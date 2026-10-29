import { Database } from 'bun:sqlite';

import { getStateDb } from './state/index.ts';
import { personApproved } from './view.ts';

/** What the person had posted on the MR when a response round began. */
export type ReviewerOutcome = 'comment' | 'approve';

/** What the person has posted on the MR now, as a response round records it. */
export function reviewerOutcome(
  mr: Parameters<typeof personApproved>[0],
  person: string
): ReviewerOutcome {
  return personApproved(mr, person) ? 'approve' : 'comment';
}

/** Records the next response round for this person and returns it (1 on the first). */
export function recordRespondRound(
  mrUrl: string,
  person: string,
  now: number = Date.now(),
  db: Database = getStateDb(),
  outcome?: ReviewerOutcome
): number {
  return db.transaction(() => {
    const row = db
      .query(
        'SELECT COALESCE(MAX(round), 0) AS round FROM respond_rounds WHERE mr_url = ? AND person = ?'
      )
      .get(mrUrl, person) as { round: number };
    const round = row.round + 1;
    db.run(
      'INSERT INTO respond_rounds (mr_url, person, round, started_at, outcome) VALUES (?, ?, ?, ?, ?)',
      [mrUrl, person, round, now, outcome ?? null]
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

/** Each person's recorded outcomes per MR, in round order; null for a
    round recorded before outcomes were. */
export function readRespondOutcomes(
  db: Database = getStateDb()
): Map<string, Record<string, Array<ReviewerOutcome | null>>> {
  const rows = db
    .query(
      'SELECT mr_url, person, outcome FROM respond_rounds ORDER BY mr_url, person, round'
    )
    .all() as Array<{ mr_url: string; person: string; outcome: string | null }>;
  const out = new Map<string, Record<string, Array<ReviewerOutcome | null>>>();
  for (const r of rows) {
    const people = out.get(r.mr_url) ?? {};
    (people[r.person] ??= []).push(r.outcome as ReviewerOutcome | null);
    out.set(r.mr_url, people);
  }
  return out;
}

export function attachRespondRounds<T extends { webUrl?: string | null }>(
  mrs: T[],
  rounds: Map<string, Record<string, number>>,
  outcomes: Map<
    string,
    Record<string, Array<ReviewerOutcome | null>>
  > = new Map()
): Array<
  T & {
    respondRounds?: Record<string, number>;
    respondOutcomes?: Record<string, Array<ReviewerOutcome | null>>;
  }
> {
  return mrs.map(mr => {
    if (!mr.webUrl) return mr;
    const r = rounds.get(mr.webUrl);
    const o = outcomes.get(mr.webUrl);
    return r || o
      ? {
          ...mr,
          ...(r ? { respondRounds: r } : {}),
          ...(o ? { respondOutcomes: o } : {}),
        }
      : mr;
  });
}
