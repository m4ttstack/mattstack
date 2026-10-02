import type { MaterializeDeps } from './inbox.ts';
import { finishSentNudge, resolveSentNudge, writeNudge } from './nudges.ts';
import { writePeerReview } from './peer-reviews.ts';

/** The board's real stores behind materializeEnvelope, for the server's tick
    and the triage peer pass alike. The store functions take their db before
    the nudge id and the sender, hence the adapters. */
export function boardMaterializeDeps(
  log: (line: string) => void
): Omit<MaterializeDeps, 'reportAuth'> {
  return {
    writePeerReview,
    writeNudge,
    resolveSentNudge: (mrUrl, resolution, from) =>
      resolveSentNudge(mrUrl, resolution, undefined, from),
    finishSentNudge: (mrUrl, finish, ifSentBefore, nudgeId, from) =>
      finishSentNudge(mrUrl, finish, ifSentBefore, undefined, nudgeId, from),
    log,
  };
}
