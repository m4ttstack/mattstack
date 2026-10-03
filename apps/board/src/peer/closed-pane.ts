import type { Database } from 'bun:sqlite';

import { lanesClearedByExecutor } from '../data.ts';
import { getStateDb, persistOrWarn } from '../state/index.ts';
import { deleteKvValue, listKvValues, setKvValue } from '../state/kv-blob.ts';
import { askIdForRun } from './ask-echo.ts';
import type { SwitchboardClient } from './client.ts';
import {
  canonicalUsername,
  makeEnvelope,
  type ReviewStatePayload,
} from './envelope.ts';
import type { NudgeState } from './nudges.ts';
import { enqueueOutbox } from './outbox.ts';

/** mrUrl -> the runStartedAt (0 when unknown) already reported closed, so
    each run is reported once however many sweeps see the gone pane. */
export const CLOSED_REPORTED_NS = 'peer-closed-reported';

export interface ClosedPaneLane {
  iid: number;
  status?: string;
  agentId?: string;
  sessionId?: string | null;
  runStartedAt?: number;
}

export interface ClosedPaneReport {
  to: string;
  mrUrl: string;
  runStartedAt: number;
  payload: ReviewStatePayload;
}

/** A teammate's in-flight review with a gone executor reports error.
    The review lane stays unchanged and resumable. */
export function closedPaneReports(input: {
  reviews: Map<string, ClosedPaneLane>;
  executors: ReadonlyArray<{
    agentId: string;
    sessionId: string;
    state: string;
  }>;
  authorOf: (mrUrl: string) => string | undefined;
  self: string;
  reported: Map<string, unknown>;
  nudges: readonly NudgeState[];
  now: number;
}): ClosedPaneReport[] {
  const me = canonicalUsername(input.self);
  const seen = new Set<string>();
  const out: ClosedPaneReport[] = [];
  for (const executor of input.executors) {
    if (executor.state !== 'gone') continue;
    const { reviews } = lanesClearedByExecutor(
      executor.agentId,
      executor.sessionId || undefined,
      input.reviews,
      new Map()
    );
    for (const mrUrl of reviews) {
      if (seen.has(mrUrl)) continue;
      seen.add(mrUrl);
      const lane = input.reviews.get(mrUrl)!;
      const author = input.authorOf(mrUrl);
      if (!author || canonicalUsername(author) === me) continue;
      const runStartedAt = lane.runStartedAt ?? 0;
      if (input.reported.get(mrUrl) === runStartedAt) continue;
      const nudgeId = askIdForRun(
        input.nudges,
        mrUrl,
        author,
        lane.runStartedAt,
        input.now
      );
      out.push({
        to: author,
        mrUrl,
        runStartedAt,
        payload: {
          mrUrl,
          iid: lane.iid,
          status: 'error',
          reason: 'pane closed',
          updatedAt: input.now,
          ...(nudgeId ? { nudgeId } : {}),
        },
      });
    }
  }
  return out;
}

/** Lane state and writer identity must still be current after awaited reads.
    A replacement run needs its own executor snapshot, even on the same pane.
    A report and its dedupe marker must commit together. */
interface ClosedPaneIO {
  current: () => { self: string; client: SwitchboardClient } | undefined;
  readReviews: () => Map<string, ClosedPaneLane>;
  fetchExecutors: () => Promise<
    ReadonlyArray<{ agentId: string; sessionId: string; state: string }>
  >;
  fetchAuthors: () => Promise<ReadonlyMap<string, string>>;
  readNudges: () => readonly NudgeState[];
  kickOutbox: (client: SwitchboardClient) => void;
}

