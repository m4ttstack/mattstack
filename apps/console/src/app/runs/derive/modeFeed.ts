import type { GateRow, RunDecisionRow, RunSummary } from '@mattstack/rt-client';

import { runIdOfGate } from '../../../shared/gate-run';
import { decisionText } from './day';

const MODE_PREFIX = 'mode:';

export interface ModeFeedRow {
  gate: GateRow;
  mode: string;
  choice: string;
  stage: string | null;
  headCommit: string | null;
  answeredAt: number;
}

export interface ModeFeedRun {
  run: RunSummary;
  canControl: boolean;
  rows: ModeFeedRow[];
}

export type PauseState = 'none' | 'pausing' | 'paused';

/** A pause set for the current step reads as pausing while the agent is
    still working and paused once it has stopped. */
export function pauseStateOf(run: RunSummary): PauseState {
  if (!run.hold) return 'none';
  return run.agent?.status === 'working' ? 'pausing' : 'paused';
}

/** Who set the run's pause: whoever decided its newest hold. A hold with no
    decision reads as the console's. */
export function pausedBy(decisions: RunDecisionRow[]): 'console' | 'agent' {
  const latest = decisions
    .filter(d => d.scope.startsWith('hold:'))
    .reduce<RunDecisionRow | null>(
      (last, d) => (!last || d.decided_at >= last.decided_at ? d : last),
      null
    );
  return !latest || latest.decided_by === 'console' ? 'console' : 'agent';
}

/** The mode a run answers gates in: its `gate-mode` field, else the mode on
    its latest mode-answered gate. Null for chatty or none, which answer
    nothing alone. */
export function runModeOf(
  fields: { key: string; value: string }[] | undefined,
  rows: ModeFeedRow[]
): string | null {
  const field = fields?.find(f => f.key === 'gate-mode')?.value?.trim();
  const mode = field || rows[0]?.mode || null;
  return mode && mode !== 'chatty' ? mode : null;
}

export function modeOf(gate: GateRow): string | null {
  const by = gate.answer?.by;
  return by?.startsWith(MODE_PREFIX) ? by.slice(MODE_PREFIX.length) : null;
}

function metaText(gate: GateRow, key: string): string | null {
  const v = gate.meta?.[key];
  return typeof v === 'string' && v ? v : null;
}

/** The gates a mode answered on the listed runs, grouped by run: rows newest
    first, runs by their newest row. */
export function modeFeed(
  runs: RunSummary[],
  gates: GateRow[],
  o: { since?: number } = {}
): ModeFeedRun[] {
  const byId = new Map(runs.map(r => [r.id, r] as const));
  const grouped = new Map<string, ModeFeedRow[]>();
  for (const gate of gates) {
    const mode = modeOf(gate);
    const answeredAt = gate.answer?.answeredAt;
    if (mode === null || answeredAt == null) continue;
    if (o.since !== undefined && answeredAt < o.since) continue;
    const runId = runIdOfGate(gate);
    if (!runId || !byId.has(runId)) continue;
    const rows = grouped.get(runId) ?? [];
    rows.push({
      gate,
      mode,
      choice: decisionText(gate),
      stage: metaText(gate, 'stage'),
      headCommit: metaText(gate, 'headCommit'),
      answeredAt,
    });
    grouped.set(runId, rows);
  }
  return [...grouped.entries()]
    .map(([runId, rows]) => {
      const run = byId.get(runId)!;
      return {
        run,
        canControl: run.status === 'running',
        rows: rows.sort((a, b) => b.answeredAt - a.answeredAt),
      };
    })
    .sort((a, b) => b.rows[0]!.answeredAt - a.rows[0]!.answeredAt);
}
