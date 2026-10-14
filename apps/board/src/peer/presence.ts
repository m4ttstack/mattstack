import {
  canonicalUsername,
  makeEnvelope,
  type DraftEnvelope,
  type ReviewStatePayload,
} from './envelope.ts';

/** Past this, a reviewing state whose board went quiet stops counting:
    nothing else retires a review whose board went offline mid-run. */
export const PEER_REVIEW_STALE_MS = 2 * 60 * 60 * 1000;

export function reviewPresenceRecipients(input: {
  orgMembers: readonly string[];
  self: string;
  author: string;
  enrolled: readonly string[] | null;
}): string[] {
  const author = canonicalUsername(input.author);
  const self = canonicalUsername(input.self);
  const enrolled = input.enrolled
    ? new Set(input.enrolled.map(canonicalUsername))
    : null;
  const out = [author];
  for (const raw of input.orgMembers) {
    const u = canonicalUsername(raw);
    if (!u || u === '*' || u === self || out.includes(u)) continue;
    if (enrolled && !enrolled.has(u)) continue;
    out.push(u);
  }
  return out;
}

export function presenceEnvelopes(
  recipients: readonly string[],
  author: string,
  payload: ReviewStatePayload,
  now: number = Date.now()
): DraftEnvelope[] {
  const authorKey = canonicalUsername(author);
  const { nudgeId, ...rest } = payload;
  return recipients.map(to =>
    makeEnvelope(
      to,
      'review-state',
      canonicalUsername(to) === authorKey && nudgeId
        ? { ...rest, nudgeId }
        : rest,
      now
    )
  );
}

/** Envelopes for one review transition: none for this board's own MR or when
    `self` is the "all" view setting, which is no identity. */
export function reviewSyncEnvelopes(input: {
  author: string | undefined;
  self: string;
  recipients: (author: string) => string[];
  payload: ReviewStatePayload;
  askId?: string | null;
  now?: number;
}): DraftEnvelope[] {
  if (!input.author || input.self === 'all') return [];
  if (canonicalUsername(input.author) === canonicalUsername(input.self))
    return [];
  return presenceEnvelopes(
    input.recipients(input.author),
    input.author,
    input.askId ? { ...input.payload, nudgeId: input.askId } : input.payload,
    input.now
  );
}

export function isFreshPeerReview(
  s: { status: string; updatedAt: number; receivedAt?: number },
  now: number
): boolean {
  if (s.status !== 'queued' && s.status !== 'reviewing') return false;
  return now - (s.receivedAt ?? s.updatedAt) <= PEER_REVIEW_STALE_MS;
}

export function activePeerReviewer(
  mr: {
    peerReviews?: ReadonlyArray<{
      reviewer: string;
      status: string;
      updatedAt: number;
      receivedAt?: number;
    }>;
  },
  self: string | null,
  now: number
): string | null {
  const me = self === null ? null : canonicalUsername(self);
  for (const p of mr.peerReviews ?? []) {
    if (me !== null && canonicalUsername(p.reviewer) === me) continue;
    if (isFreshPeerReview(p, now)) return p.reviewer;
  }
  return null;
}
