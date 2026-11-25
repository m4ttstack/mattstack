import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';

import { heldSpans } from './run';

export type PauseState = 'none' | 'pausing' | 'paused';

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

const isWorking = (run: RunSummary) => run.agent?.status === 'working';

/** An agent still working under a hold it set is waiting on work of its own,
    such as a subagent, or has not stopped yet: nothing is paused. */
const worksUnderOwnHold = (run: RunSummary, decisions: RunDecisionRow[]) =>
  run.hold != null && isWorking(run) && pausedBy(decisions) === 'agent';

/** A console pause reads as pausing while the agent is still working and
    paused once it has stopped; an agent's own only once it has stopped. */
export function pauseStateOf(
  run: RunSummary,
  decisions: RunDecisionRow[]
): PauseState {
  if (!run.hold || worksUnderOwnHold(run, decisions)) return 'none';
  return isWorking(run) ? 'pausing' : 'paused';
}

/** The holds a stage rail draws. */
export function railHolds(
  run: RunSummary,
  stages: RunStageRow[],
  decisions: RunDecisionRow[],
  fields: RunFieldRow[]
) {
  const spans = heldSpans(stages, decisions, fields);
  return worksUnderOwnHold(run, decisions)
    ? spans.filter(s => s.to != null)
    : spans;
}
