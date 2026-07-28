import { describe, test, expect, afterEach } from 'bun:test';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, writeFile } from 'node:fs/promises';
import { createSandboxRepo, addNamedWorktree, addWorkSlot, gitIn } from './helpers.ts';
import { getWorktreeMap, findSlotForBranch, workSlotRoot, ensureWorkSlot } from '../../src/core/worktrees.ts';
import { resolveRepoIdentity } from '../../src/core/persistence.ts';
import { getConfigDir, setConfigDir, repoHash } from '../../src/core/config-paths.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

describe('worktree map', () => {
  test('classifies primary, human slots, work slots, dirty state, and branch owners', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    repo.git('checkout', '-b', 'feat');
    repo.git('checkout', 'main');
    const human = await addNamedWorktree(repo, 'dobby', 'feat');
    cleanups.push(human);
    await writeFile(join(human, 'wip.txt'), 'wip\n');

    const commonDir = await resolveRepoIdentity(repo.dir);
    let map = await getWorktreeMap(repo.dir);
    expect(map[0]!.isPrimary).toBe(true);
    const dobby = findSlotForBranch(map, 'feat');
    expect(dobby?.path).toBe(human);
    expect(dobby?.dirty).toBe(true);

    const slot = await ensureWorkSlot(repo.dir, commonDir, map);
    cleanups.push(slot);
    expect(basename(slot)).toBe('gitq-1');
    map = await getWorktreeMap(repo.dir);
    const work = map.find((s) => s.path === slot);
    expect(work?.isWorkSlot).toBe(true);
    expect(work?.branch).toBeNull();

    // Reuse, not re-create: a free detached work slot is returned as-is.
    expect(await ensureWorkSlot(repo.dir, commonDir, map)).toBe(slot);
  });

  test('finds a branch held by a work slot, which the guards have to see', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    repo.git('checkout', '-b', 'feat');
    repo.git('checkout', 'main');
    // A human `git checkout` inside a pool slot. gitq leaves its own slots
    // detached, so a work slot on a branch is always this. Skipping it here
    // made surgery move the ref and leave this tree silently stale.
    const work = addWorkSlot(repo, 'gitq-1', 'feat');
    cleanups.push(work.root);

    const found = findSlotForBranch(await getWorktreeMap(repo.dir), 'feat');

    expect(found?.path).toBe(work.path);
    expect(found?.isWorkSlot).toBe(true);
  });

  test('prefers a human worktree over a work slot when both hold the branch', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    repo.git('checkout', '-b', 'feat');
    repo.git('checkout', 'main');
    const work = addWorkSlot(repo, 'gitq-1', 'feat');
    cleanups.push(work.root);

    // Git refuses a second checkout of the same branch, so reach the state by
    // pointing a human worktree at it after the fact.
    const human = await addNamedWorktree(repo, 'dobby');
    cleanups.push(human);
    gitIn(human)('checkout', '--ignore-other-worktrees', 'feat');

    const found = findSlotForBranch(await getWorktreeMap(repo.dir), 'feat');

    // The human's checkout is the one whose message is actionable ("run this
    // from that worktree"); a work slot only ever says "free it".
    expect(found?.path).toBe(human);
  });

  test('pool repos place work slots as siblings; single checkouts go to the work-slot root', async () => {
    const pooled = await createSandboxRepo();
    cleanups.push(pooled.dir);
    const sib = await addNamedWorktree(pooled, 'harry');
    cleanups.push(sib);
    const pooledId = await resolveRepoIdentity(pooled.dir);
    const pooledMap = await getWorktreeMap(pooled.dir);
    expect(workSlotRoot(pooledId, pooledMap)).toBe(dirname(pooled.dir));

    const single = await createSandboxRepo();
    cleanups.push(single.dir);
    const singleId = await resolveRepoIdentity(single.dir);
    const singleMap = await getWorktreeMap(single.dir);
    // Pin the config dir to a sandbox rather than asking for whatever root is
    // configured: the point is that the root MOVES with it, so the expectation
    // has to be a path the real cache dir cannot satisfy. The shape of the
    // untouched default is asserted in tests/config-paths.test.ts.
    const sandboxConfigDir = join(tmpdir(), 'gitq-work-slot-root-test-config');
    const restoreConfigDir = getConfigDir();
    setConfigDir(sandboxConfigDir);
    try {
      expect(workSlotRoot(singleId, singleMap)).toBe(join(sandboxConfigDir, 'work', repoHash(singleId)));
    } finally {
      setConfigDir(restoreConfigDir);
    }
  });
});

describe('work slots in repos with checkout hooks', () => {
  test('provisioning and reuse survive a failing post-checkout hook, with hooks disabled in the slot', async () => {
    const repo = await createSandboxRepo();
    cleanups.push(repo.dir);
    const sib = await addNamedWorktree(repo, 'human');
    cleanups.push(sib);
    // A hook that always fails, like husky without node_modules.
    const hookDir = join(repo.dir, '.git', 'hooks');
    await writeFile(join(hookDir, 'post-checkout'), '#!/bin/sh\nexit 1\n');
    const { chmodSync } = await import('node:fs');
    chmodSync(join(hookDir, 'post-checkout'), 0o755);

    const commonDir = await resolveRepoIdentity(repo.dir);
    const map = await getWorktreeMap(repo.dir);
    // Register the expected slot path BEFORE provisioning so a failed
    // provision cannot strand a stale worktree dir for later tests.
    cleanups.push(join(dirname(repo.dir), 'gitq-1'));
    const slot = await ensureWorkSlot(repo.dir, commonDir, map);

    // Checkouts inside the slot must not trip the repo's hooks.
    const { GitShell } = await import('../../src/core/git-shell.ts');
    const head = await GitShell.getBranchHead(repo.dir, 'main');
    await GitShell.detachAt(slot, head);
    expect(await GitShell.getBranchHead(slot, 'HEAD')).toBe(head);
    // The slot's per-worktree config pins hooks off, and re-applying is idempotent.
    await GitShell.disableWorktreeHooks(slot);
    const { execFileSync } = await import('node:child_process');
    const hooksPath = execFileSync('git', ['config', '--worktree', 'core.hooksPath'], { cwd: slot }).toString().trim();
    expect(hooksPath).toBe('/dev/null');
  });
});
