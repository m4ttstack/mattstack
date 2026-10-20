import { Database } from 'bun:sqlite';

import { getStateDb } from './state/index.ts';

/** Records the next response round for this person and returns it (1 on the first). */
export function recordRespondRound(
  mrUrl: string,
  person: string,
  now: number = Date.now(),
  db: Database = getStateDb()
): number {
  return db.transaction(() => {
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
  })();
}

/** Drops one recorded round, for a launch that never started a pane. */
export function deleteRespondRound(
  mrUrl: string,
  person: string,
  round: number,
  db: Database = getStateDb()
): void {
  db.run(
    'DELETE FROM respond_rounds WHERE mr_url = ? AND person = ? AND round = ?',
    [mrUrl, person, round]
  );
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

export function attachRespondRounds<T extends { webUrl?: string | null }>(
  mrs: T[],
  rounds: Map<string, Record<string, number>>
): Array<T & { respondRounds?: Record<string, number> }> {
  return mrs.map(mr =>
    mr.webUrl && rounds.has(mr.webUrl)
      ? { ...mr, respondRounds: rounds.get(mr.webUrl) }
      : mr
  );
}
