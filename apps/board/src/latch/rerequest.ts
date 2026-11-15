/**
 * The author's board re-requests a GitHub reviewer whose latch carries an
 * ask, so GitHub notifies them. The reviewer's own board cannot: GitHub does
 * not notify anyone of their own act. One request per reviewer per request
 * cycle, remembered in kv under `<mrUrl>|<discussionId>`. A cycle's entry
 * outlives the cycle, marked over, because only a submitted review clears
 * GitHub's request: a request still pending from an earlier cycle notifies
 * no one when repeated, so it is removed and requested again (renewed).
 */
import type { Database } from 'bun:sqlite';

import { DAEMON_UNREACHABLE_PREFIX, rtCommand } from '@mattstack/rt-client';
import { repoIdentityField } from '../config.ts';
import type { BoardMR } from '../data.ts';
import { FORGE_WRITE_TIMEOUT_MS, forgeReason } from '../forge-writes.ts';
import type { ForgeKind } from '../mr-ref.ts';
import { getStateDb } from '../state/index.ts';
import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from '../state/kv-blob.ts';
import type { ReviewerRequest } from './discussions.ts';
import { identityMismatchLine, verifyLatchIdentity } from './identity.ts';

export const LATCH_REREQUEST_NS = 'latch-rerequest';

export interface ReRequestPlan {
  /** Reviewer usernames to request on GitHub. */
  send: string[];
  /** Reviewer usernames whose request, pending from an earlier cycle, is
      removed and requested again. */
  renew: string[];
  /** Keys to record without a call: GitHub already holds this ask's request. */
  mark: string[];
  /** Keys whose request cycle is over while their thread stays live. */
  end: string[];
  /** Keys whose thread is spent or gone. */
  forget: string[];
}

/** A kv entry with no `over` is the current cycle's, as entries written
    before `over` existed read. */
export interface ReRequestMemo {
  at: number;
  over?: boolean;
}

const keyOf = (mrUrl: string, discussionId: string) =>
  `${mrUrl}|${discussionId}`;

const isLive = (memo: unknown) =>
  memo !== null &&
  memo !== undefined &&
  (memo as Partial<ReRequestMemo>).over !== true;

export function planReRequests(
  mrUrl: string,
  requests: ReviewerRequest[],
  reviewers: { username: string; reviewState: string | null }[],
  stored: ReadonlyMap<string, unknown>
): ReRequestPlan {
  const state = new Map(
    reviewers.map(r => [r.username.toLowerCase(), r.reviewState])
  );
  const threads = new Set<string>();
  const plan: ReRequestPlan = {
    send: [],
    renew: [],
    mark: [],
    end: [],
    forget: [],
  };
  for (const r of requests) {
    const key = keyOf(mrUrl, r.discussionId);
    threads.add(key);
    const memo = stored.get(key);
    if (!r.requested) {
      if (isLive(memo)) plan.end.push(key);
      continue;
    }
    if (isLive(memo)) continue;
    const pending = state.get(r.reviewer.toLowerCase()) === 'UNREVIEWED';
    if (!pending) plan.send.push(r.reviewer);
    else if (memo === undefined) plan.mark.push(key);
    else plan.renew.push(r.reviewer);
  }
  plan.forget = [...stored.keys()].filter(k => !threads.has(k));
  return plan;
}

/** How long a refused send or a failed identity check holds off its retry,
    so an error path costs no request per snapshot. */
export const REREQUEST_HOLD_MS = 60 * 60_000;

/** How old an entry for a PR this board no longer lists (merged, closed)
    may grow before it is deleted. Its thread can no longer be seen to end. */
export const REREQUEST_PRUNE_MS = 30 * 24 * 60 * 60_000;

/** In-process holds, kept for the board's lifetime across passes. */
export interface ReRequestHolds {
  /** repoName to the time its identity may be checked again. */
  identity: Map<string, number>;
  /** Memo key to the time its refused send may be retried. */
  refused: Map<string, number>;
}

export function createReRequestHolds(): ReRequestHolds {
  return { identity: new Map(), refused: new Map() };
}

const defaultHolds = createReRequestHolds();

export interface ReRequestDeps {
  /** The team record's forge username: the login the daemon must sign in as. */
  self: string;
  forge: ForgeKind;
  command?: typeof rtCommand;
  db?: Database;
  log?: (line: string) => void;
  now?: () => number;
  holds?: ReRequestHolds;
  /** Overrides the identity check, for a caller that also audits a mismatch. */
  verify?: (repoName: string, mr: BoardMR) => Promise<boolean>;
}

