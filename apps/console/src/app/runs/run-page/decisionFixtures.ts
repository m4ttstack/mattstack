import type { GateQuestion, GateRow } from '@mattstack/rt-client';

/** 13:41 local on the board's day, so stamps read "1:41 PM". */
export const AT = new Date(2026, 9, 8, 13, 41).getTime();

export const approachQuestion: GateQuestion = {
  id: 'approach',
  label: 'Which approach?',
  multi: false,
  options: [
    {
      value: 'backend',
      label: 'Backend gap-fill + component work (Recommended)',
    },
    { value: 'panel', label: 'Panel component only, mock the data' },
    { value: 'spike', label: 'Spike first, then decide' },
  ],
};

export const reviewQuestion: GateQuestion = {
  id: 'outcome',
  label: 'What should the review post?',
  multi: false,
  options: [
    { value: 'approve', label: 'Approve' },
    { value: 'changes', label: 'Request changes (Recommended)' },
    { value: 'comment', label: 'Comment only' },
  ],
};

export const FINDINGS_CONTEXT = JSON.stringify(
  {
    'gate-ctx': 'findings@1',
    findings: [
      { file: 'src/contacts/dedupe.ts', line: 41, tier: 'must-fix' },
      { file: 'src/contacts/import.ts', line: 12, tier: 'suggestion' },
    ],
  },
  null,
  2
);

export const PROSE_CONTEXT =
  'The orders list already loads a page at a time.\n\n- Server-side: add an assignee param\n- Client-side: filter the loaded page';

export function gateOf(over: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g-20261008-0412',
    subject: 'run:20261008-1338',
    kind: 'plan',
    questions: [approachQuestion],
    meta: { stage: 'plan' },
    status: 'answered',
    answer: {
      answers: { approach: 'backend' },
      by: 'console',
      answeredAt: AT,
    },
    openedAt: AT - 5 * 60_000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    consumedAt: null,
    owner: null,
    escalatedAt: null,
    ...over,
  };
}

export function answeredWith(
  answers: NonNullable<GateRow['answer']>['answers'],
  by: string | null = 'console'
): GateRow['answer'] {
  return { answers, by: (by ?? undefined) as string, answeredAt: AT };
}
