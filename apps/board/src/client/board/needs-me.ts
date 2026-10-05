/** Whether a row needs the board's seat to move, and what kind of move: the
    predicate behind the "Needs me" tab and its grouping. Hot rows are read
    off the status line so the tab and the row can never disagree; the rest
    is the seat's standing relationship to the MR (author or assigned
    reviewer), which the status line only shows when nothing hotter is on. */
import {
  ALL_TURN,
  authorTurn,
  reviewerTurn,
  type AuthorSignal,
  type ReviewerSignal,
  type TurnConfig,
} from '../../turn.ts';
import type { BoardMRWithReview } from '../types.ts';
import { rowStatus, type Verb } from './row-status.ts';

export type Need =
  'decide' | 'unstick' | 'respond' | 'fix' | 're-review' | 'review' | 'merge';

/** Group order on the tab: what blocks an agent first, then what blocks the
    author, then the reviewer's queue, then the pleasant one. */
export const NEED_ORDER: readonly Need[] = [
  'decide',
  'unstick',
  'respond',
  'fix',
  're-review',
  'review',
  'merge',
];

export const NEED_LABEL: Record<Need, string> = {
  decide: 'decide',
  unstick: 'unstick',
  respond: 'respond',
  fix: 'fix',
  're-review': 're-review',
  review: 'review',
  merge: 'merge',
};

type Resolved = ReadonlyMap<string, 'posted' | 'dismissed'>;

const DECIDE_VERBS = new Set<Verb['kind']>(['answer', 'read-note']);

/** What the status line says about the seat's move: a hot line is always
    theirs (its verb says which kind); a working line means an agent has the
    row for now, so nothing standing counts either; anything else defers to
    the seat's standing relationship. */
function lineNeed(
  mr: BoardMRWithReview,
  now: number,
  resolved: Resolved,
  self: string
): Need | null | 'busy' {
  const { line, bar } = rowStatus(mr, now, resolved, self);
  if (line.tone === 'work') return 'busy';
  if (!bar) return null;
  if (line.tone === 'bad') return 'unstick';
  const kind = line.verbs[0]?.kind;
  if (kind === 're-review') return 're-review';
  if (kind && DECIDE_VERBS.has(kind)) return 'decide';
  return 'unstick';
}

const AUTHOR_NEED: Record<AuthorSignal, Need> = {
  threads: 'respond',
  changesRequested: 'respond',
  conflicts: 'fix',
  rebase: 'fix',
  ciFailing: 'fix',
  readyToMerge: 'merge',
};

const REVIEWER_NEED: Record<ReviewerSignal, Need> = {
  assigned: 'review',
  approvalReset: 're-review',
  repliedThreads: 're-review',
};

export function needOf(
  mr: BoardMRWithReview,
  self: string,
  now: number,
  resolved: Resolved,
  cfg: TurnConfig = ALL_TURN
): Need | null {
  // A merge in flight spins like an agent's run, but it is the seat's own
  // move: the row keeps its place in the merge group until it leaves.
  if (mr.mergeButton.loading && mr.author.username === self) return 'merge';
  const fromLine = lineNeed(mr, now, resolved, self);
  if (fromLine === 'busy') return null;
  if (fromLine) return fromLine;
  if (mr.author.username === self) {
    const s = authorTurn(mr, cfg);
    return s && AUTHOR_NEED[s];
  }
  const s = reviewerTurn(mr, self, cfg);
  return s && REVIEWER_NEED[s];
}
