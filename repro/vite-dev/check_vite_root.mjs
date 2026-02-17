// Repro for aspect-build/rules_js#1669 (Vite-specific)
//
// Vite determines the project root by calling realpathSync(process.cwd())
// and resolves config files relative to __dirname. Both escape the sandbox.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { realpathSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Replicate Vite's root resolution: realpathSync(process.cwd())
const cwd = process.cwd();
let cwdReal;
try {
    cwdReal = realpathSync.native(cwd);
} catch {
    cwdReal = cwd;
}

// Vite resolves config and index.html relative to root
const configFromDirname = resolve(__dirname, "vite.config.mjs");
const configFromCwd = resolve(cwd, "vite.config.mjs");
const indexFromDirname = resolve(__dirname, "index.html");
const indexFromCwd = resolve(cwd, "index.html");

console.log("=== Vite Root Resolution Test (issue #1669) ===");
console.log();
console.log("Vite's root resolution:");
console.log(`  process.cwd():              ${cwd}`);
console.log(`  realpathSync.native(cwd):   ${cwdReal}`);
console.log(`  __dirname:                  ${__dirname}`);
console.log();
console.log("Config file resolution:");
console.log(`  from __dirname: ${configFromDirname} (exists: ${existsSync(configFromDirname)})`);
console.log(`  from cwd:       ${configFromCwd} (exists: ${existsSync(configFromCwd)})`);
console.log();
console.log("index.html resolution:");
console.log(`  from __dirname: ${indexFromDirname} (exists: ${existsSync(indexFromDirname)})`);
console.log(`  from cwd:       ${indexFromCwd} (exists: ${existsSync(indexFromCwd)})`);
console.log();

const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(`BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`);
console.log();

let bugReproduced = false;

if (sourceTree) {
    // In run mode (BUILD_WORKSPACE_DIRECTORY is set), check against source tree
    if (__dirname.startsWith(sourceTree)) {
        console.log("BUG: __dirname in vite.config escaped to source tree!");
        console.log(`  __dirname: ${__dirname}`);
        console.log(`  Vite would resolve config/index.html from the source tree.`);
        bugReproduced = true;
    }

    if (cwdReal.startsWith(sourceTree)) {
        console.log("BUG: Vite's root (realpathSync.native(cwd)) escaped!");
        console.log(`  Vite would look for files in: ${cwdReal}`);
        console.log(`  Instead of the sandbox at:    ${cwd}`);
        bugReproduced = true;
    }
} else {
    // In test mode (no BUILD_WORKSPACE_DIRECTORY), check .runfiles/ or /execroot/ in path
    if (!__dirname.includes('.runfiles/') && !__dirname.includes('/execroot/')) {
        console.log("BUG: __dirname escaped the runfiles tree!");
        console.log(`  __dirname: ${__dirname}`);
        bugReproduced = true;
    }

    if (!cwdReal.includes('.runfiles/') && !cwdReal.includes('/execroot/')) {
        console.log("BUG: realpathSync.native(cwd) escaped the runfiles tree!");
        console.log(`  cwdReal: ${cwdReal}`);
        bugReproduced = true;
    }
}

if (bugReproduced) {
    console.log();
    console.log("Impact on Vite:");
    console.log("  - Vite dev server serves files from the real source tree");
    console.log("  - HMR watches wrong directory");
    console.log("  - May cause duplicate React instances (#915)");
}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced - Vite root resolution escaped.");
    console.log("See: https://github.com/aspect-build/rules_js/issues/1669");
    process.exit(1);
} else {
    console.log("RESULT: Vite root resolution stays in the sandbox.");
    process.exit(0);
}
