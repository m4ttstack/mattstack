import type { AskCardData, AskKind } from '../../types.ts';

const ASKED: Record<AskKind, string> = {
  review: 'asked for a review',
  're-review': 'asked for a re-review',
  respond: 'asked your agent to respond',
};

const VERB: Record<AskKind, string> = {
  review: 'Review',
  're-review': 'Re-review',
  respond: 'Respond',
};

const DONE: Record<AskKind, string> = {
  review: 'reviewed',
  're-review': 're-reviewed',
  respond: 'responded',
};

const DOING: Record<AskKind, string> = {
  review: 'is reviewing',
  're-review': 'is re-reviewing',
  respond: 'is responding on',
};

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

/** "Rae" from the roster's "Rae Marlow", else the username capitalized. */
export function firstName(fromName: string | undefined, from: string): string {
  const name = fromName?.trim().split(/\s+/)[0];
  if (name) return name;
  return from.charAt(0).toUpperCase() + from.slice(1);
}

export type OutcomeTone = 'ok' | 'quiet' | 'warn';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A handled ask's outcome as history shows it. */
export function historyOutcome(
  view: Pick<AskCardData, 'kind' | 'handled'>
): { text: string; tone: OutcomeTone } {
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
    text:
      h?.reason === 'always-allowed' ? `${done} · always allowed` : done,
    tone: 'ok',
  };
}

/** The one line a card shrinks to after its go-ahead starts the agent. */
export function confirmLine(kind: AskKind, iid: number): string {
  return `Your agent ${DOING[kind]} !${iid}`;
}
