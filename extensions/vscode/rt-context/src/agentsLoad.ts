import type { agentList, agentResume, listRuns, paneAttachPlan, paneList, RtResponse } from '@mattstack/rt-client';
import { worktreeAgentRows, type AgentRow } from './agentRows';

export interface AgentsDeps {
  paneList: typeof paneList;
  agentList: typeof agentList;
  listRuns: typeof listRuns;
  agentResume: typeof agentResume;
  paneAttachPlan: typeof paneAttachPlan;
}

type Failure = { error: string };

const HEADLESS = 'This session runs headless, so there is no pane to attach to';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function settle<T>(call: () => Promise<RtResponse<T>>): Promise<{ data: T } | Failure> {
  try {
    const res = await call();
    if (res.ok && res.data !== undefined) return { data: res.data };
    return { error: res.error ?? 'The rt daemon returned no data' };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

export async function loadAgentRows(
  ctx: { worktreePath: string; worktreeRoots: string[]; branch: string | null },
  deps: AgentsDeps,
): Promise<{ rows: AgentRow[] } | Failure> {
  const [panes, agents, runs] = await Promise.all([
    settle(() => deps.paneList()),
    settle(() => deps.agentList({})),
    settle(() => deps.listRuns()),
  ]);
  if ('error' in panes) return { error: panes.error };
  const rows = worktreeAgentRows({
    ...ctx,
    panes: panes.data.panes,
    agents: 'data' in agents ? agents.data.agents : [],
    runs: 'data' in runs ? runs.data.runs : [],
  });
  return { rows };
}

export async function paneForResume(agentId: string, deps: AgentsDeps): Promise<{ paneId: string } | Failure> {
  const res = await settle(() => deps.agentResume({ id: agentId }));
  if ('error' in res) return res;
  return res.data.paneId ? { paneId: res.data.paneId } : { error: HEADLESS };
}

export async function attachPlanFor(
  paneId: string,
  deps: AgentsDeps,
): Promise<{ argv: string[]; env: Record<string, string> } | Failure> {
  // herdr's own window nearly always shows a visible pane, so a plain attach is refused; picking it here moves it here.
  const res = await settle(() => deps.paneAttachPlan({ paneId, takeover: true }));
  if ('error' in res) return res;
  return { argv: res.data.argv, env: res.data.env };
}
