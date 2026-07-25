import { describe, test, expect, afterEach } from 'bun:test';
import { join, basename, dirname } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { createSandboxRepo, addNamedWorktree } from './helpers.ts';
import { getWorktreeMap, findSlotForBranch, workSlotRoot, ensureWorkSlot } from '../../src/core/worktrees.ts';
import { resolveRepoIdentity } from '../../src/core/persistence.ts';
import { repoHash } from '../../src/core/config-paths.ts';
import { homedir } from 'node:os';

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

  test('pool repos place work slots as siblings; single checkouts go to the cache dir', async () => {
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
    expect(workSlotRoot(singleId, singleMap)).toBe(
      join(homedir(), '.cache', 'gitq', 'work', repoHash(singleId)),
    );
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
  });
});
