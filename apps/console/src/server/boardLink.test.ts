import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it, vi } from 'vitest';

import { boardLinkResolver } from './boardLink';

const post = {
  id: 'g 1',
  subject: 'mr:acme/web!412',
  kind: 'review-post',
  status: 'open',
  openedAt: 0,
} as unknown as GateRow;

const review = { id: 'r1', work_type: 'review', status: 'running' };

function setup(origin: string | null, gates: GateRow[] | null = [post]) {
  let now = 0;
  const deps = {
    boardOrigin: vi.fn(async () => origin),
    runGates: vi.fn(async () => gates),
    now: () => now,
  };
  return {
    deps,
    resolve: boardLinkResolver(deps),
    tick: (ms: number) => (now += ms),
  };
}

describe('boardLinkResolver', () => {
  it('links a live review run to its waiting hand-off gate on the board', async () => {
    const { resolve } = setup('https://board.mattstack/');
    expect(await resolve(review)).toBe('https://board.mattstack/?gate=g%201');
  });

  it('is null for a work run, a finished run, or no waiting hand-off', async () => {
    const { resolve, deps } = setup('https://board.mattstack');
    expect(await resolve({ ...review, work_type: 'feature' })).toBeNull();
    expect(await resolve({ ...review, status: 'done' })).toBeNull();
    expect(deps.runGates).not.toHaveBeenCalled();
    deps.runGates.mockResolvedValueOnce([{ ...post, status: 'answered' }]);
    expect(await resolve(review)).toBeNull();
  });

  it('is null when deck does not answer', async () => {
    const { resolve } = setup(null);
    expect(await resolve(review)).toBeNull();
  });

  it('asks deck once for a while, and again sooner after a miss', async () => {
    const hit = setup('https://board.mattstack');
    await hit.resolve(review);
    hit.tick(60_000);
    await hit.resolve(review);
    expect(hit.deps.boardOrigin).toHaveBeenCalledTimes(1);

    const miss = setup(null);
    await miss.resolve(review);
    miss.tick(31_000);
    await miss.resolve(review);
    expect(miss.deps.boardOrigin).toHaveBeenCalledTimes(2);
  });
});
