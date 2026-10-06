import type { AskCardData, BoardData } from '../../types.ts';

/** Invented asks for the `Board/Asks` stories: R3's people and MRs. */

const FORGE = 'https://gitlab.example.com/acme/claims/-/merge_requests';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// The dropdown reads ages off the real clock, so the fixtures hang off it.
export const ASKS_NOW = Date.now();

const ask = (
  iid: number,
  from: string,
  fromName: string,
  kind: AskCardData['kind'],
  title: string,
  ageMs: number,
  extra: Partial<AskCardData> = {}
): AskCardData => ({
  id: `${from}/${iid}`,
  from,
  fromName,
  kind,
  mrUrl: `${FORGE}/${iid}`,
  iid,
  title,
  sourceBranch: `acme-${iid}-fixture`,
  receivedAt: ASKS_NOW - ageMs,
  ...extra,
});

export const RAE_ASK = ask(
  1388,
  'rae',
  'Rae Marlow',
  'review',
  'debounce the claim search input on slow networks',
  4 * MIN,
  { note: 'mostly the retry path in searchClient, the UI bits are trivial' }
);
export const TOM_ASK = ask(
  1391,
  'tom',
  'Tom Clearwater',
  're-review',
  'split the export worker so large batches stop timing out',
  22 * MIN
);
export const BEA_ASK = ask(
  1366,
  'bea',
  'Bea Finch',
  'respond',
  'cache the policy lookup in the quote flow',
  HOUR,
  { note: 'left four threads, two are blocking' }
);

const handled = (
  a: AskCardData,
  at: number,
  h: Omit<NonNullable<AskCardData['handled']>, 'at'>
): AskCardData => ({ ...a, handled: { at: ASKS_NOW - at, ...h } });

export const ASK_HISTORY: AskCardData[] = [
  handled(
    ask(1350, 'bea', 'Bea Finch', 'review', 'retry flaky uploads in the attachments step', 2 * HOUR),
    HOUR,
    { result: 'launched', reason: 'accepted' }
  ),
  handled(
    ask(1342, 'rae', 'Rae Marlow', 'review', 'move the audit log writer off the request path', 25 * HOUR),
    DAY,
    { result: 'launched', reason: 'always-allowed' }
  ),
  handled(
    ask(1336, 'tom', 'Tom Clearwater', 'respond', 'tidy the claim notes parser', 2 * DAY + HOUR),
    2 * DAY,
    { result: 'launched', reason: 'accepted' }
  ),
  handled(
    ask(1329, 'joel', 'Joel Vasquez', 're-review', 'rename the claim status enum to match the API', 2 * DAY + HOUR),
    2 * DAY,
    { result: 'rejected', declined: true, reason: 'busy right now' }
  ),
  handled(
    ask(1317, 'pia', 'Pia Quist', 'review', 'bump the PDF renderer and pin its fonts', 6 * DAY),
    4 * DAY,
    { result: 'expired', reason: 'stale', reasonText: 'No answer in 48h' }
  ),
];

type Asks = NonNullable<BoardData['asks']>;

export const THREE_WAITING: Asks = {
  pending: [RAE_ASK, TOM_ASK, BEA_ASK],
  history: ASK_HISTORY,
  alwaysAllow: ['rae', 'dani'],
};

export const NOTHING_WAITING: Asks = {
  pending: [],
  history: ASK_HISTORY,
  alwaysAllow: ['rae', 'dani'],
};

export const ROSTER_NAMES: ReadonlyMap<string, string> = new Map([
  ['rae', 'Rae Marlow'],
  ['tom', 'Tom Clearwater'],
  ['bea', 'Bea Finch'],
  ['dani', 'Dani Oliveira'],
  ['joel', 'Joel Vasquez'],
  ['pia', 'Pia Quist'],
]);
