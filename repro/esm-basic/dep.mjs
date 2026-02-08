// Simple ESM dependency that exports its own import.meta.url.
// Used to verify that imported modules also resolve within the sandbox.
export const depUrl = import.meta.url;
