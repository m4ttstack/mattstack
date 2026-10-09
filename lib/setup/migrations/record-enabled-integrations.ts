import { INTEGRATIONS_SETTING, storedIntegrationScopes, upgradeIntegrations } from "../../agent-integrations/preferences.ts";
import { setSetting } from "../../settings/write.ts";
import type { MigrationDef } from "./index.ts";

/**
 * Machine scope: the set comes from this Mac's resolved agent.provider, and
 * a user-scope write would travel to Macs whose provider differs.
 */
export const recordEnabledIntegrationsMigration: MigrationDef = {
  id: "2026-10-09-record-enabled-integrations",
  title: "Keep the agent integrations this Mac already uses",
  async run() {
    if (storedIntegrationScopes().length > 0) {
      return { state: "skipped", detail: "You already chose which integrations are on" };
    }
    const ids = upgradeIntegrations();
    setSetting(INTEGRATIONS_SETTING, ids, "machine");
    return { state: "done", detail: `Kept ${ids.join(" and ")} turned on, as this Mac had ${ids.length === 1 ? "it" : "them"}` };
  },
};