const held = (holds: Map<string, number>, key: string, now: number) =>
  (holds.get(key) ?? 0) > now;

export async function sendReReviewRequests(
  mrs: BoardMR[],
  deps: ReRequestDeps
): Promise<void> {
  if (deps.forge !== 'github') return;
  const db = deps.db ?? getStateDb();
  const command = deps.command ?? rtCommand;
  const log = deps.log ?? (line => console.error(line));
  const now = deps.now ?? Date.now;
  const holds = deps.holds ?? defaultHolds;
  const verify =
    deps.verify ??
    (async (repoName: string) => {
      const verdict = await verifyLatchIdentity(repoName, deps.self, {
        command,
        db,
        now,
      });
      if (!verdict.ok)
        log(identityMismatchLine(repoName, deps.self, verdict.login));
      return verdict.ok;
    });
  const verified = new Map<string, Promise<boolean>>();
  const stored = listKvValues(LATCH_REREQUEST_NS, db);
  const listed = mrs.flatMap(mr => (mr.webUrl ? [`${mr.webUrl}|`] : []));
  for (const [key, memo] of stored) {
    const at = (memo as Partial<ReRequestMemo> | null)?.at ?? 0;
    if (at >= now() - REREQUEST_PRUNE_MS) continue;
    if (listed.some(prefix => key.startsWith(prefix))) continue;
    deleteKvValue(LATCH_REREQUEST_NS, key, db);
  }

  for (const mr of mrs) {
    // Undefined means the discussions read failed: forgetting on it would
    // send the same ask again once the read recovers.
    if (!mr.webUrl || !mr.reviewerRequests) continue;
    const mrUrl = mr.webUrl;
    const requests = mr.reviewerRequests;
    const plan = planReRequests(
      mrUrl,
      requests,
      (mr.reviews.reviewers ?? []).map(r => ({
        username: r.username,
        reviewState: r.reviewState ?? null,
      })),
      new Map([...stored].filter(([k]) => k.startsWith(`${mrUrl}|`)))
    );
    for (const key of plan.forget) deleteKvValue(LATCH_REREQUEST_NS, key, db);
    for (const key of plan.end)
      setKvValue(LATCH_REREQUEST_NS, key, { at: now(), over: true }, db);
    for (const key of plan.mark)
      setKvValue(LATCH_REREQUEST_NS, key, { at: now() }, db);
    const keyFor = new Map(
      requests
        .filter(r => r.requested)
        .map(r => [r.reviewer, keyOf(mrUrl, r.discussionId)])
    );
    const due = (who: string[]) =>
      who.filter(w => !held(holds.refused, keyFor.get(w)!, now()));
    const batches = [
      { who: due(plan.send), renew: false },
      { who: due(plan.renew), renew: true },
    ].filter(b => b.who.length > 0);
    if (batches.length === 0) continue;

    const repoName = repoIdentityField(mr.rtRepo);
    if (!repoName) {
      log(`re-request skipped for ${mrUrl}: no repo identity`);
      continue;
    }
    if (held(holds.identity, repoName, now())) continue;
    if (!verified.has(repoName))
      verified.set(
        repoName,
        verify(repoName, mr).catch(() => false)
      );
    if (!(await verified.get(repoName))) {
      holds.identity.set(repoName, now() + REREQUEST_HOLD_MS);
      continue;
    }

    for (const batch of batches) {
      // Another pass may have sent while this one awaited.
      const send = batch.who.filter(
        w => !isLive(getKvValue(LATCH_REREQUEST_NS, keyFor.get(w)!, null, db))
      );
      if (send.length === 0) continue;
      const args: unknown[] = batch.renew ? [send, { renew: true }] : [send];
      const res = await command(
        'mr:action',
        { repoName, iid: mr.iid, action: 'requestReReview', args },
        { timeoutMs: FORGE_WRITE_TIMEOUT_MS }
      ).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));
      const who = send.join(', ');
      if (!res.ok && !(res.error ?? '').startsWith(DAEMON_UNREACHABLE_PREFIX)) {
        log(
          `re-request of ${who} on ${mrUrl} refused: ${forgeReason(res.error ?? '') || 'no reason given'}`
        );
        for (const reviewer of send)
          holds.refused.set(keyFor.get(reviewer)!, now() + REREQUEST_HOLD_MS);
        continue;
      }
      if (!res.ok)
        log(`re-request of ${who} on ${mrUrl} unanswered; it may still apply`);
      for (const reviewer of send)
        setKvValue(
          LATCH_REREQUEST_NS,
          keyFor.get(reviewer)!,
          { at: now() },
          db
        );
    }
  }
}
