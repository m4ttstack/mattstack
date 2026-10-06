import type { AuthorSignal, ReviewerSignal } from '../../turn.ts';

/** How each whose-turn signal reads to a person in the Show chips' tooltip.
    The settings editor's checkboxes carry the same words, sentence-cased, in
    board.turn's schema; turn-labels.test.ts holds the two together. */
export const AUTHOR_LABEL: Record<AuthorSignal, string> = {
  threads: 'unanswered comments',
  changesRequested: 'changes requested',
  conflicts: 'merge conflicts',
  rebase: 'needs a rebase',
  ciFailing: 'CI failing',
  readyToMerge: 'approved, ready to merge',
};

export const REVIEWER_LABEL: Record<ReviewerSignal, string> = {
  assigned: "assigned and haven't finished",
  approvalReset: 'a push reset my approval',
  repliedThreads: 'the author answered my comment',
};
