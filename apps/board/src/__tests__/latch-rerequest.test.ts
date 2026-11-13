import type { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';

import { DAEMON_UNREACHABLE_PREFIX } from '@mattstack/rt-client';
import { repoIdentityField } from '../config.ts';
import type { BoardMR } from '../data.ts';
import type { ReviewerRequest } from '../latch/discussions.ts';
import {
  createReRequestHolds,
  LATCH_REREQUEST_NS,
  planReRequests,
  REREQUEST_HOLD_MS,
  sendReReviewRequests,
  type ReRequestDeps,
} from '../latch/rerequest.ts';
import { listKvValues, setKvValue } from '../state/kv-blob.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const URL_A = 'https://github.test/o/r/pull/5';
const URL_B = 'https://github.test/o/r/pull/6';
const REPO = repoIdentityField('github.com/o/r')!;

const req = (
  reviewer: string,
  discussionId: string,
  requested: boolean
): ReviewerRequest => ({ reviewer, discussionId, requested });

describe('planReRequests', () => {
  test('a requested reviewer who has reviewed, with no key, is sent', () => {
    expect(
      planReRequests(
        URL_A,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }],
        []
      )
    ).toEqual({ send: ['ivasco'], mark: [], forget: [] });
  });

  test('a requested reviewer already pending on GitHub is only marked', () => {
    expect(
      planReRequests(
        URL_A,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'UNREVIEWED' }],
        []
      )
    ).toEqual({ send: [], mark: [`${URL_A}|d1`], forget: [] });
  });

  test('a request whose key is set gives nothing', () => {
    expect(
      planReRequests(
        URL_A,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }],
        [`${URL_A}|d1`]
      )
    ).toEqual({ send: [], mark: [], forget: [] });
  });

  test('a key on a latch that is no longer requested is forgotten', () => {
    expect(
      planReRequests(
        URL_A,
        [req('ivasco', 'd1', false)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }],
        [`${URL_A}|d1`]
      )
    ).toEqual({ send: [], mark: [], forget: [`${URL_A}|d1`] });
  });

  test('a key whose thread is gone is forgotten', () => {
    expect(planReRequests(URL_A, [], [], [`${URL_A}|gone`])).toEqual({
      send: [],
      mark: [],
      forget: [`${URL_A}|gone`],
    });
  });

  test("matches the reviewer's state without regard to case", () => {
    expect(
      planReRequests(
        URL_A,
        [req('IVasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'UNREVIEWED' }],
        []
      )
    ).toEqual({ send: [], mark: [`${URL_A}|d1`], forget: [] });
  });
});

type Answer = { ok: boolean; data?: unknown; error?: string };

function fakeDaemon(
  opts: {
    login?: string;
    action?: Answer;
    actionFor?: Record<number, Answer>;
  } = {}
) {
  const calls: Array<{ verb: string; payload: Record<string, unknown> }> = [];
  const command = (async (verb: string, payload: Record<string, unknown>) => {
    calls.push({ verb, payload });
    if (verb === 'forge:self')
      return { ok: true, data: { username: opts.login ?? 'Ellie-Dev' } };
    if (verb === 'mr:action')
      return (
        opts.actionFor?.[payload.iid as number] ?? opts.action ?? { ok: true }
      );
    return { ok: false, error: `unexpected verb ${verb}` };
  }) as never;
  const actions = () => calls.filter(c => c.verb === 'mr:action');
  return { calls, command, actions };
}

function pr(
  webUrl: string,
  iid: number,
  requests: ReviewerRequest[] | undefined,
  reviewers: Array<{ username: string; reviewState: string | null }>
): BoardMR {
  return {
    webUrl,
    iid,
    rtRepo: 'github.com/o/r',
    author: { username: 'ellie-dev' },
    reviews: { reviewers },
    reviewerRequests: requests,
  } as unknown as BoardMR;
}

function run(
  mrs: BoardMR[],
  daemon: ReturnType<typeof fakeDaemon>,
  db: Database,
  forge: 'github' | 'gitlab' = 'github',
  extra: Partial<ReRequestDeps> = {}
) {
  const lines: string[] = [];
  const done = sendReReviewRequests(mrs, {
    self: 'ellie-dev',
    forge,
    command: daemon.command,
    db,
    log: line => lines.push(line),
    holds: createReRequestHolds(),
    ...extra,
  });
  return done.then(() => lines);
}

const keys = (db: Database) => [...listKvValues(LATCH_REREQUEST_NS, db).keys()];

