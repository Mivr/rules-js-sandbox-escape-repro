// Repro for aspect-build/rules_js#1669
// __dirname derived from import.meta.url escapes the sandbox.
//
// In ESM modules, __dirname is typically derived from import.meta.url:
//   const __dirname = dirname(fileURLToPath(import.meta.url));
//
// When the ESM resolver follows symlinks, import.meta.url points to
// the real source tree, so __dirname does too. This breaks Vite.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Two ways to resolve a relative path
const fromCwd = resolve("src/");
const fromDirname = resolve(__dirname, "src/");

// Check realpathSync.native on CWD (what Vite uses internally)
let cwdReal;
try {
    cwdReal = realpathSync.native(process.cwd());
} catch {
    cwdReal = process.cwd();
}

console.log("=== __dirname Escape Test (issue #1669) ===");
console.log();
console.log(`__filename:                 ${__filename}`);
console.log(`__dirname:                  ${__dirname}`);
console.log(`process.cwd():              ${process.cwd()}`);
console.log(`realpathSync.native(cwd):   ${cwdReal}`);
console.log();
console.log("Path resolution comparison:");
console.log(`  resolve('src/'):              ${fromCwd}`);
console.log(`  resolve(__dirname, 'src/'):   ${fromDirname}`);
console.log();

const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(`BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`);
console.log();

let bugReproduced = false;

// In bazel test mode (BUILD_WORKSPACE_DIRECTORY not set), detect escape
// by checking if the path is in the runfiles tree.
if (!sourceTree) {
    if (!__filename.includes('.runfiles/')) {
        console.log("BUG: __filename escaped the runfiles tree!");
        console.log(`  Path: ${__filename}`);
        console.log(`  Expected path to contain '.runfiles/'`);
        bugReproduced = true;
    }
}

if (sourceTree && __dirname.startsWith(sourceTree)) {
    console.log("BUG: __dirname escaped the runfiles tree!");
    console.log(`  __dirname: ${__dirname}`);
    console.log(`  source tree: ${sourceTree}`);
    console.log();
    console.log("  This is the root cause of Vite issues (#1669): when Vite");
    console.log("  uses __dirname to find its project root or resolve config");
    console.log("  files, it ends up looking in the real source tree instead");
    console.log("  of the sandbox. This leads to:");
    console.log("    - Duplicate builds (#1645)");
    console.log("    - Wrong file versions being served");
    console.log("    - Broken HMR (hot module replacement)");
    bugReproduced = true;
}

if (sourceTree && cwdReal.startsWith(sourceTree)) {
    console.log("BUG: realpathSync.native(cwd) escaped the sandbox!");
    console.log(`  cwd:     ${process.cwd()}`);
    console.log(`  escaped: ${cwdReal}`);
    console.log();
    console.log("  Vite calls realpathSync(process.cwd()) to determine the");
    console.log("  project root. When this escapes, all file serving and");
    console.log("  module resolution uses the wrong base directory.");
    bugReproduced = true;
}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced - __dirname or cwd escaped the sandbox.");
    console.log("See: https://github.com/aspect-build/rules_js/issues/1669");
    process.exit(1);
} else {
    console.log("RESULT: __dirname and cwd stayed within the sandbox.");
    process.exit(0);
}
