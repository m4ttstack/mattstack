import { describe, expect, test } from 'bun:test';

import {
  executeSweepAction,
  type DomainStateIo,
  type ExecuteSweepActionIo,
} from '../gates/execute-sweep-action.ts';
import type { SweepAction } from '../gates/sweep.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

function makeIo(
  parkResult: { ok: true } | { ok: false; error: string }
): ExecuteSweepActionIo & {
  calls: string[];
  closed: string[];
  writes: Record<'review' | 'respond' | 'doctor', unknown[]>;
  logs: string[];
} {
  const calls: string[] = [];
  const closed: string[] = [];
  const writes: Record<'review' | 'respond' | 'doctor', unknown[]> = {
    review: [],
    respond: [],
    doctor: [],
  };
  const logs: string[] = [];
  const domainIo = (
    domain: 'review' | 'respond' | 'doctor'
  ): DomainStateIo => ({
    writeState: (_path, patch) => {
      writes[domain].push(patch);
    },
    filePath: mrUrl => `/${domain}s/${mrUrl}.json`,
  });
  return {
    calls,
    closed,
    writes,
    logs,
    gatePark: async payload => {
      calls.push(`gatePark(${payload.id})`);
      return parkResult.ok
        ? { ok: true, data: { ok: true as const } }
        : { ok: false, error: parkResult.error };
    },
    closeTab: async (tabId: string) => {
      calls.push(`closeTab(${tabId})`);
      closed.push(tabId);
    },
    review: domainIo('review'),
    respond: domainIo('respond'),
    doctor: domainIo('doctor'),
    now: () => 5000,
    graceMinutes: 90,
    log: message => {
      logs.push(message);
    },
    logError: message => {
      logs.push(message);
    },
  };
}

describe('executeSweepAction', () => {
  test('park action calls gatePark before closeTab, and logs on success', async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'park',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-1',
      gateId: 'gate-1',
    };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(['gatePark(gate-1)', 'closeTab(tab-1)']);
    expect(io.closed).toEqual(['tab-1']);
    expect(io.logs).toHaveLength(1);
    expect(io.logs[0]).toContain('gate-1');
  });

  test('park action with no tabId calls gatePark but never closeTab', async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'park',
      domain: 'review',
      mrUrl: MR_URL,
      gateId: 'gate-1',
    };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(['gatePark(gate-1)']);
    expect(io.closed).toEqual([]);
  });

  test('park action skips closeTab and logs once when gatePark reports not-open', async () => {
    const io = makeIo({ ok: false, error: 'not-open' });
    const action: SweepAction = {
      kind: 'park',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-1',
      gateId: 'gate-1',
    };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(['gatePark(gate-1)']);
    expect(io.closed).toEqual([]);
    expect(io.logs).toHaveLength(1);
    expect(io.logs[0]).toContain('not-open');
  });

  test('park action with no gateId is a no-op', async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'park',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-1',
    };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual([]);
    expect(io.closed).toEqual([]);
  });

  test('close-missed-done action always closes the tab and writes done to its own domain, no gate re-read guard', async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'close-missed-done',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-2',
    };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual(['tab-2']);
    expect(io.writes.review).toEqual([{ status: 'done', tabId: '' }]);
    expect(io.writes.respond).toEqual([]);
    expect(io.writes.doctor).toEqual([]);
  });

  test("a doctor close-missed-done writes only the doctor domain's state, never review's or respond's", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'close-missed-done',
      domain: 'doctor',
      mrUrl: MR_URL,
      tabId: 'doctor-tab',
    };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual(['doctor-tab']);
    expect(io.writes.doctor).toEqual([{ status: 'done', tabId: '' }]);
    expect(io.writes.review).toEqual([]);
    expect(io.writes.respond).toEqual([]);
    expect(io.logs[0]).toContain('doctor');
  });

  test("a respond close-missed-done writes only the respond domain's state", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = {
      kind: 'close-missed-done',
      domain: 'respond',
      mrUrl: MR_URL,
      tabId: 'respond-tab',
    };
    await executeSweepAction(action, io);
    expect(io.writes.respond).toEqual([{ status: 'done', tabId: '' }]);
    expect(io.writes.review).toEqual([]);
    expect(io.writes.doctor).toEqual([]);
  });
});

