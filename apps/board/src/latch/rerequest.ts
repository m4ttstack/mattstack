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
import { deleteKvValue, listKvValues, setKvValue } from '../state/kv-blob.ts';
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

export interface ReRequestDeps {
  /** The team record's forge username: the login the daemon must sign in as. */
  self: string;
  forge: ForgeKind;
  command?: typeof rtCommand;
  db?: Database;
  log?: (line: string) => void;
  /** Overrides the identity check, for a caller that also audits a mismatch. */
  verify?: (repoName: string, mr: BoardMR) => Promise<boolean>;
}

export async function sendReReviewRequests(
  mrs: BoardMR[],
  deps: ReRequestDeps
): Promise<void> {
  if (deps.forge !== 'github') return;
  const db = deps.db ?? getStateDb();
  const command = deps.command ?? rtCommand;
  const log = deps.log ?? (line => console.error(line));
  const verify =
    deps.verify ??
    (async (repoName: string) => {
      const verdict = await verifyLatchIdentity(repoName, deps.self, {
        command,
        db,
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
      setKvValue(LATCH_REREQUEST_NS, key, { at: Date.now() }, db);
    if (plan.send.length === 0) continue;

    const repoName = repoIdentityField(mr.rtRepo);
    if (!repoName) {
      log(`re-request skipped for ${mrUrl}: no repo identity`);
      continue;
    }
    if (!verified.has(repoName)) verified.set(repoName, verify(repoName, mr));
    if (!(await verified.get(repoName))) continue;

    const res = await command(
      'mr:action',
      { repoName, iid: mr.iid, action: 'requestReReview', args: [plan.send] },
      { timeoutMs: FORGE_WRITE_TIMEOUT_MS }
    ).catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    const who = plan.send.join(', ');
    if (!res.ok && !(res.error ?? '').startsWith(DAEMON_UNREACHABLE_PREFIX)) {
      log(
        `re-request of ${who} on ${mrUrl} refused: ${forgeReason(res.error ?? '') || 'no reason given'}`
      );
      continue;
    }
    if (!res.ok)
      log(`re-request of ${who} on ${mrUrl} unanswered; it may still apply`);
    const sent = new Set(plan.send);
    for (const r of requests)
      if (r.requested && sent.has(r.reviewer))
        setKvValue(
          LATCH_REREQUEST_NS,
          keyOf(mrUrl, r.discussionId),
          { at: Date.now() },
          db
        );
  }
}
