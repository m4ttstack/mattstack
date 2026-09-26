import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { createSandboxRepo, commit } from './helpers.ts';
import { GitShell } from '../../src/core/git-shell.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

describe('GitShell worktree primitives', () => {
  test('worktreeAddDetached + worktreeList report paths, heads, and branches', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    const wtParent = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-wt-')));
    cleanups.push(wtParent);
    const wt = join(wtParent, 'slot');
    await GitShell.worktreeAddDetached(repo.dir, wt, 'HEAD');

    const list = await GitShell.worktreeList(repo.dir);
    expect(list.length).toBe(2);
    expect(list[0]!.path).toBe(repo.dir);
    expect(list[0]!.branch).toBe('main');
    expect(list[1]!.path).toBe(realpathSync(wt));
    expect(list[1]!.branch).toBeNull();
    expect(list[1]!.head).toMatch(/^[0-9a-f]{40}$/);
  });

  test('detached rebase + CAS ref update move a branch without checking it out', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    const { git, dir } = repo;
    git('checkout', '-b', 'feature');
    const oldHead = await commit(dir, git, 'f.txt', 'f\n', 'feature work');
    git('checkout', 'main');
    const mainHead2 = await commit(dir, git, 'm.txt', 'm\n', 'main advance');

    const wtParent = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-wt2-')));
    cleanups.push(wtParent);
    const wt = join(wtParent, 'slot');
    await GitShell.worktreeAddDetached(repo.dir, wt, 'HEAD');

    await GitShell.detachAt(wt, oldHead);
    await GitShell.rebaseOntoDetached(wt, mainHead2, `${oldHead}~1`);
    const newHead = await GitShell.getBranchHead(wt, 'HEAD');
    expect(newHead).not.toBe(oldHead);

    await GitShell.updateRefCas(dir, 'feature', newHead, oldHead);
    expect(await GitShell.getBranchHead(dir, 'feature')).toBe(newHead);

    // CAS with a stale expected value must throw and not move the ref.
    await expect(GitShell.updateRefCas(dir, 'feature', oldHead, oldHead)).rejects.toThrow();
    expect(await GitShell.getBranchHead(dir, 'feature')).toBe(newHead);
  });
});
