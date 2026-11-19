/**
 * What mattstack knows about a pane beyond herdr and chat presence: the
 * `rt agent` record that launched it, the herd job it works, and the open
 * gate it waits on. Pure; pane:list gathers the sources once per call.
 */
import type { ChatPane, ChatPaneAgent, GateRow } from "../../packages/rt-client/src/commands.ts";
import type { AgentRecord } from "../state/agents-store.ts";
import { gateHints } from "./gate-push.ts";
import { WATCHED_JOB_STATUSES, type HerdJobRow } from "./herd-store.ts";

export interface PaneExtrasSources {
  agents: AgentRecord[];
  jobsByPane: (ref: string) => HerdJobRow[];
  herdActive: (herdId: string) => boolean;
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

const sameSession = (pane: ChatPane, session: string | null | undefined) => !pane.sessionId || !session || session === pane.sessionId;

// Job rows outlive their herd and keep their pane, and herdr reuses pane ids,
// so only a live herd's job counts, one whose worker is still at it first.
function matchJob(pane: ChatPane, src: PaneExtrasSources): HerdJobRow | undefined {
  const rank = (j: HerdJobRow) => (WATCHED_JOB_STATUSES.has(j.status) ? 1 : 0);
  return src
    .jobsByPane(pane.paneId)
    .filter((j) => src.herdActive(j.herd) && sameSession(pane, j.agentSession))
    .sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)[0];
}

// rt gate ask records the bare HERDR_PANE_ID while bg rows carry the bg: ref,
// so the nudged session decides first and the pane id only when it is unknown.
function matchGate(pane: ChatPane, gates: GateRow[]): GateRow | undefined {
  const bySession = pane.sessionId ? gates.find((g) => g.nudge?.session === pane.sessionId) : undefined;
  return bySession ?? gates.find((g) => gateHints(g).paneId === pane.paneId && sameSession(pane, g.nudge?.session));
}

export function paneExtras(pane: ChatPane, src: PaneExtrasSources): Pick<ChatPane, "agent" | "herd" | "gate"> {
  const out: Pick<ChatPane, "agent" | "herd" | "gate"> = {};
  const rec = matchAgent(pane, src.agents);
  if (rec) out.agent = toAgent(rec);
  const job = matchJob(pane, src);
  if (job) out.herd = { herdId: job.herd, job: job.name };
  const gate = matchGate(pane, src.openGates);
  if (gate) out.gate = { id: gate.id, question: gate.questions[0]?.label ?? "" };
  return out;
}
