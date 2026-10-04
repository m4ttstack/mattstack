import { afterEach, describe, expect, test } from 'bun:test';

import type { SwitchboardClient } from '../peer/client.ts';
import {
  clearClosedPeerReviews,
  CLOSED_REPORTED_NS,
  closedPaneReports,
  pruneClosedPaneMarkers,
  sweepClosedPeerReviews,
  type ClosedPaneLane,
} from '../peer/closed-pane.ts';
import type { NudgeState } from '../peer/nudges.ts';
import { readOutbox } from '../peer/outbox.ts';
import { openStateDb } from '../state/db.ts';
import { listKvValues, setKvValue } from '../state/kv-blob.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/9';
const NOW = 10_000;

const gone = (agentId: string, sessionId = '') => ({
  agentId,
  sessionId,
  state: 'gone',
});

function input(over: Partial<Parameters<typeof closedPaneReports>[0]> = {}) {
  const reviews = new Map<string, ClosedPaneLane>([
    [
      URL_A,
      { iid: 4821, status: 'reviewing', agentId: 'ag-1', runStartedAt: 500 },
    ],
  ]);
  const nudges: NudgeState[] = [
    {
      id: 'ask-1',
      mrUrl: URL_A,
      iid: 4821,
      from: 'kim',
      receivedAt: 400,
      materializedAt: 400,
      kind: 'review',
    },
  ];
  return {
    reviews,
    executors: [gone('ag-1')],
    authorOf: (u: string) =>
      u === URL_A ? 'kim' : u === URL_B ? 'pat' : undefined,
    self: 'pat',
    reported: new Map<string, unknown>(),
    nudges,
    now: NOW,
    ...over,
  };
}

describe('closedPaneReports', () => {
  test('a gone pane on a teammate MR reports pane closed with the ask id', () => {
    expect(closedPaneReports(input())).toEqual([
      {
        to: 'kim',
        mrUrl: URL_A,
        runStartedAt: 500,
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'error',
          reason: 'pane closed',
          updatedAt: NOW,
          nudgeId: 'ask-1',
        },
      },
    ]);
  });

  test('a queued lane is reported too', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [
        URL_A,
        { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 500 },
      ],
    ]);
    expect(closedPaneReports(input({ reviews })).length).toBe(1);
  });

  test('a lane matched by session id when it has no agent id', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [
        URL_A,
        { iid: 4821, status: 'reviewing', sessionId: 's-1', runStartedAt: 500 },
      ],
    ]);
    expect(
      closedPaneReports(input({ reviews, executors: [gone('ag-x', 's-1')] }))
        .length
    ).toBe(1);
  });

  test('my own MR is never reported', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [
        URL_B,
        { iid: 9, status: 'reviewing', agentId: 'ag-1', runStartedAt: 500 },
      ],
    ]);
    expect(closedPaneReports(input({ reviews }))).toEqual([]);
  });

  test('an author whose name differs only in case is still me', () => {
    expect(closedPaneReports(input({ self: 'KIM' }))).toEqual([]);
  });

  test('an MR with no known author is skipped', () => {
    expect(closedPaneReports(input({ authorOf: () => undefined }))).toEqual([]);
  });

  test('a live or hidden executor is not reported', () => {
    for (const state of ['live', 'hidden'])
      expect(
        closedPaneReports(
          input({ executors: [{ agentId: 'ag-1', sessionId: '', state }] })
        )
      ).toEqual([]);
  });

  test('a finished lane is not reported', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [
        URL_A,
        { iid: 4821, status: 'done', agentId: 'ag-1', runStartedAt: 500 },
      ],
    ]);
    expect(closedPaneReports(input({ reviews }))).toEqual([]);
  });

  test('the same run is reported once; a fresh run reports again', () => {
    expect(
      closedPaneReports(input({ reported: new Map([[URL_A, 500]]) }))
    ).toEqual([]);
    expect(
      closedPaneReports(input({ reported: new Map([[URL_A, 200]]) })).length
    ).toBe(1);
  });

  test('a run with no start time reports once under 0', () => {
    const reviews = new Map<string, ClosedPaneLane>([
      [URL_A, { iid: 4821, status: 'reviewing', agentId: 'ag-1' }],
    ]);
    const [report] = closedPaneReports(input({ reviews }));
    expect(report?.runStartedAt).toBe(0);
    expect(report?.payload.nudgeId).toBeUndefined();
    expect(
      closedPaneReports(input({ reviews, reported: new Map([[URL_A, 0]]) }))
    ).toEqual([]);
  });
});

