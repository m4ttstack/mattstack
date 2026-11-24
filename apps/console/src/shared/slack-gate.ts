import type { GateRow } from '@mattstack/rt-client';

/** A `slack-open` gate expires this long after it opened, unless its meta says when. */
export const SLACK_GATE_TTL_MS = 30 * 60_000;
/** Under this many minutes left, the countdown reads as urgent. */
const URGENT_MINUTES = 5;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

export type SlackOrigin =
  | { from: 'pane'; pane: string }
  | { from: 'teammate' }
  | { from: 'app' }
  | { from: 'handle'; handle: string };

export interface SlackGateView {
  id: string;
  name: string;
  kind: 'new' | 'resume';
  brief: string;
  origin: SlackOrigin | null;
  openedAt: number;
  expiresAt: number;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The context the daemon writes opens with the person's name and a label
    for the text that follows; the row shows only that text. A teammate's
    request carries a fixed brief for the agent, so its row shows what they
    wrote. */
function briefOf(gate: GateRow, meta: Record<string, unknown>): string {
  const own = text(meta.triggerTs) ? undefined : text(meta.brief);
  if (own) return own;
  return (gate.context ?? '')
    .replace(/^Person:[^\n]*\n\n/, '')
    .replace(/^(Brief|Message):\n/, '')
    .trim();
}

function originOf(
  gate: GateRow,
  meta: Record<string, unknown>
): SlackOrigin | null {
  if (meta.action === 'support') return { from: 'app' };
  if (text(meta.triggerTs)) {
    return { from: 'teammate' };
  }
  const pane = text(gate.pane) ?? text(meta.requesterPane);
  if (pane) return { from: 'pane', pane };
  const handle = text(meta.requesterHandle);
  return handle ? { from: 'handle', handle } : null;
}

export function slackGateView(gate: GateRow): SlackGateView {
  const meta = gate.meta ?? {};
  return {
    id: gate.id,
    name: text(meta.personName) ?? gate.subject.replace(/^slack:/, ''),
    kind: meta.action === 'resume' ? 'resume' : 'new',
    brief: briefOf(gate, meta),
    origin: originOf(gate, meta),
    openedAt: gate.openedAt,
    expiresAt:
      typeof meta.expiresAt === 'number'
        ? meta.expiresAt
        : gate.openedAt + SLACK_GATE_TTL_MS,
  };
}

function duration(minutes: number): string {
  if (minutes >= DAY_MINUTES) return `${Math.floor(minutes / DAY_MINUTES)}d`;
  if (minutes >= HOUR_MINUTES) return `${Math.floor(minutes / HOUR_MINUTES)}h`;
  return `${minutes}m`;
}

export function agedLabel(openedAt: number, now: number): string {
  return `${duration(Math.max(0, Math.floor((now - openedAt) / MINUTE_MS)))} old`;
}

export function leftLabel(
  expiresAt: number,
  now: number
): { text: string; urgent: boolean } {
  const left = Math.max(0, Math.ceil((expiresAt - now) / MINUTE_MS));
  return { text: `${duration(left)} left`, urgent: left < URGENT_MINUTES };
}

/** What a teammate starts a message with to ask the bot back: the trigger
    setting when one is set, else the persona's name after an @. The
    setting's registry default supplies the persona, so there is no fallback
    here. */
export function personaTrigger(
  persona: { name: string },
  trigger?: string
): string {
  const words = trigger?.trim();
  return words ? words : `@${persona.name}`;
}

export function isExpired(view: Pick<SlackGateView, 'expiresAt'>, now: number) {
  return view.expiresAt <= now;
}
