/**
 * One-time fixes `rt setup update` runs once per machine, in this order.
 * An id is `<yyyy-mm-dd>-<slug>` and is never renamed once shipped: the
 * ledger in setup-state.json keys on it.
 */

import { boardPeerTriggerMigration } from "./board-peer-trigger.ts";
import { retireSwitchboardUrlMigration } from "./retire-switchboard-url.ts";
import { sdmResourcesKeyMigration } from "./sdm-resources-key.ts";
import { unsetSetting } from "../../settings/write.ts";
import type { ApplyContext, StepOutcome } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";

export interface MigrationDef {
  id: string;
  title: string;
  /** `done` changed something, `skipped` found nothing to fix; both are recorded. `failed` is not, so it runs again next time. */
  run(ctx: ApplyContext): Promise<StepOutcome>;
}

export const SHARED_STORE_REFUSAL = 'A setup migration only changes this Mac. A change to the org or team stores is a layout change: see the rt:settings skill, "Changing the org repo\'s layout".';

/** Shipped migrations that write the org or team stores, each with why it stays. No new entries: see SHARED_STORE_REFUSAL. */
export const SHARED_STORE_MIGRATIONS: Readonly<Record<string, string>> = {
  "2026-10-07-sdm-resources-key": "shipped in a release and recorded done on most Macs; it renames rt.sdmEnrichment to sdm.resources in place",
};

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
  sdmResourcesKeyMigration,
];

export function migrationEventId(id: string): MigrationEventId {
  return `migration.${id}`;
}
