// Repro for esbuild path resolution escaping the Bazel sandbox.
//
// esbuild is a STATICALLY-LINKED Go binary. This means:
//   - Node.js fs patches (register.cjs) don't work: esbuild never uses Node's fs
//   - LD_PRELOAD native fix doesn't work: static binaries bypass the dynamic linker
//
// The ONLY fix is esbuild's own `preserveSymlinks: true` option.
//
// Run with ESBUILD_PRESERVE_SYMLINKS=1 env var to test the fix:
//   ESBUILD_PRESERVE_SYMLINKS=1 bazel run //repro/esbuild-resolve:run_bug

import * as esbuild from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(__dirname, "src/app.js");

const preserveSymlinks = process.env.ESBUILD_PRESERVE_SYMLINKS === "1";

console.log("=== esbuild Path Resolution Escape Test ===");
console.log();
console.log("esbuild version:", esbuild.version);
console.log("preserveSymlinks:", preserveSymlinks);
console.log();

// Capture all paths esbuild resolves during bundling
const resolvedPaths = [];

const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    // esbuild's own symlink control — the only way to prevent escape
    // for statically-linked Go binaries (LD_PRELOAD can't help here)
    preserveSymlinks,
    plugins: [
        {
            name: "capture-paths",
            setup(build) {
                build.onLoad({ filter: /\.(js|mjs|ts)$/ }, (args) => {
                    resolvedPaths.push(args.path);
                    return null;
                });
            },
        },
    ],
});

console.log("Entry point (as passed to esbuild):");
console.log(`  ${entryPoint}`);
console.log();

console.log("Paths resolved by esbuild (from onLoad plugin):");
for (const p of resolvedPaths) {
    console.log(`  ${p}`);
}
console.log();

console.log("Metafile inputs:");
for (const [key, value] of Object.entries(result.metafile.inputs)) {
    console.log(`  ${key} (${value.bytes} bytes)`);
}
console.log();

console.log("__dirname (from import.meta.url):");
console.log(`  ${__dirname}`);
console.log();

const realDirname = realpathSync.native(__dirname);
console.log("realpathSync.native(__dirname) — JS-patched:");
console.log(`  ${realDirname}`);
console.log();

// Key check: do the resolved paths escape to the source tree?
const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(
    `BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`
);
console.log();

let bugReproduced = false;

if (sourceTree) {
    const escapedPaths = resolvedPaths.filter((p) =>
        p.startsWith(sourceTree)
    );
    if (escapedPaths.length > 0) {
        console.log("BUG: esbuild resolved paths escape to SOURCE TREE!");
        console.log();
        console.log("  WHY: esbuild is a statically-linked Go binary.");
        console.log("  - Node.js fs patches: INEFFECTIVE (esbuild doesn't use Node fs)");
        console.log("  - LD_PRELOAD native fix: INEFFECTIVE (static binary, no dynamic linker)");
        console.log("  - esbuild preserveSymlinks: " + (preserveSymlinks ? "ENABLED but still escaped?!" : "NOT SET (this is the fix)"));
        console.log();
        for (const p of escapedPaths) {
            console.log(`  ESCAPED: ${p}`);
        }
        bugReproduced = true;
    }
} else {
    const escapedPaths = resolvedPaths.filter(
        (p) => !p.includes("/runfiles/") && !p.includes("/execroot/")
    );
    if (escapedPaths.length > 0) {
        console.log("BUG: esbuild resolved paths outside the sandbox!");
        for (const p of escapedPaths) {
            console.log(`  ESCAPED: ${p}`);
        }
        bugReproduced = true;
    }
}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced — esbuild escaped the sandbox.");
    console.log("  esbuild resolved imports through symlinks to the real source tree.");
    console.log("  Neither Node.js fs patches nor LD_PRELOAD can fix this.");
    console.log("  Fix: set esbuild's `preserveSymlinks: true` option.");
    process.exit(1);
} else {
    console.log("RESULT: esbuild resolved paths stayed within the sandbox.");
    if (preserveSymlinks) {
        console.log("  esbuild's preserveSymlinks option prevented the escape.");
    }
    process.exit(0);
}
