import { describe, expect, it } from 'vitest';

import {
  buildUserEvidence,
  type EvidenceContext,
} from '../src/server/metrics/evidence.js';
import { computeSnapshot } from '../src/server/metrics/snapshot.js';
import type {
  FetchResult,
  NormLinearIssue,
} from '../src/server/store/model.js';
import { FETCH, fetchedWithMergedMrs, USERS, WINDOW } from './fixtures.js';

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };
const CTX: EvidenceContext = {
  window: WINDOW,
  baseUrl: 'https://gitlab.com',
  sizeBand: SIZE_BAND,
};

const snap = computeSnapshot(FETCH, {
  window: WINDOW,
  users: USERS,
  sizeBand: SIZE_BAND,
});
const alice = snap.byUser.alice!;
const ev = buildUserEvidence(FETCH, 'alice', CTX);

describe('buildUserEvidence row counts match the snapshot', () => {
  it('merged-MR-backed counts line up', () => {
    expect(ev.mrsMerged!.rows.length).toBe(alice.mrsMerged);
    expect(ev.additions!.rows.length).toBe(alice.mrsMerged);
  });

  it('reviewed / pipelines / coding-days counts line up', () => {
    expect(ev.mrsReviewed!.rows.length).toBe(alice.mrsReviewed);
    expect(ev.pipelines!.rows.length).toBe(alice.pipelines);
    expect(ev.codingDays!.rows.length).toBe(alice.codingDays);
  });

  it('issues done: row count equals the counted value', () => {
    expect(ev.issuesCompleted!.rows.length).toBe(alice.issuesCompleted);
  });

  it('reverted rows that are NOT muted equal revertedCount', () => {
    const reverted = ev.revertedCount!.rows.filter(r => !r.muted).length;
    expect(reverted).toBe(alice.revertedCount);
  });
});

describe('buildUserEvidence links and flags', () => {
  it('builds GitLab MR deep links from baseUrl + projectPath + iid', () => {
    // alice's MR1 is iid 1 in org/app.
    expect(
      ev.mrsMerged!.rows.some(
        r => r.href === 'https://gitlab.com/org/app/-/merge_requests/1'
      )
    ).toBe(true);
  });

  it('carries the Linear issue url through as the row href', () => {
    expect(
      ev.issuesCompleted!.rows.every(r =>
        r.href?.startsWith('https://linear.app/')
      )
    ).toBe(true);
  });

  it('revert rows name the reverting MR and how long the original lived', () => {
    expect(ev.revertRate!.columns).toEqual([
      'MR',
      'Title',
      'Merged',
      'Reverted by',
      'Lived',
    ]);
    const reverted = ev.revertRate!.rows.find(r => r.cells[0] === '!1');
    expect(reverted?.cells.slice(3)).toEqual(['!4', '15d']);
    const kept = ev.revertRate!.rows.find(r => r.cells[0] === '!2');
    expect(kept?.cells.slice(3)).toEqual(['—', '—']);
  });

  it('size-health marks out-of-band MRs as muted', () => {
    // MR2 is +5/-2 = 7 changed lines, below tooSmall (10) -> out of band -> muted.
    const small = ev.sizeHealthPct!.rows.find(r => r.cells[0] === '!2');
    expect(small?.muted).toBe(true);
  });

  it('latency evidence summarizes p50/p90 over the sampled MRs', () => {
    expect(ev.responseLatencyHours!.summary).toMatch(
      /p50 .*h · p90 .*h over \d+ MR/
    );
  });
});

