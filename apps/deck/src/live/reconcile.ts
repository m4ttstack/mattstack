import { existsSync } from 'fs';

import {
  clearLive,
  getLive,
  getLives,
  setLive,
  type LiveState,
} from '../../core/settings.ts';
import { getRecord, isEnabled } from '../registry/records.ts';
import type { ServiceManager } from '../services/manager.ts';
import {
  installLive,
  stopLiveUnlocked,
  withLiveLock,
  type LiveDeps,
} from './engine.ts';
import { branchOf, sharedRootFor } from './sources.ts';

const sameState = (a: LiveState, b: LiveState) =>
  a.source === b.source && a.startedAt === b.startedAt;

async function reconcileApp(
  name: string,
  seen: LiveState,
  manager: ServiceManager,
  deps: LiveDeps
): Promise<void> {
  const state = getLive(name);
  if (!state || !sameState(state, seen)) return;
  const record = getRecord(name);
  if (!record) {
    clearLive(name);
    return;
  }
  if (!isEnabled(record)) {
    await stopLiveUnlocked(name, manager, deps);
    return;
  }
  if (record.label && (await manager.isInstalled(record.label)))
    await manager.uninstall(record.label);
  let next = state;
  if (!existsSync(state.source)) {
    const sharedRoot = sharedRootFor(record);
    if (!sharedRoot) return;
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

/** Runs on deck's 5-second tick: re-asserts each live app's services and
    routes, and moves an app off a worktree that no longer exists. */
export async function reconcileLive(
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<void> {
  for (const [name, seen] of Object.entries(getLives())) {
    try {
      await withLiveLock(name, () => reconcileApp(name, seen, manager, deps));
    } catch (err) {
      console.error(`live reconcile for ${name} failed:`, err);
    }
  }
}
