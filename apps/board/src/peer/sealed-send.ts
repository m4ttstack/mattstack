import {
  activeTeam,
  type SealBinding,
  type SealFields,
  type SealResult,
  type textSeal,
} from '@mattstack/rt-client';
import {
  buildAskDraft,
  canonicalUsername,
  HELD_REASON,
  makeEnvelope,
  type AskKind,
  type DraftEnvelope,
  type NudgeOutcomePayload,
  type ReReviewRequestPayload,
  type ReviewStatePayload,
} from './envelope.ts';
import { reviewSyncEnvelopes } from './presence.ts';
import {
  askBinding,
  outcomeBinding,
  reviewStateBinding,
  WIRE_REASONS,
} from './sealed.ts';

/** Only the seal's own answer is read, so a test needs no daemon. */
export type SealText = (
  ...args: Parameters<typeof textSeal>
) => Promise<{ ok: boolean; data?: SealResult }>;

export interface SealDeps {
  seal: SealText;
  /** This board's username on the relay, which the relay stamps on what it
      sends; null when the board does not know it. */
  self(): string | null;
}

/** Why a person's words did not go with their message. */
export type NoteReason = 'no-key' | 'unavailable';

export interface Sealing {
  sealed?: string;
  /** There was text, and none of it can go. */
  unsent: boolean;
  /** Who cannot read it, as canonical usernames. */
  unreachable: string[];
}

/** The username join registers this board under, and `rt team peer` unless the
    org's forge login had to stand in for both. */
export function peerUsername(defaultMember: string): string | null {
  const recorded = activeTeam().username;
  if (recorded !== null) return recorded;
  return defaultMember && defaultMember !== 'all' ? defaultMember : null;
}

/** Never throws: text that cannot be sealed is left out, never sent plain. */
export async function sealFields(
  deps: Pick<SealDeps, 'seal'>,
  to: readonly string[],
  binding: SealBinding,
  fields: SealFields
): Promise<Sealing> {
  if (Object.keys(fields).length === 0)
    return { unsent: false, unreachable: [] };
  try {
    const { ok, data } = await deps.seal({ to: [...to], binding, fields });
    if (ok && data?.ok)
      return {
        sealed: data.sealed,
        unsent: false,
        unreachable: data.unreachable,
      };
    return {
      unsent: true,
      unreachable:
        ok && data?.ok === false && data.reason === 'no-recipients'
          ? to.map(canonicalUsername)
          : [],
    };
  } catch {
    return { unsent: true, unreachable: [] };
  }
}

async function sealAs(
  deps: SealDeps,
  to: readonly string[],
  binding: (self: string) => SealBinding,
  fields: SealFields
): Promise<Sealing> {
  if (Object.keys(fields).length === 0)
    return { unsent: false, unreachable: [] };
  const self = deps.self();
  return self === null
    ? { unsent: true, unreachable: [] }
    : sealFields(deps, to, binding(self), fields);
}

/** `sealing` was for one person. */
function unsentWhy(sealing: Sealing): NoteReason | undefined {
  if (!sealing.unsent) return undefined;
  return sealing.unreachable.length > 0 ? 'no-key' : 'unavailable';
}

/** The fields that hold any text. */
function given(fields: Record<string, string | undefined>): SealFields {
  return Object.fromEntries(
    Object.entries(fields).filter((e): e is [string, string] => !!e[1])
  );
}

const sealedField = (s: Sealing) => (s.sealed ? { sealed: s.sealed } : {});

