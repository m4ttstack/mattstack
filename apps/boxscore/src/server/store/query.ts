import type { TimeWindow } from '../../shared/types.js';
import {
  mrKey,
  type IndexRow,
  type Store,
  type StoredMetrics,
} from './index.js';
import type { FetchResult, NormMr, UserIdentity } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Maps a stored login to the spelling the roster compares against. */
export type LoginCanon = (login: string) => string;

const canonOrNull = (canon: LoginCanon, login: string | null): string | null =>
  login === null ? null : canon(login);

function toNormMr(
  row: IndexRow,
  metrics: StoredMetrics | undefined,
  canon: LoginCanon
): NormMr {
  return {
    iid: row.iid,
    projectPath: row.projectPath,
    authorUsername: canonOrNull(canon, row.authorUsername),
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // No query has ever fetched this; cohorts.ts's `?? createdAt` fallback depends on it
    // staying null (spec section 9). Do not source it here.
    preparedAt: null,
    mergedAt: row.mergedAt,
    title: row.title,
    sourceBranch: row.sourceBranch,
    description: metrics?.description ?? null,
    labels: metrics?.labels ?? [],
    additions: metrics?.diffStats?.additions ?? 0,
    deletions: metrics?.diffStats?.deletions ?? 0,
    fileCount: metrics?.diffStats?.filesChanged ?? 0,
    approvedByUsernames: (metrics?.approvedByUsernames ?? []).map(canon),
    notes: (metrics?.notes ?? []).map(n => ({
      ...n,
      authorUsername: canonOrNull(canon, n.authorUsername),
    })),
    diffStats: metrics?.fileStats ?? [],
  };
}

/**
 * Build the metrics layer's FetchResult for one window directly from store rows: a window
 * is a query, not a slice of a wider cached fetch. Performs no network work.
 *
 * `updatedAt` is bounded on both sides (inclusive), matching sliceOutcome's departure from
 * a live fetch's open-ended lower bound: without an upper bound this query would surface
 * MRs updated during a later window, which then leaks into revert detection for this one.
 *
 * `canon` rewrites every stored login before it meets the roster; without it (GitLab)
 * stored logins pass through unchanged.
 */
export function buildFetchResult(
  store: Store,
  window: TimeWindow,
  roster: readonly string[],
  canon?: LoginCanon
): FetchResult {
  const toRoster: LoginCanon = canon ?? (login => login);
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const rosterSet = new Set(roster);

  const indexRows = store.indexRowsUpdatedWithin(window.start, window.end);
  const keys = indexRows.map(r => mrKey(r.projectPath, r.iid));
  const metricsByKey = new Map(
    store.metricsByKeys(keys).map(m => [mrKey(m.projectPath, m.iid), m])
  );
  const mrs = indexRows.map(row =>
    toNormMr(row, metricsByKey.get(mrKey(row.projectPath, row.iid)), toRoster)
  );

  const pipelines = store
    .pipelinesBetween(window.start, window.end)
    .map(p => ({
      projectPath: p.projectPath,
      username: canonOrNull(toRoster, p.username),
      status: p.status,
      createdAt: p.createdAt,
    }))
    .filter(p => rosterSet.has(p.username ?? ''));

  // Widened by a day on each side, mirroring slice.ts:31-34's mirror of the live fetch's
  // push-event bound.
  const padStart = new Date(start - DAY_MS).toISOString();
  const padEnd = new Date(end + DAY_MS).toISOString();
  // Push rows key on the stored spelling, so the canon can fold two rows for one commit
  // onto a single user; those count once.
  const seenPushes = new Set<string>();
  const pushEvents = store
    .pushEventsBetween(padStart, padEnd)
    .filter(e => {
      if (!canon) return true;
      const key = `${canon(e.username)}:${e.createdAt}:${e.repositoryId ?? ''}`;
      if (seenPushes.has(key)) return false;
      seenPushes.add(key);
      return true;
    })
    .map(e => ({ username: toRoster(e.username), createdAt: e.createdAt }))
    .filter(e => rosterSet.has(e.username));

  // Issues are windowed downstream in cohorts.ts by closedAt, not here by MR linkage.
  const linearIssues = canon
    ? store.allLinearIssues().map(i => ({
        ...i,
        creditedUser: canonOrNull(canon, i.creditedUser),
      }))
    : store.allLinearIssues();

  // A tier-capability flag (does this GitLab tier expose approvals at all), not a
  // per-window content check. Parity with fetch.ts:68, which also hardcodes true:
  // no code path in this repo ever sets it false.
  const approvalsAvailable = true;

  return { mrs, pipelines, pushEvents, linearIssues, approvalsAvailable };
}

/**
 * Identities for a roster, keyed by username. Usernames never stored are simply absent.
 * With `canon`, a row stored under another case keys onto the roster spelling it maps to;
 * a row stored under that exact spelling wins.
 */
export function storedIdentities(
  store: Store,
  roster: readonly string[],
  canon?: LoginCanon
): Record<string, UserIdentity> {
  const out: Record<string, UserIdentity> = {};
  const rosterSet = new Set(roster);
  const exact = new Set<string>();
  const rows = canon
    ? store.identitiesIgnoringCase(roster)
    : store.identities(roster);
  for (const r of rows) {
    const username = canon ? canon(r.username) : r.username;
    if (canon && (!rosterSet.has(username) || exact.has(username))) continue;
    if (username === r.username) exact.add(username);
    out[username] =
      r.userId == null
        ? { username, name: r.name, resolved: r.resolved }
        : { username, name: r.name, resolved: r.resolved, userId: r.userId };
  }
  return out;
}

/**
 * The cold-store probe behind ColdCacheError: every configured project must have a scan
 * floor at or before the window's start, or the window reads rows nothing ever fetched.
 */
export function hasDataFor(
  store: Store,
  projects: readonly string[],
  window: TimeWindow
): boolean {
  const start = Date.parse(window.start);
  return projects.every(p => {
    const floor = store.scanFloor(p);
    return floor !== null && Date.parse(floor) <= start;
  });
}
