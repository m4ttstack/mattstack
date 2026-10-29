import { expect, test } from 'bun:test';

import { marksTip, reactorsOf, slackLadder } from '../slack-ladder.ts';

const MARKS = [
  { emoji: 'eyes', stage: 'looking' as const },
  { emoji: 'speech_balloon', stage: 'commented' as const },
  { emoji: 'white_check_mark', stage: 'approved' as const },
];
const stageOf = (reactions: string[], posted = true) =>
  slackLadder({ status: 'found', reactions, posted }, MARKS).mark?.stage ??
  null;

test('no slack info: not posted, no mark', () => {
  expect(slackLadder(undefined, MARKS)).toEqual({ posted: false, mark: null });
});

test('posted with no reactions: the logo alone', () => {
  expect(
    slackLadder({ status: 'found', reactions: [], posted: true }, MARKS)
  ).toEqual({ posted: true, mark: null });
});

test('the furthest reaction wins, whatever order the reactions or marks come in', () => {
  expect(stageOf(['eyes'])).toBe('looking');
  expect(stageOf(['eyes', 'speech_balloon'])).toBe('commented');
  expect(stageOf(['white_check_mark', 'eyes'])).toBe('approved');
  expect(
    slackLadder(
      {
        status: 'found',
        reactions: ['eyes', 'white_check_mark'],
        posted: true,
      },
      [...MARKS].reverse()
    ).mark?.stage
  ).toBe('approved');
});

test('reactions on an unposted message count for nothing', () => {
  expect(
    slackLadder(
      { status: 'found', reactions: ['white_check_mark'], posted: false },
      MARKS
    )
  ).toEqual({ posted: false, mark: null });
});

test('unknown reactions are ignored', () => {
  expect(stageOf(['tada'])).toBeNull();
});

const APPROVED = { word: 'approved' };
const LOOKING = { word: 'looking' };

test('marksTip says whether you or someone else left the furthest mark', () => {
  expect(marksTip(APPROVED, { you: true, others: [] })).toBe(
    'You marked this approved in Slack'
  );
  expect(marksTip(APPROVED, { you: false, others: ['U1'] })).toBe(
    'Someone else marked this approved in Slack'
  );
  expect(marksTip(APPROVED, { you: true, others: ['U1'] })).toBe(
    'You and 1 other marked this approved in Slack'
  );
  expect(marksTip(LOOKING, { you: false, others: ['U1', 'U2'] })).toBe(
    '2 others marked this looking in Slack'
  );
});

test('marksTip says Someone before the board knows who, and nothing without a mark', () => {
  expect(marksTip(APPROVED, undefined)).toBe(
    'Someone marked this approved in Slack'
  );
  expect(marksTip(null, undefined)).toBeNull();
});

test('marksTip across several posts counts the channels that reached it', () => {
  expect(
    marksTip(APPROVED, { you: true, others: [] }, { reached: 2, posts: 3 })
  ).toBe('You marked this approved in 2 of 3 Slack channels');
});

test('reactorsOf merges who left one emoji across posts', () => {
  expect(
    reactorsOf(
      [
        { reactedBy: { white_check_mark: { you: false, others: ['U1'] } } },
        {
          reactedBy: { white_check_mark: { you: true, others: ['U1', 'U2'] } },
        },
        {},
      ],
      'white_check_mark'
    )
  ).toEqual({ you: true, others: ['U1', 'U2'] });
  expect(reactorsOf([{}], 'eyes')).toBeUndefined();
});
