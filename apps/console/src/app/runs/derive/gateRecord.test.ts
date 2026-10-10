import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { gateRecord } from './gateRecord';

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g1',
    subject: 'run:r1',
    kind: 'plan',
    questions: [],
    meta: null,
    context: null,
    origin: null,
    status: 'answered',
    answer: null,
    openedAt: 1,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    ...over,
  }) as GateRow;

const answered = (answers: Record<string, unknown>) => ({
  answers: answers as never,
  by: 'pane',
  answeredAt: 1,
});

describe('gateRecord: the answered form', () => {
  const plan = gate({
    kind: 'ship',
    context: 'Pipeline green for head abc1234.',
    questions: [
      {
        id: 'open_as',
        label: 'Open the MR as draft or ready?',
        multi: false,
        options: [
          {
            value: 'draft',
            label: 'Draft (Recommended)',
            description: 'Push and open as draft',
          },
          { value: 'ready', label: 'Ready' },
        ],
      },
      {
        id: 'next',
        label: 'Then?',
        multi: false,
        options: ['proceed', 'hold'],
      },
    ],
    answer: answered({
      open_as: { value: 'draft', note: 'keep it quiet' },
      next: 'proceed',
    }),
  });

  it('lists every option with the pick checked and its note', () => {
    const r = gateRecord(plan);
    expect(r.shape).toBe('form');
    if (r.shape !== 'form') return;
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]!.options.map(o => [o.text, o.picked])).toEqual([
      ['Draft', true],
      ['Ready', false],
    ]);
    expect(r.questions[0]!.options[0]!.detail).toBe('Push and open as draft');
    expect(r.questions[0]!.note).toBe('keep it quiet');
  });

  it('folds the Then? move out of the questions and keeps the prose summary', () => {
    const r = gateRecord(plan);
    if (r.shape !== 'form') throw new Error('form');
    expect(r.then).toBe('proceed');
    expect(r.summary).toBe('Pipeline green for head abc1234.');
    expect(r.escalation).toBe(false);
  });

  it('marks an escalation and leaves a closed gate unpicked', () => {
    const r = gateRecord(
      gate({
        kind: 'review-escalation',
        status: 'closed',
        closedReason: 'abandoned',
        questions: [
          {
            id: 'action',
            label: 'What now?',
            multi: false,
            options: ['take', 'hold'],
          },
        ],
        answer: answered({ action: 'take' }),
      })
    );
    if (r.shape !== 'form') throw new Error('form');
    expect(r.escalation).toBe(true);
    expect(r.questions[0]!.options.every(o => !o.picked)).toBe(true);
  });
});

describe('gateRecord: a review post', () => {
  const findings = JSON.stringify({
    'gate-ctx': 'findings@1',
    findings: [
      {
        id: 'f1',
        severity: 'critical',
        title: 'Totals skip the discount',
        file: 'src/cart/totals.ts:40',
      },
      { id: 'f2', severity: 'minor', title: 'Name reads oddly' },
    ],
  });
  const r = gateRecord(
    gate({
      kind: 'review-post',
      questions: [
        {
          id: 'thread-1',
          label: 'src/cart/totals.ts:12',
          multi: true,
          options: ['post:a', 'resolve:a'],
          context: JSON.stringify({
            'gate-ctx': 'carryover@1',
            original: '**issue:** the total rounds early\nmore',
          }),
        },
        {
          id: 'findings-1',
          label: 'Post which findings to !12?',
          multi: true,
          options: ['f1', 'f2'],
          context: findings,
        },
        {
          id: 'skipped-1',
          label: 'Bring back a finding you skipped earlier?',
          multi: true,
          options: ['restore:r1'],
          context: JSON.stringify({
            'gate-ctx': 'skipped@1',
            skipped: [{ id: 'r1' }],
          }),
        },
        {
          id: 'outcome',
          label: 'Verdict on !12: ready once totals round late',
          multi: false,
          options: [
            { value: 'comment', label: 'Comment (recommended)' },
            { value: 'approve', label: 'Approve' },
          ],
        },
      ],
      answer: answered({
        'thread-1': ['post:a'],
        'findings-1': ['f1'],
        'skipped-1': [],
        outcome: 'comment',
      }),
    })
  );

  it('reads the verdict, findings, threads and skipped count', () => {
    expect(r.shape).toBe('review-post');
    if (r.shape !== 'review-post') return;
    expect(r.verdict).toEqual({
      pick: 'Comment',
      reason: 'Ready once totals round late',
      passed: ['Approve'],
    });
    expect(r.findings.map(f => [f.id, f.severity, f.where, f.posted])).toEqual([
      ['f1', 'critical', 'totals.ts:40', true],
      ['f2', 'minor', null, false],
    ]);
    expect(r.threads).toEqual([
      {
        where: 'totals.ts:12',
        gist: 'the total rounds early',
        replied: true,
        resolved: false,
      },
    ]);
    expect(r.skipped).toBe(1);
    expect(r.restored).toBe(0);
  });

  it('falls back to the form when a question has no shape it knows', () => {
    const odd = gateRecord(
      gate({
        kind: 'review-post',
        questions: [
          { id: 'x', label: 'Something new?', multi: false, options: ['a'] },
        ],
        answer: answered({ x: 'a' }),
      })
    );
    expect(odd.shape).toBe('form');
  });
});

describe('gateRecord: replying to a review', () => {
  it('reads each thread, the agent call and your pick', () => {
    const r = gateRecord(
      gate({
        kind: 'respond-plan',
        context: JSON.stringify({ 'gate-ctx': 'plan@1', reviewer: 'Sam Lee' }),
        questions: [
          {
            id: 'thread-1',
            label: 'src/cart/List.test.tsx:9',
            multi: false,
            options: [
              { value: 'reply:a', label: 'Reply' },
              { value: 'fix:a', label: 'Fix (Recommended)' },
            ],
            context: JSON.stringify({
              'gate-ctx': 'thread@1',
              severity: 'blocking',
              claim: { summary: 'Assert the exact list?' },
              verdict: { call: 'valid', note: 'the list is fixed' },
            }),
          },
          {
            id: 'code-changes',
            label: 'Approve the proposed code changes?',
            multi: false,
            options: ['approve', 'revise'],
          },
        ],
        answer: answered({ 'thread-1': 'fix:a', 'code-changes': 'approve' }),
      })
    );
    expect(r).toEqual({
      shape: 'respond-plan',
      reviewer: 'Sam Lee',
      threads: [
        {
          where: 'List.test.tsx:9',
          severity: 'blocking',
          claim: 'Assert the exact list?',
          call: 'valid',
          callNote: 'the list is fixed',
          pick: 'Fix',
        },
      ],
      codeChanges: { pick: 'approve', passed: ['revise'] },
    });
  });

  it('reads the replies that went up', () => {
    const r = gateRecord(
      gate({
        kind: 'respond-post',
        questions: [
          {
            id: 'thread-1',
            label: 'src/cart/List.test.tsx:9',
            multi: true,
            options: ['post:a', 'resolve:a'],
            context: JSON.stringify({
              'gate-ctx': 'reply@1',
              file: 'src/cart/List.test.tsx:9',
              sha: 'f903b01',
              text: 'switched to toEqual.',
            }),
          },
        ],
        answer: answered({ 'thread-1': ['post:a', 'resolve:a'] }),
      })
    );
    expect(r).toEqual({
      shape: 'respond-post',
      replies: [
        {
          where: 'List.test.tsx:9',
          text: 'switched to toEqual.',
          sha: 'f903b01',
          posted: true,
          resolved: true,
        },
      ],
    });
  });
});
