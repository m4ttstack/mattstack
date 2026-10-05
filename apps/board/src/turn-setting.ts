import { getSetting } from '@mattstack/rt-client';

import { ALL_TURN, resolveTurnConfig, type TurnConfig } from './turn.ts';

/** Read per request, never cached: a `rt settings set` from the shell must
    land on the next poll without a board restart. */
export function readTurnConfig(
  resolve: typeof getSetting = getSetting
): TurnConfig {
  try {
    return resolveTurnConfig(resolve<unknown>('board.turn').value);
  } catch (err) {
    console.warn('board: board.turn unavailable, using every signal', err);
    return ALL_TURN;
  }
}
