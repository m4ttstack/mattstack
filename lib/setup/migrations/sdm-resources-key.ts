import { orgSettingsPath, teamSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { currentOrg, listTeamFolders, readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { SettingsOwnershipRefusal, setSetting, unsetSetting } from "../../settings/write.ts";
import type { MigrationDef } from "./index.ts";

const OLD = "rt.sdmEnrichment";
const NEW = "sdm.resources";

export const sdmResourcesKeyMigration: MigrationDef = {
  id: "2026-10-07-sdm-resources-key",
  title: "Move your team's StrongDM labels to their new setting",
  async run() {
    const org = currentOrg();
    if (org === null) return { state: "skipped", detail: "This Mac is in no org" };
    const stores = [
      { scope: "org" as const, opts: {}, file: orgSettingsPath(org) },
      ...listTeamFolders(org).map((team) => ({ scope: "team" as const, opts: { team }, file: teamSettingsPath(org, team) })),
    ];
    let moved = 0;
    for (const { scope, opts, file } of stores) {
      const values = readStore(file).global;
      if (!(OLD in values) || NEW in values) continue;
      try {
        setSetting(NEW, values[OLD], scope, opts);
        unsetSetting(OLD, scope, opts);
        moved++;
      } catch (err) {
        if (err instanceof SettingsOwnershipRefusal) continue;
        throw err;
      }
    }
    return moved > 0
      ? { state: "done", detail: `Moved StrongDM labels in ${moved} ${moved === 1 ? "store" : "stores"}` }
      : { state: "skipped", detail: "No StrongDM labels to move on this Mac" };
  },
};
