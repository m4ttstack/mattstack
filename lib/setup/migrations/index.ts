/**
 * One-time fixes `rt setup update` runs once per machine, in this order.
 * An id is `<yyyy-mm-dd>-<slug>` and is never renamed once shipped: the
 * ledger in setup-state.json keys on it.
 */

import { boardPeerTriggerMigration } from "./board-peer-trigger.ts";
import { retireSwitchboardUrlMigration } from "./retire-switchboard-url.ts";
import { unsetSetting } from "../../settings/write.ts";
import type { ApplyContext, StepOutcome } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";

export interface MigrationDef {
  id: string;
  title: string;
  /** `done` changed something, `skipped` found nothing to fix; both are recorded. `failed` is not, so it runs again next time. */
  run(ctx: ApplyContext): Promise<StepOutcome>;
}

export const MIGRATIONS: MigrationDef[] = [
  boardPeerTriggerMigration,
  {
    id: "2026-10-01-unset-board-default-pack",
    title: "Remove the old default pack setting",
    async run(): Promise<StepOutcome> {
      return unsetSetting("board.defaultPack", "user")
        ? { state: "done", detail: "Removed the old default pack setting" }
        : { state: "skipped", detail: "There was no old default pack setting" };
    },
  },
  retireSwitchboardUrlMigration,
];

export function migrationEventId(id: string): MigrationEventId {
  return `migration.${id}`;
}
