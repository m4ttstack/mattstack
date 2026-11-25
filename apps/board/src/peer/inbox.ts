import type { Database } from 'bun:sqlite';

import {
  ANNOUNCEMENT_TYPE,
  parseAnnouncementPayload,
  type AnnouncementPayload,
} from '@mattstack/rt-client';
import type { SwitchboardClient } from './client.ts';
import {
  parseNudgeOutcomePayload,
  parseReReviewRequestPayload,
  parseReviewStatePayload,
  type Envelope,
  type NudgeResult,
} from './envelope.ts';
import type { NudgeState, SentNudgeResolution } from './nudges.ts';
import { drainOutbox } from './outbox.ts';
import type { PeerReviewState } from './peer-reviews.ts';
import {
  ANNOUNCEMENT_MAX_AGE_MS,
  type KeptAnnouncement,
} from './sealed-announcements.ts';
import { outcomeBinding, reviewStateBinding, WIRE_REASONS } from './sealed.ts';

export interface MaterializeDeps {
  isOrgAdmin(username: string): boolean;
  /** A shared id means a redelivery replaces the banner rather than stacking; the sound can still replay. */
  notifyAnnouncement(
    id: string,
    payload: AnnouncementPayload,
    from: string
  ): Promise<void>;
  keepAnnouncement(a: KeptAnnouncement): void;
  /** Tries the kept announcements; runs at the end of every tick. */
  openAnnouncements?: () => Promise<void>;
  writePeerReview(s: PeerReviewState): unknown;
  writeNudge(n: NudgeState): void;
  resolveSentNudge(
    mrUrl: string,
    resolution: Omit<SentNudgeResolution, 'result' | 'outcome'> & {
      result: NudgeResult | 'confirmed' | 'parked';
    },
    /** Who sent the report: only the teammate that was asked can answer. */
    from?: string,
    nudgeId?: string
  ): void;
  finishSentNudge(
    mrUrl: string,
    finish: Pick<
      SentNudgeResolution,
      'outcome' | 'reason' | 'at' | 'sealed' | 'sealedAs'
    > & { result: 'done' | 'failed' | 'stopped' },
    ifSentBefore: number,
    nudgeId?: string,
    from?: string
  ): void;
  log(line: string): void;
  /** Called once per tick that reached the relay: "unauthorized" on a 401
      inbox, "ok" on a fetch that came back. Lets the runtime track token
      health without the tick knowing what it is used for. */
  reportAuth?: (state: 'ok' | 'unauthorized') => void;
}

class NotKept extends Error {}

/** Beside sealed text a plain reason is one of the fixed ones; any other comes
    only from a board too old to seal. */
function plainReason(p: {
  reason?: string;
  sealed?: string;
}): string | undefined {
  return p.sealed && p.reason && !WIRE_REASONS.has(p.reason)
    ? undefined
    : p.reason;
}

/** The board's entire inbound involvement: materialize, never decide. Every
    branch ends ack-safe -- malformed or unknown envelopes are logged and
    dropped so a bad message can't wedge the inbox forever. */
