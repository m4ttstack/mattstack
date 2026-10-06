/**
 * Registered settings migrations. A step reads a key's stored value at
 * `version` and returns it at `version + 1`; a key's steps must form one
 * unbroken chain ending at its storeVersion (registry.test.ts). A key in
 * RENAMES reads the old keys' store names as older versions of itself, and
 * steps filed under an old key continue its chain. Each step's source
 * schema lives in schemas.ts (authoring only). `rt settings schema diff
 * --draft` inserts entries directly above the two @draft markers; keep
 * them.
 */

import type { MigrationStep } from "../registry-machinery.ts";
import { deleteProperty, renameProperty, setDefault } from "./helpers.ts";

export interface KeyedMigrationStep extends MigrationStep {
  key: string;
}

export const MIGRATION_STEPS: KeyedMigrationStep[] = [
  {
    key: "board.tabs",
    version: 1,
    // v2 refuses what board's loader refuses: an empty id, label or
    // codeowners section, a repeated id, an empty list. A tab board would not
    // start with is dropped; nothing left reads as board's implicit Team tab.
    up: (value) => {
      const seen = new Set<string>();
      const kept = (Array.isArray(value) ? value : []).filter((t: unknown) => {
        if (t === null || typeof t !== "object") return false;
        const { id, label, source } = t as { id?: unknown; label?: unknown; source?: { kind?: unknown; section?: unknown } };
        if (typeof id !== "string" || id === "" || typeof label !== "string" || label === "" || seen.has(id)) return false;
        if (source?.kind === "codeowners" && (typeof source.section !== "string" || source.section === "")) return false;
        if (source?.kind !== "authors" && source?.kind !== "codeowners") return false;
        seen.add(id);
        return true;
      });
      // v1 never declared pack, so any type passed; board only ever read a string.
      const tabs = kept.map((t) => {
        const { pack, ...rest } = t as Record<string, unknown>;
        return pack === undefined || typeof pack === "string" ? t : rest;
      });
      return tabs.length > 0 ? tabs : [{ id: "team", label: "Team", source: { kind: "authors" } }];
    },
  },
  // @draft-steps
];

export const RENAMES: Record<string, string[]> = {
  // @draft-renames
};
