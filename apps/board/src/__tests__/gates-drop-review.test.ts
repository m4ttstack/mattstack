import { describe, expect, test } from 'bun:test';

import type { GateRow } from '@mattstack/rt-client';
import {
  dropReview,
  type DropReviewIo,
  type DropReviewLane,
} from '../gates/drop.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const OTHER_MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4900';
const RUN_START = 1_000;

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'gate-1',
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: RUN_START + 10,
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

const LANE: DropReviewLane = {
  gateId: 'gate-1',
  runStartedAt: RUN_START,
  tabId: 'tab-7',
};

function makeIo(
  rows: GateRow[],
  opts: { lane?: DropReviewLane | null; refuse?: Set<string> } = {}
) {
  const closed: Array<{ id: string; reason: string }> = [];
  const tabsClosed: string[] = [];
  const settled: string[] = [];
  const errors: string[] = [];
  const io: DropReviewIo = {
    rows: () => rows,
    gateClose: async ({ id, reason }) => {
      if (opts.refuse?.has(id)) return { ok: false, error: 'not open' };
      closed.push({ id, reason });
      return { ok: true, data: { ok: true as const } };
    },
    reviewLane: () => (opts.lane === null ? undefined : (opts.lane ?? LANE)),
    closeTab: async tabId => {
      tabsClosed.push(tabId);
    },
    settleReview: mrUrl => {
      settled.push(mrUrl);
    },
    logError: message => {
      errors.push(message);
    },
  };
  return { io, closed, tabsClosed, settled, errors };
}

describe('dropReview', () => {
  test('closes open and parked review gates on the MR as abandoned', async () => {
    const { io, closed, settled } = makeIo([
      row({ id: 'gate-1' }),
      row({ id: 'esc', kind: 'review-escalation', status: 'parked' }),
    ]);
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 2, failed: 0 });
    expect(closed).toEqual([
      { id: 'gate-1', reason: 'abandoned' },
      { id: 'esc', reason: 'abandoned' },
    ]);
    expect(settled).toEqual([MR_URL]);
  });

  test('leaves other domains, other MRs and finished gates alone', async () => {
    const { io, closed } = makeIo([
      row({ id: 'respond', kind: 'respond-post' }),
      row({ id: 'other-mr', subject: `mr:${OTHER_MR_URL}` }),
      row({ id: 'answered', status: 'answered' }),
      row({ id: 'gone', status: 'closed' }),
    ]);
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 0, failed: 0 });
    expect(closed).toEqual([]);
  });

  test("closes the pane only when the current run's open gate was dropped", async () => {
    const open = makeIo([row()]);
    await dropReview(MR_URL, open.io);
    expect(open.tabsClosed).toEqual(['tab-7']);

    const parked = makeIo([row({ status: 'parked' })]);
    await dropReview(MR_URL, parked.io);
    expect(parked.tabsClosed).toEqual([]);
    expect(parked.settled).toEqual([MR_URL]);
  });

  test("an older run's gate never touches the live run's pane or lane", async () => {
    const { io, closed, tabsClosed, settled } = makeIo([
      row({ id: 'old', openedAt: RUN_START - 500 }),
      row({ id: 'old-parked', status: 'parked', openedAt: RUN_START - 900 }),
    ]);
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 2, failed: 0 });
    expect(closed.map(c => c.id)).toEqual(['old', 'old-parked']);
    expect(tabsClosed).toEqual([]);
    expect(settled).toEqual([]);
  });

  test('the gate the lane recorded is current even if opened before the run', async () => {
    const { io, settled } = makeIo([row({ openedAt: RUN_START - 1 })]);
    await dropReview(MR_URL, io);
    expect(settled).toEqual([MR_URL]);
  });

  test('with no lane on file nothing is settled', async () => {
    const { io, settled, tabsClosed } = makeIo([row()], { lane: null });
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 1, failed: 0 });
    expect(settled).toEqual([]);
    expect(tabsClosed).toEqual([]);
  });

  test('a refused close is logged and counted as failed', async () => {
    const { io, settled, tabsClosed, errors } = makeIo([row()], {
      refuse: new Set(['gate-1']),
    });
    expect(await dropReview(MR_URL, io)).toEqual({ closed: 0, failed: 1 });
    expect(settled).toEqual([]);
    expect(tabsClosed).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
