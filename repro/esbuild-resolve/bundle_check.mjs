// Repro for esbuild path resolution escaping the Bazel sandbox.
//
// On macOS, esbuild is dynamically linked, so DYLD_INSERT_LIBRARIES intercepts
// its filesystem calls directly via the native FS patch library.
//
// On Linux, esbuild is statically linked — the native fix can't intercept it.
// A separate fix (e.g. esbuild's preserveSymlinks option) would be needed there.
//
// Test with vs without the native fix:
//   bazel test //repro/esbuild-resolve:test              (bug — no fix)
//   bazel test //repro/esbuild-resolve:test --config=with-fix  (fix applied)

import * as esbuild from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(__dirname, "src/app.js");

console.log("=== esbuild Path Resolution Escape Test ===");
console.log();
console.log("esbuild version:", esbuild.version);
console.log();

// Capture all paths esbuild resolves during bundling
const resolvedPaths = [];

const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
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
console.log("realpathSync.native(__dirname) — patched:");
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
    process.exit(1);
} else {
    console.log("RESULT: esbuild resolved paths stayed within the sandbox.");
    process.exit(0);
}
