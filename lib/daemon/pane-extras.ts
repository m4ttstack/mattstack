/**
 * What mattstack knows about a pane beyond herdr and chat presence: the
 * `rt agent` record that launched it, the herd job it works, and the open
 * gate it waits on. Pure; pane:list gathers the sources once per call.
 */
import type { ChatPane, ChatPaneAgent, GateRow } from "../../packages/rt-client/src/commands.ts";
import type { AgentRecord } from "../state/agents-store.ts";
import type { HerdJobRow } from "./herd-store.ts";

export interface PaneExtrasSources {
  agents: AgentRecord[];
  jobsByPane: (ref: string) => HerdJobRow[];
  openGates: GateRow[];
}

function newest(records: AgentRecord[]): AgentRecord | undefined {
  return records.reduce<AgentRecord | undefined>((best, r) => (!best || r.createdAt > best.createdAt ? r : best), undefined);
}

// herdr renumbers panes and records live 30 days, so a pane id alone only
// counts for a record still running. Records store bg panes in ref form, so
// ref equality also keeps the two servers apart.
function matchAgent(pane: ChatPane, agents: AgentRecord[]): AgentRecord | undefined {
  const bySession = pane.sessionId ? newest(agents.filter((r) => r.sessionId === pane.sessionId)) : undefined;
  return bySession ?? newest(agents.filter((r) => r.paneId === pane.paneId && r.finishedAt === undefined));
}

function toAgent(r: AgentRecord): ChatPaneAgent {
  return {
    id: r.id,
    provider: r.provider,
    ...(r.caller ? { caller: r.caller } : {}),
    ...(r.label ? { label: r.label } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.effort ? { effort: r.effort } : {}),
    ...(r.account ? { account: r.account } : {}),
    startedAt: r.createdAt,
  };
}

export function paneExtras(pane: ChatPane, src: PaneExtrasSources): Pick<ChatPane, "agent" | "herd" | "gate"> {
  const out: Pick<ChatPane, "agent" | "herd" | "gate"> = {};
  const rec = matchAgent(pane, src.agents);
  if (rec) out.agent = toAgent(rec);
  const job = src.jobsByPane(pane.paneId)[0];
  if (job) out.herd = { herdId: job.herd, job: job.name };
  const gate = src.openGates.find((g) => (g.origin?.paneId ?? g.pane) === pane.paneId);
  if (gate) out.gate = { id: gate.id, question: gate.questions[0]?.label ?? "" };
  return out;
}
