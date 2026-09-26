import { describe, test, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { realpathSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { createSandboxRepo } from './helpers.ts';
import { loadStore, saveStore, getStorePath, resolveRepoIdentity } from '../../src/core/persistence.ts';
import { repoHash, setConfigDir, getConfigDir } from '../../src/core/config-paths.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import { entryBelongsToRepo } from '../../src/core/operation-log.ts';
import type { OperationEntry } from '../../src/core/operation-log.ts';

const cleanups: string[] = [];
const savedConfigDir = getConfigDir();
afterEach(async () => {
  setConfigDir(savedConfigDir);
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function isolatedConfigDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-cfg-')));
  cleanups.push(dir);
  setConfigDir(dir);
  return dir;
}

async function repoWithWorktree(): Promise<{ primary: string; slot: string }> {
  const repo = await createSandboxRepo();
  cleanups.push(repo.dir);
  const slot = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-slot-')));
  cleanups.push(slot);
  execFileSync('git', ['worktree', 'add', '--detach', join(slot, 'wt'), 'HEAD'], { cwd: repo.dir, stdio: 'pipe' });
  return { primary: repo.dir, slot: join(slot, 'wt') };
}

describe('repo identity', () => {
  test('all worktrees resolve to one identity and share one store', async () => {
    isolatedConfigDir();
    const { primary, slot } = await repoWithWorktree();
    const idA = await resolveRepoIdentity(primary);
    const idB = await resolveRepoIdentity(slot);
    expect(idA).toBe(idB);
    expect(idA.endsWith('.git')).toBe(true);

    let store = await loadStore(primary);
    store = { ...store, stacks: [StackManager.createStack('shared', 'main')] };
    await saveStore(primary, store);

    const fromSlot = await loadStore(slot);
    expect(fromSlot.stacks.map((s) => s.stackName)).toEqual(['shared']);
    expect(fromSlot.commonDir).toBe(idA);
  });

  test('a legacy path-keyed store migrates on first load', async () => {
    const cfg = isolatedConfigDir();
    const { primary } = await repoWithWorktree();
    // Seed a store under the LEGACY key (hash of the worktree path).
    const legacyFile = join(cfg, 'stacks', `${repoHash(primary)}.json`);
    const legacy = { repoPath: primary, remoteUrl: '', stacks: [StackManager.createStack('old', 'main')] };
    await Bun.write(legacyFile, JSON.stringify(legacy));

    const store = await loadStore(primary);
    expect(store.stacks.map((s) => s.stackName)).toEqual(['old']);
    const identity = await resolveRepoIdentity(primary);
    expect(existsSync(join(cfg, 'stacks', `${repoHash(identity)}.json`))).toBe(true);
    expect(existsSync(legacyFile + '.bak')).toBe(true);
  });

  test('a second legacy store merges without clobbering, skipping duplicate names', async () => {
    const cfg = isolatedConfigDir();
    const { primary, slot } = await repoWithWorktree();
    let store = await loadStore(primary);
    store = { ...store, stacks: [StackManager.createStack('kept', 'main')] };
    await saveStore(primary, store);
    // A different slot still has an old path-keyed store with one new and one colliding stack.
    const legacyFile = join(cfg, 'stacks', `${repoHash(slot)}.json`);
    const legacy = {
      repoPath: slot,
      remoteUrl: '',
      stacks: [StackManager.createStack('kept', 'main'), StackManager.createStack('extra', 'main')],
    };
    await Bun.write(legacyFile, JSON.stringify(legacy));

    const merged = await loadStore(slot);
    expect(merged.stacks.map((s) => s.stackName).sort()).toEqual(['extra', 'kept']);
  });

  test('non-git paths fall back to path identity', async () => {
    isolatedConfigDir();
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-plain-')));
    cleanups.push(plain);
    expect(await resolveRepoIdentity(plain)).toBe(plain);
    const store = await loadStore(plain);
    expect(store.stacks).toEqual([]);
  });
});

describe('entryBelongsToRepo with identity', () => {
  const base = { id: 'e', timestamp: 1, operation: 'sync', commands: [], branchSnapshots: {}, stackSnapshot: StackManager.createStack('s', 'main') } as unknown as OperationEntry;

  test('matches commonDir, legacy repoPath, and legacy untagged entries', () => {
    expect(entryBelongsToRepo({ ...base, commonDir: '/r/.git' }, '/r/.git')).toBe(true);
    expect(entryBelongsToRepo({ ...base, repoPath: '/r' }, '/r')).toBe(true);
    expect(entryBelongsToRepo(base, '/anything')).toBe(true);
    expect(entryBelongsToRepo({ ...base, commonDir: '/r/.git', repoPath: '/r' }, '/other')).toBe(false);
  });
});
