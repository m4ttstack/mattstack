import type { GateRow } from '@mattstack/rt-client';

const RUN_SUBJECT_PREFIX = 'run:';

/** Review and respond runs keep their gates on `mr:` subjects, so the run
    is named by `origin.runId` there. */
export function runIdOfGate(g: GateRow): string | null {
  if (g.subject.startsWith(RUN_SUBJECT_PREFIX)) {
    return g.subject.slice(RUN_SUBJECT_PREFIX.length) || null;
  }
  return g.origin?.runId || null;
}
