# rules_js Sandbox Path Escaping — Reproduction & Fix Demo

Demonstrates how path resolution escapes the Bazel sandbox in
[aspect-build/rules_js](https://github.com/aspect-build/rules_js)
and how the **native FS sandbox** (`LD_PRELOAD`) fix resolves it across
Node.js LTS versions.

## The Problem

Bazel creates runfiles as **symlink trees** pointing to real files. When code
calls `realpath()` on these symlinks — whether through Node.js, Go, or any
other runtime — the paths resolve **outside** the sandbox into the real source
tree, breaking hermeticity.

On **Node.js <= 18.18.2**, the ESM module resolver captures `realpathSync` via
destructuring *before* `--require` patches run. This means the JavaScript
monkey-patches (`register.cjs`) **cannot fix ESM imports** on these versions.
The native FS sandbox fix operates at the C library level, fixing the escape
on all Node.js versions.

### Two classes of escape

| Class | Example Tools | JS Patches Help? | LD_PRELOAD Helps? | Fix |
|-------|--------------|-----------------|------------------|-----|
| **Dynamically-linked** (uses libc) | Node.js, Python, native addons | Yes (Node >= 18.19.0) | **Yes (all versions)** | Native FS sandbox (`LD_PRELOAD`) |
| **Statically-linked** (direct syscalls) | esbuild (Go), swc (Rust) | No | **No** | Tool-specific option (e.g. `preserveSymlinks`) |

## Quick Start

### Multi-Version Test Matrix

Test the fix across Node.js 18.18.2 (pre-ESM-fix), 20.17.0 (LTS), and 22.12.0 (LTS):

```bash
# Test ALL versions with the native fix — all 9 tests pass
bazel test //repro/... --config=with-fix

# Test without fix — 3 node18 tests FAIL (demonstrating the bug), 6 pass
bazel test //repro/...
```

Each repro scenario has per-version test targets (`test_node18`, `test_node20`, `test_node22`):

```bash
# Test a single scenario + version
bazel test //repro/esm-basic:test_node18 --config=with-fix

# Test one scenario across all versions
bazel test //repro/esm-basic:all_versions --config=with-fix
```

### Manual Debugging

```bash
# Reproduce the bug (default Node 18.18.2 toolchain)
bazel run //repro/esm-basic:run_bug

# Verify the fix
bazel run //repro/esm-basic:run_fix --config=with-fix
```

## Reproduction Scenarios

| Scenario | Issue | What Escapes | Targets |
|----------|-------|-------------|---------|
| ESM static import | [#362](https://github.com/aspect-build/rules_js/issues/362) | `import.meta.url` via `realpathSync` | `//repro/esm-basic:test_node{18,20,22}` |
| Dynamic `import()` | [#353](https://github.com/aspect-build/rules_js/issues/353), [#915](https://github.com/aspect-build/rules_js/issues/915) | `import()` target resolution | `//repro/esm-dynamic-import:test_node{18,20,22}` |
| `__dirname` | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | `import.meta.url`-derived `__dirname` | `//repro/dirname-escape:test_node{18,20,22}` |
| Vite root | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | `realpathSync(cwd)` and `__dirname` | `//repro/vite-dev:run_bug` |
| Vitest | [#979](https://github.com/aspect-build/rules_js/issues/979) | Test file discovery via escaped paths | `//repro/vitest:run_bug` |
| **esbuild** | — | esbuild resolves imports through symlinks | `//repro/esbuild-resolve:run_bug` / `:run_fix` |

### Expected Test Results

| Version | Without Fix | With `--config=with-fix` | Why |
|---------|------------|-------------------------|-----|
| Node 18.18.2 | **FAIL** | PASS | JS patches can't fix ESM; native LD fix needed |
| Node 20.17.0 | PASS | PASS | JS patches work for ESM on this version |
| Node 22.12.0 | PASS | PASS | JS patches work for ESM on this version |

## How the Native FS Sandbox Fix Works

The fix is a C shared library loaded via `LD_PRELOAD` with three layers:

### Tier 1 — `realpath()` interposition (all Node versions)

Intercepts `realpath()`, `__realpath_chk()`, and `canonicalize_file_name()` at the glibc level. For each call, it walks symlinks hop-by-hop — if a hop would escape a sandbox root, it stops and returns the last in-root path.

This handles `realpathSync.native()` and any C-level `realpath()` calls.

### Tier 2 — `lstat()` interposition (Node <= 18.18.2 only)

On older Node versions, the ESM resolver's internal `realpathSync` uses
`lstat()` + `readlink()` instead of C `realpath()`, bypassing Tier 1.

The fix:

1. **seccomp BPF filter** blocks the `statx` syscall (returns `ENOSYS`),
   because libuv calls `statx` via raw `syscall()` — LD_PRELOAD can't intercept
   raw syscalls. When `statx` fails, libuv falls back to `lstat()` via glibc.

2. **`__lxstat` / `lstat` / `fstatat` interposition** — when `lstat` detects a
   symlink that would escape the sandbox, it replaces the result with `stat()`
   output (following the symlink), making the symlink appear as a regular file.
   Node's `realpathSync` then sees a "regular file" and skips `readlink()`,
   using the sandbox path as-is.

3. **Delayed activation** — the lstat guard starts *disabled* to avoid breaking
   CJS module loading at startup. After `register.cjs` finishes (via `--require`),
   it sets `JS_BINARY__FS_PATCH_READLINK=1` on Node < 18.19.0. The guard polls
   this env var and enables itself. Since ESM imports happen after `--require`,
   the guard is active in time.

> **Key discovery**: Node.js links against `__lxstat@GLIBC_2.2.5` (old glibc
> symbol), not `lstat@GLIBC_2.33`. The fix intercepts `__lxstat`, `__lxstat64`,
> `lstat`, and `fstatat` to cover all glibc versions.

### Why not intercept `readlink()` instead?

We tried — but Node 18.18.2's ESM resolver has **no try-catch** around
`realpathSync`. Returning `EINVAL` from `readlink()` (to pretend the path isn't
a symlink) crashes the resolver. The `lstat` approach is non-destructive: it
only modifies the stat result, and all callers handle "regular file" gracefully.

## Setup

```bash
# Clone this repo
git clone https://github.com/Mivr/rules-js-sandbox-escape-repro
cd rules-js-sandbox-escape-repro

# Run all tests with the fix
bazel test //repro/... --config=with-fix
```

The `--config=with-fix` flag (defined in `.bazelrc`) overrides `aspect_rules_js`
with a local fork that includes the native FS sandbox. Update the path in
`.bazelrc` to point to your own checkout:

```
build:with-fix --override_module=aspect_rules_js=/path/to/your/rules_js_fork
```

## Node Versions Tested

| Toolchain | Version | Status |
|-----------|---------|--------|
| `node18` | 18.18.2 | Last version before ESM resolver fix |
| `node20` | 20.17.0 | Maintenance LTS |
| `node22` | 22.12.0 | Active LTS |

## Related Issues

- [#362](https://github.com/aspect-build/rules_js/issues/362) — ESM imports escape the sandbox & runfiles (core issue)
- [#353](https://github.com/aspect-build/rules_js/issues/353) — Mocha tests escaping the sandbox
- [#347](https://github.com/aspect-build/rules_js/issues/347) — Angular architect escaping runfiles
- [#446](https://github.com/aspect-build/rules_js/issues/446) — js_binary + ESM + hermeticity
- [#490](https://github.com/aspect-build/rules_js/issues/490) — Imports escape with `--inspect-brk`
- [#915](https://github.com/aspect-build/rules_js/issues/915) — Storybook loads React twice
- [#979](https://github.com/aspect-build/rules_js/issues/979) — Vitest on Linux cannot find test files
- [#1669](https://github.com/aspect-build/rules_js/issues/1669) — `__dirname` is not hermetic

## Platform Support

| Platform | Bug Reproduces | LD_PRELOAD Fix | Notes |
|----------|---------------|----------------|-------|
| Linux x86_64 | Yes | Yes | Primary target |
| Linux aarch64 | Yes | Planned | Needs CC toolchain |
| macOS | Yes | Limited | `DYLD_INSERT_LIBRARIES` + SIP restrictions |
| Windows | No | N/A | No symlink sandbox |