describe('executeSweepAction onReviewParked', () => {
  function withParkHook(
    io: ReturnType<typeof makeIo>,
    impl?: () => Promise<void>
  ): Array<[string, number]> {
    const parked: Array<[string, number]> = [];
    io.onReviewParked = async (mrUrl, parkedAt) => {
      parked.push([mrUrl, parkedAt]);
      if (impl) await impl();
    };
    return parked;
  }

  const reviewPark: SweepAction = {
    kind: 'park',
    domain: 'review',
    mrUrl: MR_URL,
    tabId: 'tab-1',
    gateId: 'gate-1',
  };

  test('a review park that gatePark accepts reports the park at now', async () => {
    const io = makeIo({ ok: true });
    const parked = withParkHook(io);
    await executeSweepAction(reviewPark, io);
    expect(parked).toEqual([[MR_URL, 5000]]);
  });

  test('a refused park reports nothing', async () => {
    const io = makeIo({ ok: false, error: 'not-open' });
    const parked = withParkHook(io);
    await executeSweepAction(reviewPark, io);
    expect(parked).toEqual([]);
  });

  test('a respond-domain park reports nothing', async () => {
    const io = makeIo({ ok: true });
    const parked = withParkHook(io);
    await executeSweepAction({ ...reviewPark, domain: 'respond' }, io);
    expect(parked).toEqual([]);
  });

  test('a park after a resume reports again', async () => {
    const io = makeIo({ ok: true });
    const parked = withParkHook(io);
    await executeSweepAction(reviewPark, io);
    await executeSweepAction({ ...reviewPark, gateId: 'gate-2' }, io);
    expect(parked).toEqual([
      [MR_URL, 5000],
      [MR_URL, 5000],
    ]);
  });

  test('the park is recorded before the tab closes, and reported after', async () => {
    const io = makeIo({ ok: true });
    io.markReviewParked = (mrUrl, parkedAt) => {
      io.calls.push(`mark(${mrUrl},${parkedAt})`);
    };
    io.onReviewParked = async () => {
      io.calls.push('report');
    };
    await executeSweepAction(reviewPark, io);
    expect(io.calls).toEqual([
      'gatePark(gate-1)',
      `mark(${MR_URL},5000)`,
      'closeTab(tab-1)',
      'report',
    ]);
  });

  function withBothHooks(io: ReturnType<typeof makeIo>): string[] {
    const seen: string[] = [];
    io.markReviewParked = () => {
      seen.push('mark');
    };
    io.onReviewParked = async () => {
      seen.push('report');
    };
    return seen;
  }

  test("an older run's gate still parks but is neither recorded nor reported", async () => {
    const io = makeIo({ ok: true });
    io.reviewRunStartedAt = () => 1_000;
    const seen = withBothHooks(io);
    await executeSweepAction({ ...reviewPark, gateOpenedAt: 999 }, io);
    expect(io.calls).toEqual(['gatePark(gate-1)', 'closeTab(tab-1)']);
    expect(seen).toEqual([]);
  });

  test("the current run's gate is recorded and reported", async () => {
    const io = makeIo({ ok: true });
    io.reviewRunStartedAt = () => 1_000;
    const seen = withBothHooks(io);
    await executeSweepAction({ ...reviewPark, gateOpenedAt: 1_000 }, io);
    expect(seen).toEqual(['mark', 'report']);
  });

  test('with no lane the park is recorded and reported', async () => {
    const io = makeIo({ ok: true });
    io.reviewRunStartedAt = () => undefined;
    const seen = withBothHooks(io);
    await executeSweepAction({ ...reviewPark, gateOpenedAt: 999 }, io);
    expect(seen).toEqual(['mark', 'report']);
  });

  test('a refused or respond-domain park records nothing', async () => {
    const marks: string[] = [];
    for (const [result, domain] of [
      [{ ok: false, error: 'not-open' }, 'review'],
      [{ ok: true }, 'respond'],
    ] as const) {
      const io = makeIo(result);
      io.markReviewParked = mrUrl => {
        marks.push(mrUrl);
      };
      await executeSweepAction({ ...reviewPark, domain }, io);
    }
    expect(marks).toEqual([]);
  });

  test('a failing record is logged and the tab still closes', async () => {
    const io = makeIo({ ok: true });
    io.markReviewParked = () => {
      throw new Error('db locked');
    };
    await executeSweepAction(reviewPark, io);
    expect(io.closed).toEqual(['tab-1']);
    expect(io.logs.some(l => l.includes('db locked'))).toBe(true);
  });

  test('a failing report is logged, never thrown', async () => {
    const io = makeIo({ ok: true });
    withParkHook(io, async () => {
      throw new Error('outbox full');
    });
    await executeSweepAction(reviewPark, io);
    expect(io.closed).toEqual(['tab-1']);
    expect(io.logs.some(l => l.includes('outbox full'))).toBe(true);
  });
});
