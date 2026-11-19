import { sep } from 'path';
import type { AgentRecord, AgentStatus, ChatPane, RunSummary } from '@mattstack/rt-client';

export type AgentRowStatus = 'working' | 'waiting' | 'idle' | 'done' | 'ended';

export interface AgentRow {
  key: string;
  group: 'running' | 'recent';
  title: string;
  status: AgentRowStatus;
  startedBy: string;
  at: number;
  target: { kind: 'pane'; paneId: string } | { kind: 'resume'; agentId: string };
}

export function ownerOf(cwd: string, worktreeRoots: string[]): string | null {
  let best: string | null = null;
  for (const root of worktreeRoots) {
    if (cwd !== root && !cwd.startsWith(root + sep)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

const LIVE_STATUS: Record<AgentStatus, AgentRowStatus> = {
  working: 'working',
  blocked: 'waiting',
  idle: 'idle',
  done: 'done',
  unknown: 'idle',
};

function recordAt(r: AgentRecord): number {
  return r.finishedAt ?? r.lastResumedAt ?? r.createdAt;
}

export function worktreeAgentRows(input: {
  worktreePath: string;
  worktreeRoots: string[];
  branch: string | null;
  panes: ChatPane[];
  agents: AgentRecord[];
  runs: RunSummary[];
}): AgentRow[] {
  const { worktreePath, worktreeRoots, branch } = input;
  const mine = (cwd: string | undefined) => !!cwd && ownerOf(cwd, worktreeRoots) === worktreePath;

  const recordBySession = new Map<string, AgentRecord>();
  for (const r of input.agents) if (r.sessionId) recordBySession.set(r.sessionId, r);

  const runTypeBySession = new Map<string, string>();
  if (branch) {
    for (const run of input.runs) {
      if (run.branch === branch && run.session) runTypeBySession.set(run.session, run.work_type);
    }
  }

  const startedBy = (session: string | undefined, caller: string | undefined, hasRecord: boolean): string => {
    if (caller) return caller;
    const runType = session ? runTypeBySession.get(session) : undefined;
    if (runType && hasRecord) return runType;
    return hasRecord ? 'rt agent' : 'by hand';
  };

  // Every live pane counts, in any worktree: a record shown as ended while its session runs
  // elsewhere would be resumed a second time.
  const liveSessions = new Set<string>();
  const liveAgentIds = new Set<string>();
  for (const p of input.panes) {
    if (p.sessionId) liveSessions.add(p.sessionId);
    const agentId = p.agent?.id ?? (p.sessionId ? recordBySession.get(p.sessionId)?.id : undefined);
    if (agentId) liveAgentIds.add(agentId);
  }

  const running: AgentRow[] = [];
  for (const p of input.panes) {
    if (!mine(p.cwd)) continue;
    const rec = p.sessionId ? recordBySession.get(p.sessionId) : undefined;
    const caller = p.agent?.caller ?? rec?.caller;
    const label = p.agent?.label ?? rec?.label;
    const agentId = p.agent?.id ?? rec?.id;
    running.push({
      key: p.sessionId ?? p.paneId,
      group: 'running',
      title: p.presence?.handle ?? label ?? agentId ?? p.paneId,
      status: p.gate ? 'waiting' : LIVE_STATUS[p.agentStatus] ?? 'idle',
      startedBy: startedBy(p.sessionId, caller, !!(p.agent || rec)),
      at: p.agent?.startedAt ?? 0,
      target: { kind: 'pane', paneId: p.paneId },
    });
  }

  const recent: AgentRow[] = [];
  for (const r of input.agents) {
    if (!mine(r.cwd) || liveSessions.has(r.sessionId) || liveAgentIds.has(r.id)) continue;
    recent.push({
      key: r.sessionId || r.id,
      group: 'recent',
      title: r.handle ?? r.label ?? r.id,
      status: 'ended',
      startedBy: startedBy(r.sessionId, r.caller, true),
      at: recordAt(r),
      target: { kind: 'resume', agentId: r.id },
    });
  }
  recent.sort((a, b) => b.at - a.at);

  return [...running, ...recent];
}
