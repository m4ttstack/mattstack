/** What the help button and its card say about a request, as data. */
import type { SupportPart } from '@mattstack/rt-client';
import type { SupportAvailability, SupportRequests } from '../../../support.ts';

export type HelpRequest = SupportRequests[number];
export type Tone = 'work' | 'wait' | 'ok' | 'bad';
export type CardIcon = 'spin' | 'check' | 'clock' | 'moon' | 'x';

export type CardAction =
  | { kind: 'open-slack'; href: string }
  | { kind: 'message-host' }
  | { kind: 'ask-again' }
  | { kind: 'try-again' }
  | { kind: 'show-it' };

export interface Card {
  icon: CardIcon;
  tone: Tone;
  title: string;
  detail?: string;
  action?: CardAction;
}

const OPEN = new Set<HelpRequest['state']>([
  'sent',
  'received',
  'opening',
  'waiting',
]);

/** rt-client's SUPPORT_TEXT_MAX, which the browser cannot import;
    support-model.test.ts holds the two together. */
export const TEXT_MAX = 8000;

/** A settled request older than this is history, not news. */
const NEWS_MS = 24 * 60 * 60_000;

export const isOpen = (r: HelpRequest) => OPEN.has(r.state);

/** The request the button speaks for: one still going, else the newest
    settled one nobody has looked at yet. */
export function currentRequest(
  requests: readonly HelpRequest[],
  seen: ReadonlySet<string>,
  now: number
): HelpRequest | null {
  const newest = [...requests].sort((a, b) => b.sentAt - a.sentAt);
  return (
    newest.find(isOpen) ??
    newest.find(r => !seen.has(r.id) && now - r.updatedAt < NEWS_MS) ??
    null
  );
}

/** A host's link is followed only into Slack. */
export function slackLink(link: string | null): string | null {
  return link && /^(slack:\/\/|https:\/\/([a-z0-9-]+\.)*slack\.com\/)/.test(link)
    ? link
    : null;
}

export const firstName = (host: string) => host.trim().split(/\s+/)[0] ?? host;

const openSlack = (r: HelpRequest): CardAction | undefined => {
  const href = slackLink(r.dmLink);
  return href ? { kind: 'open-slack', href } : undefined;
};

export function requestCard(
  r: HelpRequest,
  host: string,
  persona: string,
  others: readonly HelpRequest[]
): Card {
  const bot = r.persona ?? persona;
  const direct = `Message ${host} directly`;
  switch (r.state) {
    case 'sent':
      return r.away
        ? {
            icon: 'moon',
            tone: 'wait',
            title: `${host}'s Mac is away`,
            detail: 'Your request will wait up to 7 days',
          }
        : { icon: 'spin', tone: 'work', title: `Asked ${host}'s agent` };
    case 'received':
    case 'opening':
      return {
        icon: 'spin',
        tone: 'work',
        title: `${bot} is starting`,
        detail: `${host}'s Mac has it`,
      };
    case 'waiting':
      return {
        icon: 'clock',
        tone: 'wait',
        title: `${host} needs to OK this one`,
        detail: 'It will wait',
      };
    case 'already-waiting':
      return {
        icon: 'clock',
        tone: 'wait',
        title: 'You already have a request waiting',
        ...(others.some(o => o.id !== r.id && isOpen(o))
          ? { action: { kind: 'show-it' } as const }
          : {}),
      };
    case 'opened':
      return {
        icon: 'check',
        tone: 'ok',
        title: `${bot} messaged you in Slack`,
        action: openSlack(r),
      };
    case 'already-open':
      return {
        icon: 'check',
        tone: 'ok',
        title: 'You already have a chat open',
        action: openSlack(r),
      };
    case 'declined':
      return {
        icon: 'x',
        tone: 'bad',
        title: `${host} declined this one`,
        detail: direct,
        action: { kind: 'message-host' },
      };
    case 'not-accepting':
      return {
        icon: 'x',
        tone: 'bad',
        title: `${host} isn't taking requests`,
        detail: direct,
        action: { kind: 'message-host' },
      };
    case 'failed':
      return {
        icon: 'x',
        tone: 'bad',
        title: "Your request didn't open",
        detail: r.reason ?? direct,
        action: { kind: 'message-host' },
      };
    case 'expired':
      return {
        icon: 'x',
        tone: 'bad',
        title: 'It was never picked up after 7 days',
        detail: `Ask again, or message ${host}`,
        action: { kind: 'ask-again' },
      };
  }
}

