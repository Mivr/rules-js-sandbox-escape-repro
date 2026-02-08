// Repro for aspect-build/rules_js#353, #915
// Dynamic import() escapes the sandbox — this is how Mocha, Storybook,
// and plugin systems load files at runtime.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("=== Dynamic import() Escape Test (issues #353, #915) ===");
console.log();
console.log(`runner __dirname: ${__dirname}`);

// Dynamically import a "plugin" — simulates Mocha loading test files,
// Storybook loading stories, or any plugin system.
const pluginPath = resolve(__dirname, "plugin.mjs");
console.log(`plugin path to import: ${pluginPath}`);
console.log();

const plugin = await import(pluginPath);
const pluginResolvedPath = fileURLToPath(plugin.pluginUrl);

console.log(`plugin import.meta.url: ${plugin.pluginUrl}`);
console.log(`plugin resolved path:   ${pluginResolvedPath}`);
console.log();

const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
console.log(`BUILD_WORKSPACE_DIRECTORY: ${sourceTree || "(not set — running as test)"}`);
console.log();

let bugReproduced = false;

// In bazel test mode (BUILD_WORKSPACE_DIRECTORY not set), detect escape
// by checking if the path is in the runfiles tree.
if (!sourceTree) {
    if (!pluginResolvedPath.includes('.runfiles/')) {
        console.log("BUG: dynamic import() escaped the runfiles tree!");
        console.log(`  Path: ${pluginResolvedPath}`);
        console.log(`  Expected path to contain '.runfiles/'`);
        bugReproduced = true;
    }
}

// Check: does the dynamically imported plugin resolve to the source tree?
if (sourceTree && pluginResolvedPath.startsWith(sourceTree)) {
    console.log("BUG: dynamic import() escaped the sandbox!");
    console.log(`  plugin resolved to: ${pluginResolvedPath}`);
    console.log(`  source tree:        ${sourceTree}`);
    console.log();
    console.log("  This is how Mocha (#353) fails: it uses import() to load");
    console.log("  test files, but they resolve to the source tree. __dirname");
    console.log("  inside those files points to the real source tree, causing");
    console.log("  require() failures for compiled outputs.");
    console.log();
    console.log("  Storybook (#915) hits the same issue: webpack discovers");
    console.log("  node_modules at both the runfiles path and the escaped path,");
    console.log("  loading React twice and breaking hooks.");
    bugReproduced = true;
}

// Also check runner itself
if (sourceTree && __dirname.startsWith(sourceTree)) {
    console.log("BUG: runner __dirname escaped the sandbox!");
    console.log(`  __dirname: ${__dirname}`);
    bugReproduced = true;
}

// Show the shell realpath for comparison
try {
    const shellReal = execSync(`realpath "${pluginPath}" 2>&1`).toString().trim();
    if (shellReal !== pluginPath) {
        console.log(`Shell realpath (ground truth): ${shellReal}`);
    }
} catch {}

console.log();
if (bugReproduced) {
    console.log("RESULT: Bug reproduced - dynamic import() escaped the sandbox.");
    console.log("See: https://github.com/aspect-build/rules_js/issues/353");
    process.exit(1);
} else {
    console.log("RESULT: dynamic import() stayed within the sandbox.");
    process.exit(0);
}