const databases: ReturnType<typeof openStateDb>[] = [];
function freshDb() {
  const db = openStateDb(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function runtime() {
  const db = freshDb();
  const client: SwitchboardClient = {
    publish: async () => 201,
    inbox: async () => [],
    ack: async () => true,
    peers: async () => [],
  };
  let peer: { self: string; client: SwitchboardClient } | undefined = {
    self: 'pat',
    client,
  };
  const initial = input();
  let reviews = initial.reviews;
  let kicks = 0;
  const io = {
    current: () => peer,
    readReviews: () => reviews,
    fetchExecutors: async () => initial.executors,
    fetchAuthors: async () =>
      new Map([
        [URL_A, 'kim'],
        [URL_B, 'pat'],
      ]),
    readNudges: () => initial.nudges,
    kickOutbox: (target: SwitchboardClient) => {
      expect(target).toBe(client);
      kicks++;
    },
  };
  return {
    db,
    io,
    setPeer: (next: typeof peer) => {
      peer = next;
    },
    setReviews: (next: typeof reviews) => {
      reviews = next;
    },
    kicks: () => kicks,
  };
}

describe('sweepClosedPeerReviews', () => {
  test('queues the report and persists its run marker, so repeated sweeps send once', async () => {
    const r = runtime();
    await sweepClosedPeerReviews(r.io, r.db);
    await sweepClosedPeerReviews(r.io, r.db);
    const queued = readOutbox(r.db);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.envelope).toMatchObject({
      to: 'kim',
      type: 'review-state',
      payload: {
        mrUrl: URL_A,
        iid: 4821,
        status: 'error',
        reason: 'pane closed',
        nudgeId: 'ask-1',
      },
    });
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(500);
    expect(r.io.readReviews().get(URL_A)?.status).toBe('reviewing');
    expect(r.kicks()).toBe(1);
  });

  test('a done write while the snapshot is pending prevents a closed report', async () => {
    const r = runtime();
    const pending = deferred<Awaited<ReturnType<typeof r.io.fetchExecutors>>>();
    r.io.fetchExecutors = () => pending.promise;
    const sweep = sweepClosedPeerReviews(r.io, r.db);
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'done', agentId: 'ag-1', runStartedAt: 500 },
        ],
      ])
    );
    pending.resolve([gone('ag-1')]);
    await sweep;
    expect(readOutbox(r.db)).toEqual([]);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
    expect(r.kicks()).toBe(0);
  });

  test('a fresh run while the snapshot is pending never inherits an old pane report', async () => {
    const r = runtime();
    const pending = deferred<Awaited<ReturnType<typeof r.io.fetchAuthors>>>();
    r.io.fetchAuthors = () => pending.promise;
    const sweep = sweepClosedPeerReviews(r.io, r.db);
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'queued', agentId: 'ag-2', runStartedAt: 900 },
        ],
      ])
    );
    pending.resolve(new Map([[URL_A, 'kim']]));
    await sweep;
    expect(readOutbox(r.db)).toEqual([]);
    r.io.fetchExecutors = async () => [gone('ag-2')];
    await sweepClosedPeerReviews(r.io, r.db);
    expect(readOutbox(r.db)).toHaveLength(1);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(900);
  });

  test('a fresh run that reuses its executor is deferred until the next snapshot', async () => {
    const r = runtime();
    const pending = deferred<Awaited<ReturnType<typeof r.io.fetchExecutors>>>();
    r.io.fetchExecutors = () => pending.promise;
    const sweep = sweepClosedPeerReviews(r.io, r.db);
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 900 },
        ],
      ])
    );
    pending.resolve([gone('ag-1')]);
    await sweep;
    expect(readOutbox(r.db)).toEqual([]);
    await sweepClosedPeerReviews(r.io, r.db);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(900);
  });

  test('losing the writer or changing peering/member while pending prevents writes', async () => {
    for (const next of [
      undefined,
      { self: 'all' },
      { self: 'kim' },
      { self: 'pat' },
    ]) {
      const r = runtime();
      const pending =
        deferred<Awaited<ReturnType<typeof r.io.fetchExecutors>>>();
      r.io.fetchExecutors = () => pending.promise;
      const sweep = sweepClosedPeerReviews(r.io, r.db);
      const original = r.io.current()!;
      r.setPeer(
        next
          ? {
              self: next.self,
              client:
                next.self === 'pat' ? { ...original.client } : original.client,
            }
          : undefined
      );
      pending.resolve([gone('ag-1')]);
      await sweep;
      expect(readOutbox(r.db)).toEqual([]);
      expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
    }
  });

  test('overlapping sweeps still enqueue the same run once', async () => {
    const r = runtime();
    const pending = deferred<Awaited<ReturnType<typeof r.io.fetchExecutors>>>();
    r.io.fetchExecutors = () => pending.promise;
    const a = sweepClosedPeerReviews(r.io, r.db);
    const b = sweepClosedPeerReviews(r.io, r.db);
    pending.resolve([gone('ag-1')]);
    await Promise.all([a, b]);
    expect(readOutbox(r.db)).toHaveLength(1);
    expect(r.kicks()).toBe(1);
  });

  test('a failed marker write rolls back the queued report and retries the whole run', async () => {
    const r = runtime();
    r.db.run(
      "CREATE TRIGGER reject_marker BEFORE INSERT ON kv WHEN NEW.ns = 'peer-closed-reported' BEGIN SELECT RAISE(ABORT, 'marker rejected'); END"
    );
    await expect(sweepClosedPeerReviews(r.io, r.db)).rejects.toThrow(
      'marker rejected'
    );
    expect(readOutbox(r.db)).toEqual([]);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
    expect(r.kicks()).toBe(0);
    r.db.run('DROP TRIGGER reject_marker');
    await sweepClosedPeerReviews(r.io, r.db);
    expect(readOutbox(r.db)).toHaveLength(1);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(500);
  });

  test('a failed enqueue never records a run as reported', async () => {
    const r = runtime();
    r.db.run(
      "CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'outbox rejected'); END"
    );
    await expect(sweepClosedPeerReviews(r.io, r.db)).rejects.toThrow(
      'outbox rejected'
    );
    expect(readOutbox(r.db)).toEqual([]);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
  });

  test('an idle lane or unavailable peer skips fetching and writing', async () => {
    for (const idle of [true, false]) {
      const r = runtime();
      if (idle) r.setReviews(new Map());
      else r.setPeer(undefined);
      r.io.fetchExecutors = async () => {
        throw new Error('must not fetch');
      };
      r.io.fetchAuthors = async () => {
        throw new Error('must not fetch');
      };
      await sweepClosedPeerReviews(r.io, r.db);
      expect(readOutbox(r.db)).toEqual([]);
    }
  });
});