export interface SendError {
  code: string;
  message: string;
}

/** A send rt turned down, or never answered. */
export function sendErrorCard(
  err: SendError,
  host: string,
  waiting: boolean
): Card {
  switch (err.code) {
    case 'support-already-waiting':
      return {
        icon: 'clock',
        tone: 'wait',
        title: 'You already have a request waiting',
        ...(waiting ? { action: { kind: 'show-it' } as const } : {}),
      };
    case 'support-not-accepting':
      return {
        icon: 'x',
        tone: 'bad',
        title: `${host} isn't taking requests`,
        detail: `Message ${host} directly`,
        action: { kind: 'message-host' },
      };
    case 'support-unreachable':
      return {
        icon: 'x',
        tone: 'bad',
        title: 'Nothing was sent',
        detail: 'The relay did not answer',
        action: { kind: 'try-again' },
      };
    case 'support-slack':
      return {
        icon: 'x',
        tone: 'bad',
        title: 'Nothing was sent',
        detail: 'Slack did not answer',
        action: { kind: 'try-again' },
      };
    case 'support-changed':
      return {
        icon: 'x',
        tone: 'bad',
        title: 'Your first version was already sent',
        detail: 'That is the one they will read',
      };
    case 'no-answer':
      return {
        icon: 'x',
        tone: 'bad',
        title: 'rt did not answer',
        detail: 'Trying again never sends it twice',
        action: { kind: 'try-again' },
      };
    default:
      return {
        icon: 'x',
        tone: 'bad',
        title: 'Nothing was sent',
        detail: err.message.replace(/\.$/, ''),
        action: { kind: 'try-again' },
      };
  }
}

export interface Pill {
  tone: Tone | 'rest';
  label: string;
  href?: string;
}

export function pill(
  r: HelpRequest | null,
  host: string,
  persona: string
): Pill {
  if (!r) return { tone: 'rest', label: 'Need help?' };
  const bot = r.persona ?? persona;
  switch (r.state) {
    case 'sent':
      return r.away
        ? { tone: 'wait', label: `Waiting for ${host}` }
        : { tone: 'work', label: `Asked ${host}'s agent` };
    case 'received':
    case 'opening':
      return { tone: 'work', label: `${bot} is starting` };
    case 'waiting':
    case 'already-waiting':
      return { tone: 'wait', label: `Waiting for ${host}` };
    case 'opened':
    case 'already-open': {
      const href = slackLink(r.dmLink);
      return {
        tone: 'ok',
        label: `${bot} is in Slack`,
        ...(href ? { href } : {}),
      };
    }
    default:
      return { tone: 'bad', label: "Request didn't open" };
  }
}

export function whoAnswers(host: string, away: boolean): string {
  return away ? `${host}'s Mac is away` : `${host}'s Mac answers in Slack`;
}

export const hostOf = (a: SupportAvailability) =>
  a.state === 'hidden' ? '' : firstName(a.host);

export interface HelpMr {
  url: string;
  /** "!1374" */
  ref: string;
  state: string;
}

/** A chip's few words; the whole value is its tip. */
export function partLabel(part: SupportPart, mr: HelpMr | null): string {
  switch (part.key) {
    case 'setup':
      return `Setup: ${part.value}`;
    case 'mr':
      return mr ? [mr.ref, mr.state].filter(Boolean).join(', ') : part.label;
    default:
      return part.label;
  }
}

const PART_ORDER = ['mr', 'versions', 'setup'];

export const byPartOrder = (a: SupportPart, b: SupportPart) =>
  PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key);
