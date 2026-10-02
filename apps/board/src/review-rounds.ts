import { Database } from 'bun:sqlite';

import type { ReviewOutcome } from './review-state.ts';
import { getStateDb } from './state/index.ts';

export type SkippedSeverity = 'critical' | 'important' | 'minor';

export interface SkippedFinding {
  /** Round-qualified (`r<round>-<finding id>`): finding ids restart every round. */
  id: string;
  title: string;
  severity: SkippedSeverity;
  file?: string;
  line?: number;
  excerpt: string;
  snippet: string;
}

export interface ReviewRound {
  mrUrl: string;
  round: number;
  reviewedSha: string;
  outcome: ReviewOutcome;
  skipped: SkippedFinding[];
  restored: string[];
  confirmed: string[];
  recordedAt: number;
}

export interface LedgerView {
  /** The last recorded round; 0 when the MR has none. */
  round: number;
  reviewedSha: string | null;
  rounds: Array<{ round: number; reviewedSha: string; recordedAt: number }>;
  skipped: Array<SkippedFinding & { round: number }>;
  confirmed: string[];
}

export function qualifySkippedId(round: number, id: string): string {
  return /^r\d+-/.test(id) ? id : `r${round}-${id}`;
}

function list<T>(json: string): T[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function recordRound(
  row: ReviewRound,
  db: Database = getStateDb()
): void {
  db.run(
    `INSERT OR REPLACE INTO review_rounds
       (mr_url, round, reviewed_sha, outcome, skipped, restored, confirmed, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.mrUrl,
      row.round,
      row.reviewedSha,
      row.outcome,
      JSON.stringify(row.skipped),
      JSON.stringify(row.restored),
      JSON.stringify(row.confirmed),
      row.recordedAt,
    ]
  );
}

interface Row {
  mr_url: string;
  round: number;
  reviewed_sha: string;
  outcome: string;
  skipped: string;
  restored: string;
  confirmed: string;
  recorded_at: number;
}

export function readRounds(
  mrUrl: string,
  db: Database = getStateDb()
): ReviewRound[] {
  const rows = db
    .query('SELECT * FROM review_rounds WHERE mr_url = ? ORDER BY round')
    .all(mrUrl) as Row[];
  return rows.map(r => ({
    mrUrl: r.mr_url,
    round: r.round,
    reviewedSha: r.reviewed_sha,
    outcome: r.outcome as ReviewOutcome,
    skipped: list<SkippedFinding>(r.skipped),
    restored: list<string>(r.restored),
    confirmed: list<string>(r.confirmed),
    recordedAt: r.recorded_at,
  }));
}

/** What a later round needs: every finding skipped so far that no round has
    brought back, and every thread confirmed fixed and left to the author. */
export function ledgerView(rounds: ReviewRound[]): LedgerView {
  const restored = new Set(rounds.flatMap(r => r.restored));
  const last = rounds.at(-1);
  return {
    round: last?.round ?? 0,
    reviewedSha: last?.reviewedSha ?? null,
    rounds: rounds.map(r => ({
      round: r.round,
      reviewedSha: r.reviewedSha,
      recordedAt: r.recordedAt,
    })),
    skipped: rounds.flatMap(r =>
      r.skipped
        .filter(s => !restored.has(s.id))
        .map(s => ({ ...s, round: r.round }))
    ),
    confirmed: [...new Set(rounds.flatMap(r => r.confirmed))],
  };
}

export function dropRounds(mrUrl: string, db: Database = getStateDb()): void {
  db.run('DELETE FROM review_rounds WHERE mr_url = ?', [mrUrl]);
}