export async function clearClosedPeerReviews(
  agentId: string,
  io: ClosedPaneIO & {
    clearExecutor: () => Promise<{ ok: boolean; error?: string }>;
    settleReview: (mrUrl: string) => void;
    onReportError: (err: unknown) => void;
    settleResponds: (agentId: string, sessionId: string | undefined) => void;
  },
  db?: Database
): Promise<{ ok: boolean; error?: string }> {
  const beforeClear = io.readReviews();
  const peer = io.current();
  const result = await io.clearExecutor();
  if (!result.ok) return result;
  const executors = await io.fetchExecutors();
  const sessionId = executors.find(e => e.agentId === agentId)?.sessionId;
  const initialReviews = currentRuns(beforeClear, io.readReviews());
  const settle = lanesClearedByExecutor(
    agentId,
    sessionId,
    initialReviews,
    new Map()
  );
  const captured = new Map(
    settle.reviews.map(url => [url, initialReviews.get(url)!])
  );
  if (peer && peer.self !== 'all' && captured.size) {
    try {
      const authors = await io.fetchAuthors();
      const current = io.current();
      const reviews = currentRuns(captured, io.readReviews());
      if (
        current &&
        current.client === peer.client &&
        current.self === peer.self
      )
        persistClosedPaneReports(
          io,
          current,
          reviews,
          [{ agentId, sessionId: sessionId ?? '', state: 'gone' }],
          authors,
          db
        );
    } catch (err) {
      io.onReportError(err);
    }
  }
  for (const url of currentRuns(captured, io.readReviews()).keys())
    io.settleReview(url);
  io.settleResponds(agentId, sessionId);
  return result;
}

export async function sweepClosedPeerReviews(
  io: ClosedPaneIO,
  db?: Database
): Promise<void> {
  const peer = io.current();
  if (!peer || peer.self === 'all') return;
  const initialReviews = io.readReviews();
  if (
    ![...initialReviews.values()].some(
      r => r.status === 'queued' || r.status === 'reviewing'
    )
  )
    return;
  const [executors, authors] = await Promise.all([
    io.fetchExecutors(),
    io.fetchAuthors(),
  ]);
  const current = io.current();
  if (!current || current.client !== peer.client || current.self !== peer.self)
    return;
  const reviews = currentRuns(initialReviews, io.readReviews());
  persistClosedPaneReports(io, current, reviews, executors, authors, db);
}

/** Only the same in-flight run may be settled or reported after an await. */
function currentRuns(
  initialReviews: Map<string, ClosedPaneLane>,
  reviews: Map<string, ClosedPaneLane>
): Map<string, ClosedPaneLane> {
  return new Map(
    [...reviews].filter(([url, lane]) => {
      const initial = initialReviews.get(url);
      return (
        initial &&
        (lane.status === 'queued' || lane.status === 'reviewing') &&
        initial.runStartedAt === lane.runStartedAt &&
        initial.agentId === lane.agentId &&
        initial.sessionId === lane.sessionId
      );
    })
  );
}

/** The envelope and run marker must commit together before delivery. */
function persistClosedPaneReports(
  io: ClosedPaneIO,
  current: { self: string; client: SwitchboardClient },
  reviews: Map<string, ClosedPaneLane>,
  executors: Awaited<ReturnType<ClosedPaneIO['fetchExecutors']>>,
  authors: ReadonlyMap<string, string>,
  db?: Database
): void {
  const stateDb = db ?? getStateDb();
  const reports = closedPaneReports({
    reviews,
    executors,
    authorOf: url => authors.get(url),
    self: current.self,
    reported: listKvValues(CLOSED_REPORTED_NS, stateDb),
    nudges: io.readNudges(),
    now: Date.now(),
  });
  for (const report of reports) {
    stateDb.transaction(() => {
      enqueueOutbox(
        makeEnvelope(report.to, 'review-state', report.payload),
        stateDb
      );
      setKvValue(
        CLOSED_REPORTED_NS,
        report.mrUrl,
        report.runStartedAt,
        stateDb
      );
    })();
  }
  if (reports.length) io.kickOutbox(current.client);
}

export function pruneClosedPaneMarkers(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const stale = [...listKvValues(CLOSED_REPORTED_NS, db).keys()].filter(
    url => !keepUrls.has(url)
  );
  if (stale.length === 0) return;
  persistOrWarn('closed pane marker prune', () => {
    db.transaction(() => {
      for (const url of stale) deleteKvValue(CLOSED_REPORTED_NS, url, db);
    })();
  });
}
