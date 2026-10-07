import type { HarnessIntegration } from "../contracts.ts";
import { codexMessagingConnection, codexSessionLive } from "./link.ts";

export const codexIntegration: HarnessIntegration = {
  id: "codex",
  label: "Codex",
  sessionEnv: ["CODEX_THREAD_ID"],
  messagingConnection: codexMessagingConnection,
  sessionLive: (binding) => (binding.native.harness === "codex" && binding.native.kind === "id" ? codexSessionLive(binding) : undefined),
  capabilities: async (mode) => {
    const { codexReadiness, codexSupported } = await import("./sessions.ts");
    return { mode, supported: codexSupported(mode), readiness: codexReadiness() };
  },
  validateOptions: (options) => options.account !== undefined
    ? { ok: false, error: { code: "unsupported", message: "codex does not support --account in this version (see spec's Non-goals)" } }
    : { ok: true, data: options },
  options: async () => [
    { name: "model", kind: "text" },
    { name: "effort", kind: "text" },
    { name: "extraArgs", kind: "text" },
    { name: "yolo", kind: "boolean" },
  ],
  loadSessions: async () => (await import("./sessions.ts")).loadCodexSessions(),
  loadMessaging: async () => (await import("./sessions.ts")).loadCodexMessaging(),
  loadQuestions: async () => (await import("./sessions.ts")).loadCodexQuestions(),
};
