import { describe, expect, test } from 'bun:test';

import type { PullRequest } from '@mattstack/glance';
import {
  CannotRebaseError,
  forgeRebase,
  githubRebaseDeps,
  gitlabRebaseDeps,
  type ForgeRebaseDeps,
  type ForgeRebaseRead,
} from '../forge-rebase.ts';

const read = (over: Partial<ForgeRebaseRead> = {}): ForgeRebaseRead => ({
  sha: 'a',
  rebaseInProgress: false,
  mergeError: null,
  conflicts: false,
  divergedCommitsCount: null,
  ...over,
});

interface Harness {
  deps: ForgeRebaseDeps;
  reads: () => number;
  rebases: () => number;
  sleeps: () => number;
  controller: AbortController;
}

function harness(
  queue: Array<ForgeRebaseRead | Error>,
  over: Partial<ForgeRebaseDeps> = {}
): Harness {
  const controller = new AbortController();
  let reads = 0;
  let rebases = 0;
  let sleeps = 0;
  const deps: ForgeRebaseDeps = {
    forge: 'gitlab',
    canRebase: true,
    read: async () => {
      const next = queue[reads++];
      if (next === undefined) throw new Error('read queue exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
    rebase: async () => {
      rebases++;
    },
    sleep: async () => {
      sleeps++;
    },
    signal: controller.signal,
    ...over,
  };
  return {
    deps,
    controller,
    reads: () => reads,
    rebases: () => rebases,
    sleeps: () => sleeps,
  };
}

describe('forgeRebase on GitLab', () => {
  test('a cancel during the first read never sends the rebase', async () => {
    const h = harness([]);
    h.deps.read = async () => {
      h.controller.abort();
      return read();
    };
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.rebases()).toBe(0);
  });

  test('cannot rebase returns cannot without calling rebase', async () => {
    const h = harness([], { canRebase: false });
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cannot' });
    expect(h.rebases()).toBe(0);
  });

  test('sha moved after the flag clears is rebased', async () => {
    const h = harness([
      read({ sha: 'a' }),
      read({ sha: 'a', rebaseInProgress: true }),
      read({ sha: 'b', rebaseInProgress: false }),
    ]);
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'rebased', sha: 'b' });
  });

  test('a moved sha while the flag is still set waits for the settled read', async () => {
    const h = harness([
      read({ sha: 'a' }),
      read({ sha: 'b', rebaseInProgress: true }),
      read({ sha: 'a', mergeError: 'Rebase failed: conflict' }),
    ]);
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'Rebase failed: conflict',
      conflicts: false,
    });
    expect(h.reads()).toBe(3);
  });

  test('a failed read before the call fails without sending the rebase', async () => {
    const h = harness([new Error('502 Bad Gateway')]);
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'could not read the MR before rebasing',
      conflicts: false,
    });
    expect(h.rebases()).toBe(0);
  });

  test('a null sha before the call fails without sending the rebase', async () => {
    const h = harness([read({ sha: null }), read({ sha: 'b' })]);
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'could not read the MR before rebasing',
      conflicts: false,
    });
    expect(h.rebases()).toBe(0);
  });

  test('merge error once settled is failed', async () => {
    const h = harness([
      read(),
      read({ mergeError: 'Rebase failed: conflict' }),
    ]);
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'Rebase failed: conflict',
      conflicts: false,
    });
  });

  test('conflicts once settled is failed with conflicts', async () => {
    const h = harness([read(), read({ conflicts: true })]);
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'the branch has conflicts with its target',
      conflicts: true,
    });
  });

  test('not behind once settled is current', async () => {
    const h = harness([read(), read({ divergedCommitsCount: 0 })]);
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'current' });
  });

  test('settled with nothing moved and unknown behind is unclear after one read', async () => {
    const h = harness([read(), read({ divergedCommitsCount: null })]);
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'unclear' });
    expect(h.reads()).toBe(2);
  });

  test('keeps waiting while the flag is set, with no limit', async () => {
    const queue = [
      read(),
      ...Array.from({ length: 50 }, () => read({ rebaseInProgress: true })),
      read({ sha: 'b' }),
    ];
    const h = harness(queue);
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'rebased', sha: 'b' });
    expect(h.sleeps()).toBe(50);
  });

  test('rebase call error is failed', async () => {
    const h = harness([read()], {
      rebase: async () => {
        throw new Error('403 Forbidden');
      },
    });
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: '403 Forbidden',
      conflicts: false,
    });
  });

  test('CannotRebaseError from the rebase call is cannot', async () => {
    const h = harness([read()], {
      rebase: async () => {
        throw new CannotRebaseError('nope');
      },
    });
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cannot' });
  });

  test('a failed read keeps waiting and reports the error until a read succeeds', async () => {
    const seen: Array<string | null> = [];
    const h = harness(
      [
        read(),
        new Error('502 Bad Gateway'),
        new Error('503 Service Unavailable'),
        read({ rebaseInProgress: true }),
        read({ divergedCommitsCount: 0 }),
      ],
      { onReadError: message => seen.push(message) }
    );
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'current' });
    expect(h.sleeps()).toBe(3);
    expect(seen).toEqual(['502 Bad Gateway', '503 Service Unavailable', null]);
  });

  test('a failed first read is not a wait error', async () => {
    const seen: Array<string | null> = [];
    const h = harness([new Error('502 Bad Gateway')], {
      onReadError: message => seen.push(message),
    });
    await forgeRebase(h.deps);
    expect(seen).toEqual([]);
  });

  test('abort while waiting is cancelled', async () => {
    const h = harness([
      read(),
      read({ rebaseInProgress: true }),
      read({ rebaseInProgress: true }),
    ]);
    h.deps.sleep = async () => h.controller.abort();
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.reads()).toBe(2);
  });
});