describe('sendReReviewRequests', () => {
  test('only the requested reviewer is re-requested', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    const lines = await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd-iv', true), req('kim', 'd-kim', false)],
          [
            { username: 'ivasco', reviewState: 'COMMENTED' },
            { username: 'kim', reviewState: 'COMMENTED' },
          ]
        ),
      ],
      daemon,
      db
    );
    expect(daemon.actions()).toEqual([
      {
        verb: 'mr:action',
        payload: {
          repoName: REPO,
          iid: 5,
          action: 'requestReReview',
          args: [['ivasco']],
        },
      },
    ]);
    expect(keys(db)).toEqual([`${URL_A}|d-iv`]);
    expect(lines).toEqual([]);
  });

  test('sends once per request cycle', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    const mrs = [
      pr(
        URL_A,
        5,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }]
      ),
    ];
    await run(mrs, daemon, db);
    await run(mrs, daemon, db);
    expect(daemon.actions()).toHaveLength(1);
  });

  test('every requested reviewer on one PR goes in one call', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd1', true), req('kim', 'd2', true)],
          [
            { username: 'ivasco', reviewState: 'COMMENTED' },
            { username: 'kim', reviewState: 'APPROVED' },
          ]
        ),
      ],
      daemon,
      db
    );
    expect(daemon.actions().map(c => c.payload.args)).toEqual([
      [['ivasco', 'kim']],
    ]);
    expect(keys(db).sort()).toEqual([`${URL_A}|d1`, `${URL_A}|d2`]);
  });

  test('a reviewer already pending is marked without a call', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd1', true)],
          [{ username: 'ivasco', reviewState: 'UNREVIEWED' }]
        ),
      ],
      daemon,
      db
    );
    expect(daemon.calls).toEqual([]);
    expect(keys(db)).toEqual([`${URL_A}|d1`]);
  });

  test('a refused call writes nothing, logs one line, and holds its retry for an hour', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({
      action: {
        ok: false,
        error: 'Error: requestReReview failed: 422 not a collaborator',
      },
    });
    const mrs = [
      pr(
        URL_A,
        5,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }]
      ),
    ];
    let now = 1_000;
    const extra = { holds: createReRequestHolds(), now: () => now };
    const lines = await run(mrs, daemon, db, 'github', extra);
    expect(keys(db)).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(URL_A);
    expect(lines[0]).toContain('ivasco');
    expect(lines[0]).toContain('422 not a collaborator');

    now = 1_000 + REREQUEST_HOLD_MS - 1;
    expect(await run(mrs, daemon, db, 'github', extra)).toEqual([]);
    expect(daemon.actions()).toHaveLength(1);

    now = 1_000 + REREQUEST_HOLD_MS;
    await run(mrs, daemon, db, 'github', extra);
    expect(daemon.actions()).toHaveLength(2);
    expect(keys(db)).toEqual([]);
  });

  test("a refusal on one PR does not hold another PR's send", async () => {
    const db = tempDb();
    const daemon = fakeDaemon({
      actionFor: { 5: { ok: false, error: 'Error: 422 not a collaborator' } },
    });
    const reviewers = [{ username: 'ivasco', reviewState: 'COMMENTED' }];
    const extra = { holds: createReRequestHolds(), now: () => 1_000 };
    await run(
      [
        pr(URL_A, 5, [req('ivasco', 'd1', true)], reviewers),
        pr(URL_B, 6, [req('ivasco', 'd2', true)], reviewers),
      ],
      daemon,
      db,
      'github',
      extra
    );
    expect(daemon.actions().map(c => c.payload.iid)).toEqual([5, 6]);
    expect(keys(db)).toEqual([`${URL_B}|d2`]);
  });

  test('a key another pass wrote during the identity check is not sent again', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd1', true)],
          [{ username: 'ivasco', reviewState: 'COMMENTED' }]
        ),
      ],
      daemon,
      db,
      'github',
      {
        verify: async () => {
          setKvValue(LATCH_REREQUEST_NS, `${URL_A}|d1`, { at: 1 }, db);
          return true;
        },
      }
    );
    expect(daemon.actions()).toEqual([]);
  });

  test('an unanswered call writes the key, so it is never sent twice', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({
      action: { ok: false, error: `${DAEMON_UNREACHABLE_PREFIX}/x: timed out` },
    });
    const mrs = [
      pr(
        URL_A,
        5,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }]
      ),
    ];
    await run(mrs, daemon, db);
    expect(keys(db)).toEqual([`${URL_A}|d1`]);
    await run(mrs, daemon, db);
    expect(daemon.actions()).toHaveLength(1);
  });

  test('after a stuck reply clears the request, nothing is sent', async () => {
    const db = tempDb();
    setKvValue(LATCH_REREQUEST_NS, `${URL_A}|d1`, { at: 1 }, db);
    const daemon = fakeDaemon();
    await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd1', true)],
          [{ username: 'ivasco', reviewState: 'COMMENTED' }]
        ),
      ],
      daemon,
      db
    );
    expect(daemon.calls).toEqual([]);
    expect(keys(db)).toEqual([`${URL_A}|d1`]);
  });

  test('a re-armed latch forgets its key, so the next ask sends again', async () => {
    const db = tempDb();
    const daemon = fakeDaemon();
    const reviewers = [{ username: 'ivasco', reviewState: 'COMMENTED' }];
    await run(
      [pr(URL_A, 5, [req('ivasco', 'd1', true)], reviewers)],
      daemon,
      db
    );
    await run(
      [pr(URL_A, 5, [req('ivasco', 'd1', false)], reviewers)],
      daemon,
      db
    );
    expect(keys(db)).toEqual([]);
    await run(
      [pr(URL_A, 5, [req('ivasco', 'd1', true)], reviewers)],
      daemon,
      db
    );
    expect(daemon.actions()).toHaveLength(2);
  });

  test('a spent or gone latch forgets its key', async () => {
    const db = tempDb();
    setKvValue(LATCH_REREQUEST_NS, `${URL_A}|d1`, { at: 1 }, db);
    setKvValue(LATCH_REREQUEST_NS, `${URL_B}|d9`, { at: 1 }, db);
    const daemon = fakeDaemon();
    await run([pr(URL_A, 5, [], [])], daemon, db);
    expect(keys(db)).toEqual([`${URL_B}|d9`]);
  });

  test('a PR whose discussions went unread keeps its keys', async () => {
    const db = tempDb();
    setKvValue(LATCH_REREQUEST_NS, `${URL_A}|d1`, { at: 1 }, db);
    const daemon = fakeDaemon();
    await run([pr(URL_A, 5, undefined, [])], daemon, db);
    expect(keys(db)).toEqual([`${URL_A}|d1`]);
    expect(daemon.calls).toEqual([]);
  });

  test('a daemon signed in as someone else sends nothing, checked once per repo', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ login: 'ivasco' });
    const reviewers = [{ username: 'ivasco', reviewState: 'COMMENTED' }];
    const lines = await run(
      [
        pr(URL_A, 5, [req('ivasco', 'd1', true)], reviewers),
        pr(URL_B, 6, [req('ivasco', 'd2', true)], reviewers),
      ],
      daemon,
      db
    );
    expect(daemon.actions()).toEqual([]);
    expect(daemon.calls.filter(c => c.verb === 'forge:self')).toHaveLength(1);
    expect(keys(db)).toEqual([]);
    expect(lines).toEqual([
      `latch: skipped ${REPO}, the daemon signs in as ivasco but this team records ellie-dev`,
    ]);
  });

  test('a failed identity check holds that repo for an hour, with no call or log', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ login: 'ivasco' });
    const mrs = [
      pr(
        URL_A,
        5,
        [req('ivasco', 'd1', true)],
        [{ username: 'ivasco', reviewState: 'COMMENTED' }]
      ),
    ];
    let now = 1_000;
    const extra = { holds: createReRequestHolds(), now: () => now };
    expect(await run(mrs, daemon, db, 'github', extra)).toHaveLength(1);
    expect(daemon.calls).toHaveLength(1);

    now = 1_000 + REREQUEST_HOLD_MS - 1;
    expect(await run(mrs, daemon, db, 'github', extra)).toEqual([]);
    expect(daemon.calls).toHaveLength(1);

    now = 1_000 + REREQUEST_HOLD_MS;
    await run(mrs, daemon, db, 'github', extra);
    expect(daemon.calls.map(c => c.verb)).toEqual(['forge:self', 'forge:self']);
  });

  test('a GitLab board never runs the step', async () => {
    const db = tempDb();
    setKvValue(LATCH_REREQUEST_NS, `${URL_B}|d9`, { at: 1 }, db);
    const daemon = fakeDaemon();
    await run(
      [
        pr(
          URL_A,
          5,
          [req('ivasco', 'd1', true)],
          [{ username: 'ivasco', reviewState: 'COMMENTED' }]
        ),
        pr(URL_B, 6, [], []),
      ],
      daemon,
      db,
      'gitlab'
    );
    expect(daemon.calls).toEqual([]);
    expect(keys(db)).toEqual([`${URL_B}|d9`]);
  });
});
