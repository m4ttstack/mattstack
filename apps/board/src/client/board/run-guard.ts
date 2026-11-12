import { mrRef, type MrLinkTarget } from '../../mr-ref.ts';
import type { ActiveRun, BoardMRWithReview } from '../types.ts';
import type { LaunchOpts } from './action-runner.ts';
import type { LaunchFlow } from './row-actions.ts';

const DOCTOR_FLOWS = new Set<LaunchFlow>(['doctor', 'rebase-local']);

/** The live work run a manual doctor would collide with on this MR. */
export function activeRunConfirmFor(
  flow: LaunchFlow,
  opts: LaunchOpts,
  mr: BoardMRWithReview
): ActiveRun | null {
  if (!DOCTOR_FLOWS.has(flow)) return null;
  if (opts.quiet || opts.intent === 'focus') return null;
  return mr.activeRun ?? null;
}

/** The parent MR (or, outside the board's window, its branch) whose worker
    owns this MR's branch; null when the run is this MR's own. The parent
    sits on the same forge as `mr`. */
export function runParent(run: ActiveRun, mr?: MrLinkTarget): string | null {
  if (run.viaIid !== undefined)
    return mrRef({
      iid: run.viaIid,
      provider: mr?.provider,
      webUrl: mr?.webUrl,
    });
  return run.viaBranch ?? null;
}
