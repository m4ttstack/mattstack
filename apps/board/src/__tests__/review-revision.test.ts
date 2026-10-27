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
  ])('a different %s is a revision', (_name, change) => {
    expect(findingChanged(F1, { ...F1, ...change })).toBe(true);
  });

  test('a changed comment alone is not', () => {
    expect(findingChanged(F1, { ...F1, comment: 'Other draft.' })).toBe(false);
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
      revised: { f1: { original: F1 } },
    });
  });

  test('a dropped finding has no card, so it is left out', () => {
    const cache = cacheWith(
      reviewRow('g-new', [F1]),
      superseded('g-old', [F1, F2], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)).toBeUndefined();
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

  test('a re-raise that changed nothing has no revision', () => {
    const cache = cacheWith(
      reviewRow('g-new', [F1, F2]),
      superseded('g-old', [F1, F2], 'g-new')
    );
    expect(reviewRevisionFor(cache, MR)).toBeUndefined();
  });
});
