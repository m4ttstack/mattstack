import { MATTSTACK_TLD } from '../../core/discover.ts';
import { addRoutes, repointRoutes } from '../../core/routes-writer.ts';
import { stateDir } from '../api/state.ts';
import {
  isPlatformManagedBy,
  PLATFORM_LABEL,
  PLATFORM_NAME,
} from '../services/manager.ts';
import {
  getRecord,
  listRecords,
  putRecord,
  reloadRegistry,
} from './records.ts';

/**
 * The bundle helper's plist carries no PORT, so the port it serves on can
 * differ from the one `deck setup` recorded, and nothing else moves deck's
 * self-record or its routes (the TLD reconcile only adds missing routes).
 * Run once both ports are held, so a losing boot never writes.
 */
export function reconcileSelfPort(port: number): {
  record: boolean;
  routes: string[];
} {
  reloadRegistry();
  const self = getRecord(PLATFORM_NAME);
  const record = self !== undefined && self.port !== port;
  if (record) putRecord({ ...self, port });
  return {
    record,
    routes: repointRoutes(PLATFORM_NAME, port, ['localhost', MATTSTACK_TLD]),
  };
}

/**
 * A helper-owned deck has no self record and never runs `deck setup`, the
 * only other writer of deck's own routes, so without this a fresh install
 * serves every app but deck. Run after reconcileSelfPort, which moves the
 * routes that do exist.
 */
export function ensureSelfRoutes(port: number): Promise<string[]> {
  return addRoutes(
    [`${PLATFORM_NAME}.localhost`, `${PLATFORM_NAME}.${MATTSTACK_TLD}`],
    port
  );
}

/**
 * The self record `deck setup` writes, for a helper-owned deck that never
 * runs it: without one deck has no row of its own and no name.mattstack
 * route from the TLD reconcile. A pre-rename "local" row counts as present.
 */
export function ensureSelfRecord(port: number, command: string[]): boolean {
  reloadRegistry();
  if (listRecords().some(r => isPlatformManagedBy(r.managedBy))) return false;
  putRecord({
    name: PLATFORM_NAME,
    managedBy: PLATFORM_NAME,
    port,
    kind: 'service',
    label: PLATFORM_LABEL,
    command,
    workingDirectory: stateDir(),
    createdAt: new Date().toISOString(),
  });
  return true;
}
