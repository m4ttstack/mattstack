import { existsSync } from 'fs';

import { clearLive, getLives, setLive } from '../../core/settings.ts';
import { getRecord } from '../registry/records.ts';
import type { ServiceManager } from '../services/manager.ts';
import { installLive, type LiveDeps } from './engine.ts';
import { branchOf, sharedRootFor } from './sources.ts';

/** Runs on deck's 5-second tick: re-asserts each live app's services and
    routes, and moves an app off a worktree that no longer exists. */
export async function reconcileLive(
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<void> {
  for (const [name, state] of Object.entries(getLives())) {
    const record = getRecord(name);
    if (!record) {
      clearLive(name);
      continue;
    }
    let next = state;
    if (!existsSync(state.source)) {
      const sharedRoot = sharedRootFor(record);
      if (!sharedRoot) continue;
      next = {
        ...state,
        source: sharedRoot,
        branch: branchOf(sharedRoot),
        movedFrom: state.branch ?? state.source,
      };
      setLive(name, next);
    }
    const err = await installLive(record, next, manager, deps);
    if (err) console.error(`live reconcile for ${name}: ${err}`);
  }
}
