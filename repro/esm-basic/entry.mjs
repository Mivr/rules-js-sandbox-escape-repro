// Repro for aspect-build/rules_js#362
// ESM static import resolves through symlinks, escaping the sandbox.
//
// The Node.js ESM resolver captures realpathSync via destructuring
// BEFORE any --require patches run, so it always uses the unpatched
// version that follows symlinks out of the Bazel sandbox.
//
// To reproduce, we need:
//   copy_data_to_bin = False  (so runfiles are symlinks to source tree)
//   preserve_symlinks_main = False  (so ESM resolver follows symlinks)

import { depUrl } from "./dep.mjs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const entryPath = fileURLToPath(import.meta.url);
const depPath = fileURLToPath(depUrl);

console.log("=== ESM Basic Import Escape Test (issue #362) ===");
console.log();

// Show Node.js flags
console.log("Node.js flags: " + JSON.stringify(process.execArgv));
console.log();

console.log("import.meta.url paths:");
console.log(`  entry: ${entryPath}`);
console.log(`  dep:   ${depPath}`);
console.log();

// Get the real path via shell (bypasses all JS patches)
let shellRealEntry = "";
let shellRealDep = "";
try {
    shellRealEntry = execSync(`realpath "${entryPath}" 2>&1`).toString().trim();
    shellRealDep = execSync(`realpath "${depPath}" 2>&1`).toString().trim();
} catch {}
console.log("Shell realpath (ground truth, bypasses patches):");
console.log(`  entry: ${shellRealEntry}`);
console.log(`  dep:   ${shellRealDep}`);
console.log();

// realpathSync.native() from JS (patched by register.cjs)
const realEntryNative = realpathSync.native(entryPath);
const realDepNative = realpathSync.native(depPath);
console.log("realpathSync.native() (JS-patched):");
console.log(`  entry: ${realEntryNative}`);
console.log(`  dep:   ${realDepNative}`);
console.log();

// Key test: the source tree vs runfiles
const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(`BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`);
console.log();

let bugReproduced = false;

// Check 1: Does import.meta.url itself point to the source tree?
// This happens when the ESM resolver follows symlinks during module loading.
if (sourceTree) {
    if (entryPath.startsWith(sourceTree)) {
        console.log("BUG: entry import.meta.url points to SOURCE TREE!");
        console.log(`  Expected: ...runfiles/_main/repro/esm-basic/entry.mjs`);
        console.log(`  Got:      ${entryPath}`);
        bugReproduced = true;
    }
    if (depPath.startsWith(sourceTree)) {
        console.log("BUG: dep import.meta.url points to SOURCE TREE!");
        console.log(`  Expected: ...runfiles/_main/repro/esm-basic/dep.mjs`);
        console.log(`  Got:      ${depPath}`);
        bugReproduced = true;
    }
}

// Check 1b: In bazel test mode (BUILD_WORKSPACE_DIRECTORY not set),
// detect escape by checking if the path is in the runfiles tree.
// Bazel runfiles paths always contain /runfiles/ — source tree paths don't.
if (!sourceTree) {
    if (!entryPath.includes('.runfiles/')) {
        console.log("BUG: entry import.meta.url escaped the runfiles tree!");
        console.log(`  Path: ${entryPath}`);
        console.log(`  Expected path to contain '.runfiles/'`);
        bugReproduced = true;
    }
    if (!depPath.includes('.runfiles/')) {
        console.log("BUG: dep import.meta.url escaped the runfiles tree!");
        console.log(`  Path: ${depPath}`);
        bugReproduced = true;
    }
}

// Check 2: Does the path differ from the shell realpath?
// If the files are symlinks, shell realpath shows where they actually point.
// If import.meta.url matches the shell realpath (source tree), the ESM
// resolver followed the symlinks.
if (shellRealEntry && shellRealEntry !== entryPath) {
    console.log("NOTE: Shell realpath differs from import.meta.url:");
    console.log(`  import.meta.url: ${entryPath}`);
    console.log(`  shell realpath:  ${shellRealEntry}`);
    console.log("  This means symlinks exist but weren't fully followed.");
}

// Check 3: Does realpathSync.native() escape?
// In user code, this is patched. But the ESM resolver uses the UNPATCHED
// version internally, so even though this check passes, the resolver
// may still escape.
if (shellRealEntry && realEntryNative !== shellRealEntry) {
    console.log("INFO: realpathSync.native() is patched (returns guarded path).");
    console.log(`  patched: ${realEntryNative}`);
    console.log(`  real:    ${shellRealEntry}`);
}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced - ESM resolver escaped the sandbox.");
    console.log("  import.meta.url points to the real source tree instead of");
    console.log("  the Bazel runfiles tree. This means __dirname, relative");
    console.log("  requires, and all path-based operations use wrong paths.");
    console.log("See: https://github.com/aspect-build/rules_js/issues/362");
    process.exit(1);
} else {
    console.log("RESULT: No escape detected in import.meta.url.");
    process.exit(0);
}
