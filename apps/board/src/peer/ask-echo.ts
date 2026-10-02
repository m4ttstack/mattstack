import { canonicalUsername } from './envelope.ts';
import type { NudgeState } from './nudges.ts';

/** The ask a review run answers: the author's latest review or re-review ask
    on this MR that this board already held when the run started. An ask that
    lands mid-run belongs to the next run, so a late report from this one can
    never finish it. A run stamp later than the signal's own emittedAt belongs
    to a later run than the one that emitted it, so it echoes nothing. */
export function askIdForRun(
  nudges: readonly NudgeState[],
  mrUrl: string,
  author: string,
  runStartedAt: number | undefined,
  emittedAt: number
): string | undefined {
  if (runStartedAt === undefined || runStartedAt > emittedAt) return undefined;
  const who = canonicalUsername(author);
  let best: { id: string; at: number } | undefined;
  for (const n of nudges) {
    if (n.mrUrl !== mrUrl || n.kind === 'respond') continue;
    if (canonicalUsername(n.from) !== who) continue;
    const at = n.materializedAt ?? n.receivedAt;
    if (at > runStartedAt) continue;
    if (!best || at > best.at) best = { id: n.id, at };
  }
  return best?.id;
}
