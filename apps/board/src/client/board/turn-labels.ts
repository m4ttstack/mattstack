import type { AuthorSignal, ReviewerSignal } from '../../turn.ts';

/** How each whose-turn signal reads to a person: the settings editor's
    checkbox labels and the Show chips' tooltip share these words. */
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
