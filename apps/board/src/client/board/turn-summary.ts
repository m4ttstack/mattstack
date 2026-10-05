import type { BoardMR } from '../../data.ts';
import { authorTurn, type TurnConfig } from '../../turn.ts';

export type TurnBucket =
  'needYou' | 'waitingOnAuthor' | 'readyToMerge' | 'needReviewer';

/** First matching bucket wins, in this order, so the four counts add up to
    the row count. */
export function turnSummary<T extends BoardMR>(
  rows: T[],
  cfg: TurnConfig,
  needsMe: ((mr: T) => boolean) | null
): Record<TurnBucket, number> {
  const out: Record<TurnBucket, number> = {
    needYou: 0,
    waitingOnAuthor: 0,
    readyToMerge: 0,
    needReviewer: 0,
  };
  for (const mr of rows) {
    if (needsMe?.(mr)) {
      out.needYou++;
      continue;
    }
    const s = authorTurn(mr, cfg);
    if (s === 'readyToMerge') out.readyToMerge++;
    else if (s) out.waitingOnAuthor++;
    else out.needReviewer++;
  }
  return out;
}
