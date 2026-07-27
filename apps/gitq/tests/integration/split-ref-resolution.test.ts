import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { StackManager } from '../../src/core/stack-manager.ts';
import { createSandboxRepo, cleanupRepo, commit, type SandboxRepo } from './helpers.ts';
import type { Stack } from '../../src/core/types.ts';

mock.restore();

// ── Ambiguity fixture ────────────────────────────────────────────────────────

/**
 * Grow the repo until some four-hex prefix is shared, which is the only way to
 * exercise `--disambiguate` (it refuses anything shorter). 1600 commits, each
 * writing a distinct file, gives 1600 commits and 1600 blobs over 65536
 * possible prefixes: a commit-commit collision is a near certainty and blob
 * collisions come in bulk. fast-import builds them in one process, in about a
 * second; 1600 `git commit` spawns would not fit the timeout.
 */
function importCollisionObjects(repo: SandboxRepo, count: number): void {
  const stream: string[] = [];
  for (let i = 1; i <= count; i++) {
    const message = `collision commit ${i}`;
    const content = `collision content ${i}`;
    stream.push(
      'commit refs/heads/collide',
      `committer GitQ Test <test@gitq.dev> ${1700000000 + i} +0000`,
      `data ${Buffer.byteLength(message) + 1}`,
      message,
      `M 644 inline f${i}.txt`,
      `data ${Buffer.byteLength(content) + 1}`,
      content,
      '',
    );
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo.dir, input: stream.join('\n'), stdio: 'pipe' });
}

/** Every object in the repo, bucketed by its first four hex digits. */
function objectsByPrefix(repo: SandboxRepo): Map<string, { sha: string; type: string }[]> {
  const raw = repo.git('cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)');
  const buckets = new Map<string, { sha: string; type: string }[]>();
  for (const line of raw.split('\n')) {
    const [sha, type] = line.split(' ');
    if (!sha || !type) continue;
    const prefix = sha.slice(0, 4);
    const bucket = buckets.get(prefix) ?? [];
    bucket.push({ sha, type });
    buckets.set(prefix, bucket);
  }
  return buckets;
}

let repo: SandboxRepo;
let tagCommit: string;
let blobSha: string;
/** A four-hex prefix two commits answer to. */
let commitCollision: { prefix: string; shas: string[] };
/** A four-hex prefix only blobs answer to. */
let blobCollision: { prefix: string; shas: string[] };

beforeAll(async () => {
  repo = await createSandboxRepo();
  repo.git('checkout', '-b', 'feat/resolve');
  await commit(repo.dir, repo.git, 'a.txt', 'a\n', 'first');
  tagCommit = await commit(repo.dir, repo.git, 'b.txt', 'b\n', 'second');
  repo.git('tag', '-a', 'v1', '-m', 'release one');
  blobSha = repo.git('rev-parse', 'HEAD:b.txt');
  repo.git('checkout', 'main');

  importCollisionObjects(repo, 1600);

  const buckets = objectsByPrefix(repo);
  for (const [prefix, objects] of buckets) {
    const commits = objects.filter((o) => o.type === 'commit');
    const blobs = objects.filter((o) => o.type === 'blob');
    if (!commitCollision && commits.length >= 2) {
      commitCollision = { prefix, shas: commits.map((c) => c.sha).sort() };
    }
    if (!blobCollision && blobs.length >= 2 && commits.length === 0) {
      blobCollision = { prefix, shas: blobs.map((b) => b.sha).sort() };
    }
  }
});

afterAll(async () => {
  await cleanupRepo(repo.dir);
});

// ── GitShell.resolveRef ──────────────────────────────────────────────────────

