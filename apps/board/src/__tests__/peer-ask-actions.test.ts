import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  acceptAsk,
  declineAsk,
  declineWhileOff,
  expireStaleAsks,
  type AskActionDeps,
} from '../peer/ask-actions.ts';
import {
  markNudgeHandled,
  readNudges,
  writeNudge,
  type NudgeState,
} from '../peer/nudges.ts';
import type { ReviewState } from '../review-state.ts';
import { openStateDb } from '../state/db.ts';
import { parseTriageBlock } from '../triage/config.ts';
import { NUDGE_FRESH_MS } from '../triage/nudge.ts';

const NOW = 1_000_000;
const ask: NudgeState = {
  id: 'n1',
  mrUrl: 'https://x/mr/1',
  iid: 1,
  from: 'rae',
  receivedAt: NOW - 1000,
  kind: 'review',
};

const reviewing = (mrUrl: string): ReviewState =>
  ({
    mrUrl,
    iid: 1,
    status: 'reviewing',
    startedAt: 0,
    updatedAt: 0,
  }) as unknown as ReviewState;

function deps(over: Partial<AskActionDeps> = {}) {
  const handled: unknown[] = [];
  const published: unknown[] = [];
  const launched: unknown[] = [];
  const d: AskActionDeps = {
    asksOn: () => true,
    readNudges: () => [ask],
    markNudgeHandled: (id, result, reason, opts) => {
      handled.push({ id, result, reason, ...opts });
      return true;
    },
    publishOutcome: (to, p) => published.push({ to, p }),
    readReviewStates: () => new Map(),
    readRespondStates: () => new Map(),
    isOwnMr: () => false,
    launchAsk: async (mrUrl, iid, kind) => {
      launched.push({ mrUrl, iid, kind });
      return { kind: 'launched' };
    },
    cfg: parseTriageBlock({
      enabled: true,
      cooldownMinutes: 30,
      dailyAttemptBudget: 1,
    }),
    now: () => NOW,
    ...over,
  };
  return Object.assign(d, { handled, published, launched });
}

describe('acceptAsk', () => {
  test('launches, marks accepted, publishes launched, ignoring budget', async () => {
    const d = deps();
    expect(await acceptAsk('n1', d)).toEqual({ ok: true });
    expect(d.launched).toEqual([{ mrUrl: ask.mrUrl, iid: 1, kind: 'review' }]);
    expect(d.handled).toEqual([
      { id: 'n1', result: 'launched', reason: 'accepted' },
    ]);
    expect(d.published).toEqual([
      {
        to: 'rae',
        p: { mrUrl: ask.mrUrl, iid: 1, nudgeId: 'n1', result: 'launched' },
      },
    ]);
  });

  test('an unknown id is 404, a handled one 409, and nothing launches', async () => {
    const d = deps({
      readNudges: () => [{ ...ask, handled: { at: 1, result: 'expired' } }],
    });
    expect(await acceptAsk('nope', d)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 409 });
    expect(d.launched).toEqual([]);
  });

  test('a second ask for an MR already reviewing refuses with the reason', async () => {
    const d = deps({
      readReviewStates: () => new Map([[ask.mrUrl, reviewing(ask.mrUrl)]]),
    });
    expect(await acceptAsk('n1', d)).toEqual({
      ok: false,
      status: 409,
      message: 'A review is already running',
    });
    expect(d.handled).toEqual([
      { id: 'n1', result: 'rejected', reason: 'review-in-flight' },
    ]);
    expect(d.launched).toEqual([]);
  });

  test('accepting one ask then another for the same MR never launches twice', async () => {
    const states = new Map<string, ReviewState>();
    const second = { ...ask, id: 'n2' };
    const answered = new Set<string>();
    const d = deps({
      readNudges: () =>
        [ask, second].map(n =>
          answered.has(n.id)
            ? { ...n, handled: { at: 1, result: 'launched' as const } }
            : n
        ),
      markNudgeHandled: id => {
        answered.add(id);
        return true;
      },
      readReviewStates: () => states,
      launchAsk: async mrUrl => {
        d.launched.push(mrUrl);
        states.set(mrUrl, reviewing(mrUrl));
        return { kind: 'launched' };
      },
    });
    expect(await acceptAsk('n1', d)).toEqual({ ok: true });
    expect(await acceptAsk('n2', d)).toMatchObject({
      ok: false,
      status: 409,
      message: 'A review is already running',
    });
    expect(d.launched).toHaveLength(1);
  });

  test('two accepts at once for one MR launch exactly once', async () => {
    const states = new Map<string, ReviewState>();
    const second = { ...ask, id: 'n2' };
    const d = deps({
      readNudges: () => [ask, second],
      readReviewStates: () => states,
      launchAsk: async mrUrl => {
        d.launched.push(mrUrl);
        await new Promise(r => setTimeout(r, 5));
        states.set(mrUrl, reviewing(mrUrl));
        return { kind: 'launched' };
      },
    });
    const [a, b] = await Promise.all([acceptAsk('n1', d), acceptAsk('n2', d)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(d.launched).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser).toMatchObject({
      status: 409,
      message: 'A review is already running',
    });
  });

  test('accept while asks are off is 409 and never launches', async () => {
    const d = deps({ asksOn: () => false });
    expect(await acceptAsk('n1', d)).toEqual({
      ok: false,
      status: 409,
      message: 'Asks are turned off',
    });
    expect(d.launched).toEqual([]);
  });

  test('an ask that went stale while open expires instead', async () => {
    const d = deps({
      readNudges: () => [{ ...ask, receivedAt: NOW - 49 * 3_600_000 }],
    });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 409 });
    expect(d.published[0]).toMatchObject({ p: { result: 'expired' } });
    expect(d.launched).toEqual([]);
  });

  test('a failed launch is 502 and tells the asker', async () => {
    const d = deps({
      launchAsk: async () => ({ kind: 'error', message: 'no pane' }),
    });
    expect(await acceptAsk('n1', d)).toMatchObject({ ok: false, status: 502 });
    expect(d.published[0]).toMatchObject({
      p: { result: 'rejected', reason: 'launch-failed' },
    });
  });
});

