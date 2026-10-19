import { Database } from 'bun:sqlite';

import { getStateDb } from './state/index.ts';

/** Records the next response round for this person and returns it (1 on the first). */
export function recordRespondRound(
  mrUrl: string,
  person: string,
  now: number = Date.now(),
  db: Database = getStateDb()
): number {
  const row = db
    .query(
      'SELECT COALESCE(MAX(round), 0) AS round FROM respond_rounds WHERE mr_url = ? AND person = ?'
    )
    .get(mrUrl, person) as { round: number };
  const round = row.round + 1;
  db.run(
    'INSERT INTO respond_rounds (mr_url, person, round, started_at) VALUES (?, ?, ?, ?)',
    [mrUrl, person, round, now]
  );
  return round;
}

/** Highest recorded round per person, per MR. */
export function readRespondRounds(
  db: Database = getStateDb()
): Map<string, Record<string, number>> {
  const rows = db
    .query(
      'SELECT mr_url, person, MAX(round) AS round FROM respond_rounds GROUP BY mr_url, person'
    )
    .all() as Array<{ mr_url: string; person: string; round: number }>;
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const people = out.get(r.mr_url) ?? {};
    people[r.person] = r.round;
    out.set(r.mr_url, people);
  }
  return out;
}

/** Drop rounds whose MR left the board (same contract as pruneRespondStates). */
export function pruneRespondRounds(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const urls = db
    .query('SELECT DISTINCT mr_url FROM respond_rounds')
    .all() as Array<{ mr_url: string }>;
  for (const { mr_url } of urls) {
    if (!keepUrls.has(mr_url))
      db.run('DELETE FROM respond_rounds WHERE mr_url = ?', [mr_url]);
  }
}
