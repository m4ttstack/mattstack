import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { LatchFile } from './post.ts';

export interface StagedFiles {
  dir: string;
  paths: { path: string; name: string }[];
  cleanup(): Promise<void>;
}

export type StageFn = (files: LatchFile[]) => Promise<StagedFiles>;

/** HOME is read per call: Bun freezes `homedir()` at startup, so a test HOME would be ignored. */
function defaultRoot(): string {
  return join(
    process.env.HOME ?? homedir(),
    '.mattstack',
    'evidence',
    'board-latch'
  );
}

/** Writes each file under its filename in a private subfolder for the daemon to read. */
export async function stageFiles(
  files: LatchFile[],
  opts: { root?: string } = {}
): Promise<StagedFiles> {
  const root = opts.root ?? defaultRoot();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'stage-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await chmod(dir, 0o700);
    const paths = [];
    for (const f of files) {
      const path = join(dir, f.filename);
      await writeFile(path, f.bytes);
      paths.push({ path, name: f.filename });
    }
    return { dir, paths, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