describe('GitShell.resolveRef against real git', () => {
  test('resolves a short sha to the full commit', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const result = await GitShell.resolveRef(repo.dir, tagCommit.slice(0, 7));
    expect(result).toEqual({ kind: 'resolved', sha: tagCommit });
  });

  test('resolves a full sha to itself', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.resolveRef(repo.dir, tagCommit)).toEqual({ kind: 'resolved', sha: tagCommit });
  });

  test('peels an annotated tag to the commit it points at', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    // The tag object is not the commit: the peel is doing real work here.
    expect(repo.git('rev-parse', 'v1')).not.toBe(tagCommit);
    expect(await GitShell.resolveRef(repo.dir, 'v1')).toEqual({ kind: 'resolved', sha: tagCommit });
  });

  test('resolves a branch name and a `~n` walk back from it', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.resolveRef(repo.dir, 'feat/resolve')).toEqual({ kind: 'resolved', sha: tagCommit });
    expect(await GitShell.resolveRef(repo.dir, 'feat/resolve~1')).toEqual({
      kind: 'resolved',
      sha: repo.git('rev-parse', 'feat/resolve~1'),
    });
  });

  test('reports an unknown revision as unknown', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.resolveRef(repo.dir, 'no-such-branch')).toEqual({ kind: 'unknown' });
    expect(await GitShell.resolveRef(repo.dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toEqual({
      kind: 'unknown',
    });
  });

  test('reports a sha that names a blob as unknown, not resolved', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(blobSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await GitShell.resolveRef(repo.dir, blobSha)).toEqual({ kind: 'unknown' });
  });

  test('reports a prefix two commits share as ambiguous, with both candidates', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(commitCollision).toBeDefined();

    const result = await GitShell.resolveRef(repo.dir, commitCollision.prefix);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') throw new Error('unreachable');
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect([...result.candidates].sort()).toEqual(commitCollision.shas);
  });

  test('reports a prefix only blobs share as unknown, since no commit answers to it', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(blobCollision).toBeDefined();

    // git itself calls this abbreviation ambiguous; "use more characters" is
    // advice that cannot help when none of the matches is a commit.
    expect(() => repo.git('rev-parse', '--verify', `${blobCollision.prefix}^{commit}`)).toThrow();
    expect(await GitShell.disambiguate(repo.dir, blobCollision.prefix)).toEqual([]);
    expect(await GitShell.resolveRef(repo.dir, blobCollision.prefix)).toEqual({ kind: 'unknown' });
  });

  test('disambiguate returns nothing for a prefix under four digits', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    expect(await GitShell.disambiguate(repo.dir, commitCollision.prefix.slice(0, 3))).toEqual([]);
  });
});

// ── GitShell.logOneLine ──────────────────────────────────────────────────────

describe('GitShell.logOneLine against real git', () => {
  test('walks a real range newest first', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const log = await GitShell.logOneLine(repo.dir, 'main..feat/resolve');
    expect(log.map((c) => c.message)).toEqual(['second', 'first']);
  });

  test('throws on a range git cannot walk instead of passing it off as empty', async () => {
    const { GitShell } = await import('../../src/core/git-shell.ts');
    await expect(GitShell.logOneLine(repo.dir, 'no-such-ref..main')).rejects.toThrow(/no-such-ref/);
  });
});

// ── tailSplit: revision resolution and the fork-point floor ──────────────────

/** main with two commits of its own, then `feat` with three on top of it. */
async function buildForkRepo(): Promise<{ r: SandboxRepo; stack: Stack; featHead: string; mainHead: string }> {
  const r = await createSandboxRepo();
  await commit(r.dir, r.git, 'main-1.txt', '1\n', 'main one');
  const mainHead = await commit(r.dir, r.git, 'main-2.txt', '2\n', 'main two');

  r.git('checkout', '-b', 'feat');
  await commit(r.dir, r.git, 'feat-1.txt', '1\n', 'feat one');
  await commit(r.dir, r.git, 'feat-2.txt', '2\n', 'feat two');
  const featHead = await commit(r.dir, r.git, 'feat-3.txt', '3\n', 'feat three');

  r.git('checkout', 'main');

  let stack = StackManager.createStack('test', 'main');
  stack = StackManager.addNode(stack, 'feat', 'main');
  stack = StackManager.updateNode(stack, 'feat', { lastKnownHead: featHead });

  return { r, stack, featHead, mainHead };
}

