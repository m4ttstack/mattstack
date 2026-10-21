import { describe, expect, test } from 'bun:test';

import type { BoardData } from '../../types.ts';
import { boardPeople, NO_PEOPLE, people } from '../people.ts';

describe('people', () => {
  test('a unique first name stands alone', () => {
    const p = people([
      { username: 'rae', name: 'Rae Marlow' },
      { username: 'jun', name: 'Jun Okafor' },
    ]);
    expect(p.short('rae')).toBe('Rae');
    expect(p.full('rae')).toBe('Rae Marlow');
  });

  test('a shared first name takes the last initial', () => {
    const p = people([
      { username: 'sam1', name: 'Sam Keller' },
      { username: 'sam2', name: 'sam Ortiz' },
      { username: 'jun', name: 'Jun Okafor' },
    ]);
    expect(p.short('sam1')).toBe('Sam K.');
    expect(p.short('sam2')).toBe('sam O.');
    expect(p.short('jun')).toBe('Jun');
  });

  test('a shared first name and last initial falls back to the full name', () => {
    const p = people([
      { username: 'a', name: 'Sam Keller' },
      { username: 'b', name: 'Sam Kim' },
      { username: 'c', name: 'Sam Ortiz' },
    ]);
    expect(p.short('a')).toBe('Sam Keller');
    expect(p.short('b')).toBe('Sam Kim');
    expect(p.short('c')).toBe('Sam O.');
  });

  test('identical full names fall back to the handle', () => {
    const p = people([
      { username: 'sam', name: 'Sam' },
      { username: 'sam2', name: 'Sam' },
    ]);
    expect(p.short('sam')).toBe('sam');
    expect(p.short('sam2')).toBe('sam2');
  });

  test('an unknown name shows the handle', () => {
    const p = people([{ username: 'dcf417', name: null }]);
    expect(p.short('dcf417')).toBe('dcf417');
    expect(p.full('dcf417')).toBe('dcf417');
    expect(NO_PEOPLE.short('ghost')).toBe('ghost');
  });

  test('the first source with a name wins', () => {
    const p = people([
      { username: 'rae', name: '' },
      { username: 'rae', name: 'Rae Marlow' },
      { username: 'rae', name: 'R. Marlow' },
    ]);
    expect(p.full('rae')).toBe('Rae Marlow');
  });

  test('the same person seen twice is not a clash', () => {
    const p = people([
      { username: 'rae', name: 'Rae Marlow' },
      { username: 'rae', name: 'Rae Marlow' },
    ]);
    expect(p.short('rae')).toBe('Rae');
  });
});

describe('boardPeople', () => {
  const user = (username: string, name: string) => ({
    id: `gitlab:${username}`,
    username,
    name,
    avatarUrl: null,
  });

  test('learns names from the roster, MRs and asks', () => {
    const data = {
      allMembers: [
        { username: 'matt', name: 'Matt Goodwin', hidden: false, count: 1 },
      ],
      teams: [
        { name: 'core', members: [{ username: 'rae', name: 'Rae Marlow' }] },
      ],
      mrs: [
        {
          author: user('jun', 'Jun Okafor'),
          reviews: {
            reviewers: [
              { ...user('dcf417', 'Dana Fisher'), reviewState: null },
            ],
            approvedBy: [user('ines', 'Ines Duarte')],
          },
          respondTargets: [
            {
              username: 'petra',
              name: 'Petra Novak',
              openThreads: 1,
              openComments: 0,
            },
          ],
          sentNudge: { reviewer: 'anika', reviewerName: 'Anika Bose' },
        },
      ],
      asks: {
        pending: [{ from: 'mira', fromName: 'Mira Holt' }],
        history: [{ from: 'tom' }],
      },
    } as unknown as BoardData;
    const p = boardPeople(data);
    expect(
      [
        'matt',
        'rae',
        'jun',
        'dcf417',
        'ines',
        'petra',
        'anika',
        'mira',
        'tom',
      ].map(u => p.short(u))
    ).toEqual([
      'Matt',
      'Rae',
      'Jun',
      'Dana',
      'Ines',
      'Petra',
      'Anika',
      'Mira',
      'tom',
    ]);
  });

  test("the roster's spelling beats an MR's", () => {
    const data = {
      allMembers: [{ username: 'renee', name: 'Renee Park' }],
      mrs: [
        {
          author: user('renee', 'R. Park'),
          reviews: { reviewers: [], approvedBy: [] },
        },
      ],
    } as unknown as BoardData;
    expect(boardPeople(data).full('renee')).toBe('Renee Park');
  });

  test('a clash anywhere on the board qualifies every row', () => {
    const data = {
      allMembers: [
        { username: 'dana', name: 'Dana Wu', hidden: false, count: 0 },
      ],
      mrs: [
        {
          author: user('jun', 'Jun Okafor'),
          reviews: {
            reviewers: [
              { ...user('dcf417', 'Dana Fisher'), reviewState: null },
            ],
            approvedBy: [],
          },
        },
      ],
    } as unknown as BoardData;
    const p = boardPeople(data);
    expect(p.short('dcf417')).toBe('Dana F.');
    expect(p.short('dana')).toBe('Dana W.');
  });
});
