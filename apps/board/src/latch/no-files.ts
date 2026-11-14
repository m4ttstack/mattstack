/**
 * A PR with no changed file has nowhere to anchor a latch thread. The memo
 * holds the finished review's run stamp, so both posting sites skip that
 * review on every later tick and a later review tries again.
 */
import type { Database } from 'bun:sqlite';

import { getKvValue, getStateDb, setKvValue } from '../state/index.ts';

const NS = 'latch-no-files';

export function recordNoFiles(
  mrUrl: string,
  runStamp: number,
  db: Database = getStateDb()
): void {
  setKvValue(NS, mrUrl, runStamp, db);
}

export function noFilesFor(
  mrUrl: string,
  runStamp: number,
  db: Database = getStateDb()
): boolean {
  return getKvValue<number | null>(NS, mrUrl, null, db) === runStamp;
}
