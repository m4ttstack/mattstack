import { homedir } from "os";
import type { HarnessIntegration } from "../contracts.ts";

export const claudeIntegration: HarnessIntegration = {
  id: "claude",
  label: "Claude Code",
  sessionEnv: ["CLAUDE_CODE_SESSION_ID"],
  typedPaneInput: true,
  sessionForPid: async (pid) => {
    const { registryRoots, sessionForPid } = await import("../../claude-registry.ts");
    return sessionForPid(pid, { roots: registryRoots(process.env.HOME ?? homedir()) });
  },
  capabilities: async (mode) => {
    const { claudeReadiness, claudeSupported } = await import("./sessions.ts");
    return { mode, supported: claudeSupported(mode), readiness: claudeReadiness() };
  },
  validateOptions: (options) => ({ ok: true, data: options }),
  options: async () => [
    { name: "model", kind: "text" },
    { name: "effort", kind: "text" },
    { name: "account", kind: "text" },
    { name: "extraArgs", kind: "text" },
    { name: "yolo", kind: "boolean" },
  ],
  loadSessions: async () => (await import("./sessions.ts")).createClaudeSessions(),
  loadMessaging: async () => (await import("./messaging.ts")).createClaudeMessaging(),
};
