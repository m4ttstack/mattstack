import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { readJson, writeJsonAtomic } from '../core/json-store.ts';
import type { CascadePauseInfo } from '../core/rebase-engine.ts';
import type { CliContext } from './context.ts';
import { fail } from './output.ts';

export interface PauseFile {
  stackId: string;
  pauseInfo: CascadePauseInfo;
}

export function pausePath(gitDir: string): string {
  return join(gitDir, 'gitq-pause.json');
}

/** Read the pause file for a repo's git dir. Returns null if none exists. */
export async function readPause(gitDir: string): Promise<PauseFile | null> {
  return readJson<PauseFile | null>(pausePath(gitDir), null);
}

export async function writePause(gitDir: string, pause: PauseFile): Promise<void> {
  await writeJsonAtomic(pausePath(gitDir), pause);
}

export async function clearPause(gitDir: string): Promise<void> {
  await unlink(pausePath(gitDir)).catch(() => {});
}

/**
 * Legacy guard, superseded by `requireStackFree` (slots.ts) for every
 * command with a resolvable stack: those now refuse on a per-stack LEASE
 * (running or parked), not on this local pause file, since a cascade pauses
 * in a leased work slot rather than in `ctx.gitDir`. This delegates to the
 * old check (a pause file directly in `ctx.gitDir`) and is kept only for
 * `undo`, which has no single stack to guard until it reads the operation
 * log entry. Returns the `fail()` exit code (1) when a local pause file is
 * present, or `null` when it's safe to proceed.
 */
export async function requireNoPause(ctx: CliContext): Promise<number | null> {
  if (await readPause(ctx.gitDir)) {
    return fail('a cascade is paused here; resolve it first: gitq continue (or gitq abort)');
  }
  return null;
}