describe('issuesCompleted drops gated-out issues from the rows', () => {
  const issue = (
    identifier: string,
    over: Partial<NormLinearIssue> = {}
  ): NormLinearIssue => ({
    id: identifier,
    identifier,
    title: `Issue ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
    creditedUser: 'alice',
    linkedMrs: [],
    closedAt: null,
    stateType: 'completed',
    stateName: 'Done',
    ...over,
  });
  const fetchWithNoise: FetchResult = {
    ...FETCH,
    linearIssues: [
      ...(FETCH.linearIssues ?? []),
      // A different Linear team's ticket now counts like any other.
      issue('NARWHAL-9', { closedAt: '2026-05-15T00:00:00.000Z' }),
      issue('ENG-9', { stateType: 'started', stateName: 'In Progress' }),
    ],
  };
  const withEveryTeam = buildUserEvidence(fetchWithNoise, 'alice', CTX);

  it('counts a ticket from any Linear team, omitting only state exclusions', () => {
    const ids = withEveryTeam.issuesCompleted!.rows.map(r => r.cells[0]);
    expect(ids).toEqual(['NARWHAL-9', 'ENG-2', 'ENG-1']);
  });

  it('still tallies the state exclusion in the summary', () => {
    expect(withEveryTeam.issuesCompleted!.summary).toBe(
      '3 counted · 1 excluded by state'
    );
  });

  it('sorts by ticket number descending, not lexicographically', () => {
    const withHighNumber: FetchResult = {
      ...FETCH,
      linearIssues: [
        ...(FETCH.linearIssues ?? []),
        issue('ENG-10', { closedAt: '2026-05-15T00:00:00.000Z' }),
      ],
    };
    const evNum = buildUserEvidence(withHighNumber, 'alice', CTX);
    const ids = evNum.issuesCompleted!.rows.map(r => r.cells[0]);
    expect(ids).toEqual(['ENG-10', 'ENG-2', 'ENG-1']);
  });
});

describe('issuesCompleted shows the closed date and non-mention links only', () => {
  const fetchedWithIssues: FetchResult = {
    ...FETCH,
    linearIssues: [
      ...(FETCH.linearIssues ?? []),
      {
        id: 'ENG-10',
        identifier: 'ENG-10',
        title: 'Issue ENG-10',
        url: 'https://linear.app/acme/issue/ENG-10',
        creditedUser: 'alice',
        linkedMrs: [
          { iid: 100, projectPath: 'org/app', via: 'closing' },
          { iid: 200, projectPath: 'org/app', via: 'mention' },
        ],
        closedAt: '2026-05-15T00:00:00.000Z',
        stateType: 'completed',
        stateName: 'Done',
      },
    ],
  };

  it('issue evidence shows the closed date and ignores mention-only links in the MR column', () => {
    const ev = buildUserEvidence(fetchedWithIssues, 'alice', CTX);
    const issues = ev.issuesCompleted!;
    expect(issues.columns).toEqual([
      'Issue',
      'Title',
      'State',
      'Closed',
      'MR(s)',
    ]);
    const row = issues.rows.find(r => r.cells[0] === 'ENG-10')!;
    expect(row.cells[3]).toBe('2026-05-15');
    expect(row.cells[4]).not.toContain('!200'); // 200 is the mention-only link
    expect(row.cells[4]).toContain('!100');
    expect(row.mrHrefs).toHaveLength(1);
    expect(row.mrHrefs![0]).toMatch(/\/-\/merge_requests\/100$/);
  });
});

describe('evidence row ordering', () => {
  it('MR tables sort by MR number, highest first', () => {
    expect(ev.mrsMerged!.rows.map(r => r.cells[0])).toEqual(['!2', '!1']);
    expect(ev.sizeHealthPct!.rows.map(r => r.cells[0])).toEqual(['!2', '!1']);
    expect(ev.revertedCount!.rows.map(r => r.cells[0])).toEqual(['!2', '!1']);
  });

  it('date tables sort newest day first', () => {
    expect(ev.codingDays!.rows.map(r => r.cells[0])).toEqual([
      '2026-05-20',
      '2026-05-10',
      '2026-05-09',
      '2026-05-08',
    ]);
    expect(ev.longestStreak!.rows.map(r => r.cells[0])).toEqual([
      '2026-05-11',
      '2026-05-10',
    ]);
  });
});

describe('evidence facts', () => {
  it('carries typed totals for every stat', () => {
    expect(ev.mrsMerged?.facts).toEqual({ merged: 2, added: 105, deleted: 22 });
    expect(ev.additions?.facts).toEqual(ev.mrsMerged?.facts);
    expect(ev.deletions?.facts).toEqual(ev.mrsMerged?.facts);
    expect(ev.sizeHealthPct?.facts).toEqual({
      inBand: 1,
      overBand: 0,
      underBand: 1,
      bandLow: 10,
      bandHigh: 400,
    });
    expect(Object.keys(ev.reciprocity?.facts ?? {}).sort()).toEqual([
      'given',
      'received',
      'reviewers',
    ]);
    expect(Object.keys(ev.pipelines?.facts ?? {}).sort()).toEqual([
      'canceled',
      'failed',
      'running',
      'success',
    ]);
    expect(ev.longestStreak?.facts).toEqual(ev.currentStreak?.facts);
    expect(ev.longestStreak?.facts).toEqual({
      current: expect.any(Number),
      longest: 2,
      mergeDays: 2,
    });
    expect(ev.revertRate?.facts).toEqual({ reverted: 1, checked: 2 });
    expect(ev.revertedCount?.facts).toEqual(ev.revertRate?.facts);
    expect(ev.codingDays?.facts).toEqual({ days: 4, windowDays: 30 });
    expect(Object.keys(ev.mrsReviewed?.facts ?? {}).sort()).toEqual([
      'authors',
      'reviewed',
    ]);
    expect(Object.keys(ev.reviewDepth?.facts ?? {}).sort()).toEqual([
      'inlineComments',
      'reviewed',
    ]);
    for (const k of ['reviewLatencyHours', 'responseLatencyHours'] as const)
      expect(Object.keys(ev[k]?.facts ?? {}).sort()).toEqual([
        'count',
        'p50',
        'p90',
      ]);
    expect(Object.keys(ev.issuesCompleted?.facts ?? {}).sort()).toEqual([
      'counted',
      'excludedByState',
      'outsideWindow',
    ]);
  });

  it('reciprocity facts count review events and distinct reviewers', () => {
    const f = ev.reciprocity!.facts!;
    expect(f.given).toBe(alice.mrsReviewed);
    expect(f.reviewers).toBe(ev.reciprocity!.rows.length);
    expect(f.received).toBe(
      ev.reciprocity!.rows.reduce((s, r) => s + Number(r.cells[1]), 0)
    );
  });

  it('pipelines facts partition every pipeline into four buckets', () => {
    const f = ev.pipelines!.facts!;
    expect(f.success! + f.failed! + f.canceled! + f.running!).toBe(
      alice.pipelines
    );
  });

  it('size bands partition merged MRs at the band edges', () => {
    const edges = fetchedWithMergedMrs('alice', 2);
    edges.mrs[0] = { ...edges.mrs[0]!, additions: 10, deletions: 0 };
    edges.mrs[1] = { ...edges.mrs[1]!, additions: 401, deletions: 0 };
    const f = buildUserEvidence(edges, 'alice', CTX).sizeHealthPct!.facts!;
    expect(f).toMatchObject({ inBand: 1, underBand: 0, overBand: 1 });
  });

  it('latency facts are zero with no samples', () => {
    const none = buildUserEvidence(FETCH, 'nobody', CTX);
    expect(none.reviewLatencyHours?.facts).toEqual({
      p50: 0,
      p90: 0,
      count: 0,
    });
  });

  it('computes facts before rows are truncated', () => {
    const big = fetchedWithMergedMrs('alice', 320);
    const evBig = buildUserEvidence(big, 'alice', CTX);
    expect(evBig.mrsMerged?.rows).toHaveLength(300);
    expect(evBig.mrsMerged?.facts?.merged).toBe(320);
    expect(evBig.sizeHealthPct?.facts?.inBand).toBe(320);
  });
});
