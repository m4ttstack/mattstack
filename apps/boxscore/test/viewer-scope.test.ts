import { describe, expect, it } from 'vitest';

import { fixtureLeaderboard } from '../src/server/fixture/index.js';
import { canSeeUser, narrowForViewer } from '../src/server/viewer-scope.js';

const board = () => fixtureLeaderboard(true);

describe('narrowForViewer', () => {
  it('passes Team view through unchanged', () => {
    const res = board();
    expect(narrowForViewer(res, { username: 'srivera', role: 'team' })).toEqual(
      res
    );
  });

  it("keeps only the viewer's row, with every rank blanked and no leaders", () => {
    const out = narrowForViewer(board(), { username: 'srivera', role: 'self' });
    expect(out.users.map(u => u.username)).toEqual(['srivera']);
    expect(out.leaders).toEqual({});
    for (const v of Object.values(out.users[0]!.metrics))
      if (typeof v === 'object' && v !== null && 'rank' in v)
        expect(v.rank).toBeNull();
  });

  it("keeps the viewer's own values and deltas", () => {
    const before = board().users.find(u => u.username === 'srivera')!;
    const out = narrowForViewer(board(), { username: 'srivera', role: 'self' });
    expect(out.users[0]!.metrics.mrsMerged.value).toBe(
      before.metrics.mrsMerged.value
    );
    expect(out.users[0]!.metrics.mrsMerged.delta).toBe(
      before.metrics.mrsMerged.delta
    );
  });

  it('matches the viewer case-insensitively', () => {
    const out = narrowForViewer(board(), { username: 'SRivera', role: 'self' });
    expect(out.users.map(u => u.username)).toEqual(['srivera']);
  });

  it('empties the board in the locked state', () => {
    const out = narrowForViewer(board(), { username: null, role: 'self' });
    expect(out.users).toEqual([]);
    expect(out.leaders).toEqual({});
  });
});

describe('canSeeUser', () => {
  it('lets Team view see anyone', () => {
    expect(canSeeUser({ username: 'a', role: 'team' }, 'b')).toBe(true);
  });
  it('lets Self view see only themselves, case-insensitively', () => {
    const v = { username: 'alice', role: 'self' } as const;
    expect(canSeeUser(v, 'Alice')).toBe(true);
    expect(canSeeUser(v, 'bob')).toBe(false);
  });
  it('lets the locked state see no one', () => {
    expect(canSeeUser({ username: null, role: 'self' }, 'alice')).toBe(false);
  });
});
