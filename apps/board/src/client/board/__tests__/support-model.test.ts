import { describe, expect, test } from 'bun:test';

import { SUPPORT_TEXT_MAX } from '@mattstack/rt-client';
import {
  askedOf,
  byPartOrder,
  currentRequest,
  firstName,
  hostOf,
  partLabel,
  pill,
  requestCard,
  sendErrorCard,
  slackLink,
  TEXT_MAX,
  whoAnswers,
} from '../support/support-model.ts';
import {
  AWAY,
  DM,
  MR,
  MR_PART,
  NOBODY,
  NOW,
  READY,
  request,
  SETUP,
  VERSIONS,
} from '../support/support.fixtures.ts';

const DAY = 24 * 60 * 60_000;
const none = new Set<string>();

test("the box stops where rt's own limit does", () => {
  expect(TEXT_MAX).toBe(SUPPORT_TEXT_MAX);
});

describe('the request the button speaks for', () => {
  test('one still going wins over newer news', () => {
    const open = request('waiting', { sentAt: NOW - DAY });
    const news = request('declined', { sentAt: NOW });
    expect(currentRequest([news, open], none, NOW)).toBe(open);
  });

  test('else the one that settled last, for a day, and never an older one', () => {
    const old = request('opened', { id: 'old', updatedAt: NOW - 5 });
    const news = request('declined', { id: 'news', sentAt: NOW - 9 });
    const current = (seen: string[], now = NOW) =>
      currentRequest([old, news], new Set(seen), now);
    expect(current([])).toBe(news);
    expect(current(['news'])).toBe(null);
    expect(current([], NOW + DAY)).toBe(null);
    expect(currentRequest([], none, NOW)).toBe(null);
  });
});

describe("a request's card", () => {
  const direct = 'Message Alex directly';
  const cases: [
    Parameters<typeof request>,
    string,
    string | undefined,
    string | undefined,
  ][] = [
    [['sent'], "Asked Alex's agent", undefined, undefined],
    [
      ['sent', { away: true }],
      "Alex's Mac is away",
      'Your request will wait up to 7 days',
      undefined,
    ],
    [['received'], 'Maude is starting', "Alex's Mac has it", undefined],
    [['opening'], 'Maude is starting', "Alex's Mac has it", undefined],
    [['waiting'], 'Alex needs to OK this one', 'It will wait', undefined],
    [
      ['already-waiting'],
      'You already have a request waiting',
      undefined,
      undefined,
    ],
    [
      ['opened', { dmLink: DM }],
      'Maude messaged you in Slack',
      undefined,
      'open-slack',
    ],
    [['opened'], 'Maude messaged you in Slack', undefined, undefined],
    [
      ['already-open', { dmLink: DM }],
      'You already have a chat open',
      undefined,
      'open-slack',
    ],
    [['declined'], 'Alex declined this one', direct, 'message-host'],
    [['not-accepting'], "Alex isn't taking requests", direct, 'message-host'],
    [['failed'], "Your request didn't open", direct, 'message-host'],
    [
      ['failed', { reason: 'no Slack account' }],
      "Your request didn't open",
      'no Slack account',
      'message-host',
    ],
    [
      ['expired'],
      'It was never picked up after 7 days',
      'Ask again, or message Alex',
      'ask-again',
    ],
  ];
  for (const [args, title, detail, action] of cases)
    test(JSON.stringify(args), () => {
      const r = request(...args);
      const c = requestCard(r, 'Alex', 'Maude', [r]);
      expect([c.title, c.detail, c.action?.kind]).toEqual([
        title,
        detail,
        action,
      ]);
    });

  test('a duplicate offers the one still going', () => {
    const r = request('already-waiting');
    const action = (other: Parameters<typeof request>[0]) =>
      requestCard(r, 'Alex', 'Maude', [r, request(other)]).action?.kind;
    expect(action('waiting')).toBe('show-it');
    expect(action('declined')).toBeUndefined();
  });

  test('it names the agent the host answered as', () => {
    const r = request('received', { persona: 'Ada' });
    expect(requestCard(r, 'Alex', 'Maude', [r]).title).toBe('Ada is starting');
  });
});

