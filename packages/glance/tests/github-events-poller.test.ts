// packages/glance/tests/github-events-poller.test.ts
import { describe, expect, test } from 'bun:test';
import { GitHubEventsPoller, type FetchGitHubEventsPage, type GitHubEvent } from '../src/GitHubEventsPoller.ts';

const ev = (id: string, n: number): GitHubEvent => ({
  id,
  type: 'PullRequestEvent',
  created_at: '2026-08-06T01:00:00Z',
  payload: { action: 'opened', pull_request: { number: n } },
});

/** A scripted fetch: each call shifts the next response, throwing it when it is an Error. */
function scriptedFetch(responses: Array<Awaited<ReturnType<FetchGitHubEventsPage>> | Error>): {
  fetch: FetchGitHubEventsPage;
  calls: Array<{ page: number; etag: string | null }>;
} {
  const calls: Array<{ page: number; etag: string | null }> = [];
  return {
    calls,
    fetch: async (opts) => {
      calls.push(opts);
      const next = responses.shift();
      if (!next) throw new Error('scripted fetch exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe('GitHubEventsPoller', () => {
  test('cold start suppresses invalidations and seeds the seen set', async () => {
    const { fetch } = scriptedFetch([
      { status: 200, events: [ev('16878075933', 1), ev('12860960092', 2)], etag: 'W/"a"', pollIntervalSec: 60 },
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch });
    const r = await p.tick();
    expect(r.coldStart).toBe(true);
    expect(r.invalidations).toEqual([]);
    expect(r.cursor.seenIds).toContain('16878075933');
    expect(r.cursor.seenIds).toContain('12860960092');
    expect(r.serverPollIntervalMs).toBe(60_000);
  });

  test('a persisted numeric GitLab-era cursor cold-starts instead of throwing or silently non-deduping (U20 rule)', async () => {
    const { fetch } = scriptedFetch([
      { status: 200, events: [ev('16878075933', 1)], etag: null, pollIntervalSec: null },
    ]);
    const foreign = JSON.parse('{"since":"2026-08-05T00:00:00Z","lastEventId":12345}');
    const p = new GitHubEventsPoller({ fetchPage: fetch, cursor: foreign });
    const r = await p.tick();
    expect(r.coldStart).toBe(true);
    expect(r.invalidations).toEqual([]);
  });

  test('warm tick: only unseen ids are fresh, regardless of id ordering (A6)', async () => {
    const { fetch } = scriptedFetch([
      // Newest-first feed interleaving both id ranges: the low-range id is the NEW one.
      { status: 200, events: [ev('12860999999', 9), ev('16878075933', 1)], etag: null, pollIntervalSec: null },
    ]);
    const p = new GitHubEventsPoller({
      fetchPage: fetch,
      cursor: { since: '2026-08-06T00:00:00Z', lastEventId: '16878075933', seenIds: ['16878075933'] },
    });
    const r = await p.tick();
    expect(r.coldStart).toBe(false);
    expect(r.freshEvents).toBe(1);
    expect(r.invalidations).toEqual([{ kind: 'mr', ref: '9', cause: 'opened' }]);
    expect(r.cursor.lastEventId).toBe('12860999999');
  });

  test('page-1 304 short-circuits: one request, cursor unchanged, cadence remembered from the earlier 200', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, events: [ev('1', 1)], etag: 'W/"a"', pollIntervalSec: 60 },
      { status: 304, events: [], etag: null, pollIntervalSec: null },
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch });
    await p.tick();
    const r2 = await p.tick();
    expect(r2.notModified).toBe(true);
    expect(r2.requests).toBe(1);
    expect(r2.serverPollIntervalMs).toBe(60_000);
    expect(calls[1]).toEqual({ page: 1, etag: 'W/"a"' });
    expect(r2.cursor).toEqual((await Promise.resolve(p.getCursor())));
  });

  test('walk stops at an all-seen page and never requests page 4', async () => {
    const page = (ids: string[], n: number) => ({
      status: 200 as const,
      events: ids.map((id) => ev(id, n)),
      etag: null,
      pollIntervalSec: null,
    });
    const { fetch, calls } = scriptedFetch([
      page(['30', '29'], 1), // cold: seeds 30,29
      page(['32', '31'], 2), // warm page 1: all fresh -> continue
      page(['30', '29'], 2), // warm page 2: all seen -> stop, no page 3
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch });
    await p.tick();
    const r = await p.tick();
    expect(r.freshEvents).toBe(2);
    expect(calls.map(c => c.page)).toEqual([1, 1, 2]);
    expect(calls.every(c => c.page <= 3)).toBe(true);
  });

  test('seenIds is bounded, evicting oldest first', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ev(String(100 + i), i));
    const { fetch } = scriptedFetch([
      { status: 200, events: many, etag: null, pollIntervalSec: null },
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch, maxSeenIds: 3 });
    const r = await p.tick();
    expect(r.cursor.seenIds).toHaveLength(3);
    expect(r.cursor.seenIds).not.toContain('100');
  });

  test('cold tick that throws stays cold: the retry reports coldStart and no invalidations', async () => {
    const { fetch } = scriptedFetch([
      new Error('network down'),
      { status: 200, events: [ev('1', 1), ev('2', 2)], etag: null, pollIntervalSec: null },
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch });

    await expect(p.tick()).rejects.toThrow('network down');

    const r = await p.tick();
    expect(r.coldStart).toBe(true);
    expect(r.requests).toBe(1);
    expect(r.invalidations).toEqual([]);
  });

  test('a tick whose page 2 throws keeps the previous etag, so the next tick refetches instead of 304ing', async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, events: [ev('10', 1)], etag: 'W/"a"', pollIntervalSec: null },
      { status: 200, events: [ev('12', 12), ev('11', 11)], etag: 'W/"b"', pollIntervalSec: null },
      new Error('page 2 failed'),
      { status: 200, events: [ev('12', 12), ev('11', 11), ev('10', 1)], etag: 'W/"b"', pollIntervalSec: null },
    ]);
    const p = new GitHubEventsPoller({ fetchPage: fetch });
    await p.tick();

    await expect(p.tick()).rejects.toThrow('page 2 failed');

    const r = await p.tick();
    expect(calls[3]).toEqual({ page: 1, etag: 'W/"a"' });
    expect(r.freshEvents).toBe(2);
    expect(r.invalidations.map((k) => k.ref).sort()).toEqual(['11', '12']);
  });

  test('cursor JSON round-trip resumes with no replay (the rt persistence path)', async () => {
    const { fetch } = scriptedFetch([
      { status: 200, events: [ev('50', 1)], etag: null, pollIntervalSec: null },
      { status: 200, events: [ev('50', 1)], etag: null, pollIntervalSec: null },
    ]);
    const p1 = new GitHubEventsPoller({ fetchPage: fetch });
    await p1.tick();
    const persisted = JSON.parse(JSON.stringify(p1.getCursor()));
    const p2 = new GitHubEventsPoller({ fetchPage: fetch, cursor: persisted });
    const r = await p2.tick();
    expect(r.coldStart).toBe(false);
    expect(r.freshEvents).toBe(0);
    expect(r.invalidations).toEqual([]);
  });
});
