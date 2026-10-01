/**
 * One-time fixes `rt setup update` runs once per machine, in this order.
 * An id is `<yyyy-mm-dd>-<slug>` and is never renamed once shipped: the
 * ledger in setup-state.json keys on it.
 */

import type { ApplyContext, StepOutcome } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";

export interface MigrationDef {
  id: string;
  title: string;
  /** `done` changed something, `skipped` found nothing to fix; both are recorded. `failed` is not, so it runs again next time. */
  run(ctx: ApplyContext): Promise<StepOutcome>;
}

export const MIGRATIONS: MigrationDef[] = [];

export function migrationEventId(id: string): MigrationEventId {
  return `migration.${id}`;
}
