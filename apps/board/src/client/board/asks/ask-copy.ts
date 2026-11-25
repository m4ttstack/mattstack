import { mrRef, type MrLinkTarget } from '../../../mr-ref.ts';
import type { AskCardData, AskKind } from '../../types.ts';

const ASKED: Record<AskKind, string> = {
  review: 'asked for a review',
  're-review': 'asked for a follow-up review',
  respond: 'asked your agent to respond',
};

const VERB: Record<AskKind, string> = {
  review: 'Review',
  're-review': 'Follow-up review',
  respond: 'Respond',
};

const DONE: Record<AskKind, string> = {
  review: 'reviewed',
  're-review': 'followed up',
  respond: 'responded',
};

const DOING: Record<AskKind, string> = {
  review: 'is reviewing',
  're-review': 'is following up on',
  respond: 'is responding on',
};

/** Where an ask's words would be, when this Mac has not opened them. They may
    be only the title and branch, so neither line speaks of a note. */
export const TEXT_STATE_COPY = {
  pending: 'Opening…',
  unreadable: "This Mac couldn't open the details",
} as const;

type NoteReason = 'no-key' | 'unavailable';

export const whyNoNote = (why: NoteReason, first: string) =>
  why === 'no-key'
    ? `${first} can't receive notes yet`
    : 'this Mac could not lock it';

/** Why a person's note did not go with their ask or their decline. */
export function noteNotSent(
  what: 'Sent' | 'Queued' | 'Declined',
  why: NoteReason,
  first: string
): string {
  const reason =
    why === 'no-key' ? whyNoNote(why, first) : 'This Mac could not lock it';
  return `${what} without your note. ${reason}.`;
}

/** What the card says the asker did, after their name. */
export function askedPhrase(kind: AskKind): string {
  return ASKED[kind];
}

/** The card's go-ahead button label. */
export function verbLabel(kind: AskKind): string {
  return VERB[kind];
}

/** The agent lane whose colour the go-ahead button wears. */
export function verbLane(kind: AskKind): 'review' | 'respond' {
  return kind === 'respond' ? 'respond' : 'review';
}

export type OutcomeTone = 'ok' | 'quiet' | 'warn';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A handled ask's outcome as history shows it. */
export function historyOutcome(view: Pick<AskCardData, 'kind' | 'handled'>): {
  text: string;
  tone: OutcomeTone;
} {
  const h = view.handled;
  if (h?.result === 'expired')
    return { text: 'expired, no answer in 48h', tone: 'warn' };
  if (h?.result === 'rejected') {
    if (h.declined)
      return {
        text: h.reason ? `declined: ${h.reason}` : 'declined',
        tone: 'quiet',
      };
    return {
      text: h.reasonText ? `skipped: ${lowerFirst(h.reasonText)}` : 'skipped',
      tone: 'quiet',
    };
  }
  const done = DONE[view.kind];
  return {
    text: h?.reason === 'always-allowed' ? `${done} • always allowed` : done,
    tone: 'ok',
  };
}

/** The one line a card shrinks to after its go-ahead starts the agent. */
export function confirmLine(kind: AskKind, mr: MrLinkTarget): string {
  return `Your agent ${DOING[kind]} ${mrRef(mr)}`;
}
