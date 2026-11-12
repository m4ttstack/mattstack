import { describe, expect, test } from 'bun:test';
import {
  forgeReason,
  githubMrWrite,
  githubPostNote,
  githubSetDraft,
} from '../forge-writes.ts';

type Call = [string, Record<string, unknown>, { timeoutMs?: number }?];

function fake(replies: unknown[]) {
  const calls: Call[] = [];
  const command = (async (
    cmd: string,
    payload: Record<string, unknown>,
    opts?: { timeoutMs?: number }
  ) => {
    calls.push([cmd, payload, opts]);
    return replies.shift();
  }) as never;
  return { calls, command };
}

const UNREACHABLE = {
  ok: false,
  error: 'rt daemon unreachable at /s (timed out)',
};

describe('githubMrWrite', () => {
  test('merge sends mr:action with the write timeout', async () => {
    const f = fake([{ ok: true }]);
    const res = await githubMrWrite('remote:x', 7, 'merge', f.command);
    expect(f.calls).toEqual([
      [
        'mr:action',
        { repoName: 'remote:x', iid: 7, action: 'merge', args: [] },
        { timeoutMs: 120_000 },
      ],
    ]);
    expect(res).toEqual({ kind: 'done' });
  });

  test('a queued merge reports the queue, never a merge', async () => {
    const f = fake([
      {
        ok: true,
        data: {
          queued: { position: 2, state: 'QUEUED' },
          sourceBranchNotDeleted: 's',
        },
      },
    ]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'done',
      mergeQueued: { position: 2, state: 'QUEUED' },
      sourceBranchNotDeleted: 's',
    });
  });

  test('a forge refusal is refused with the trimmed reason', async () => {
    const f = fake([
      {
        ok: false,
        error: 'Error: mergePullRequest failed: 405 Pull Request is not mergeable',
      },
    ]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'refused',
      reason: '405 Pull Request is not mergeable',
    });
  });

  test('an unanswered merge that read back merged is done', async () => {
    const f = fake([UNREACHABLE, { ok: true, data: { mr: { state: 'merged' } } }]);
    expect(await githubMrWrite('remote:x', 7, 'merge', f.command)).toEqual({
      kind: 'done',
    });
    expect(f.calls.filter((c) => c[0] === 'mr:get')).toEqual([
      ['mr:get', { repoName: 'remote:x', iid: 7, refresh: true }, { timeoutMs: 120_000 }],
    ]);
  });

  test('an unanswered merge still open stays unanswered, one read', async () => {
    const f = fake([UNREACHABLE, { ok: true, data: { mr: { state: 'opened' } } }]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'unanswered',
      reason: 'the merge may still land',
    });
    expect(f.calls.filter((c) => c[0] === 'mr:get')).toHaveLength(1);
  });

  test('a failed read-back leaves the merge unanswered', async () => {
    const f = fake([UNREACHABLE, UNREACHABLE]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'unanswered',
      reason: 'the merge may still land',
    });
  });

  test('other unanswered actions never read back', async () => {
    const f = fake([UNREACHABLE]);
    expect(await githubMrWrite('r', 1, 'setAutoMerge', f.command)).toEqual({
      kind: 'unanswered',
      reason: 'it may still apply',
    });
    expect(f.calls).toHaveLength(1);
  });
});

describe('githubSetDraft', () => {
  test('sends toggleDraft with the draft flag', async () => {
    const f = fake([{ ok: true }]);
    expect(await githubSetDraft('remote:x', 7, true, f.command)).toEqual({
      kind: 'done',
    });
    expect(f.calls[0]?.[1]).toEqual({
      repoName: 'remote:x',
      iid: 7,
      action: 'toggleDraft',
      args: [true],
    });
  });

  test('unanswered says it may still apply', async () => {
    const f = fake([UNREACHABLE]);
    expect(await githubSetDraft('r', 1, false, f.command)).toEqual({
      kind: 'unanswered',
      reason: 'it may still apply',
    });
  });
});

describe('githubPostNote', () => {
  test('posts a plain note and returns its id', async () => {
    const f = fake([{ ok: true, data: { noteId: 55 } }]);
    expect(await githubPostNote('remote:x', 7, 'hi', f.command)).toEqual({
      kind: 'done',
      noteId: 55,
    });
    expect(f.calls[0]).toEqual([
      'mr:comment',
      { repoName: 'remote:x', iid: 7, body: 'hi', resolvable: false },
      { timeoutMs: 120_000 },
    ]);
  });

  test('a reply without a note id is still done', async () => {
    const f = fake([{ ok: true }]);
    expect(await githubPostNote('r', 1, 'hi', f.command)).toEqual({
      kind: 'done',
    });
  });

  test('unanswered says the note may have posted', async () => {
    const f = fake([UNREACHABLE]);
    expect(await githubPostNote('r', 1, 'hi', f.command)).toEqual({
      kind: 'unanswered',
      reason: 'the note may have posted',
    });
  });

  test('a refusal carries the forge reason', async () => {
    const f = fake([{ ok: false, error: 'Error: comment failed: locked' }]);
    expect(await githubPostNote('r', 1, 'hi', f.command)).toEqual({
      kind: 'refused',
      reason: 'locked',
    });
  });
});

describe('forgeReason', () => {
  test('strips the Error and verb prefixes', () => {
    expect(forgeReason('Error: setAutoMerge failed: x')).toBe('x');
  });
  test('leaves other messages alone', () => {
    expect(forgeReason('plain message')).toBe('plain message');
  });
});
