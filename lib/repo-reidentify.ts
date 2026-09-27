/**
 * lib/repo-reidentify.ts: move every identity-keyed store from one serialized
 * identity to another. Store by store, verify-persisted, idempotent; a
 * refusal in one store never stops the others, so the report is complete.
 * The worktree pool directory is deliberately not a store here: the registry
 * holds absolute tree paths and the segment is a derived name, never a key.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { migrateRepoData, migrationIncomplete, REPO_INDEX_NS } from "./repo-index.ts";
import { moveRepoTrackingEntry } from "./repo-tracking.ts";
import { rtDir } from "./rt-paths.ts";
import { parseIdentity, serializeIdentity } from "./settings/identity.ts";
import { CURSOR_NS } from "./state/cursors-store.ts";
import { dropTableRows, moveKvKey, moveTableRows, type StoreReport } from "./state/reidentify.ts";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../packages/rt-client/src/settings/paths.ts";
import { listTeams } from "../packages/rt-client/src/settings/stores.ts";
import { renameRepoSection } from "../packages/rt-client/src/settings/write.ts";

export interface IdentityPair {
  serialized: string;
  raw: string;
}

export interface ReidentifyReport {
  from: IdentityPair;
  to: IdentityPair;
  dryRun: boolean;
  stores: StoreReport[];
  /** True when no store is refused. */
  ok: boolean;
}

export function normalizeIdentityArg(arg: string): IdentityPair | null {
  const trimmed = arg.trim();
  if (trimmed === "") return null;
  const parsed = parseIdentity(trimmed);
  if (parsed) {
    if (parsed.kind !== "remote") return null;
    return { serialized: trimmed, raw: parsed.id };
  }
  if (trimmed.includes(":") || !trimmed.includes("/")) return null;
  return { serialized: serializeIdentity({ kind: "remote", id: trimmed }), raw: trimmed };
}

const MOVED_TABLES = [
  "run_history",
  "endpoint_claims",
  "project_mrs",
  "project_mrs_meta",
  "project_mr_demands",
  "project_mr_sections",
  "discussions",
  "agents",
];
const DROPPED_TABLES = ["branch_cache", "git_badges"];

function guarded(store: string, run: () => StoreReport): StoreReport {
  try {
    return run();
  } catch (err) {
    return { store, status: "refused", count: 0, detail: String(err) };
  }
}

function dataDirReport(from: string, to: string, dryRun: boolean): StoreReport {
  const store = "data-dir";
  const m = migrateRepoData(from, to, { dryRun });
  const count = m.moved.length + m.merged.length;
  if (migrationIncomplete(m)) return { store, status: "refused", count, detail: `refused: ${[...m.refused, ...(m.registry === "refused" ? ["worktree-registry"] : [])].join(", ")}` };
  if (count === 0 && m.registry === "none") return { store, status: "none", count: 0 };
  return { store, status: "moved", count: count + (m.registry === "none" ? 0 : 1) };
}

function herdsReport(from: string, to: string, dryRun: boolean): StoreReport {
  // Resolved per call: the daemon-config RT_DIR constant is pinned at module load.
  const path = join(rtDir(), "herds.db");
  if (!existsSync(path)) return { store: "herds.repo", status: "none", count: 0 };
  const db = new Database(path, { readwrite: true, create: false });
  try {
    return moveTableRows("herds", "repo", from, to, { dryRun, db });
  } finally {
    db.close();
  }
}

function settingsReport(label: string, path: string, from: string, to: string, dryRun: boolean): StoreReport {
  const r = renameRepoSection(path, from, to, { dryRun });
  return { store: `settings:${label}`, status: r.status, count: r.keys, ...(r.detail ? { detail: r.detail } : {}) };
}

export async function reidentify(fromArg: string, toArg: string, opts: { dryRun?: boolean } = {}): Promise<ReidentifyReport | { error: string }> {
  const from = normalizeIdentityArg(fromArg);
  const to = normalizeIdentityArg(toArg);
  if (!from || !to) return { error: "both identities must be remote-kind: github.com/owner/repo or remote:github.com%2Fowner%2Frepo" };
  if (from.serialized === to.serialized) return { error: "old and new identities are the same" };
  const dryRun = opts.dryRun === true;
  const f = from.serialized;
  const t = to.serialized;
  const stores: StoreReport[] = [];
  const add = (store: string, run: () => StoreReport): void => {
    stores.push(guarded(store, run));
  };

  add(`kv:${REPO_INDEX_NS}`, () => moveKvKey(REPO_INDEX_NS, f, t, { dryRun }));
  add("data-dir", () => dataDirReport(f, t, dryRun));
  add("rt.repoTracking", () => moveRepoTrackingEntry(f, t, { dryRun }));
  add(`kv:${CURSOR_NS}`, () => moveKvKey(CURSOR_NS, f, t, { dryRun }));
  for (const table of MOVED_TABLES) add(`${table}.repo`, () => moveTableRows(table, "repo", f, t, { dryRun }));
  for (const table of DROPPED_TABLES) add(`${table}.repo`, () => dropTableRows(table, "repo", f, { dryRun }));
  add("herds.repo", () => herdsReport(f, t, dryRun));
  add("settings:user", () => settingsReport("user", userSettingsPath(), from.raw, to.raw, dryRun));
  add("settings:machine", () => settingsReport("machine", machineSettingsPath(), from.raw, to.raw, dryRun));
  let teams: string[] = [];
  try {
    teams = listTeams();
  } catch (err) {
    stores.push({ store: "settings:team", status: "refused", count: 0, detail: String(err) });
  }
  for (const team of teams) add(`settings:team:${team}`, () => settingsReport(`team:${team}`, teamSettingsPath(team), from.raw, to.raw, dryRun));

  return { from, to, dryRun, stores, ok: stores.every((s) => s.status !== "refused") };
}