describe('declineAsk', () => {
  test('publishes the chip words, the flag and the note', () => {
    const d = deps();
    expect(
      declineAsk('n1', { reason: 'busy', note: 'after standup' }, d)
    ).toEqual({ ok: true });
    expect(d.handled).toEqual([
      {
        id: 'n1',
        result: 'rejected',
        reason: 'busy right now',
        declined: true,
        note: 'after standup',
      },
    ]);
    expect(d.published).toEqual([
      {
        to: 'rae',
        p: {
          mrUrl: ask.mrUrl,
          iid: 1,
          nudgeId: 'n1',
          result: 'rejected',
          reason: 'busy right now',
          declined: true,
          declineNote: 'after standup',
        },
      },
    ]);
  });

  test('no reason picked sends none', () => {
    const d = deps();
    declineAsk('n1', {}, d);
    expect(d.published[0]).toEqual({
      to: 'rae',
      p: {
        mrUrl: ask.mrUrl,
        iid: 1,
        nudgeId: 'n1',
        result: 'rejected',
        declined: true,
      },
    });
  });

  test('a handled ask cannot be declined', () => {
    const d = deps({
      readNudges: () => [{ ...ask, handled: { at: 1, result: 'launched' } }],
    });
    expect(declineAsk('n1', {}, d)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('declineWhileOff', () => {
  test('answers every waiting ask with asks-off and leaves handled ones alone', () => {
    const d = deps({
      readNudges: () => [
        ask,
        { ...ask, id: 'n2', handled: { at: 1, result: 'launched' } },
      ],
    });
    expect(declineWhileOff(d)).toBe(1);
    expect(d.handled).toEqual([
      { id: 'n1', result: 'rejected', reason: 'asks-off' },
    ]);
    expect(d.published).toEqual([
      {
        to: 'rae',
        p: {
          mrUrl: ask.mrUrl,
          iid: 1,
          nudgeId: 'n1',
          result: 'rejected',
          reason: 'asks-off',
        },
      },
    ]);
  });
});

/** Deps over a real state db, so "another process" is a direct write to the
    same rows between this process's read and its answer. */
function dbDeps(over: Partial<AskActionDeps> = {}) {
  const db = openStateDb(
    join(mkdtempSync(join(tmpdir(), 'ask-actions-')), 'state.db')
  );
  const d = deps({
    readNudges: () => readNudges(db),
    markNudgeHandled: (id, result, reason, opts) =>
      markNudgeHandled(id, result, reason, db, NOW, opts),
    ...over,
  });
  return Object.assign(d, { db });
}

describe('answers racing another process', () => {
  test('accept loses to a handled write landing after its read: 409, no launch, nothing sent', async () => {
    const d = dbDeps();
    writeNudge(ask, d.db);
    d.readReviewStates = () => {
      markNudgeHandled('n1', 'rejected', 'asks-off', d.db, NOW);
      return new Map();
    };
    expect(await acceptAsk('n1', d)).toEqual({
      ok: false,
      status: 409,
      message: 'That ask was already answered',
    });
    expect(d.launched).toEqual([]);
    expect(d.published).toEqual([]);
    expect(readNudges(d.db)[0]?.handled?.reason).toBe('asks-off');
  });

  test('accept claims the row before launching, then sends launched', async () => {
    const d = dbDeps();
    writeNudge(ask, d.db);
    let duringLaunch: NudgeState['handled'];
    d.launchAsk = async () => {
      duringLaunch = readNudges(d.db)[0]?.handled;
      return { kind: 'launched' };
    };
    expect(await acceptAsk('n1', d)).toEqual({ ok: true });
    expect(duringLaunch?.result).toBe('launched');
    expect(d.published).toHaveLength(1);
  });

  test('a launch that fails turns the claim into launch-failed', async () => {
    const d = dbDeps({
      launchAsk: async () => ({ kind: 'error', message: 'no pane' }),
    });
    writeNudge(ask, d.db);
    expect(await acceptAsk('n1', d)).toMatchObject({ status: 502 });
    expect(readNudges(d.db)[0]?.handled).toMatchObject({
      result: 'rejected',
      reason: 'launch-failed',
    });
    expect(
      d.published.map(p => (p as { p: { result: string } }).p.result)
    ).toEqual(['rejected']);
  });

  test('decline and the asks-off sweep send nothing for an ask answered first elsewhere', () => {
    const d = dbDeps();
    writeNudge(ask, d.db);
    const stale = readNudges(d.db);
    markNudgeHandled('n1', 'launched', 'always-allowed', d.db, NOW);
    d.readNudges = () => stale;
    expect(declineAsk('n1', {}, d)).toMatchObject({ ok: false, status: 409 });
    expect(declineWhileOff(d)).toBe(0);
    expect(d.published).toEqual([]);
    expect(readNudges(d.db)[0]?.handled?.result).toBe('launched');
  });
});

describe('expireStaleAsks', () => {
  test('expires waiting asks past the fresh window and tells each asker once', () => {
    const d = dbDeps();
    writeNudge(
      { ...ask, id: 'old', receivedAt: NOW - NUDGE_FRESH_MS - 1 },
      d.db
    );
    writeNudge({ ...ask, id: 'fresh', receivedAt: NOW - 1000 }, d.db);
    writeNudge(
      {
        ...ask,
        id: 'done',
        receivedAt: NOW - NUDGE_FRESH_MS - 1,
        handled: { at: 1, result: 'launched' },
      },
      d.db
    );
    expect(expireStaleAsks(d, NOW)).toBe(1);
    expect(expireStaleAsks(d, NOW)).toBe(0);
    expect(d.published).toEqual([
      {
        to: 'rae',
        p: {
          mrUrl: ask.mrUrl,
          iid: 1,
          nudgeId: 'old',
          result: 'expired',
          reason: 'stale',
        },
      },
    ]);
    const byId = new Map(readNudges(d.db).map(n => [n.id, n.handled]));
    expect(byId.get('old')).toMatchObject({
      result: 'expired',
      reason: 'stale',
    });
    expect(byId.get('fresh')).toBeUndefined();
    expect(byId.get('done')?.result).toBe('launched');
  });
});

test('a launcher that throws ends as launch-failed, sent once, never launched', async () => {
  const d = dbDeps({
    launchAsk: async () => {
      throw new Error('no tab for this MR');
    },
  });
  writeNudge(ask, d.db);
  expect(await acceptAsk('n1', d)).toEqual({
    ok: false,
    status: 502,
    message: 'Your agent could not start',
  });
  expect(readNudges(d.db)[0]?.handled).toMatchObject({
    result: 'rejected',
    reason: 'launch-failed',
  });
  expect(d.published).toEqual([
    {
      to: 'rae',
      p: {
        mrUrl: ask.mrUrl,
        iid: 1,
        nudgeId: 'n1',
        result: 'rejected',
        reason: 'launch-failed',
      },
    },
  ]);
});
