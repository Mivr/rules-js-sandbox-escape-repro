// Repro for aspect-build/rules_js#979
// Vitest cannot find test files on Linux due to path resolution escaping.
//
// The bug: vitest's project root resolves to the source tree (via realpath)
// instead of the runfiles tree. When the source tree doesn't have all build
// outputs, vitest fails to find test files. Even when it DOES find them
// (because source files exist), it's running from the wrong location,
// breaking hermeticity.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("=== Vitest Test Discovery Test (issue #979) ===");
console.log();
console.log(`__dirname:                ${__dirname}`);
console.log(`process.cwd():            ${process.cwd()}`);
console.log();

const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(`BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`);
console.log();

let bugReproduced = false;

// Check: did __dirname escape to the source tree?
// This is what vitest uses to find its project root.
if (sourceTree && __dirname.startsWith(sourceTree)) {
    console.log("BUG: __dirname escaped to source tree!");
    console.log(`  __dirname:    ${__dirname}`);
    console.log(`  source tree:  ${sourceTree}`);
    console.log();
    console.log("  When vitest's run_vitest.mjs is loaded via ESM, import.meta.url");
    console.log("  resolves through symlinks to the source tree. This means:");
    console.log("    - vitest's project root is the source tree, not the sandbox");
    console.log("    - test files are loaded from the source tree");
    console.log("    - build outputs (compiled TS, bundled files) may not exist there");
    console.log("    - on some setups, test files themselves may not exist there");
    console.log("      (e.g., when tests are generated or in a different output dir)");
    bugReproduced = true;
}

// Also check if realpathSync.native(cwd) would escape
// (this is what vitest uses to canonicalize the project root)
const cwdReal = realpathSync.native(process.cwd());
if (sourceTree && cwdReal.startsWith(sourceTree)) {
    console.log("BUG: realpathSync.native(cwd) escaped to source tree!");
    console.log(`  cwd real: ${cwdReal}`);
    bugReproduced = true;
}

// Try to actually run vitest to demonstrate the full scenario
try {
    // chdir to where vitest config lives
    process.chdir(__dirname);
    console.log();
    console.log(`Running vitest from: ${process.cwd()}`);

    const { startVitest } = await import("vitest/node");
    const vitest = await startVitest("test", [], {
        run: true,
        config: resolve(__dirname, "vitest.config.mjs"),
    });

    if (vitest) {
        const files = vitest.state.getFiles();
        console.log(`vitest found ${files.length} test file(s)`);
        const results = files.map(f => ({
            name: f.name,
            state: f.result?.state,
        }));
        for (const r of results) {
            console.log(`  ${r.state === "pass" ? "PASS" : "FAIL"}: ${r.name}`);
        }
        await vitest.close();

        if (bugReproduced) {
            console.log();
            console.log("NOTE: vitest ran tests successfully, BUT it ran them from");
            console.log("the SOURCE TREE instead of the sandbox. This breaks hermeticity.");
        }
    }
} catch (err) {
    console.log(`vitest error: ${err.message}`);
    if (!bugReproduced) {
        bugReproduced = true;
    }
}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced - vitest path resolution escaped.");
    console.log("See: https://github.com/aspect-build/rules_js/issues/979");
    process.exit(1);
} else {
    console.log("RESULT: vitest path resolution stays in the sandbox.");
    process.exit(0);
}
