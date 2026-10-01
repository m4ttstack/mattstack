import { describe, expect, test } from 'bun:test';

import {
  menuActsOnSelection,
  postableOf,
  selectionOf,
  tabChangeClearsSelection,
} from '../selection.ts';

const a = { webUrl: 'https://gl/a', iid: 1 };
const b = { webUrl: 'https://gl/b', iid: 2 };
const c = { webUrl: 'https://gl/c', iid: 3 };

describe('selectionOf', () => {
  test('keeps only the selected MRs, in board order', () => {
    expect(
      selectionOf([a, b, c], new Set(['https://gl/c', 'https://gl/a']))
    ).toEqual([a, c]);
  });

  test('a selected url no longer on the board simply drops out', () => {
    expect(
      selectionOf([a, b], new Set(['https://gl/a', 'https://gl/gone']))
    ).toEqual([a]);
  });

  test('an empty selection selects nothing', () => {
    expect(selectionOf([a, b], new Set())).toEqual([]);
  });

  test('MRs without a webUrl never match', () => {
    const orphan = { webUrl: null, iid: 4 };
    expect(selectionOf([orphan, a], new Set(['https://gl/a']))).toEqual([a]);
  });

  test('survives a filtered list -- selection is about urls, not positions', () => {
    // Board switched to a filter that only shows b and c; a stays selected and
    // reappears when the filter widens again.
    const sel = new Set(['https://gl/a', 'https://gl/c']);
    expect(selectionOf([b, c], sel)).toEqual([c]);
    expect(selectionOf([a, b, c], sel)).toEqual([a, c]);
  });
});

describe('postableOf', () => {
  const me = { username: 'me' };
  const mine = (iid: number, over: Record<string, unknown> = {}) => ({
    webUrl: `https://gl/${iid}`,
    iid,
    author: me,
    ...over,
  });

  test('drops MRs already posted to slack', () => {
    const posted = mine(5, { slack: { posted: true } });
    const unposted = mine(6, { slack: { posted: false } });
    expect(postableOf([posted, unposted], 'me')).toEqual([unposted]);
  });

  test('keeps MRs with no slack info at all', () => {
    expect(postableOf([mine(1), mine(2)], 'me')).toEqual([mine(1), mine(2)]);
  });

  test('drops MRs without a webUrl', () => {
    expect(postableOf([mine(7, { webUrl: null }), mine(1)], 'me')).toEqual([
      mine(1),
    ]);
  });

  test("drops someone else's MR: only an author posts about an MR", () => {
    const theirs = mine(8, { author: { username: 'kim' } });
    expect(postableOf([theirs, mine(1)], 'me')).toEqual([mine(1)]);
  });

  test('an "all" board has nothing to post', () => {
    expect(postableOf([mine(1)], null)).toEqual([]);
  });
});

describe('tabChangeClearsSelection', () => {
  test('an actual tab-id change clears the selection', () => {
    expect(tabChangeClearsSelection({ tab: 'q' }, 'team')).toBe(true);
  });

  test('re-sending the already-active tab id is not a change', () => {
    expect(tabChangeClearsSelection({ tab: 'team' }, 'team')).toBe(false);
  });

  test('a member/group/sort-only patch (no tab key) never clears it', () => {
    expect(tabChangeClearsSelection({ member: 'bob' }, 'team')).toBe(false);
    expect(tabChangeClearsSelection({ group: 'status' }, 'team')).toBe(false);
    expect(tabChangeClearsSelection({ sort: 'progress' }, 'team')).toBe(false);
  });
});

test('a right-click acts on the selection only from a checked row, two or more checked', () => {
  const sel = new Set(['u1', 'u2']);
  expect(menuActsOnSelection({ webUrl: 'u1' }, sel, 2)).toBe(true);
  expect(menuActsOnSelection({ webUrl: 'u3' }, sel, 2)).toBe(false);
  expect(menuActsOnSelection({ webUrl: 'u1' }, new Set(['u1']), 1)).toBe(false);
  expect(menuActsOnSelection({ webUrl: null }, sel, 2)).toBe(false);
});
