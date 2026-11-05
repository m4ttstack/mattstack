import { createAvatar } from '@dicebear/core';
import * as personas from '@dicebear/personas';

import { FACE_TILES } from './face-tiles.ts';

/** A generated face, so a name keeps its persona across sessions and machines. */
export function generatedFace(seed: string, tile: number) {
  return createAvatar(personas, {
    seed,
    backgroundColor: [FACE_TILES[tile]!],
  });
}
