import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';

import { openStateDb } from '../state/db.ts';

// Bun shares this module across test files, so a hook registered here would
// fire for the first importer only: each file calls afterAll(removeTempDbs).
const opened: Array<{ db: Database; dir: string }> = [];

/** A throwaway state db for latch tests. */
export function tempDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), 'board-latch-test-'));
  const db = openStateDb(join(dir, 'state.db'));
  opened.push({ db, dir });
  return db;
}

export function removeTempDbs(): void {
  for (const { db, dir } of opened.splice(0)) {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
