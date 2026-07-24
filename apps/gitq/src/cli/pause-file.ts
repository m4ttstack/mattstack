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
 * Shared guard for state-mutating commands: refuse to run while a cascade is
 * paused (git is mid-rebase). Returns the `fail()` exit code (1) when a pause
 * file is present, or `null` when it's safe to proceed. Read-only commands and
 * the pause-resolving commands (`continue`/`abort`) are exempt and must not
 * call this.
 */
export async function requireNoPause(ctx: CliContext): Promise<number | null> {
  if (await readPause(ctx.gitDir)) {
    return fail('a cascade is paused here; resolve it first: gitq continue (or gitq abort)');
  }
  return null;
}
