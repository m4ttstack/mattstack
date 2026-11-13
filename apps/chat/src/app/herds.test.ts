import { expect, test } from 'vitest';

import type { HerdTag } from '../server/herds';
import type { FleetRoom } from './FleetTree';
import { groupHerds, mergeByNewest, workerOf } from './herds';

const TAG: HerdTag = {
  id: 'h1',
  name: 'sweep',
  shepherdHandle: 'sid',
  shepherdName: 'sid',
  workers: [
    { job: 'a', handle: 'ida', name: 'ida' },
    { job: 'b', handle: 'meg', name: 'meg' },
  ],
};

function dm(room: string, a: string, b: string, at?: number): FleetRoom {
  return {
    room,
    memberCount: 3,
    unread: 0,
    mentions: 0,
    kind: 'dm',
    participants: { a, b, aName: a, bName: b },
    ...(at === undefined ? {} : { lastPostedAt: at }),
  };
}

test("a herd's group takes its newest post and that DM's last line", () => {
  const rooms: FleetRoom[] = [
    {
      ...dm('d1', 'sid', 'ida', 5),
      herd: TAG,
      lastMessage: { handle: 'ida', body: 'old' },
    },
    {
      ...dm('d2', 'meg', 'sid', 9),
      herd: TAG,
      lastMessage: { handle: 'meg', body: 'new' },
    },
    dm('d3', 'kai', 'remy', 7),
  ];
  const [group, ...rest] = groupHerds(rooms);
  expect(rest).toEqual([]);
  expect(group!.rooms.map(r => r.room)).toEqual(['d1', 'd2']);
  expect(group!.lastPostedAt).toBe(9);
  expect(group!.lastMessage?.body).toBe('new');
});

test('workerOf names the far end of a shepherd DM, and nothing for the room', () => {
  expect(workerOf(dm('d1', 'meg', 'sid'), TAG)?.handle).toBe('meg');
  expect(
    workerOf({ room: 'herd-x', memberCount: 1, unread: 0, mentions: 0 }, TAG)
  ).toBeUndefined();
});

test('a herd sits ahead of the first DM it is newer than', () => {
  const dms = [dm('a', 'x', 'y', 30), dm('b', 'x', 'z', 10)];
  const herd = { tag: TAG, rooms: [], lastPostedAt: 20 };
  const order = mergeByNewest(dms, [herd], r => r.lastPostedAt ?? 0).map(e =>
    e.kind === 'dm' ? e.room.room : e.group.tag.id
  );
  expect(order).toEqual(['a', 'h1', 'b']);
});
