/**
 * The words every surface uses for an agent: `rt pane attach`'s picker and
 * the VS Code Agents menu. Each surface draws its own glyph and tone; the
 * words come from here so the two never drift.
 */
import type { AgentStatus } from "./commands.ts";

export type AgentStatusKey = AgentStatus | "gate" | "ended";

export const AGENT_STATUS_WORDS: Record<AgentStatusKey, string> = {
  working: "working",
  blocked: "waiting on you",
  idle: "idle",
  done: "done",
  unknown: "unknown",
  gate: "waiting on a gate",
  ended: "ended",
};

/** An open gate outranks whatever herdr reports, since it is what the pane is waiting on. */
export function agentStatusKey(p: { agentStatus: AgentStatus; gate?: unknown }): AgentStatusKey {
  return p.gate ? "gate" : p.agentStatus;
}

export type StartedByKind = "herd" | "caller" | "run" | "agent" | "hand";

const RUN_WORDS: Record<string, string> = { work: "work run", review: "review run", respond: "respond run" };

/** Who started an agent: its herd, the `rt agent` caller, the run it belongs to, `rt agent` itself, or a person by hand. */
export function agentStartedBy(a: {
  herdId?: string;
  caller?: string;
  runType?: string;
  hasRecord: boolean;
}): { kind: StartedByKind; text: string } {
  const herdId = a.herdId ?? (a.caller?.startsWith("herd:") ? a.caller.slice("herd:".length) : undefined);
  if (herdId) return { kind: "herd", text: `herd ${herdId}` };
  if (a.caller) return { kind: "caller", text: a.caller };
  if (a.runType && a.hasRecord) return { kind: "run", text: RUN_WORDS[a.runType] ?? `${a.runType} run` };
  if (a.hasRecord) return { kind: "agent", text: "rt agent" };
  return { kind: "hand", text: "by hand" };
}
