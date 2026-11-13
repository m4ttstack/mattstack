import { describe, expect, test } from 'bun:test';

import type { GateRow } from '@mattstack/rt-client';
import { dropReview, type DropReviewIo } from '../gates/drop.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const OTHER_MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4900';

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'gate-1',
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 1,
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
    ...overrides,
  };
}

function makeIo(
  rows: GateRow[],
  opts: { tabId?: string; refuse?: Set<string> } = {}
) {
  const closed: Array<{ id: string; reason: string }> = [];
  const tabsClosed: string[] = [];
  const dismissed: string[] = [];
  const io: DropReviewIo = {
    rows: () => rows,
    gateClose: async ({ id, reason }) => {
      if (opts.refuse?.has(id)) return { ok: false, error: 'not open' };
      closed.push({ id, reason });
      return { ok: true, data: { ok: true as const } };
    },
    reviewTabId: () => opts.tabId,
    closeTab: async tabId => {
      tabsClosed.push(tabId);
    },
    dismissReview: mrUrl => {
      dismissed.push(mrUrl);
    },
    logError: () => {},
  };
  return { io, closed, tabsClosed, dismissed };
}

describe('dropReview', () => {
  test('closes open and parked review gates on the MR as abandoned', async () => {
    const { io, closed, dismissed } = makeIo([
      row({ id: 'open-post' }),
      row({ id: 'parked-esc', kind: 'review-escalation', status: 'parked' }),
    ]);
    const result = await dropReview(MR_URL, io);
    expect(result).toEqual({ closed: 2 });
    expect(closed).toEqual([
      { id: 'open-post', reason: 'abandoned' },
      { id: 'parked-esc', reason: 'abandoned' },
    ]);
    expect(dismissed).toEqual([MR_URL]);
  });

  test('leaves other domains, other MRs and finished gates alone', async () => {
    const { io, closed } = makeIo([
      row({ id: 'respond', kind: 'respond-post' }),
      row({ id: 'other-mr', subject: `mr:${OTHER_MR_URL}` }),
      row({ id: 'answered', status: 'answered' }),
      row({ id: 'gone', status: 'closed' }),
    ]);
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 0 });
    expect(closed).toEqual([]);
  });

  test('closes the waiting pane only when an open gate was dropped', async () => {
    const open = makeIo([row()], { tabId: 'tab-7' });
    await dropReview(MR_URL, open.io);
    expect(open.tabsClosed).toEqual(['tab-7']);

    const parked = makeIo([row({ status: 'parked' })], { tabId: 'tab-7' });
    await dropReview(MR_URL, parked.io);
    expect(parked.tabsClosed).toEqual([]);
  });

  test('a gate that moved on before the close is not counted', async () => {
    const { io, dismissed, tabsClosed } = makeIo([row({ id: 'raced' })], {
      tabId: 'tab-7',
      refuse: new Set(['raced']),
    });
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 0 });
    expect(dismissed).toEqual([]);
    expect(tabsClosed).toEqual([]);
  });
});
