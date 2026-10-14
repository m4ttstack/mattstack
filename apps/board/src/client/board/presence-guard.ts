import type { BoardMR } from '../../data.ts';
import { activePeerReviewer } from '../../peer/presence.ts';
import type { BoardMRWithReview } from '../types.ts';
import type { LaunchOpts } from './action-runner.ts';
import type { LaunchFlow } from './row-actions.ts';

export function presenceConfirmFor(
  flow: LaunchFlow,
  opts: LaunchOpts,
  mr: BoardMR,
  self: string | null,
  now: number
): string | null {
  if (flow !== 'review' && flow !== 're-review') return null;
  if (opts.quiet || opts.intent === 'focus') return null;
  return activePeerReviewer(mr as BoardMRWithReview, self, now);
}