export function materializeEnvelope(
  e: Envelope,
  deps: MaterializeDeps,
  now: number = Date.now()
): void | Promise<void> {
  if (e.type === 'review-state') {
    const p = parseReviewStatePayload(e.payload);
    if (!p)
      return deps.log(`peer: malformed review-state from ${e.from} (${e.id})`);
    const reason = plainReason(p);
    deps.writePeerReview({
      ...p,
      reason,
      reviewer: e.from,
      receivedAt: e.receivedAt,
    });
    // A reviewing transition confirms any pending sent nudge for this MR: the
    // re-review actually started, whichever of state/outcome lands first.
    if (p.status === 'queued' || p.status === 'reviewing') {
      deps.resolveSentNudge(p.mrUrl, { result: 'confirmed', at: now }, e.from);
    }
    // A park holds the ask at the reviewer's gate until the resumed pane
    // reports reviewing again.
    if (p.status === 'parked') {
      deps.resolveSentNudge(p.mrUrl, { result: 'parked', at: now }, e.from);
    }
    // The review ended: keep the ask on the row with its result, so the
    // asker can read it and dismiss or retry. A report echoing its ask's id
    // finishes only that ask; one without falls back to the report's own
    // updatedAt, so a redelivered pre-nudge report cannot finish an ask sent
    // after it.
    const finished =
      p.status === 'done'
        ? 'done'
        : p.status === 'error'
          ? 'failed'
          : p.status === 'stopped'
            ? 'stopped'
            : null;
    if (finished) {
      deps.finishSentNudge(
        p.mrUrl,
        {
          result: finished,
          ...(p.status === 'done' && p.outcome ? { outcome: p.outcome } : {}),
          ...(p.status !== 'done' && reason ? { reason } : {}),
          ...(p.status !== 'done' && p.sealed
            ? { sealed: p.sealed, sealedAs: reviewStateBinding(e.from, p) }
            : {}),
          at: now,
        },
        p.updatedAt,
        p.nudgeId,
        e.from
      );
    }
    return;
  }
  if (e.type === 'respond-state') {
    // The author's board telling the asker how the respond it asked for is
    // going. Mirrors review-state's chip mechanics exactly: any non-terminal
    // status confirms the ask; done and error finish it.
    const p = parseReviewStatePayload(e.payload);
    if (!p)
      return deps.log(`peer: malformed respond-state from ${e.from} (${e.id})`);
    if (p.status !== 'done' && p.status !== 'error') {
      deps.resolveSentNudge(p.mrUrl, { result: 'confirmed', at: now }, e.from);
    }
    if (p.status === 'done' || p.status === 'error') {
      deps.finishSentNudge(
        p.mrUrl,
        { result: p.status === 'done' ? 'done' : 'failed', at: now },
        p.updatedAt,
        p.nudgeId,
        e.from
      );
    }
    return;
  }
  if (
    e.type === 're-review-request' ||
    e.type === 'review-request' ||
    e.type === 'respond-request'
  ) {
    const p = parseReReviewRequestPayload(e.payload);
    if (!p)
      return deps.log(`peer: malformed ${e.type} from ${e.from} (${e.id})`);
    deps.writeNudge({
      id: e.id,
      mrUrl: p.mrUrl,
      iid: p.iid,
      from: e.from,
      // Sealed text replaces the plain fields, so only an older board's count.
      ...(p.sealed
        ? { sealed: p.sealed }
        : {
            note: p.note,
            ...(p.title ? { title: p.title } : {}),
            ...(p.sourceBranch ? { sourceBranch: p.sourceBranch } : {}),
          }),
      receivedAt: e.receivedAt,
      materializedAt: now,
      // Absence means re-review, so rows written before kinds existed keep
      // their meaning; only the newer ask flavors are marked.
      ...(e.type === 'review-request'
        ? { kind: 'review' as const }
        : e.type === 'respond-request'
          ? { kind: 'respond' as const }
          : {}),
    });
    return;
  }
  if (e.type === 'nudge-outcome') {
    const p = parseNudgeOutcomePayload(e.payload);
    if (!p)
      return deps.log(`peer: malformed nudge-outcome from ${e.from} (${e.id})`);
    deps.resolveSentNudge(
      p.mrUrl,
      {
        result: p.result,
        reason: plainReason(p),
        ...(p.declined ? { declined: true as const } : {}),
        ...(p.sealed
          ? {
              sealed: p.sealed,
              sealedAs: outcomeBinding(e.from, p.mrUrl, p.nudgeId),
            }
          : p.declineNote
            ? { declineNote: p.declineNote }
            : {}),
        at: now,
      },
      e.from,
      p.nudgeId
    );
    return;
  }
  if (e.type === ANNOUNCEMENT_TYPE) {
    const p = parseAnnouncementPayload(e.payload);
    if (!p)
      return deps.log(`peer: malformed announcement from ${e.from} (${e.id})`);
    if (now - e.receivedAt > ANNOUNCEMENT_MAX_AGE_MS)
      return deps.log(
        `peer: dropping stale announcement from ${e.from} (${e.id})`
      );
    if (!deps.isOrgAdmin(e.from))
      return deps.log(
        `peer: dropping announcement from ${e.from}, not an org admin (${e.id})`
      );
    if (p.sealed) {
      try {
        return deps.keepAnnouncement({
          id: e.id,
          from: e.from,
          // The relay's clock: one ahead of ours would never grow old.
          receivedAt: Math.min(e.receivedAt, now),
          sealed: p.sealed,
        });
      } catch (err) {
        throw new NotKept(String(err));
      }
    }
    return deps.notifyAnnouncement(e.id, p, e.from);
  }
  deps.log(
    `peer: ignoring unknown envelope type "${e.type}" from ${e.from} (${e.id})`
  );
}

/** One poll cycle: push what's queued, pull what's pending, materialize, ack.
    Runs on the board's 60s tick and once at startup. Best-effort throughout --
    a dead relay must never affect the board's own rendering, and this is
    called as `void runPeerTick(...)` from an interval, so it swallows and logs
    rather than rejecting into an unhandled rejection. Every fetched id is
    acked, malformed and unknown alike: they were logged, and leaving them
    pending would wedge the inbox forever. Only an announcement this board
    could not keep is left for the next tick. */
export async function runPeerTick(
  client: SwitchboardClient,
  deps: MaterializeDeps,
  outboxDb?: Database
): Promise<void> {
  await exchange(client, deps, outboxDb);
  try {
    await deps.openAnnouncements?.();
  } catch (err) {
    deps.log(
      `peer: announcements failed: ${err instanceof Error ? err.message : err}`
    );
  }
}

async function exchange(
  client: SwitchboardClient,
  deps: MaterializeDeps,
  outboxDb?: Database
): Promise<void> {
  try {
    await drainOutbox(d => client.publish(d), outboxDb);
    const envelopes = await client.inbox();
    // A 401 is a token problem, not a transient one: report it and stop, so
    // nothing is materialized or acked against a rejected token.
    if (envelopes === 'unauthorized') {
      deps.reportAuth?.('unauthorized');
      return;
    }
    if (!envelopes) return;
    deps.reportAuth?.('ok');
    const acks: string[] = [];
    for (const e of envelopes) {
      // Payload parse failures are already handled inside; this catches a
      // throwing store write (fs errors). One bad envelope must not skip the
      // batch's ack, or the batch redelivers and re-throws forever.
      try {
        await materializeEnvelope(e, deps);
        acks.push(e.id);
      } catch (err) {
        // An announcement is only on the relay until it is kept, and is dropped
        // as stale there after a day, so it cannot redeliver forever.
        if (!(err instanceof NotKept)) acks.push(e.id);
        deps.log(
          `peer: materialize failed for ${e.id} from ${e.from}: ${err instanceof Error ? err.message : err}`
        );
      }
    }
    await client.ack(acks);
  } catch (err) {
    deps.log(`peer: tick failed: ${err instanceof Error ? err.message : err}`);
  }
}
