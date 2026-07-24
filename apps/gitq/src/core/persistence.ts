import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import type { StackStore } from './types.ts';
import { getStacksDir, repoHash } from './config-paths.ts';
import { readJson, writeJsonAtomic } from './json-store.ts';

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Compute the full path to a repo's stack store file. */
export function getStorePath(repoPath: string): string {
  return join(getStacksDir(), `${repoHash(repoPath)}.json`);
}

// ── Read / Write ─────────────────────────────────────────────────────────────

/** Load the stack store for a repo. Returns an empty store if the file doesn't exist. */
export async function loadStore(repoPath: string): Promise<StackStore> {
  const store = await readJson<StackStore>(getStorePath(repoPath), { repoPath, remoteUrl: '', stacks: [] });

  // Migration: fill in stackName for stacks created before it was required
  for (const stack of store.stacks) {
    if (!stack.stackName) {
      (stack as any).stackName = stack.id;
    }
  }

  return store;
}

/**
 * Persist the stack store to disk.
 * Uses atomic write (write to temp, rename) to avoid corruption.
 */
export async function saveStore(repoPath: string, store: StackStore): Promise<void> {
  await writeJsonAtomic(getStorePath(repoPath), store);
}

/**
 * Relocate a stack store from one repo path to another.
 * Renames the hash-keyed file and updates the repoPath inside the JSON.
 */
export async function relocateStore(oldPath: string, newPath: string): Promise<void> {
  const oldFile = getStorePath(oldPath);
  const newFile = getStorePath(newPath);

  // Load using the old path, update repoPath, save under the new hash
  const store = await readJson<StackStore>(oldFile, { repoPath: oldPath, remoteUrl: '', stacks: [] });
  store.repoPath = newPath;
  await writeJsonAtomic(newFile, store);

  // Remove old file (best-effort — may already be gone)
  if (oldFile !== newFile) {
    await rename(oldFile, oldFile + '.bak').catch(() => {});
  }
}

