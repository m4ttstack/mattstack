import type { GateRow, RunFieldRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { filePath } from './fields';
import {
  answerableGates,
  branchSub,
  ciLabel,
  mrFact,
  runPageFacts,
  ticketUrl,
  type RunPageInput,
} from './page';

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g',
    subject: 'run:r1',
    kind: 'plan',
    meta: null,
    owner: 'human',
    status: 'open',
    openedAt: 0,
    questions: [],
    answer: null,
    ...over,
  }) as unknown as GateRow;

const field = (key: string, value: string): RunFieldRow => ({
  key,
  value,
  produced_by: 'x',
  at: 0,
});

const run = (over: Partial<RunSummary> = {}): RunSummary =>
  ({
    id: 'r1',
    work_type: 'feature',
    pipeline: 'work',
    status: 'running',
    started_at: Date.UTC(2026, 9, 8, 18, 38),
    ended_at: null,
    ticket: 'WEB-412',
    branch: 'web-412',
    agent: null,
    attention: { needs: false, reason: null, evidence: '' },
    ...over,
  }) as RunSummary;

describe('ciLabel', () => {
  it.each([
    ['success', 'CI passed'],
    ['failed', 'CI failed'],
    ['waiting_for_resource', 'CI waiting for resource'],
    [null, null],
  ])('%s reads %s', (status, label) => expect(ciLabel(status)).toBe(label));
});

describe('answerableGates', () => {
  const gates = [
    gate({ id: 'late', openedAt: 9 }),
    gate({ id: 'early', openedAt: 1, status: 'parked' } as Partial<GateRow>),
    gate({ id: 'done', status: 'answered' } as Partial<GateRow>),
    gate({ id: 'other', subject: 'run:r2' }),
  ];

  it('keeps the run’s waiting gates, oldest first', () => {
    expect(answerableGates(gates, 'r1', true).map(g => g.id)).toEqual([
      'early',
      'late',
    ]);
  });

  it('has none once the run has ended', () => {
    expect(answerableGates(gates, 'r1', false)).toEqual([]);
  });
});

describe('ticketUrl', () => {
  it('prefers enrichment, then the workspace, then nothing', () => {
    expect(ticketUrl('WEB-1', 'https://x/WEB-1', 'acme')).toBe(
      'https://x/WEB-1'
    );
    expect(ticketUrl('WEB-1', null, 'acme')).toBe(
      'https://linear.app/acme/issue/WEB-1'
    );
    expect(ticketUrl('WEB-1', null, null)).toBeNull();
    expect(ticketUrl(null, 'https://x', 'acme')).toBeNull();
  });
});

describe('branchSub', () => {
  it('names the author’s branch on a hand-off run', () => {
    expect(branchSub(true, 'a..b (4): x')).toBe("author's branch");
  });

  it('counts commits with the head sha', () => {
    expect(branchSub(false, 'e41d2b8..9f2c1a7 (4): tests')).toBe(
      '4 commits @ 9f2c1a7'
    );
    expect(branchSub(false, '9f2c1a7')).toBe('1 commit @ 9f2c1a7');
    expect(branchSub(false, null)).toBe('no commits yet');
  });
});

describe('mrFact', () => {
  it('says the MR opens at ship before a work run has one', () => {
    expect(mrFact(false, run(), undefined, null)).toEqual({
      label: 'MR · CI',
      value: null,
      url: null,
      sub: 'opens at ship',
    });
  });

  it('names a work run’s MR with its state and CI', () => {
    expect(
      mrFact(
        false,
        run(),
        {
          iid: 409,
          webUrl: 'https://forge/409',
          state: 'opened',
          pipeline: { status: 'running' },
        },
        null
      )
    ).toEqual({
      label: 'MR · CI',
      value: '!409 opened',
      url: 'https://forge/409',
      sub: 'CI running',
    });
  });

  it('names the reviewed MR on a review run', () => {
    expect(
      mrFact(
        true,
        run({
          outcome: {
            status: 'running',
            reviewed: { iid: 412, url: 'https://forge/412', posted: null },
            ci: 'success',
          },
        }),
        undefined,
        '!412'
      )
    ).toEqual({
      label: 'Reviewed MR',
      value: '!412',
      url: 'https://forge/412',
      sub: 'CI passed',
    });
  });
});

describe('filePath', () => {
  it('keeps an absolute path and roots a relative one in the worktree', () => {
    expect(filePath('/a/b.md', null)).toBe('/a/b.md');
    expect(filePath('docs/b.md', '/w/molly/')).toBe('/w/molly/docs/b.md');
    expect(filePath('docs/b.md', null)).toBeNull();
  });
});

describe('runPageFacts', () => {
  const input = (over: Partial<RunPageInput> = {}): RunPageInput => ({
    repo: 'remote:acme%2Fweb',
    runId: 'r1',
    run: run(),
    fields: [
      field('worktree', '/Users/acme/worktrees/acme-web/molly'),
      field('claude-session', 's'),
    ],
    gates: [],
    kind: 'work',
    enrichment: undefined,
    workspace: 'acme',
    now: Date.UTC(2026, 9, 8, 21, 21),
    ...over,
  });

  it('builds the hero line and side facts of a work run', () => {
    const facts = runPageFacts(input());
    expect(facts.hero).toMatchObject({
      ticket: 'WEB-412',
      ticketUrl: 'https://linear.app/acme/issue/WEB-412',
    });
    expect(facts.hero.meta).toMatch(/^work pipeline · started .+ · 2h 43m$/);
    expect(facts.worktree).toEqual({
      value: '…/worktrees/acme-web/molly',
      path: '/Users/acme/worktrees/acme-web/molly',
      sub: 'acme/web',
    });
    expect(facts.canResume).toBe(true);
  });

  it('offers Resume only for a recorded, non-empty session with no agent', () => {
    expect(
      runPageFacts(input({ fields: [field('claude-session', '')] })).canResume
    ).toBe(false);
    expect(
      runPageFacts(
        input({ run: run({ agent: { status: 'idle', pane: 'p' } }) })
      ).canResume
    ).toBe(false);
  });

  it('names the reviewed MR in the hero of a review run and finds its hand-off', () => {
    const post = gate({
      id: 'post',
      subject: 'mr:acme/web!412',
      kind: 'review-post',
    });
    const facts = runPageFacts(
      input({
        kind: 'review',
        run: run({
          work_type: 'review',
          ticket: null,
          outcome: {
            status: 'running',
            reviewed: { iid: 412, url: 'https://forge/412', posted: null },
          },
        }),
        gates: [post],
      })
    );
    expect(facts.hero).toMatchObject({
      ticket: '!412',
      ticketUrl: 'https://forge/412',
    });
    expect(facts.handoff?.id).toBe('post');
    expect(facts.branch.sub).toBe("author's branch");
  });
});
