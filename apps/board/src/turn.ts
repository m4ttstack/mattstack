import { hasChangesRequested, type BoardMR } from './data.ts';

export const AUTHOR_SIGNALS = [
  'threads',
  'changesRequested',
  'conflicts',
  'rebase',
  'ciFailing',
  'readyToMerge',
] as const;
export type AuthorSignal = (typeof AUTHOR_SIGNALS)[number];

export const REVIEWER_SIGNALS = [
  'assigned',
  'approvalReset',
  'repliedThreads',
] as const;
export type ReviewerSignal = (typeof REVIEWER_SIGNALS)[number];

export interface TurnConfig {
  author: AuthorSignal[];
  reviewer: ReviewerSignal[];
}

export const ALL_TURN: TurnConfig = {
  author: [...AUTHOR_SIGNALS],
  reviewer: [...REVIEWER_SIGNALS],
};

function pick<T extends string>(v: unknown, all: readonly T[]): T[] {
  if (!Array.isArray(v)) return [...all];
  if (v.length === 0) return [];
  const known = all.filter(s => v.includes(s));
  return known.length > 0 ? known : [...all];
}

/** The board.turn value after flipping one signal. Only the touched side is
    written, in canonical order; an untouched side and any other stored key
    stay as they were, so an unset side still means every signal. */
export function toggleTurnSignal<T extends string>(
  raw: unknown,
  side: 'author' | 'reviewer',
  all: readonly T[],
  signal: T
): Record<string, unknown> {
  const stored =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const current: readonly string[] = resolveTurnConfig(raw)[side];
  const next = all.filter(x =>
    x === signal ? !current.includes(signal) : current.includes(x)
  );
  return { ...stored, [side]: next };
}

/** board.turn as stored. A list that is absent, not an array, or non-empty
    with no known signal name falls open to every signal, so a bad team write
    can never empty the board; only an explicit `[]` means none. */
export function resolveTurnConfig(raw: unknown): TurnConfig {
  const r =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    author: pick(r.author, AUTHOR_SIGNALS),
    reviewer: pick(r.reviewer, REVIEWER_SIGNALS),
  };
}

export function authorTurn(mr: BoardMR, cfg: TurnConfig): AuthorSignal | null {
  if (mr.mergeButton?.loading) return null;
  const on = (s: AuthorSignal) => cfg.author.includes(s);
  const b = mr.blockers;
  if (on('threads') && (mr.threadSummary?.awaiting ?? 0) > 0) return 'threads';
  if (on('changesRequested') && hasChangesRequested(mr)) return 'changesRequested';
  if (on('conflicts') && b.hasConflicts) return 'conflicts';
  if (on('rebase') && b.needsRebase) return 'rebase';
  if (on('ciFailing') && b.pipelineFailing) return 'ciFailing';
  if (on('readyToMerge') && mr.reviews.isApproved && !b.any) return 'readyToMerge';
  return null;
}

/** A reset approval outranks my own awaiting thread: GitLab dropped the
    approval, so the reviewer owes a look regardless. An unassigned reviewer
    is only on the hook once the author has answered (replied), not for
    threads that were simply resolved. */
export function reviewerTurn(
  mr: BoardMR,
  self: string,
  cfg: TurnConfig
): ReviewerSignal | null {
  const on = (s: ReviewerSignal) => cfg.reviewer.includes(s);
  const me = mr.reviews.reviewers.find(r => r.username === self);
  const state = me?.reviewState;
  if (state === 'APPROVED') return null;
  if (state === 'UNAPPROVED') return on('approvalReset') ? 'approvalReset' : null;
  const mine = mr.myThreads;
  if (mine && mine.awaiting > 0) return null;
  const answered = me
    ? (mine?.replied ?? 0) + (mine?.resolved ?? 0) > 0
    : (mine?.replied ?? 0) > 0;
  if (on('repliedThreads') && answered) return 'repliedThreads';
  if (on('assigned') && (state === 'UNREVIEWED' || state === 'REVIEW_STARTED'))
    return 'assigned';
  return null;
}
