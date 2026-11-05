import type { RoomSummary } from '@mattstack/rt-client';
import { expect, test } from 'vitest';

import { latestActiveRoom, visibleRooms } from './visible-rooms';

const open = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
const closed = {
  room: 'retro',
  memberCount: 1,
  unread: 0,
  mentions: 0,
  archivedAt: 5,
};

test('a closed room is hidden unless it is the active one', () => {
  expect(visibleRooms([open, closed], undefined)).toEqual([open]);
  expect(visibleRooms([open, closed], 'build')).toEqual([open]);
  expect(visibleRooms([open, closed], 'retro')).toEqual([open, closed]);
});

function room(name: string, extra: Partial<RoomSummary> = {}): RoomSummary {
  return { room: name, memberCount: 2, unread: 0, mentions: 0, ...extra };
}

test('latestActiveRoom picks the room with the newest post', () => {
  expect(
    latestActiveRoom([
      room('old', { lastPostedAt: 10 }),
      room('new', { lastPostedAt: 30 }),
      room('mid', { lastPostedAt: 20 }),
    ])
  ).toBe('new');
});

test('latestActiveRoom skips closed rooms however new their post', () => {
  expect(
    latestActiveRoom([
      room('closed', { lastPostedAt: 99, archivedAt: 100 }),
      room('open', { lastPostedAt: 1 }),
    ])
  ).toBe('open');
});

test('latestActiveRoom weighs a DM with a pair like any room, and skips one without', () => {
  const participants = { a: 'kai', b: 'remy', aName: 'kai', bName: 'remy' };
  expect(
    latestActiveRoom([
      room('build', { lastPostedAt: 1 }),
      room('dm-1', { kind: 'dm', participants, lastPostedAt: 5 }),
    ])
  ).toBe('dm-1');
  expect(
    latestActiveRoom([
      room('build', { lastPostedAt: 1 }),
      room('dm-2', { kind: 'dm', lastPostedAt: 5 }),
    ])
  ).toBe('build');
});

test('latestActiveRoom lands on a room with no posts only when none has any', () => {
  expect(['quiet', 'quieter']).toContain(
    latestActiveRoom([room('quiet'), room('quieter')])
  );
  expect(
    latestActiveRoom([room('quiet'), room('posted', { lastPostedAt: 1 })])
  ).toBe('posted');
  expect(
    latestActiveRoom([room('posted', { lastPostedAt: 1 }), room('quiet')])
  ).toBe('posted');
});

test('latestActiveRoom has no answer with no open room', () => {
  expect(latestActiveRoom([])).toBeUndefined();
  expect(latestActiveRoom([room('closed', { archivedAt: 1 })])).toBeUndefined();
});
