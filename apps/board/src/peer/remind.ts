/** The parked band's Remind: one Slack DM from the MR author to the reviewer
    whose review waits at their own approval gate. Click-only; nothing is
    sent to the reviewer's board. */
import type { BoardMR } from '../data.ts';
import { mrRef } from '../mr-ref.ts';
import { canonicalUsername } from './envelope.ts';
import { isFreshPeerReview } from './presence.ts';

/** The stored peer state's fields this reads; the board client imports this
    module, so it stays clear of the db-backed one. */
export interface RemindablePeer {
  status: string;
  updatedAt: number;
  receivedAt?: number;
  dismissedAt?: number;
  remindedAt?: number;
}

export const REMIND_EVERY_MS = 15 * 60_000;

export interface RemindMr {
  /** The name the author's board shows for its own user. */
  author: string;
  iid: number;
  title: string;
  webUrl: string;
  provider?: BoardMR['provider'];
}

export interface RemindDeps {
  peerReview(mrUrl: string, reviewer: string): RemindablePeer | undefined;
  mr(mrUrl: string): Promise<RemindMr | undefined>;
  /** Keyed by canonical username (see `foldSlackMatch`). */
  slackIdFor(reviewer: string): string | undefined;
  /** The daemon adds the persona prefix. */
  sendDm(userId: string, text: string): Promise<DmResult>;
  markReminded(mrUrl: string, reviewer: string, at: number): void;
  now(): number;
}

/** `maybeSent`: the daemon timed out, so Slack may already have the DM. */
export type DmResult =
  { ok: true } | { ok: false; message: string; maybeSent?: true };

export type RemindResult =
  | { status: 200; body: { remindedAt: number } }
  | { status: 409; body?: { retryAt: number } }
  | { status: 502; body: { maybeSent: true; remindedAt: number } }
  | { status: 404 | 422 | 502; message: string };

/** rt-client folds a fetch abort into its "unreachable" error, so the
    timeout shows only as the AbortSignal's message at the end. */
export function isDaemonTimeout(error: string | undefined): boolean {
  return (
    !!error &&
    error.startsWith('rt daemon unreachable at ') &&
    error.endsWith(': The operation timed out.')
  );
}

export function remindText(mr: RemindMr): string {
  return `${mr.author} is waiting on your review of ${mrRef(mr)} (${mr.title}). It's parked at your approval gate: ${mr.webUrl}`;
}

export function remindRetryAt(remindedAt: number | undefined): number | null {
  return remindedAt === undefined ? null : remindedAt + REMIND_EVERY_MS;
}

export function createReminder(deps: RemindDeps) {
  const sending = new Set<string>();
  return async function remind(
    mrUrl: string,
    reviewer: string
  ): Promise<RemindResult> {
    const now = deps.now();
    const peer = deps.peerReview(mrUrl, reviewer);
    if (
      !peer ||
      peer.status !== 'parked' ||
      peer.dismissedAt !== undefined ||
      !isFreshPeerReview(peer, now)
    )
      return { status: 422, message: `${reviewer}'s review is not parked` };
    const retryAt = remindRetryAt(peer.remindedAt);
    if (retryAt !== null && now < retryAt)
      return { status: 409, body: { retryAt } };
    const userId = deps.slackIdFor(canonicalUsername(reviewer));
    if (!userId)
      return { status: 422, message: `no Slack match for ${reviewer}` };
    const key = `${mrUrl}\n${reviewer}`;
    if (sending.has(key)) return { status: 409 };
    sending.add(key);
    try {
      const mr = await deps.mr(mrUrl);
      if (!mr) return { status: 404, message: 'that MR is not on the board' };
      const sent = await deps.sendDm(userId, remindText(mr));
      if (!sent.ok && !sent.maybeSent)
        return { status: 502, message: sent.message };
      const remindedAt = deps.now();
      deps.markReminded(mrUrl, reviewer, remindedAt);
      return sent.ok
        ? { status: 200, body: { remindedAt } }
        : { status: 502, body: { maybeSent: true, remindedAt } };
    } finally {
      sending.delete(key);
    }
  };
}
