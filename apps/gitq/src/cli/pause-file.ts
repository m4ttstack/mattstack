import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { readJson, writeJsonAtomic } from '../core/json-store.ts';
import type { CascadePauseInfo } from '../core/rebase-engine.ts';

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