describe('BranchSplitter.tailSplit --at resolution against real git', () => {
  test('refuses `HEAD~2` resolved against a launch checkout sitting below the fork', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { r, stack, featHead } = await buildForkRepo();
    try {
      // HEAD is main here, so HEAD~2 is main's own first commit: below where
      // feat forks. Left alone this rewound feat under its base and handed
      // main's commits to the tail branch, quietly and with exit 0.
      let message = '';
      try {
        await BranchSplitter.tailSplit(r.dir, stack, 'feat', 'feat-tail', 'HEAD~2');
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toMatch(/forks from "main"/);
      expect(message).toMatch(/"HEAD~n" counts back from the checked-out branch/);
      expect(message).toMatch(/use "feat~n" instead/);

      expect(r.git('rev-parse', 'feat')).toBe(featHead);
      expect(r.git('branch', '--list', 'feat-tail')).toBe('');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('refuses splitting at the parent branch itself, which would leave a duplicate of it', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { r, stack, featHead } = await buildForkRepo();
    try {
      await expect(BranchSplitter.tailSplit(r.dir, stack, 'feat', 'feat-tail', 'main')).rejects.toThrow(
        /is at or below where "feat" forks from "main"/,
      );

      expect(r.git('rev-parse', 'feat')).toBe(featHead);
      expect(r.git('branch', '--list', 'feat-tail')).toBe('');
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('`<branch>~n` still splits, counting back from the branch instead of HEAD', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { r, stack, featHead } = await buildForkRepo();
    try {
      const result = await BranchSplitter.tailSplit(r.dir, stack, 'feat', 'feat-tail', 'feat~2');

      expect(result.movedCommits).toHaveLength(2);
      expect(r.git('rev-parse', 'feat')).toBe(r.git('rev-parse', `${featHead}~2`));
      expect(r.git('rev-parse', 'feat-tail')).toBe(featHead);
      // The stack invariant holds: the parent is still contained in the child.
      expect(r.git('merge-base', 'main', 'feat')).toBe(r.git('rev-parse', 'main'));
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('splits at the branch\'s own oldest commit above the fork', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { r, stack, featHead, mainHead } = await buildForkRepo();
    try {
      const oldestOwn = r.git('rev-parse', 'feat~2');
      const result = await BranchSplitter.tailSplit(r.dir, stack, 'feat', 'feat-tail', oldestOwn);

      expect(result.movedCommits).toHaveLength(2);
      expect(r.git('rev-parse', 'feat')).toBe(oldestOwn);
      expect(r.git('rev-parse', 'feat-tail')).toBe(featHead);
      // One commit of feat's own survives on the source, above main's head.
      expect(r.git('rev-parse', 'feat~1')).toBe(mainHead);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('says the branch is missing from git rather than blaming the split point', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    const { r, stack } = await buildForkRepo();
    try {
      const splitPoint = r.git('rev-parse', 'feat~1');
      r.git('branch', '-D', 'feat');

      let message = '';
      try {
        await BranchSplitter.tailSplit(r.dir, stack, 'feat', 'feat-tail', splitPoint);
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toMatch(/does not exist in this repository/);
      expect(message).not.toMatch(/not found in branch/);
    } finally {
      await cleanupRepo(r.dir);
    }
  });

  test('reports an ambiguous abbreviation with its candidates, exactly as the docs promise', async () => {
    const { BranchSplitter } = await import('../../src/core/branch-splitter.ts');
    // The shared repo carries the collision fixture; this refuses before it
    // would touch a ref, so it leaves nothing behind.
    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/resolve', 'main');

    const prefix = commitCollision.prefix;
    await expect(
      BranchSplitter.tailSplit(repo.dir, stack, 'feat/resolve', 'split-tail', prefix),
    ).rejects.toThrow(
      new RegExp(`Commit "${prefix}" is an ambiguous abbreviation \\(matches ${prefix}\\w+, ${prefix}\\w+\\); use more characters`),
    );
  });
});
