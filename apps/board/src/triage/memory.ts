/** Per-MR dispatch bookkeeping AND red-edge memory. Plain-named key: the
    working name must not leak into state schemas (2026-08-08 amendment).
    Pure types/helpers only -- this file must stay Bun-free (no bun:sqlite,
    no state/index.ts import): the client bundle reaches it transitively via
    triage/edge.ts, which the "types": ["node"] client tsconfig type-checks
    with no Bun ambient types loaded. The db-backed reads/writes live in
    ./memory-store.ts instead. */
export type HandoffKind = 'pipeline-red' | 'needs-rebase';

export interface Handoff {
  runId: string;
  session: string;
  stage: string | null;
  pipelineId: number | null;
  /** The MR whose run was rung: this MR, or an ancestor for a stacked child. */
  viaMr: string | null;
  /** The branch the owning run is on. */
  viaBranch: string;
  at: number;
}

export interface MrMemory {
  lastDispatchAt: number | null;
  attemptsToday: number;
  dayStamp: string;
  /** Day the budget-exhausted escalation already fired, so it fires once. */
  budgetEscalatedDay: string | null;
  lastHandledPipelineId: number | null;
  lastNeedsRebase: boolean;
  /** Operator stand-down (right-click "never diagnose this stack"): true
      blocks auto-dispatch on this MR and, via chainOf, every descendant --
      set and cleared only by the operator, never by rollDay or a fresh
      pipeline id. */
  standDown?: boolean;
  /** Worker handoffs, one per edge kind. rollDay keeps them: a handoff
      outlives the day until liveHandoffs says its edge is gone. */
  handoffs?: Partial<Record<HandoffKind, Handoff>>;
}

export interface DispatchMemory {
  /** GitLab token identity, cached ~24h so most runs make zero API calls. */
  identity: { username: string; fetchedAt: number } | null;
  mrs: Record<string, MrMemory>;
}

export function emptyMrMemory(dayStamp: string): MrMemory {
  return {
    lastDispatchAt: null,
    attemptsToday: 0,
    dayStamp,
    budgetEscalatedDay: null,
    lastHandledPipelineId: null,
    lastNeedsRebase: false,
  };
}

export function rollDay(m: MrMemory, dayStamp: string): MrMemory {
  if (m.dayStamp === dayStamp) return m;
  return { ...m, attemptsToday: 0, budgetEscalatedDay: null, dayStamp };
}

/** Only the handoffs whose edge still holds: pipeline-red while the same
    pipeline is still failed, needs-rebase while the MR still needs it. */
export function liveHandoffs(
  mem: MrMemory | undefined,
  facts: {
    pipelineId: number | null;
    pipelineFailed: boolean;
    needsRebase: boolean;
  }
): Partial<Record<HandoffKind, Handoff>> {
  const live: Partial<Record<HandoffKind, Handoff>> = {};
  const red = mem?.handoffs?.['pipeline-red'];
  if (red && facts.pipelineFailed && red.pipelineId === facts.pipelineId) {
    live['pipeline-red'] = red;
  }
  const rebase = mem?.handoffs?.['needs-rebase'];
  if (rebase && facts.needsRebase) live['needs-rebase'] = rebase;
  return live;
}
