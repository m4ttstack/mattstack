import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';
import { expect, test } from 'vitest';

import {
  blocksByLatest,
  isMine,
  newestSenderRoom,
  otherEnd,
  waitingCount,
} from './direct';

function dm(room: string, a: string, b: string, unread = 0): RoomSummary {
  return {
    room,
    memberCount: 2,
    unread,
    mentions: 0,
    kind: 'dm',
    participants: { a, b, aName: a, bName: b },
  };
}

const message = (room: string, handle: string) =>
  ({ room, handle }) as ChatMessage;

test('a DM is the human’s only when he is one of its ends', () => {
  expect(isMine(dm('d', 'kai', 'matt'), 'matt')).toBe(true);
  expect(isMine(dm('d', 'kai', 'remy'), 'matt')).toBe(false);
  expect(
    isMine({ room: 'r', memberCount: 1, unread: 0, mentions: 0 }, 'matt')
  ).toBe(false);
});

test('the other end is whichever side is not the human', () => {
  expect(otherEnd(dm('d', 'matt', 'kai'), 'matt')?.handle).toBe('kai');
  expect(otherEnd(dm('d', 'kai', 'matt'), 'matt')?.handle).toBe('kai');
});

test('a reply goes to the newest agent, past the human’s own last message', () => {
  expect(
    newestSenderRoom(
      [message('a', 'kai'), message('b', 'remy'), message('a', 'matt')],
      'matt'
    )
  ).toBe('b');
});

test('with only the human’s messages, a reply stays in the newest of those', () => {
  expect(
    newestSenderRoom([message('a', 'matt'), message('b', 'matt')], 'matt')
  ).toBe('b');
  expect(newestSenderRoom([], 'matt')).toBeUndefined();
});

test('only the human’s own DMs count as waiting', () => {
  expect(
    waitingCount(
      [
        dm('a', 'kai', 'matt', 2),
        dm('b', 'kai', 'remy', 9),
        dm('c', 'remy', 'matt', 1),
      ],
      'matt'
    )
  ).toBe(3);
});

test('a reply brings its whole conversation down, unsplit', () => {
  const row = (id: number, room: string) => ({ id, room }) as ChatMessage;
  expect(
    blocksByLatest([row(1, 'a'), row(2, 'b'), row(3, 'a')]).map(m => m.id)
  ).toEqual([2, 1, 3]);
});