describe('forgeRebase on GitHub', () => {
  test('waits until the head moves, with no limit', async () => {
    const queue = [
      read({ sha: 'a' }),
      ...Array.from({ length: 20 }, () => read({ sha: 'a' })),
      read({ sha: 'b' }),
    ];
    const h = harness(queue, { forge: 'github' });
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'rebased', sha: 'b' });
    expect(h.sleeps()).toBe(20);
  });

  test('conflict error is failed with conflicts and no read-back', async () => {
    const h = harness([read()], {
      forge: 'github',
      rebase: async () => {
        throw new Error('PullRequest::RebaseConflictError');
      },
    });
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'PullRequest::RebaseConflictError',
      conflicts: true,
    });
    expect(h.reads()).toBe(1);
  });

  test('abort while waiting for the head is cancelled', async () => {
    const h = harness([read(), read(), read()], { forge: 'github' });
    h.deps.sleep = async () => h.controller.abort();
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.reads()).toBe(2);
  });

  test('an unknown head before the call fails without sending the mutation', async () => {
    const h = harness([read({ sha: null }), read({ sha: 'b' })], {
      forge: 'github',
    });
    expect(await forgeRebase(h.deps)).toEqual({
      kind: 'failed',
      reason: 'could not read the MR before rebasing',
      conflicts: false,
    });
    expect(h.rebases()).toBe(0);
  });

  test('a failed read while waiting for the head is reported and the wait goes on', async () => {
    const seen: Array<string | null> = [];
    const h = harness(
      [
        read({ sha: 'a' }),
        new Error('no answer from the daemon'),
        read({ sha: 'b' }),
      ],
      { forge: 'github', onReadError: message => seen.push(message) }
    );
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'rebased', sha: 'b' });
    expect(seen).toEqual(['no answer from the daemon', null]);
  });
});

const pr = (over: Partial<PullRequest>): PullRequest =>
  ({
    sha: 'abc',
    conflicts: false,
    mergeError: null,
    rebaseInProgress: false,
    divergedCommitsCount: 2,
    ...over,
  }) as PullRequest;

describe('gitlabRebaseDeps', () => {
  test('reads through fetchSingleMR and rebases through the provider', async () => {
    const calls: string[] = [];
    const provider = {
      fetchSingleMR: async (path: string, iid: number, user: null) => {
        calls.push(`fetch ${path} ${iid} ${user}`);
        return pr({ rebaseInProgress: true, divergedCommitsCount: 3 });
      },
      rebasePullRequest: async (path: string, iid: number) => {
        calls.push(`rebase ${path} ${iid}`);
      },
    };
    const deps = gitlabRebaseDeps(provider as never, 'g/p', 7);
    expect(deps.forge).toBe('gitlab');
    expect(deps.canRebase).toBe(true);
    expect(await deps.read()).toEqual({
      sha: 'abc',
      rebaseInProgress: true,
      mergeError: null,
      conflicts: false,
      divergedCommitsCount: 3,
    });
    await deps.rebase();
    expect(calls).toEqual(['fetch g/p 7 null', 'rebase g/p 7']);
  });

  test('a missing MR throws', async () => {
    const provider = { fetchSingleMR: async () => null };
    const deps = gitlabRebaseDeps(provider as never, 'g/p', 7);
    await expect(deps.read()).rejects.toThrow('g/p!7');
  });
});

type Send = Parameters<typeof githubRebaseDeps>[2];

describe('githubRebaseDeps', () => {
  test('reads with refresh and rebases through mr:action', async () => {
    const sent: Array<[string, unknown]> = [];
    const send = (async (verb: string, payload: unknown) => {
      sent.push([verb, payload]);
      return verb === 'mr:get'
        ? { ok: true, data: { mr: pr({ divergedCommitsCount: null }) } }
        : { ok: true };
    }) as unknown as Send;
    const deps = githubRebaseDeps('o/r', 9, send);
    expect(deps.forge).toBe('github');
    expect(deps.canRebase).toBe(true);
    expect(await deps.read()).toEqual({
      sha: 'abc',
      rebaseInProgress: false,
      mergeError: null,
      conflicts: false,
      divergedCommitsCount: null,
    });
    await deps.rebase();
    expect(sent).toEqual([
      ['mr:get', { repoName: 'o/r', iid: 9, refresh: true }],
      ['mr:action', { repoName: 'o/r', iid: 9, action: 'rebase' }],
    ]);
  });

  test('daemon canRebase refusal is cannot', async () => {
    const send = (async () => ({
      ok: false,
      error:
        'GitHub cannot rebase a pull request; rebase the branch with git and push',
    })) as unknown as Send;
    const deps = githubRebaseDeps('o/r', 9, send);
    const err = await deps.rebase().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CannotRebaseError);
    const h = harness([read()], { rebase: deps.rebase, forge: 'github' });
    expect(await forgeRebase(h.deps)).toEqual({ kind: 'cannot' });
  });

  test('any other refusal throws a plain error', async () => {
    const send = (async () => ({
      ok: false,
      error: 'RebaseConflictError',
    })) as unknown as Send;
    const deps = githubRebaseDeps('o/r', 9, send);
    const err = await deps.rebase().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CannotRebaseError);
    expect((err as Error).message).toBe('RebaseConflictError');
  });

  test('a failed mr:get read throws', async () => {
    const send = (async () => ({
      ok: false,
      error: 'no token',
    })) as unknown as Send;
    await expect(githubRebaseDeps('o/r', 9, send).read()).rejects.toThrow(
      'no token'
    );
  });
});
