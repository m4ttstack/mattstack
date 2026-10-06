/**
 * Every section of every settings store, the unit `rt settings check` and
 * `rt settings migrate` walk. Read-only: writes go through setSetting and
 * pruneStoreName.
 */

import { machineSettingsPath, orgSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { allDefs, type SettingScope } from "./registry-machinery.ts";
import { currentStoreName, readSection, type OlderLabel } from "./migrate.ts";
import { currentOrg, listTeamFolders, readStore } from "./stores.ts";

export interface StoreSection {
  scope: SettingScope;
  /** The team folder's name, for a team store. */
  team?: string;
  file: string;
  repo?: string;
  section: Record<string, unknown>;
}

/** Every team folder, not only the active one: check and migrate are about the clone, not about this member's view. */
export function storeSections(): StoreSection[] {
  const org = currentOrg();
  const shared: { scope: SettingScope; team?: string; file: string }[] =
    org === null
      ? []
      : [
          { scope: "org", file: orgSettingsPath(org) },
          ...listTeamFolders(org).map((team) => ({ scope: "team" as const, team, file: teamSettingsPath(org, team) })),
        ];
  const stores = [...shared, { scope: "user" as const, file: userSettingsPath() }, { scope: "machine" as const, file: machineSettingsPath() }];
  const out: StoreSection[] = [];
  for (const s of stores) {
    const store = readStore(s.file);
    if (!store.exists) continue;
    out.push({ ...s, section: store.global });
    for (const [repo, section] of Object.entries(store.repos)) out.push({ ...s, repo, section });
  }
  return out;
}

export interface MigrationWrite {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  fromVersion: number;
  storeName: string;
  value: unknown;
}

export interface MigrationFailure {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  message: string;
}

export interface OlderName {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  storeName: string;
  storedVersion: number;
  /** The key's current storeVersion: every reader of this store must know it before the older name goes. */
  storeVersion: number;
  label: OlderLabel;
  olderValue: unknown;
  currentValue: unknown;
  /** The value as stored under `storeName`, before migration: what a forced prune must show to be recoverable. */
  authored: unknown;
}

export interface MigrationPlan {
  writes: MigrationWrite[];
  failures: MigrationFailure[];
  older: OlderName[];
}

export function planStoreMigrations(): MigrationPlan {
  const plan: MigrationPlan = { writes: [], failures: [], older: [] };
  for (const s of storeSections()) {
    const where = { scope: s.scope, ...(s.team ? { team: s.team } : {}), file: s.file, ...(s.repo ? { repo: s.repo } : {}) };
    for (const def of allDefs()) {
      if (!def.scopes.includes(s.scope)) continue;
      if (s.repo !== undefined && def.repoScoped !== true) continue;
      if (s.repo === undefined && def.repoOnly === true) continue;
      const read = readSection(def, s.section, { layer: true });
      if (!read.present) continue;
      const current = currentStoreName(def);
      if (read.storeName !== current) {
        if (read.migrationError) plan.failures.push({ key: def.key, ...where, fromName: read.storeName!, message: read.migrationError });
        else plan.writes.push({ key: def.key, ...where, fromName: read.storeName!, fromVersion: read.storedVersion!, storeName: current, value: read.value });
        continue;
      }
      for (const o of read.older) {
        plan.older.push({ key: def.key, ...where, storeName: o.storeName, storedVersion: o.storedVersion, storeVersion: def.storeVersion ?? 1, label: o.label, olderValue: o.value, currentValue: read.value, authored: o.authored });
      }
    }
  }
  return plan;
}
