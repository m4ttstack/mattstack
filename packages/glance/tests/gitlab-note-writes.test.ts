import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { EmptyDiscussionError } from '../src/errors.ts';
import { buildTextPosition } from '../src/gitlabReview.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const BASE = 'https://gitlab.example.com';
const PREFIX = '/api/v4/projects/group%2Fproj/merge_requests/7';
const REFS = { base_sha: 'b', start_sha: 's', head_sha: 'h' };

function note(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    body: 'hi',
    author: { id: 1, username: 'u', name: 'U', avatar_url: null },
    created_at: '2026-11-11T00:00:00Z',
    resolvable: true,
    resolved: false,
    type: null,
    ...over
  };
}

/** Serves `replies` in order, one per request, recording each request. */
function serve(...replies: Response[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: String(init?.method ?? 'GET'),
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${init?.method} ${url.pathname}`);
    return reply;
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function provider(): GitLabProvider {
  return new GitLabProvider(BASE, 'tok');
}

describe('GitLab createComment', () => {
  test('resolvable by default: one POST /discussions, the first note reported', async () => {
    const calls = serve(json({ id: 'd1', notes: [note(11)] }, 201));
    const out = await provider().createComment('group/proj', 7, 'hello');
    expect(calls).toEqual([{ method: 'POST', path: `${PREFIX}/discussions`, body: { body: 'hello' } }]);
    expect(out).toEqual({
      noteId: 11,
      discussionId: 'd1',
      resolvable: true,
      url: `${BASE}/group/proj/-/merge_requests/7#note_11`
    });
  });

  test('resolvable: false posts a plain note with no discussion id', async () => {
    const calls = serve(json(note(12, { resolvable: null }), 201));
    const out = await provider().createComment('group/proj', 7, 'hello', { resolvable: false });
    expect(calls).toEqual([{ method: 'POST', path: `${PREFIX}/notes`, body: { body: 'hello' } }]);
    expect(out).toEqual({
      noteId: 12,
      discussionId: null,
      resolvable: false,
      url: `${BASE}/group/proj/-/merge_requests/7#note_12`
    });
  });

  test('a discussion with no notes throws EmptyDiscussionError carrying its id', async () => {
    serve(json({ id: 'd-empty', notes: [] }, 201));
    const err = await provider().createComment('group/proj', 7, 'hello').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmptyDiscussionError);
    expect((err as EmptyDiscussionError).discussionId).toBe('d-empty');
  });
});

describe('GitLab createInlineComment', () => {
  test('reads diff refs, then posts the positioned discussion', async () => {
    const calls = serve(
      json({ diff_refs: REFS }),
      json({ id: 'd2', notes: [note(21, { type: 'DiffNote' })] }, 201)
    );
    const out = await provider().createInlineComment('group/proj', 7, 'look', { path: 'a.ts', line: 4 });
    expect(calls).toEqual([
      { method: 'GET', path: PREFIX, body: undefined },
      {
        method: 'POST',
        path: `${PREFIX}/discussions`,
        body: {
          body: 'look',
          position: { ...REFS, position_type: 'text', new_path: 'a.ts', new_line: 4, old_path: 'a.ts' }
        }
      }
    ]);
    expect(out).toEqual({
      noteId: 21,
      discussionId: 'd2',
      resolvable: true,
      url: `${BASE}/group/proj/-/merge_requests/7#note_21`,
      anchored: true,
      noteType: 'DiffNote'
    });
  });

  test('a note GitLab did not anchor comes back unanchored, with no retry', async () => {
    const calls = serve(json({ diff_refs: REFS }), json({ id: 'd3', notes: [note(31, { type: null })] }, 201));
    const out = await provider().createInlineComment('group/proj', 7, 'look', { path: 'a.ts', line: 4 });
    expect(out.anchored).toBe(false);
    expect(out.noteType).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('a positioned discussion with no notes throws EmptyDiscussionError', async () => {
    serve(json({ diff_refs: REFS }), json({ id: 'd4', notes: [] }, 201));
    const err = await provider()
      .createInlineComment('group/proj', 7, 'look', { path: 'a.ts', line: 4 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmptyDiscussionError);
    expect((err as EmptyDiscussionError).discussionId).toBe('d4');
  });
});

describe('GitLab replies, edits and deletes', () => {
  test('replyToDiscussion posts a note into the thread', async () => {
    const calls = serve(json(note(41), 201));
    const out = await provider().replyToDiscussion('group/proj', 7, 'd5', 'agreed');
    expect(calls).toEqual([
      { method: 'POST', path: `${PREFIX}/discussions/d5/notes`, body: { body: 'agreed' } }
    ]);
    expect(out).toEqual({
      noteId: 41,
      discussionId: 'd5',
      resolvable: true,
      url: `${BASE}/group/proj/-/merge_requests/7#note_41`
    });
  });

  test('updateComment puts the new body, whatever the kind', async () => {
    const calls = serve(json(note(51)), json(note(51)));
    await provider().updateComment('group/proj', 7, { id: 51 }, 'v2');
    await provider().updateComment('group/proj', 7, { id: 51, kind: 'diff' }, 'v2');
    const put = { method: 'PUT', path: `${PREFIX}/notes/51`, body: { body: 'v2' } };
    expect(calls).toEqual([put, put]);
  });

  test('deleteComment deletes the note', async () => {
    const calls = serve(new Response(null, { status: 204 }));
    await provider().deleteComment('group/proj', 7, { id: 61, kind: 'general' });
    expect(calls).toEqual([{ method: 'DELETE', path: `${PREFIX}/notes/61`, body: undefined }]);
  });

  test('a 403 from updateNote passes through untouched', async () => {
    serve(new Response('', { status: 403, statusText: 'Forbidden' }));
    const err = await provider().updateComment('group/proj', 7, { id: 51 }, 'v2').catch((e: unknown) => e);
    expect((err as Error).message).toBe('updateNote failed: 403 Forbidden');
  });

  test('fetchReviewerStates reads the reviewers list', async () => {
    const calls = serve(json([{ user: { username: 'pat' }, state: 'approved' }]));
    const out = await provider().fetchReviewerStates('group/proj', 7);
    expect(calls).toEqual([{ method: 'GET', path: `${PREFIX}/reviewers`, body: undefined }]);
    expect(out).toEqual([{ username: 'pat', state: 'approved' }]);
  });
});

describe('buildTextPosition', () => {
  test('a new line alone keeps the path on both sides', () => {
    expect(buildTextPosition({ path: 'a.ts', line: 4 }, REFS)).toEqual({
      ...REFS,
      position_type: 'text',
      new_path: 'a.ts',
      new_line: 4,
      old_path: 'a.ts'
    });
  });

  test('an unchanged line carries both lines and the old path', () => {
    expect(buildTextPosition({ path: 'b.ts', line: 4, oldPath: 'a.ts', oldLine: 3 }, REFS)).toEqual({
      ...REFS,
      position_type: 'text',
      new_path: 'b.ts',
      new_line: 4,
      old_path: 'a.ts',
      old_line: 3
    });
  });

  test('an old line alone builds a removed-line position with no new line', () => {
    const pos = buildTextPosition({ path: 'a.ts', oldLine: 9 }, REFS);
    expect(pos).toEqual({ ...REFS, position_type: 'text', new_path: 'a.ts', old_path: 'a.ts', old_line: 9 });
    expect('new_line' in pos).toBe(false);
  });
});
