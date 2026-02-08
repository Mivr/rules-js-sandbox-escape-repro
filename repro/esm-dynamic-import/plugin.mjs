// A simple "plugin" module loaded via dynamic import().
// Simulates test files loaded by Mocha, stories loaded by Storybook, etc.
export const pluginUrl = import.meta.url;
export const name = "example-plugin";
