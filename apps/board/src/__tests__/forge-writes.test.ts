import { describe, expect, test } from 'bun:test';

import { ReadBackFailedError } from '@mattstack/glance';
import {
  forgeReason,
  githubMrWrite,
  githubPostNote,
  githubSetDraft,
  gitlabMrWrite,
  gitlabPostNote,
  gitlabSetDraft,
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
        error:
          'Error: mergePullRequest failed: 405 Pull Request is not mergeable',
      },
    ]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'refused',
      reason: '405 Pull Request is not mergeable',
    });
  });

  test('an unanswered merge that read back merged is done', async () => {
    const f = fake([
      UNREACHABLE,
      { ok: true, data: { mr: { state: 'merged' } } },
    ]);
    expect(await githubMrWrite('remote:x', 7, 'merge', f.command)).toEqual({
      kind: 'done',
    });
    expect(f.calls.filter(c => c[0] === 'mr:get')).toEqual([
      [
        'mr:get',
        { repoName: 'remote:x', iid: 7, refresh: true },
        { timeoutMs: 120_000 },
      ],
    ]);
  });

  test('an unanswered merge still open stays unanswered, one read', async () => {
    const f = fake([
      UNREACHABLE,
      { ok: true, data: { mr: { state: 'opened' } } },
    ]);
    expect(await githubMrWrite('r', 1, 'merge', f.command)).toEqual({
      kind: 'unanswered',
      reason: 'the merge may still land',
    });
    expect(f.calls.filter(c => c[0] === 'mr:get')).toHaveLength(1);
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

describe('an ok:false reply with no error', () => {
  test('falls back to the verb name', async () => {
    expect(
      await githubMrWrite('r', 1, 'rebase', fake([{ ok: false }]).command)
    ).toEqual({ kind: 'refused', reason: 'mr:action failed' });
    expect(
      await githubSetDraft('r', 1, true, fake([{ ok: false }]).command)
    ).toEqual({ kind: 'refused', reason: 'mr:action failed' });
    expect(
      await githubPostNote('r', 1, 'hi', fake([{ ok: false }]).command)
    ).toEqual({ kind: 'refused', reason: 'mr:comment failed' });
  });
});

const readBackFailed = (writeApplied: boolean) =>
  new ReadBackFailedError('read back failed', {
    operation: 'updatePullRequest',
    projectPath: 'g/p',
    iid: 7,
    writeApplied,
  });

function mrProvider(over: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const provider = {
    mergePullRequest: record('merge'),
    rebasePullRequest: record('rebase'),
    setAutoMerge: record('setAutoMerge'),
    cancelAutoMerge: record('cancelAutoMerge'),
    ...over,
  } as never;
  return { calls, provider };
}

describe('gitlabMrWrite', () => {
  test('runs the action through glance and reports done', async () => {
    const p = mrProvider();
    expect(await gitlabMrWrite(p.provider, 'g/p', 7, 'rebase')).toEqual({
      kind: 'done',
    });
    expect(p.calls).toEqual([['rebase', 'g/p', 7]]);
  });

  test('a merge refused with a merge status is a worded refusal', async () => {
    const errors: string[] = [];
    const p = mrProvider({
      mergePullRequest: async () => {
        throw new Error('405 detailedMergeStatus="not_approved"');
      },
    });
    expect(
      await gitlabMrWrite(p.provider, 'g/p', 7, 'merge', m => errors.push(m))
    ).toEqual({ kind: 'refused', reason: 'not approved yet' });
    expect(errors).toEqual(['405 detailedMergeStatus="not_approved"']);
  });

  test('any other throw is a failure carrying its message', async () => {
    const errors: string[] = [];
    const p = mrProvider({
      rebasePullRequest: async () => {
        throw new Error('boom');
      },
    });
    expect(
      await gitlabMrWrite(p.provider, 'g/p', 7, 'rebase', m => errors.push(m))
    ).toEqual({ kind: 'failed', message: 'boom' });
    expect(errors).toEqual(['boom']);
  });

  test('a refusal status on a non-merge action stays a failure', async () => {
    const p = mrProvider({
      setAutoMerge: async () => {
        throw new Error('detailedMergeStatus="not_approved"');
      },
    });
    expect(await gitlabMrWrite(p.provider, 'g/p', 7, 'setAutoMerge')).toEqual({
      kind: 'failed',
      message: 'detailedMergeStatus="not_approved"',
    });
  });

  test('a merge whose read-back failed after the write is done', async () => {
    const p = mrProvider({
      mergePullRequest: async () => {
        throw readBackFailed(true);
      },
    });
    expect(await gitlabMrWrite(p.provider, 'g/p', 7, 'merge')).toEqual({
      kind: 'done',
    });
  });
});

describe('gitlabSetDraft', () => {
  const updated = (title: string) => async () => ({ title });
  const never = async () => {
    throw new Error('unexpected read');
  };

  test('success reports the new title', async () => {
    const calls: unknown[][] = [];
    const provider = {
      updatePullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return { title: 'Draft: x' };
      },
      fetchSingleMR: never,
    } as never;
    expect(await gitlabSetDraft(provider, 'g/p', 7, true)).toEqual({
      kind: 'done',
      title: 'Draft: x',
    });
    expect(calls).toEqual([['g/p', 7, { draft: true }]]);
  });

  test('a failed update whose read-back shows the flip is recovered', async () => {
    const errors: string[] = [];
    const reads: unknown[][] = [];
    const provider = {
      updatePullRequest: async () => {
        throw new Error('timed out');
      },
      fetchSingleMR: async (...args: unknown[]) => {
        reads.push(args);
        return { draft: true, title: 'Draft: x' };
      },
    } as never;
    expect(
      await gitlabSetDraft(provider, 'g/p', 7, true, m => errors.push(m))
    ).toEqual({ kind: 'done', title: 'Draft: x', recovered: true });
    expect(errors).toEqual(['timed out']);
    expect(reads).toEqual([['g/p', 7, null]]);
  });

  test('a failed read-back with an applied write is recovered unverified', async () => {
    const provider = {
      updatePullRequest: async () => {
        throw readBackFailed(true);
      },
      fetchSingleMR: async () => {
        throw new Error('still down');
      },
    } as never;
    expect(await gitlabSetDraft(provider, 'g/p', 7, false)).toEqual({
      kind: 'done',
      recovered: true,
      verified: false,
    });
  });

  test('a read-back that disagrees falls through to the unverified recovery', async () => {
    const provider = {
      updatePullRequest: async () => {
        throw readBackFailed(true);
      },
      fetchSingleMR: async () => ({ draft: false, title: 'x' }),
    } as never;
    expect(await gitlabSetDraft(provider, 'g/p', 7, true)).toEqual({
      kind: 'done',
      recovered: true,
      verified: false,
    });
  });

  test('anything else is a failure carrying the message', async () => {
    const errors: string[] = [];
    const provider = {
      updatePullRequest: async () => {
        throw readBackFailed(false);
      },
      fetchSingleMR: updated('x'),
    } as never;
    expect(
      await gitlabSetDraft(provider, 'g/p', 7, true, m => errors.push(m))
    ).toEqual({ kind: 'failed', message: 'read back failed' });
    expect(errors).toEqual(['read back failed']);
  });

  test('a non-Error throw is stringified', async () => {
    const provider = {
      updatePullRequest: async () => {
        throw 'nope';
      },
      fetchSingleMR: async () => null,
    } as never;
    expect(await gitlabSetDraft(provider, 'g/p', 7, true)).toEqual({
      kind: 'failed',
      message: 'nope',
    });
  });
});

describe('gitlabPostNote', () => {
  test('posts the body and returns the note id', async () => {
    const calls: unknown[][] = [];
    const mutator = {
      createNote: async (...args: unknown[]) => {
        calls.push(args);
        return { id: 99 };
      },
    } as never;
    expect(await gitlabPostNote(mutator, 12, 7, 'hello')).toEqual({
      kind: 'done',
      noteId: 99,
    });
    expect(calls).toEqual([[12, 7, 'hello']]);
  });

  test('a throw is a failure carrying the message', async () => {
    const mutator = {
      createNote: async () => {
        throw new Error('403 forbidden');
      },
    } as never;
    expect(await gitlabPostNote(mutator, 12, 7, 'hello')).toEqual({
      kind: 'failed',
      message: '403 forbidden',
    });
  });
});

describe('a provider factory that throws', () => {
  test('gitlabMrWrite classifies it like a failed write', async () => {
    const errors: string[] = [];
    const broken = async () => {
      throw new Error('gitlab token not configured');
    };
    expect(
      await gitlabMrWrite(broken, 'g/p', 7, 'rebase', m => errors.push(m))
    ).toEqual({ kind: 'failed', message: 'gitlab token not configured' });
    expect(errors).toEqual(['gitlab token not configured']);
    const refusing = async () => {
      throw new Error('detailedMergeStatus="conflict"');
    };
    expect(await gitlabMrWrite(refusing, 'g/p', 7, 'merge')).toEqual({
      kind: 'refused',
      reason: 'merge conflicts',
    });
  });

  test('gitlabSetDraft logs, then rejects on the recovery read like before', async () => {
    const errors: string[] = [];
    const broken = async () => {
      throw new Error('gitlab token not configured');
    };
    await expect(
      gitlabSetDraft(broken, 'g/p', 7, true, m => errors.push(m))
    ).rejects.toThrow('gitlab token not configured');
    expect(errors).toEqual(['gitlab token not configured']);
  });
});
