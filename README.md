# rules_js Sandbox Path Escaping — Reproduction & Fix Demo

Demonstrates how path resolution escapes the Bazel sandbox in
[aspect-build/rules_js](https://github.com/aspect-build/rules_js)
and how the **native FS sandbox** fix resolves it across Node.js LTS versions
on both **Linux** (`LD_PRELOAD`) and **macOS** (`DYLD_INSERT_LIBRARIES`).

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

| Class | Example Tools | JS Patches Help? | Native Fix Helps? | Notes |
|-------|--------------|-----------------|-------------------|-------|
| **Dynamically-linked** (uses libc) | Node.js, Python, native addons | Yes (Node >= 18.19.0) | **Yes (all versions)** | `LD_PRELOAD` on Linux, `DYLD_INSERT_LIBRARIES` on macOS |
| **Statically-linked** (direct syscalls) | esbuild (Linux/Go static), swc (Rust) | No | **No** | Tool-specific option (e.g. `preserveSymlinks`) |

> **macOS note**: esbuild is **dynamically linked** on macOS ARM64, so
> `DYLD_INSERT_LIBRARIES` intercepts it directly. No `preserveSymlinks` needed.

## Quick Start

### Full Test Matrix

Test the fix across Node.js 18.18.2 (pre-ESM-fix), 20.17.0 (LTS), and 22.12.0 (LTS),
plus esbuild, Vite, and Vitest scenarios:

```bash
# Test ALL scenarios with the native fix — all 14 tests pass
bazel test //repro/... --config=with-fix

# Test without fix — 8 tests FAIL (demonstrating the bug), 6 pass
bazel test //repro/...
```

Each ESM repro scenario has per-version test targets (`test_node18`, `test_node20`, `test_node22`):

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

| Scenario | Issue | What Escapes | Test Target |
|----------|-------|-------------|-------------|
| ESM static import | [#362](https://github.com/aspect-build/rules_js/issues/362) | `import.meta.url` via `realpathSync` | `//repro/esm-basic:test_node{18,20,22}` |
| Dynamic `import()` | [#353](https://github.com/aspect-build/rules_js/issues/353), [#915](https://github.com/aspect-build/rules_js/issues/915) | `import()` target resolution | `//repro/esm-dynamic-import:test_node{18,20,22}` |
| `__dirname` | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | `import.meta.url`-derived `__dirname` | `//repro/dirname-escape:test_node{18,20,22}` |
| Vite root | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | `realpathSync(cwd)` and `__dirname` | `//repro/vite-dev:test_bug` / `:test_fix` |
| Vitest | [#979](https://github.com/aspect-build/rules_js/issues/979) | Test file discovery via escaped paths | `//repro/vitest:test_bug` / `:test_fix` |
| esbuild | — | esbuild resolves imports through symlinks | `//repro/esbuild-resolve:test` |

## Compatibility Matrix

Full results across all bug scenarios, Node versions, and platforms — with and without the native FS sandbox fix.

Legend: **PASS** = test passes, **FAIL** = path escapes the sandbox, N/A = not applicable

### ESM Scenarios (per Node version)

| Scenario | Issue | Node | Linux no fix | Linux + fix | macOS no fix | macOS + fix |
|----------|-------|------|:------------:|:-----------:|:------------:|:-----------:|
| ESM static import | [#362](https://github.com/aspect-build/rules_js/issues/362) | 18.18.2 | **FAIL** | PASS | **FAIL** | PASS |
| | | 20.17.0 | PASS | PASS | PASS | PASS |
| | | 22.12.0 | PASS | PASS | PASS | PASS |
| Dynamic `import()` | [#353](https://github.com/aspect-build/rules_js/issues/353) | 18.18.2 | **FAIL** | PASS | **FAIL** | PASS |
| | | 20.17.0 | PASS | PASS | PASS | PASS |
| | | 22.12.0 | PASS | PASS | PASS | PASS |
| `__dirname` escape | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | 18.18.2 | **FAIL** | PASS | **FAIL** | PASS |
| | | 20.17.0 | PASS | PASS | PASS | PASS |
| | | 22.12.0 | PASS | PASS | PASS | PASS |

**Why Node 18 fails without the fix**: On Node <= 18.18.2, the ESM resolver captures `realpathSync` via destructuring *before* `--require` patches run. The JS monkey-patches cannot intercept the already-captured function. The native fix operates at the C library level, intercepting `realpath()` and `lstat()` before Node even sees them.

**Why Node 20/22 pass without the fix**: Node >= 18.19.0 changed the ESM resolver to call `realpathSync` late enough that `--require` patches can intercept it. The JS patches in `register.cjs` are sufficient.

### Tool Scenarios (version-independent)

| Scenario | Issue | Linux no fix | Linux + fix | macOS no fix | macOS + fix | Notes |
|----------|-------|:------------:|:-----------:|:------------:|:-----------:|-------|
| esbuild resolve | — | **FAIL** | **FAIL**\* | **FAIL** | PASS | \*Linux: esbuild is statically-linked Go, bypasses `LD_PRELOAD` |
| Vite dev root | [#1669](https://github.com/aspect-build/rules_js/issues/1669) | **FAIL** | PASS | **FAIL** | PASS | `realpathSync(cwd)` + `__dirname` escape |
| Vitest config | [#979](https://github.com/aspect-build/rules_js/issues/979) | **FAIL** | PASS | **FAIL** | PASS | Test file discovery via escaped paths |

\*esbuild on **Linux** is a statically-linked Go binary that makes direct syscalls — `LD_PRELOAD` cannot intercept it. Use esbuild's `preserveSymlinks` option or the `ESBUILD_PRESERVE_SYMLINKS=1` env var as a workaround. On **macOS**, esbuild is dynamically linked, so `DYLD_INSERT_LIBRARIES` intercepts it directly.

### Summary

|  | Linux no fix | Linux + fix | macOS no fix | macOS + fix |
|--|:------------:|:-----------:|:------------:|:-----------:|
| Tests passing | 6 / 14 | 13 / 14 | 6 / 14 | **14 / 14** |
| ESM on Node 18 | FAIL | PASS | FAIL | PASS |
| ESM on Node 20+ | PASS | PASS | PASS | PASS |
| esbuild | FAIL | FAIL\* | FAIL | PASS |
| Vite / Vitest | FAIL | PASS | FAIL | PASS |

\*Requires `preserveSymlinks` workaround on Linux (statically-linked binary).

## How the Native FS Sandbox Fix Works

The fix is a C shared library loaded via `LD_PRELOAD` (Linux) or
`DYLD_INSERT_LIBRARIES` (macOS).

### Tier 1 — `realpath()` interposition (all Node versions)

Intercepts `realpath()` at the C library level. For each call, it walks
symlinks hop-by-hop — if a hop would escape a sandbox root, it stops and
returns the last in-root path.

On Linux, also intercepts `__realpath_chk()` and `canonicalize_file_name()`.

### Tier 2 — `lstat()` interposition (Node <= 18.18.2 + esbuild on macOS)

On older Node versions, the ESM resolver's internal `realpathSync` uses
`lstat()` + `readlink()` instead of C `realpath()`, bypassing Tier 1.

When `lstat` detects a symlink that would escape the sandbox, it replaces the
result with `stat()` output (following the symlink), making the symlink appear
as a regular file. The caller then skips `readlink()` and uses the sandbox
path as-is.

#### Linux implementation

1. **seccomp BPF filter** blocks the `statx` syscall (returns `ENOSYS`),
   because libuv calls `statx` via raw `syscall()` — `LD_PRELOAD` can't
   intercept raw syscalls. When `statx` fails, libuv falls back to `lstat()`
   via glibc.

2. **`__lxstat` / `lstat` / `fstatat` interposition** — intercepts all glibc
   lstat variants.

3. **Delayed activation** — the lstat guard starts *disabled* to avoid breaking
   CJS module loading at startup. After `register.cjs` finishes (via `--require`),
   it sets `JS_BINARY__FS_PATCH_READLINK=1` on Node < 18.19.0. The guard polls
   this env var and enables itself.

#### macOS implementation

macOS is simpler because:
- No seccomp BPF needed — `DYLD_INSERT_LIBRARIES` directly interposes `lstat`
  for all dynamically-linked processes (including esbuild on macOS ARM64)
- No delayed activation needed — the interposition is immediate
- Uses `fstatat(AT_FDCWD, ...)` internally to call the real `lstat`, because
  DYLD `__DATA,__interpose` causes `dlsym(RTLD_NEXT, "lstat")` to return the
  interposed function, which would cause infinite recursion

**macOS SIP workaround**: macOS System Integrity Protection strips `DYLD_*`
environment variables when the exec chain passes through SIP-restricted
binaries (`/bin/bash`, `/usr/bin/env`). The fix passes the dylib path via a
SIP-safe env var (`JS_BINARY__NATIVE_PATCH_PATH`). The node wrapper restores
`DYLD_INSERT_LIBRARIES` right before `exec`'ing the node binary (which is not
SIP-restricted).

### Why not intercept `readlink()` instead?

Node 18.18.2's ESM resolver has **no try-catch** around `realpathSync`.
Returning `EINVAL` from `readlink()` (to pretend the path isn't a symlink)
crashes the resolver. The `lstat` approach is non-destructive: it only modifies
the stat result, and all callers handle "regular file" gracefully.

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

The fork must be on the `native-fs-sandbox` branch.

## Node Versions Tested

| Toolchain | Version | Status |
|-----------|---------|--------|
| `node18` | 18.18.2 | Last version before ESM resolver fix |
| `node20` | 20.17.0 | Maintenance LTS |
| `node22` | 22.12.0 | Active LTS |

## Platform Support

| Platform | Bug Reproduces | Native Fix Works | Notes |
|----------|---------------|-----------------|-------|
| Linux x86_64 | Yes | Yes | `LD_PRELOAD` + seccomp BPF for lstat |
| Linux aarch64 | Yes | Planned | Needs CC toolchain |
| macOS ARM64 | Yes | **Yes** | `DYLD_INSERT_LIBRARIES` + SIP workaround |
| macOS x86_64 | Yes | **Yes** | Same as ARM64 |
| Windows | No | N/A | No symlink sandbox |

## Related Issues

- [#362](https://github.com/aspect-build/rules_js/issues/362) — ESM imports escape the sandbox & runfiles (core issue)
- [#353](https://github.com/aspect-build/rules_js/issues/353) — Mocha tests escaping the sandbox
- [#347](https://github.com/aspect-build/rules_js/issues/347) — Angular architect escaping runfiles
- [#446](https://github.com/aspect-build/rules_js/issues/446) — js_binary + ESM + hermeticity
- [#490](https://github.com/aspect-build/rules_js/issues/490) — Imports escape with `--inspect-brk`
- [#915](https://github.com/aspect-build/rules_js/issues/915) — Storybook loads React twice
- [#979](https://github.com/aspect-build/rules_js/issues/979) — Vitest on Linux cannot find test files
- [#1669](https://github.com/aspect-build/rules_js/issues/1669) — `__dirname` is not hermetic