describe('a refused send', () => {
  const say = (code: string, waiting = false) =>
    sendErrorCard({ code, message: 'Connect Slack first.' }, 'Alex', waiting);

  const cases: [string, string, string, string | undefined][] = [
    [
      'support-unreachable',
      'Nothing was sent',
      'The relay did not answer',
      'try-again',
    ],
    ['support-slack', 'Nothing was sent', 'Slack did not answer', 'try-again'],
    [
      'support-not-accepting',
      "Alex isn't taking requests",
      'Message Alex directly',
      'message-host',
    ],
    [
      'support-changed',
      'Your first version was already sent',
      'That is the one they will read',
      undefined,
    ],
    [
      'no-answer',
      'rt did not answer',
      'Trying again never sends it twice',
      'try-again',
    ],
    ['support-text', 'Nothing was sent', 'Connect Slack first', 'edit'],
    ['support-too-long', 'Nothing was sent', 'Connect Slack first', 'edit'],
    ['support-other', 'Nothing was sent', 'Connect Slack first', 'try-again'],
  ];
  for (const [code, title, detail, action] of cases)
    test(code, () => {
      const c = say(code);
      expect([c.title, c.detail, c.action?.kind]).toEqual([
        title,
        detail,
        action,
      ]);
    });

  test('a duplicate is shown only when there is one to show', () => {
    expect(say('support-already-waiting', true).action?.kind).toBe('show-it');
    expect(say('support-already-waiting').action).toBeUndefined();
  });
});

test('the button says where the request is', () => {
  const label = (...a: Parameters<typeof request>) =>
    pill(request(...a), 'Alex', 'Maude').label;
  expect(pill(null, 'Alex', 'Maude')).toEqual({
    tone: 'rest',
    label: 'Need help?',
  });
  expect(label('sent')).toBe("Asked Alex's agent");
  expect(label('sent', { away: true })).toBe('Waiting for Alex');
  expect(label('opening')).toBe('Maude is starting');
  expect(label('waiting')).toBe('Waiting for Alex');
  expect(label('failed')).toBe("Request didn't open");
  expect(pill(request('opened', { dmLink: DM }), 'Alex', 'Maude')).toEqual({
    tone: 'ok',
    label: 'Maude is in Slack',
    href: DM,
  });
});

test("a host's link is followed only into Slack", () => {
  for (const ok of [
    DM,
    'https://slack.com/app',
    'https://acme.slack.com/archives/D1',
  ])
    expect(slackLink(ok)).toBe(ok);
  for (const bad of [
    null,
    '',
    'javascript:alert(1)',
    'http://slack.com/x',
    'https://slack.com.evil.example/x',
    'https://evilslack.com/x',
    'https://evil.example/?https://slack.com/',
    'https://user@evil.example/slack.com/',
  ])
    expect(slackLink(bad)).toBe(null);
});

test('a request is named for the person it went to', () => {
  expect(askedOf(request('sent'))).toBe('Alex');
  expect(askedOf(request('sent', { host: undefined as never }))).toBe('alex');
});

test('who answers, by first name', () => {
  expect(firstName(' Alex Moreau ')).toBe('Alex');
  expect(hostOf(READY.availability)).toBe('Alex');
  expect(hostOf({ state: 'hidden' })).toBe('');
  expect(whoAnswers('Alex', READY.availability)).toBe(
    "Alex's Mac answers in Slack"
  );
  expect(whoAnswers('Alex', AWAY.availability)).toBe("Alex's Mac is away");
  expect(whoAnswers('Alex', NOBODY.availability)).toBe(
    "Alex's Mac isn't answering"
  );
});

test('the chips read short, the MR first', () => {
  expect([SETUP, VERSIONS, MR_PART].sort(byPartOrder)).toEqual([
    MR_PART,
    VERSIONS,
    SETUP,
  ]);
  expect(partLabel(MR_PART, MR)).toBe('!1374, needs review');
  expect(partLabel(SETUP, null)).toBe('Setup: accounts.slack');
  expect(partLabel(VERSIONS, null)).toBe('Versions');
});
