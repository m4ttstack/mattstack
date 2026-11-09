import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { FindingEntry } from '../client/board/gate-ctx.ts';
import { GateCache } from '../gates/cache.ts';
import {
  findingChanged,
  gateFindings,
  reviewRevisionFor,
} from '../review-revision.ts';

const MR = 'https://gitlab.example.com/acme/widgets/-/merge_requests/31';
const SUBJECT = `mr:${MR}`;

const F1: FindingEntry = {
  id: 'f1',
  severity: 'important',
  title: 'Retry loop never backs off',
  body: 'The loop retries at once.',
  file: 'lib/retry.ts:12',
  comment: 'Could this back off?',
};
const F2: FindingEntry = {
  id: 'f2',
  severity: 'minor',
  title: 'Stale doc comment',
  body: 'The comment names the old flag.',
  file: 'lib/flags.ts:4',
  comment: 'Nit: the comment is stale.',
};

/** A review-post facility row whose findings@1 joins its options. */
function reviewRow(
  id: string,
  findings: FindingEntry[],
  over: Partial<FacilityGateRow> = {}
): FacilityGateRow {
  const counts = { critical: 0, important: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    id,
    subject: SUBJECT,
    kind: 'review-post',
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings?',
        multi: true,
        context: JSON.stringify({ 'gate-ctx': 'findings@1', findings }),
        options: findings.map(f => ({ value: f.id, label: f.title })),
      },
      {
        id: 'outcome',
        label: 'Verdict',
        multi: false,
        options: [
          { value: 'approve', label: 'approve' },
          { value: 'comment', label: 'comment' },
        ],
      },
    ],
    context: JSON.stringify({
      'gate-ctx': 'review@1',
      readiness: 'with-fixes',
      summary: 'Two findings.',
      findings: counts,
    }),
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 2000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    ...over,
  } as FacilityGateRow;
}

const superseded = (id: string, findings: FindingEntry[], by: string) =>
  reviewRow(id, findings, {
    openedAt: 1000,
    status: 'closed',
    closedReason: 'superseded',
    supersededBy: by,
  });

function cacheWith(...rows: FacilityGateRow[]): GateCache {
  const cache = new GateCache();
  cache.reconcile(rows);
  return cache;
}

describe('gateFindings', () => {
  test("reads a review sheet's findings by id", () => {
    expect([...gateFindings(reviewRow('g', [F1, F2]))!.keys()]).toEqual([
      'f1',
      'f2',
    ]);
  });

  test('a row the sheet cannot read has none', () => {
    expect(gateFindings(reviewRow('g', [F1], { context: null }))).toBeNull();
  });
});

describe('findingChanged', () => {
  test.each([
    ['severity', { severity: 'minor' as const }],
    ['anchor', { file: 'lib/retry.ts:14' }],
    ['title', { title: 'Retry loop spins' }],
    ['body', { body: 'Reworded.' }],
    ['fix', { fix: 'Back off exponentially.' }],
    ['comment', { comment: 'Other draft.' }],
  ])('a different %s is a revision', (_name, change) => {
    expect(findingChanged(F1, { ...F1, ...change })).toBe(true);
  });

  test('the same finding is not', () => {
    expect(findingChanged(F1, { ...F1 })).toBe(false);
  });
});

describe('reviewRevisionFor', () => {
  test("names each finding the open gate changed, with the superseded gate's original", () => {
    const revisedF1 = { ...F1, severity: 'minor' as const, body: 'Narrower.' };
    const cache = cacheWith(
      reviewRow('g-new', [revisedF1, F2]),
      superseded('g-old', [F1, F2], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)).toEqual({
      gateId: 'g-new',
      previousGateId: 'g-old',
      previousFindingIds: ['f1', 'f2'],
      changedIds: ['f1'],
      revised: { f1: { original: F1 } },
    });
  });

  test('an earlier re-raise keeps its notice, against the earliest version', () => {
    const firstF1 = { ...F1, body: 'Narrower.' };
    const secondF1 = { ...F1, body: 'Narrower still.' };
    const revisedF2 = { ...F2, title: 'Doc comment drifted' };
    const cache = cacheWith(
      reviewRow('g-3', [secondF1, revisedF2]),
      superseded('g-2', [firstF1, F2], 'g-3'),
      superseded('g-1', [F1, F2], 'g-2')
    );
    expect(reviewRevisionFor(cache, MR)).toEqual({
      gateId: 'g-3',
      previousGateId: 'g-2',
      previousFindingIds: ['f1', 'f2'],
      changedIds: ['f1', 'f2'],
      revised: { f1: { original: F1 }, f2: { original: F2 } },
    });
  });

  test('only the last re-raise counts as changed for the draft', () => {
    const firstF1 = { ...F1, body: 'Narrower.' };
    const revisedF2 = { ...F2, title: 'Doc comment drifted' };
    const cache = cacheWith(
      reviewRow('g-3', [firstF1, revisedF2]),
      superseded('g-2', [firstF1, F2], 'g-3'),
      superseded('g-1', [F1, F2], 'g-2')
    );
    const revision = reviewRevisionFor(cache, MR);
    expect(revision?.changedIds).toEqual(['f2']);
    expect(Object.keys(revision?.revised ?? {})).toEqual(['f1', 'f2']);
  });

  test('a dropped finding has no card, so it is left out', () => {
    const cache = cacheWith(
      reviewRow('g-new', [F1]),
      superseded('g-old', [F1, F2], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)?.revised).toEqual({});
  });

  test("a predecessor older than the lane's run is another run's gate", () => {
    const cache = cacheWith(
      reviewRow('g-new', [{ ...F2, id: 'f1' }]),
      superseded('g-old', [F1], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR, 1500)).toBeUndefined();
    expect(reviewRevisionFor(cache, MR, 1000)?.previousGateId).toBe('g-old');
  });

  test('no predecessor in the cache (a board restart) means no revision', () => {
    const cache = cacheWith(reviewRow('g-new', [F1, F2]));
    expect(reviewRevisionFor(cache, MR)).toBeUndefined();
  });

  test('an answered gate is not on screen to mark', () => {
    const cache = cacheWith(
      reviewRow('g-new', [{ ...F1, title: 'New' }], { status: 'answered' }),
      superseded('g-old', [F1], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)).toBeUndefined();
  });

  test('a re-raise that changed nothing still names its predecessor', () => {
    const cache = cacheWith(
      reviewRow('g-new', [F1, F2]),
      superseded('g-old', [F1, F2], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)).toEqual({
      gateId: 'g-new',
      previousGateId: 'g-old',
      previousFindingIds: ['f1', 'f2'],
      changedIds: [],
      revised: {},
    });
  });
});
