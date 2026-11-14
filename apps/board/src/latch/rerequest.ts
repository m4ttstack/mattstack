/**
 * The author's board re-requests a GitHub reviewer whose latch carries an
 * ask, so GitHub notifies them. The reviewer's own board cannot: GitHub does
 * not notify anyone of their own act. One request per reviewer per request
 * cycle, remembered in kv under `<mrUrl>|<discussionId>`.
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
  /** Reviewer usernames to re-request on GitHub. */
  send: string[];
  /** Keys to record without a call: GitHub already holds the request. */
  mark: string[];
  /** Keys whose request cycle is over. */
  forget: string[];
}

const keyOf = (mrUrl: string, discussionId: string) =>
  `${mrUrl}|${discussionId}`;

export function planReRequests(
  mrUrl: string,
  requests: ReviewerRequest[],
  reviewers: { username: string; reviewState: string | null }[],
  sentKeys: string[]
): ReRequestPlan {
  const sent = new Set(sentKeys);
  const state = new Map(
    reviewers.map(r => [r.username.toLowerCase(), r.reviewState])
  );
  const asked = new Set<string>();
  const plan: ReRequestPlan = { send: [], mark: [], forget: [] };
  for (const r of requests) {
    if (!r.requested) continue;
    const key = keyOf(mrUrl, r.discussionId);
    asked.add(key);
    if (sent.has(key)) continue;
    if (state.get(r.reviewer.toLowerCase()) === 'UNREVIEWED')
      plan.mark.push(key);
    else plan.send.push(r.reviewer);
  }
  plan.forget = sentKeys.filter(k => !asked.has(k));
  return plan;
}

/** How long a refused send or a failed identity check holds off its retry,
    so an error path costs no request per snapshot. */
export const REREQUEST_HOLD_MS = 60 * 60_000;

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
  const stored = [...listKvValues(LATCH_REREQUEST_NS, db).keys()];

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
      stored.filter(k => k.startsWith(`${mrUrl}|`))
    );
    for (const key of plan.forget) deleteKvValue(LATCH_REREQUEST_NS, key, db);
    for (const key of plan.mark)
      setKvValue(LATCH_REREQUEST_NS, key, { at: now() }, db);
    const keyFor = new Map(
      requests
        .filter(r => r.requested)
        .map(r => [r.reviewer, keyOf(mrUrl, r.discussionId)])
    );
    const due = plan.send.filter(
      who => !held(holds.refused, keyFor.get(who)!, now())
    );
    if (due.length === 0) continue;

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

    // Another pass may have sent while this one awaited the identity check.
    const send = due.filter(
      who => getKvValue(LATCH_REREQUEST_NS, keyFor.get(who)!, null, db) === null
    );
    if (send.length === 0) continue;
    const res = await command(
      'mr:action',
      { repoName, iid: mr.iid, action: 'requestReReview', args: [send] },
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
      setKvValue(LATCH_REREQUEST_NS, keyFor.get(reviewer)!, { at: now() }, db);
  }
}
