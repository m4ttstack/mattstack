import type { HarnessIntegration } from "../contracts.ts";

export const codexIntegration: HarnessIntegration = {
  id: "codex",
  label: "Codex",
  // Readiness and session support arrive with the session adapter.
  capabilities: async (mode) => ({
    mode, supported: [], readiness: { ready: false, reason: "Codex's session adapter is not built yet" },
  }),
  validateOptions: (options) => options.account !== undefined
    ? { ok: false, error: { code: "unsupported", message: "codex does not support --account in this version (see spec's Non-goals)" } }
    : { ok: true, data: options },
  options: async () => [
    { name: "model", kind: "text" },
    { name: "effort", kind: "text" },
    { name: "extraArgs", kind: "text" },
    { name: "yolo", kind: "boolean" },
  ],
};
