import type { HarnessIntegration } from "../contracts.ts";

export const claudeIntegration: HarnessIntegration = {
  id: "claude",
  label: "Claude Code",
  // Readiness and session support arrive with the session adapter.
  capabilities: async (mode) => ({
    mode, supported: [], readiness: { ready: false, reason: "Claude Code's session adapter is not built yet" },
  }),
  validateOptions: (options) => ({ ok: true, data: options }),
  options: async () => [
    { name: "model", kind: "text" },
    { name: "effort", kind: "text" },
    { name: "account", kind: "text" },
    { name: "extraArgs", kind: "text" },
    { name: "yolo", kind: "boolean" },
  ],
};
