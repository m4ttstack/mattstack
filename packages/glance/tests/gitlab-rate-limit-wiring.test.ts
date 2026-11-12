/**
 * Every GitLab transport waits out a 429 through `withGitLabRateLimit`.
 * Stubbed fetch answers with the headers GitLab.com sends a Free-plan user;
 * `retry-after: 0` keeps each wait to the margin.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { MRDetailFetcher } from '../src/MRDetailFetcher.ts';
import { NoteMutator } from '../src/NoteMutator.ts';
import { RateLimitedError } from '../src/errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://gitlab.example.com';
const REFS = { base_sha: 'b', start_sha: 's', head_sha: 'h' };
const NOTE = {
  id: 1,
  body: 'hi',
  author: { id: 1, username: 'u', name: 'U', avatar_url: null },
  created_at: '2026-11-12T00:00:00Z',
  resolvable: true,
  resolved: false,
  type: 'DiffNote',
};

type Reply = () => Response;

/** A Free-plan 429; `retryAfter` in seconds. */
const limited = (retryAfter: string): Reply => () =>
  new Response('{"message":"429 Too Many Requests"}', {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'ratelimit-name': 'burst_traffic_per_user_free_plan',
      'ratelimit-limit': '100',
      'ratelimit-remaining': '0',
      'retry-after': retryAfter,
    },
  });
const ok = (body: unknown, status = 200): Reply => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Serves `replies` in order (the last one repeats), recording each request's method and path. */
function serve(...replies: Reply[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    calls.push(`${req?.method ?? init?.method ?? 'GET'} ${url.pathname}`);
    return replies[Math.min(calls.length - 1, replies.length - 1)]!();
  }) as typeof fetch;
  return calls;
}

const mutator = () => new NoteMutator(BASE, 't');
const POSITION = { ...REFS, position_type: 'text' as const, new_path: 'a.ts', old_path: 'a.ts', new_line: 3 };

describe('NoteMutator waits out a 429', () => {
  test('fetchDiffRefs retries after the reset and returns the refs', async () => {
    const calls = serve(limited('0'), ok({ diff_refs: REFS }));
    expect(await mutator().fetchDiffRefs('g/p', 7)).toEqual(REFS);
    expect(calls).toEqual(['GET /api/v4/projects/g%2Fp/merge_requests/7', 'GET /api/v4/projects/g%2Fp/merge_requests/7']);
  });

  test('an inline comment refused with 429 is sent once more after the reset, never twice past it', async () => {
    const calls = serve(limited('0'), ok({ id: 'd1', notes: [NOTE] }, 201));
    const d = await mutator().createPositionedDiscussion('g/p', 7, 'hi', POSITION);
    expect(d.id).toBe('d1');
    expect(calls).toEqual([
      'POST /api/v4/projects/g%2Fp/merge_requests/7/discussions',
      'POST /api/v4/projects/g%2Fp/merge_requests/7/discussions',
    ]);
  });

  test('a write whose reset is past 65s throws RateLimitedError after one send', async () => {
    const calls = serve(limited('70'));
    const err = await mutator().createNote('g/p', 7, 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).operation).toBe('POST /api/v4/projects/g%2Fp/merge_requests/7/notes');
    expect((err as RateLimitedError).message).toContain('retry after 71 seconds');
    expect(calls).toHaveLength(1);
  });

  test('a read whose reset is past 30s throws RateLimitedError after one send', async () => {
    const calls = serve(limited('40'));
    await expect(mutator().listDraftNotes('g/p', 7)).rejects.toBeInstanceOf(RateLimitedError);
    expect(calls).toHaveLength(1);
  });

  test.each([
    ['createNote', (m: NoteMutator) => m.createNote('g/p', 7, 'hi'), ok(NOTE, 201)],
    ['createDiscussion', (m: NoteMutator) => m.createDiscussion('g/p', 7, 'hi'), ok({ id: 'd', notes: [NOTE] }, 201)],
    ['updateNote', (m: NoteMutator) => m.updateNote('g/p', 7, 1, 'hi'), ok(NOTE)],
    ['deleteNote', (m: NoteMutator) => m.deleteNote('g/p', 7, 1), () => new Response(null, { status: 204 })],
    ['createDraftNote', (m: NoteMutator) => m.createDraftNote('g/p', 7, 'hi'), ok({ id: 1, note: 'hi', discussion_id: null, line_code: null, resolve_discussion: false }, 201)],
    ['deleteDraftNote', (m: NoteMutator) => m.deleteDraftNote('g/p', 7, 1), () => new Response(null, { status: 204 })],
    ['publishDraftNotes', (m: NoteMutator) => m.publishDraftNotes('g/p', 7, { note: 's', reviewerState: 'reviewed' }), () => new Response(null, { status: 204 })],
    ['fetchReviewerStates', (m: NoteMutator) => m.fetchReviewerStates('g/p', 7), ok([])],
    ['uploadFile', (m: NoteMutator) => m.uploadFile('g/p', 'a.png', new Uint8Array([1])), ok({ alt: 'a', url: '/u', full_path: '/u', markdown: '![a](/u)' }, 201)],
  ] as const)('%s retries once after a 429', async (_name, call, success) => {
    const calls = serve(limited('0'), success);
    await call(mutator());
    expect(calls).toHaveLength(2);
  });

  test('a write is not retried on a 502', async () => {
    const calls = serve(() => new Response('bad gateway', { status: 502 }), ok(NOTE, 201));
    await expect(mutator().createNote('g/p', 7, 'hi')).rejects.toThrow(/^createNote failed: 502/);
    expect(calls).toHaveLength(1);
  });

  test('a refusal other than 429 keeps its message and status', async () => {
    serve(() => new Response('nope', { status: 403, statusText: 'Forbidden' }));
    const err = (await mutator().listDraftNotes('g/p', 7).catch((e: unknown) => e)) as Error & { status: number };
    expect(err.message).toBe('listDraftNotes failed: 403 Forbidden: nope');
    expect(err.status).toBe(403);
  });
});

describe('MRDetailFetcher waits out a 429', () => {
  test('a discussions page refused with 429 is read again after the reset', async () => {
    const calls = serve(limited('0'), ok([]));
    const detail = await new MRDetailFetcher(BASE, 't').fetchDetail(1, 7);
    expect(detail.discussions).toEqual([]);
    expect(calls).toEqual(['GET /api/v4/projects/1/merge_requests/7/discussions', 'GET /api/v4/projects/1/merge_requests/7/discussions']);
  });
});