describe('clearClosedPeerReviews', () => {
  function clearRuntime() {
    const r = runtime();
    const settled: string[] = [];
    const reportErrors: unknown[] = [];
    const responds: Array<[string, string | undefined]> = [];
    const io = {
      ...r.io,
      clearExecutor: async () => ({ ok: true }),
      settleReview: (url: string) => {
        settled.push(url);
        r.setReviews(
          new Map(
            [...r.io.readReviews()].map(([key, lane]) => [
              key,
              key === url ? { ...lane, status: 'error' } : lane,
            ])
          )
        );
      },
      settleResponds: (agent: string, session: string | undefined) => {
        responds.push([agent, session]);
      },
      onReportError: (err: unknown) => {
        reportErrors.push(err);
      },
    };
    return { ...r, io, settled, reportErrors, responds };
  }

  test('clear before the first sweep reports queued and reviewing runs once', async () => {
    for (const status of ['queued', 'reviewing']) {
      const r = clearRuntime();
      r.setReviews(
        new Map([
          [URL_A, { iid: 4821, status, agentId: 'ag-1', runStartedAt: 500 }],
        ])
      );
      expect(await clearClosedPeerReviews('ag-1', r.io, r.db)).toEqual({
        ok: true,
      });
      await clearClosedPeerReviews('ag-1', r.io, r.db);
      await sweepClosedPeerReviews(r.io, r.db);
      expect(readOutbox(r.db)).toHaveLength(1);
      expect(readOutbox(r.db)[0]?.envelope).toMatchObject({
        to: 'kim',
        type: 'review-state',
        payload: {
          mrUrl: URL_A,
          iid: 4821,
          status: 'error',
          reason: 'pane closed',
          nudgeId: 'ask-1',
        },
      });
      expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(500);
      expect(r.settled).toEqual([URL_A]);
      expect(r.io.readReviews().get(URL_A)?.status).toBe('error');
    }
  });

  test('clear during a pending sweep retains exactly one pane-closed report', async () => {
    const r = clearRuntime();
    const pending = deferred<Awaited<ReturnType<typeof r.io.fetchExecutors>>>();
    const sweep = sweepClosedPeerReviews(
      { ...r.io, fetchExecutors: () => pending.promise },
      r.db
    );
    await clearClosedPeerReviews('ag-1', r.io, r.db);
    pending.resolve([gone('ag-1')]);
    await sweep;
    expect(readOutbox(r.db)).toHaveLength(1);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).get(URL_A)).toBe(500);
  });

  test('own, unknown and finished lanes send nothing; own and unknown lanes still clear', async () => {
    const r = clearRuntime();
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'done', agentId: 'ag-1', runStartedAt: 500 },
        ],
        [
          URL_B,
          { iid: 9, status: 'reviewing', agentId: 'ag-1', runStartedAt: 500 },
        ],
        [
          'unknown',
          { iid: 10, status: 'queued', agentId: 'ag-1', runStartedAt: 500 },
        ],
      ])
    );
    await clearClosedPeerReviews('ag-1', r.io, r.db);
    expect(readOutbox(r.db)).toEqual([]);
    expect(r.settled).toEqual([URL_B, 'unknown']);
    expect(r.io.readReviews().get(URL_A)?.status).toBe('done');
  });

  test('failed clear leaves lanes and the outbox untouched', async () => {
    const r = clearRuntime();
    const result = await clearClosedPeerReviews(
      'ag-1',
      {
        ...r.io,
        clearExecutor: async () => ({ ok: false, error: 'daemon refused' }),
      },
      r.db
    );
    expect(result).toEqual({ ok: false, error: 'daemon refused' });
    expect(readOutbox(r.db)).toEqual([]);
    expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
    expect(r.settled).toEqual([]);
    expect(r.io.readReviews().get(URL_A)?.status).toBe('reviewing');
  });

  test('a replacement run while the daemon clear is pending stays untouched', async () => {
    const r = clearRuntime();
    const pending = deferred<{ ok: boolean }>();
    const clearing = clearClosedPeerReviews(
      'ag-1',
      { ...r.io, clearExecutor: () => pending.promise },
      r.db
    );
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 900 },
        ],
      ])
    );
    pending.resolve({ ok: true });
    await clearing;
    expect(readOutbox(r.db)).toEqual([]);
    expect(r.settled).toEqual([]);
  });

  test('no peer still clears locally without author reads or reporting', async () => {
    const r = clearRuntime();
    r.setPeer(undefined);
    await clearClosedPeerReviews(
      'ag-1',
      {
        ...r.io,
        fetchAuthors: async () => {
          throw new Error('must not fetch');
        },
      },
      r.db
    );
    expect(r.settled).toEqual([URL_A]);
    expect(readOutbox(r.db)).toEqual([]);
  });

  test('losing the writer or changing member/client during author reads suppresses the report', async () => {
    for (const next of [undefined, 'all', 'kim', 'client']) {
      const r = clearRuntime();
      const pending = deferred<Awaited<ReturnType<typeof r.io.fetchAuthors>>>();
      const entered = deferred<void>();
      const clearing = clearClosedPeerReviews(
        'ag-1',
        {
          ...r.io,
          fetchAuthors: () => {
            entered.resolve();
            return pending.promise;
          },
        },
        r.db
      );
      await entered.promise;
      const original = r.io.current()!;
      r.setPeer(
        next
          ? {
              self: next === 'client' ? 'pat' : next,
              client:
                next === 'client' ? { ...original.client } : original.client,
            }
          : undefined
      );
      pending.resolve(new Map([[URL_A, 'kim']]));
      await clearing;
      expect(readOutbox(r.db)).toEqual([]);
      expect(r.settled).toEqual([URL_A]);
    }
  });

  test('a sweep followed by clear reports the same run only once', async () => {
    const r = clearRuntime();
    await sweepClosedPeerReviews(r.io, r.db);
    await clearClosedPeerReviews('ag-1', r.io, r.db);
    expect(readOutbox(r.db)).toHaveLength(1);
    expect(r.kicks()).toBe(1);
    expect(r.settled).toEqual([URL_A]);
  });

  test.each(['authors', 'outbox'])(
    '%s failure preserves successful local review/respond settlement and logs the error',
    async failure => {
      const r = clearRuntime();
      if (failure === 'outbox')
        r.db.run(
          "CREATE TRIGGER reject_clear_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'outbox rejected'); END"
        );
      const result = await clearClosedPeerReviews(
        'ag-1',
        {
          ...r.io,
          fetchAuthors:
            failure === 'authors'
              ? async () => {
                  throw new Error('authors unavailable');
                }
              : r.io.fetchAuthors,
        },
        r.db
      );
      expect(result).toEqual({ ok: true });
      expect(r.settled).toEqual([URL_A]);
      expect(r.io.readReviews().get(URL_A)?.status).toBe('error');
      expect(r.responds).toEqual([['ag-1', '']]);
      expect(readOutbox(r.db)).toEqual([]);
      expect(listKvValues(CLOSED_REPORTED_NS, r.db).size).toBe(0);
      expect(r.kicks()).toBe(0);
      expect(r.reportErrors.map(err => (err as Error).message)).toEqual([
        failure === 'authors' ? 'authors unavailable' : 'outbox rejected',
      ]);
    }
  );

  test('a failed author lookup still revalidates a replacement run before local settlement', async () => {
    const r = clearRuntime();
    const entered = deferred<void>();
    let reject!: (err: Error) => void;
    const pending = new Promise<ReadonlyMap<string, string>>((_, fail) => {
      reject = fail;
    });
    const clearing = clearClosedPeerReviews(
      'ag-1',
      {
        ...r.io,
        fetchAuthors: () => {
          entered.resolve();
          return pending;
        },
      },
      r.db
    );
    await entered.promise;
    r.setReviews(
      new Map([
        [
          URL_A,
          { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 900 },
        ],
      ])
    );
    reject(new Error('authors unavailable'));
    expect(await clearing).toEqual({ ok: true });
    expect(r.settled).toEqual([]);
    expect(readOutbox(r.db)).toEqual([]);
    expect(r.reportErrors.map(err => (err as Error).message)).toEqual([
      'authors unavailable',
    ]);
  });

  test('completion or replacement during author lookup is neither reported nor cleared', async () => {
    for (const next of [
      { iid: 4821, status: 'done', agentId: 'ag-1', runStartedAt: 500 },
      { iid: 4821, status: 'queued', agentId: 'ag-1', runStartedAt: 900 },
      { iid: 4821, status: 'queued', agentId: 'ag-2', runStartedAt: 500 },
    ]) {
      const r = clearRuntime();
      const pending = deferred<Awaited<ReturnType<typeof r.io.fetchAuthors>>>();
      const entered = deferred<void>();
      const clearing = clearClosedPeerReviews(
        'ag-1',
        {
          ...r.io,
          fetchAuthors: () => {
            entered.resolve();
            return pending.promise;
          },
        },
        r.db
      );
      await entered.promise;
      r.setReviews(new Map([[URL_A, next]]));
      pending.resolve(new Map([[URL_A, 'kim']]));
      await clearing;
      expect(readOutbox(r.db)).toEqual([]);
      expect(r.settled).toEqual([]);
    }
  });
});

describe('pruneClosedPaneMarkers', () => {
  test('removes off-board markers while keeping current runs and unrelated namespaces', () => {
    const db = freshDb();
    setKvValue(CLOSED_REPORTED_NS, URL_A, 500, db);
    setKvValue(CLOSED_REPORTED_NS, URL_B, 0, db);
    setKvValue('other', URL_A, 99, db);
    pruneClosedPaneMarkers(new Set([URL_A]), db);
    expect(listKvValues(CLOSED_REPORTED_NS, db)).toEqual(
      new Map([[URL_A, 500]])
    );
    expect(listKvValues('other', db)).toEqual(new Map([[URL_A, 99]]));
    pruneClosedPaneMarkers(new Set([URL_A]), db);
    expect(listKvValues(CLOSED_REPORTED_NS, db).size).toBe(1);
    pruneClosedPaneMarkers(new Set(), db);
    expect(listKvValues(CLOSED_REPORTED_NS, db).size).toBe(0);
  });
});
