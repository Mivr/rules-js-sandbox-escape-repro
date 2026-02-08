// Simple app that imports a utility module.
// When esbuild bundles this, it resolves the import path by following
// symlinks at the OS level (Go binary, not JS). In a Bazel runfiles
// tree with symlinks, esbuild will follow them to the source tree.
import { greet } from "./util.js";

console.log(greet("world"));
