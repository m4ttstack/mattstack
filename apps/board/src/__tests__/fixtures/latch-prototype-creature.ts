/**
 * The hand-made creature the approved prototype banners were drawn with
 * (fixtures/latch-reference/*.gif), so the parity test can render the same
 * creature through the runtime compositor.
 */
import type { Creature } from '../../latch/banner.ts';

const BODY = [
  'X.........X',
  'XX.......XX',
  '.XX.....XX.',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  '.XXXXXXXXX.',
  '..XXXXXXX..',
  '..XXXXXXX..',
];
const LEGS = [
  ['...X...X...', '..X.....X..', '.XX.....XX.'],
  ['...X...X...', '...X...X...', '..XX...XX..'],
];

const grid = (rows: string[]) => rows.map(r => [...r].map(c => c === 'X'));

export const PROTOTYPE_CREATURE: Creature = {
  frames: [grid([...BODY, ...LEGS[0]!]), grid([...BODY, ...LEGS[1]!])],
  eyes: [
    [3, 4],
    [7, 4],
  ],
};
