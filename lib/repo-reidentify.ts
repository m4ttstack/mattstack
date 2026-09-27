/**
 * lib/repo-reidentify.ts: move every identity-keyed store from one serialized
 * identity to another. Store by store, verify-persisted, idempotent; a
 * refusal in one store never stops the others, so the report is complete.
 * The worktree pool directory is deliberately not a store here: the registry
 * holds absolute tree paths and the segment is a derived name, never a key.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { isDeepStrictEqual } from "util";
import { migrateRepoData, migrationIncomplete, refreshRepoIndexMirror, REPO_INDEX_NS } from "./repo-index.ts";
import { moveRepoTrackingEntry } from "./repo-tracking.ts";
import { repoDataDir, rtDir } from "./rt-paths.ts";
import { normalizeRemote, parseIdentity, serializeIdentity } from "./settings/identity.ts";
import { getSetting } from "./settings/resolve.ts";
import { setSetting } from "./settings/write.ts";
import { CURSOR_NS } from "./state/cursors-store.ts";
import { dropTableRows, moveKvKey, moveTableRows, type StoreReport } from "./state/reidentify.ts";
import { machineSettingsPath, teamSettingsPath, teamsDir, userSettingsPath } from "../packages/rt-client/src/settings/paths.ts";
import { listTeams } from "../packages/rt-client/src/settings/stores.ts";
import { renameRepoSection, storeUnparseable } from "../packages/rt-client/src/settings/write.ts";

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
  // A non-canonical wire would otherwise read as scp syntax with host "remote".
  if (/^(remote|path):/.test(trimmed)) return null;
  // normalizeRemote strips ".git" before trailing slashes, so strip them first;
  // a bare host/path has no scheme for it to match, so lend it one.
  const bare = trimmed.replace(/\/+$/, "");
  if (bare.startsWith("/") || bare.startsWith("~")) return null;
  const raw = normalizeRemote(bare) ?? normalizeRemote(`https://${bare}`);
  if (!raw) return null;
  return { serialized: serializeIdentity({ kind: "remote", id: raw }), raw };
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

/**
 * migrateRepoData swallows its own readdir and rename failures and still
 * reports every planned name, so the directories on disk are the only proof.
 */
function dataDirReport(from: string, to: string, dryRun: boolean): StoreReport {
  const store = "data-dir";
  const fromDir = repoDataDir(from);
  const toDir = repoDataDir(to);
  if (existsSync(fromDir)) {
    try {
      readdirSync(fromDir);
    } catch (err) {
      return { store, status: "refused", count: 0, detail: `${fromDir} is unreadable: ${String(err)}` };
    }
  }
  const m = migrateRepoData(from, to, { dryRun });
  const count = m.moved.length + m.merged.length;
  if (migrationIncomplete(m)) return { store, status: "refused", count, detail: `refused: ${[...m.refused, ...(m.registry === "refused" ? ["worktree-registry"] : [])].join(", ")}` };
  if (count === 0 && m.registry === "none") return { store, status: existsSync(toDir) ? "already" : "none", count: 0 };
  if (!dryRun) {
    const missing = [...m.moved, ...m.merged].filter((name) => !existsSync(join(toDir, name)));
    if (missing.length > 0) return { store, status: "refused", count, detail: `did not land under ${toDir}: ${missing.join(", ")}` };
    if (existsSync(fromDir)) return { store, status: "refused", count, detail: `${fromDir} was not removed` };
  }
  return { store, status: "moved", count: count + (m.registry === "none" ? 0 : 1) };
}

/** listTeams reads an unlistable teams dir as no teams, which would skip every team store silently. */
function teamsOrRefusal(): string[] | StoreReport {
  const dir = teamsDir();
  if (existsSync(dir)) {
    try {
      readdirSync(dir);
    } catch (err) {
      return { store: "settings:teams", status: "refused", count: 0, detail: `${dir} is unreadable: ${String(err)}` };
    }
  }
  return listTeams();
}

function herdsReport(from: string, to: string, dryRun: boolean): StoreReport {
  // Resolved per call: the daemon-config RT_DIR constant is pinned at module load.
  const path = join(rtDir(), "herds.db");
  if (!existsSync(path)) return { store: "herds.repo", status: "none", count: 0 };
  const db = new Database(path, { readwrite: true, create: false });
  try {
    // The daemon holds herds.db open in WAL mode; without a wait, its lock reads as a refusal.
    db.run("PRAGMA busy_timeout = 2000");
    return moveTableRows("herds", "repo", from, to, { dryRun, db });
  } finally {
    db.close();
  }
}

/**
 * `rt code`'s per-repo editor choice, keyed by serialized identity inside the
 * machine-scoped `rt.workspacePrefs` blob. The whole blob is rewritten with
 * only the one editors key changed, so every other pref survives.
 */
function workspaceEditorsReport(from: string, to: string, dryRun: boolean): StoreReport {
  const store = "settings:workspacePrefs.editors";
  if (storeUnparseable(machineSettingsPath())) {
    return { store, status: "refused", count: 0, detail: `unparseable store ${machineSettingsPath()}` };
  }
  const prefs = getSetting<unknown>("rt.workspacePrefs").value;
  if (prefs === null || typeof prefs !== "object" || Array.isArray(prefs)) return { store, status: "none", count: 0 };
  const editors = (prefs as { editors?: unknown }).editors;
  if (editors === null || typeof editors !== "object" || Array.isArray(editors)) return { store, status: "none", count: 0 };
  const map = editors as Record<string, unknown>;
  const hasFrom = Object.prototype.hasOwnProperty.call(map, from);
  const hasTo = Object.prototype.hasOwnProperty.call(map, to);
  if (!hasFrom && hasTo) return { store, status: "already", count: 0 };
  if (!hasFrom) return { store, status: "none", count: 0 };
  if (hasTo && !isDeepStrictEqual(map[from], map[to])) return { store, status: "refused", count: 1, detail: "both populated" };
  if (dryRun) return { store, status: "moved", count: 1 };
  const nextEditors: Record<string, unknown> = { ...map, [to]: map[from] };
  delete nextEditors[from];
  setSetting("rt.workspacePrefs", { ...(prefs as Record<string, unknown>), editors: nextEditors }, "machine");
  const after = (getSetting<{ editors?: Record<string, unknown> } | undefined>("rt.workspacePrefs").value?.editors ?? {}) as Record<string, unknown>;
  if (!isDeepStrictEqual(after[to], map[from]) || Object.prototype.hasOwnProperty.call(after, from)) {
    return { store, status: "refused", count: 1, detail: "rt.workspacePrefs did not persist the move" };
  }
  return { store, status: "moved", count: 1 };
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
  add("settings:workspacePrefs.editors", () => workspaceEditorsReport(f, t, dryRun));
  let teams: string[] = [];
  try {
    const listed = teamsOrRefusal();
    if (Array.isArray(listed)) teams = listed;
    else stores.push(listed);
  } catch (err) {
    stores.push({ store: "settings:teams", status: "refused", count: 0, detail: String(err) });
  }
  for (const team of teams) add(`settings:team:${team}`, () => settingsReport(`team:${team}`, teamSettingsPath(team), from.raw, to.raw, dryRun));

  // repos.json mirrors the index for out-of-process readers (gitq, rt-client's
  // fallback); only a write through the index refreshes it otherwise.
  if (!dryRun) refreshRepoIndexMirror();

  return { from, to, dryRun, stores, ok: stores.every((s) => s.status !== "refused") };
}
