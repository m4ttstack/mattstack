import { describe, expect, it } from 'vitest';

import { roundedPath } from '../graphEdges';

describe('roundedPath', () => {
  it('rounds each corner with radius 10 and keeps straight runs straight', () => {
    expect(
      roundedPath([
        [0, 0],
        [0, 50],
        [0, 100],
        [100, 100],
        [100, 150],
      ])
    ).toBe('M0 0L0 90Q0 100 10 100L90 100Q100 100 100 110L100 150');
  });

  it('shrinks a corner to half of a short segment', () => {
    expect(
      roundedPath([
        [0, 0],
        [0, 40],
        [8, 40],
        [8, 80],
      ])
    ).toBe('M0 0L0 36Q0 40 4 40L4 40Q8 40 8 44L8 80');
  });

  it('draws a two-point run as one line', () => {
    expect(
      roundedPath([
        [5, 0],
        [5, 36],
      ])
    ).toBe('M5 0L5 36');
  });
});
