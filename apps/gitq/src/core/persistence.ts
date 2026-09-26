import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StackStore } from './types.ts';
import { getStacksDir, repoHash } from './config-paths.ts';
import { readJson, writeJsonAtomic } from './json-store.ts';
import { withFileLock } from './lockfile.ts';

const exec = promisify(execFile);

// ── Repo identity ────────────────────────────────────────────────────────────

/**
 * Resolve a path to its repo identity: the realpath of the git common dir,
 * shared by every worktree of the repo. Non-git paths fall back to the path
 * itself so degenerate callers keep working.
 */
export async function resolveRepoIdentity(repoPath: string): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repoPath },
    );
    return realpathSync(stdout.trim());
  } catch {
    return repoPath;
  }
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Store file path for an already-resolved identity (or legacy path). */
export function getStorePath(identity: string): string {
  return join(getStacksDir(), `${repoHash(identity)}.json`);
}

// ── Read / Write ─────────────────────────────────────────────────────────────

function emptyStore(repoPath: string): StackStore {
  return { repoPath, remoteUrl: '', stacks: [] };
}

/**
 * Load the stack store for a repo, keyed by repo identity so every worktree
 * sees the same store. Transparently migrates (or merges) a legacy store
 * keyed by this worktree's path. Returns an empty store when none exists.
 */
export async function loadStore(repoPath: string): Promise<StackStore> {
  const identity = await resolveRepoIdentity(repoPath);
  const identityFile = getStorePath(identity);
  const legacyFile = getStorePath(repoPath);

  let store = await readJson<StackStore | null>(identityFile, null);

  if (identity !== repoPath && existsSync(legacyFile)) {
    const legacy = await readJson<StackStore>(legacyFile, emptyStore(repoPath));
    if (store === null) {
      store = { ...legacy, commonDir: identity };
      await writeJsonAtomic(identityFile, store);
      console.error(`gitq: migrated stack store for ${repoPath} to repo identity ${identity}`);
    } else {
      const known = new Set(store.stacks.map((s) => s.stackName));
      const incoming = legacy.stacks.filter((s) => !known.has(s.stackName));
      const skipped = legacy.stacks.length - incoming.length;
      if (incoming.length > 0) {
        store = { ...store, stacks: [...store.stacks, ...incoming] };
        await writeJsonAtomic(identityFile, store);
      }
      console.error(
        `gitq: merged ${incoming.length} stack(s) from a legacy store at ${repoPath}` +
          (skipped > 0 ? ` (${skipped} skipped as duplicate names)` : ''),
      );
    }
    await rename(legacyFile, legacyFile + '.bak').catch(() => {});
  }

  if (store === null) store = emptyStore(repoPath);
  if (!store.commonDir && identity !== repoPath) store.commonDir = identity;

  // Migration: fill in stackName for stacks created before it was required
  for (const stack of store.stacks) {
    if (!stack.stackName) {
      (stack as any).stackName = stack.id;
    }
  }

  return store;
}

/**
 * Persist the stack store under the repo identity key. Locked: concurrent
 * cascades finishing together must not lose each other's writes, so callers
 * that read-modify-write should do so inside `updateStore` instead.
 */
export async function saveStore(repoPath: string, store: StackStore): Promise<void> {
  const identity = await resolveRepoIdentity(repoPath);
  const file = getStorePath(identity);
  const stamped = identity !== repoPath ? { ...store, commonDir: identity } : store;
  await withFileLock(file, async () => {
    await writeJsonAtomic(file, stamped);
  });
}

/**
 * Locked read-modify-write of the store: the whole cycle holds the lock, so
 * two cascades updating different stacks cannot lose updates.
 */
export async function updateStore(
  repoPath: string,
  mutate: (store: StackStore) => StackStore,
): Promise<StackStore> {
  const identity = await resolveRepoIdentity(repoPath);
  const file = getStorePath(identity);
  return withFileLock(file, async () => {
    const current = (await readJson<StackStore | null>(file, null)) ?? emptyStore(repoPath);
    const next = mutate(current);
    const stamped = identity !== repoPath ? { ...next, commonDir: identity } : next;
    await writeJsonAtomic(file, stamped);
    return stamped;
  });
}

/**
 * Relocate a stack store from one repo path to another.
 * Renames the hash-keyed file and updates the repoPath inside the JSON.
 */
export async function relocateStore(oldPath: string, newPath: string): Promise<void> {
  const oldFile = getStorePath(await resolveRepoIdentity(oldPath));
  const newFile = getStorePath(await resolveRepoIdentity(newPath));

  const store = await readJson<StackStore>(oldFile, emptyStore(oldPath));
  store.repoPath = newPath;
  await writeJsonAtomic(newFile, store);

  if (oldFile !== newFile) {
    await rename(oldFile, oldFile + '.bak').catch(() => {});
  }
}
