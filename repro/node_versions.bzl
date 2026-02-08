"""Node.js version toolchain definitions for multi-version testing."""

# Toolchain names and their platform-specific targets.
# Usage in BUILD.bazel:
#   load("//repro:node_versions.bzl", "NODE_TOOLCHAINS")
#   [js_test(
#       name = "test_%s" % name,
#       node_toolchain = toolchain,
#       ...
#   ) for name, toolchain in NODE_TOOLCHAINS.items()]

NODE_TOOLCHAINS = {
    "node18": select({
        "@bazel_tools//src/conditions:linux_x86_64": "@node18_linux_amd64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_arm64": "@node18_darwin_arm64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_x86_64": "@node18_darwin_amd64//:node_toolchain",
        "//conditions:default": "@node18_linux_amd64//:node_toolchain",
    }),
    "node20": select({
        "@bazel_tools//src/conditions:linux_x86_64": "@node20_linux_amd64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_arm64": "@node20_darwin_arm64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_x86_64": "@node20_darwin_amd64//:node_toolchain",
        "//conditions:default": "@node20_linux_amd64//:node_toolchain",
    }),
    "node22": select({
        "@bazel_tools//src/conditions:linux_x86_64": "@node22_linux_amd64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_arm64": "@node22_darwin_arm64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_x86_64": "@node22_darwin_amd64//:node_toolchain",
        "//conditions:default": "@node22_linux_amd64//:node_toolchain",
    }),
}