export async function sealedAsk(
  deps: SealDeps,
  reviewer: string,
  kind: AskKind,
  facts: Pick<ReReviewRequestPayload, 'mrUrl' | 'iid'>,
  text: { title?: string; sourceBranch?: string; note?: string }
): Promise<{ draft: DraftEnvelope; unsentWhy?: NoteReason }> {
  const draft = buildAskDraft(reviewer, kind, facts);
  const { type, id } = draft;
  const sealing = await sealAs(
    deps,
    [draft.to],
    from => askBinding({ type, from, id }, facts.mrUrl),
    given({
      title: text.title,
      sourceBranch: text.sourceBranch,
      note: text.note,
    })
  );
  const why = unsentWhy(sealing);
  return {
    draft: {
      ...draft,
      payload: {
        mrUrl: facts.mrUrl,
        iid: facts.iid,
        ...sealedField(sealing),
      } satisfies ReReviewRequestPayload,
    },
    ...(why ? { unsentWhy: why } : {}),
  };
}

export interface PreparedOutcome {
  /** Why the person's note does not go with it; absent when it does or there
      is none. */
  noteReason?: NoteReason;
  /** Queues it, at once. */
  send(): void;
}

/** An ask's outcome with its text sealed, ready to queue: sealing waits on the
    daemon, and a caller that must record and send together prepares first. */
export function outcomePreparer(
  deps: SealDeps,
  enqueue: (draft: DraftEnvelope) => void
): (to: string, p: NudgeOutcomePayload) => Promise<PreparedOutcome> {
  return async (to, { reason, declineNote, sealed: _, ...facts }) => {
    const fixed = reason !== undefined && WIRE_REASONS.has(reason);
    const recipient = canonicalUsername(to);
    const sealing = await sealAs(
      deps,
      [recipient],
      from => outcomeBinding(from, facts.mrUrl, facts.nudgeId),
      given({ reason: fixed ? undefined : reason, declineNote })
    );
    const noteReason = declineNote ? unsentWhy(sealing) : undefined;
    return {
      ...(noteReason ? { noteReason } : {}),
      send: () =>
        enqueue(
          makeEnvelope(recipient, 'nudge-outcome', {
            ...facts,
            ...(fixed ? { reason } : {}),
            ...sealedField(sealing),
          } satisfies NudgeOutcomePayload)
        ),
    };
  };
}

/** For an outcome with no note of a person's, which nothing waits to hear. */
export function outcomePublisher(
  prepare: ReturnType<typeof outcomePreparer>
): (to: string, p: NudgeOutcomePayload) => Promise<void> {
  return async (to, p) => (await prepare(to, p)).send();
}

/** `reviewSyncEnvelopes` with the reason sealed once for everyone told. A
    reason that cannot be sealed is dropped, but an error still says it was a
    hold: without that it reads as an agent that failed. */
export async function sealedReviewSyncEnvelopes(
  deps: SealDeps,
  input: Parameters<typeof reviewSyncEnvelopes>[0]
): Promise<DraftEnvelope[]> {
  const { reason, sealed: _, ...facts } = input.payload;
  const fixed = reason !== undefined && WIRE_REASONS.has(reason);
  const said = fixed
    ? reason
    : reason && facts.status === 'error'
      ? HELD_REASON
      : undefined;
  const plain: ReviewStatePayload = said ? { ...facts, reason: said } : facts;
  const envelopes = reviewSyncEnvelopes({ ...input, payload: plain });
  if (fixed || !reason || envelopes.length === 0) return envelopes;
  const sealing = await sealAs(
    deps,
    envelopes.map(e => e.to),
    from => reviewStateBinding(from, facts),
    { reason }
  );
  return envelopes.map(e => ({
    ...e,
    payload: {
      ...(e.payload as ReviewStatePayload),
      ...sealedField(sealing),
    },
  }));
}

/** What a row queued by an older board may still send. */
export function stripPlainText(d: DraftEnvelope): DraftEnvelope {
  if (!d.payload || typeof d.payload !== 'object') return d;
  const { title, sourceBranch, note, declineNote, reason, ...facts } =
    d.payload as Record<string, unknown>;
  return {
    ...d,
    payload: {
      ...facts,
      ...(typeof reason === 'string' && WIRE_REASONS.has(reason)
        ? { reason }
        : {}),
    },
  };
}
