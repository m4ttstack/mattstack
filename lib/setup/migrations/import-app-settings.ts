import { basename, join, resolve } from "path";
import { validateWrite } from "../../../packages/rt-client/src/settings/validate-write.ts";
import { restartAppWithDeck } from "../../deps/resolve.ts";
import { getKnownRepos } from "../../repo-index.ts";
import { onlyDefault } from "../../settings/presence.ts";
import { parseIdentity } from "../../settings/identity.ts";
import { getDef } from "../../settings/registry.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { boardRoots, sourceBoardRoots } from "../../team/board-token.ts";
import type { StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { repoBasename } from "../steps/repos.ts";
import { storeHolds } from "./import-legacy-settings.ts";
import type { MigrationDef } from "./index.ts";

export interface Copy {
  key: string;
  scope: "user" | "machine";
  value: unknown;
}

interface Tally {
  copied: number;
  boardCopied: boolean;
  repaired: boolean;
  unrepaired: boolean;
  gitqFileKept: boolean;
  teamFields: boolean;
  leftInPlace: number;
  failed: string[];
}

type FileProbes = Pick<Probes, "home" | "env" | "exists" | "readFile" | "rename">;
type Reader = (parsed: Record<string, unknown>) => Copy[] | null;

const BOARD_TEAM_FIELDS = ["gitlabHost", "projects", "members", "title", "botUsernames", "ticketPrefixes", "slack", "doctorSkill", "tabs"];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
}

function picked(source: Record<string, unknown>, fields: Record<string, string>): Record<string, unknown> | null {
  const out = Object.fromEntries(Object.entries(fields).filter(([, from]) => source[from] !== undefined).map(([to, from]) => [to, source[from]]));
  return Object.keys(out).length > 0 ? out : null;
}

/** The fields of the board's config.json that have a user or machine key; the team's are an admin's to set. */
export function boardCopies(c: Record<string, unknown>): Copy[] {
  const copies: Copy[] = [];
  for (const [field, key] of [["defaultMember", "board.defaultMember"], ["staleAfterDays", "board.staleAfterDays"], ["gateGraceMinutes", "board.gateGraceMinutes"]] as const) {
    if (c[field] !== undefined && c[field] !== null) copies.push({ key, scope: "user", value: c[field] });
  }
  const workspaces = picked(c, { reviews: "reviewsWorkspace", responds: "respondsWorkspace", doctors: "doctorsWorkspace" });
  if (workspaces) copies.push({ key: "board.workspaces", scope: "user", value: workspaces });
  const hidden = Array.isArray(c.members)
    ? c.members.filter((m): m is { username: string } => isObject(m) && m.hidden === true && typeof m.username === "string").map((m) => m.username)
    : [];
  if (hidden.length > 0) copies.push({ key: "board.hiddenMembers", scope: "user", value: hidden });
  if (isObject(c.triage)) {
    const { doctorSkill: _teamKey, maxConcurrent, ...flags } = c.triage;
    if (Object.keys(flags).length > 0) copies.push({ key: "board.triage", scope: "user", value: flags });
    if (maxConcurrent !== undefined) copies.push({ key: "board.triageMaxConcurrent", scope: "machine", value: maxConcurrent });
  }
  const cwds = picked(c, { review: "reviewCwd", respond: "respondCwd", doctor: "doctorCwd" });
  if (cwds) copies.push({ key: "board.cwds", scope: "machine", value: cwds });
  return copies;
}

function boardTeamFields(c: Record<string, unknown>): boolean {
  return BOARD_TEAM_FIELDS.some((field) => c[field] !== undefined) || (isObject(c.triage) && c.triage.doctorSkill !== undefined);
}

function gitqSettingsCopies(s: Record<string, unknown>): Copy[] {
  const copies: Copy[] = [];
  if (s.forges !== undefined) copies.push({ key: "gitq.forges", scope: "user", value: s.forges });
  const slots = picked(s, { workSlotLocation: "workSlotLocation", maxWorkSlots: "maxWorkSlots" });
  if (slots) copies.push({ key: "gitq.workSlots", scope: "machine", value: slots });
  return copies;
}

/** gitq's board refuses an empty list and an entry with no path, so such a file is not copied. */
function gitqBoardCopies(c: Record<string, unknown>): Copy[] | null {
  const repos = c.repos;
  if (!Array.isArray(repos) || repos.length === 0 || !repos.every((r) => isObject(r) && typeof r.path === "string" && r.path !== "")) return null;
  const value = { repos, ...(c.port !== undefined ? { port: c.port } : {}), ...(c.herdrWorkspace !== undefined ? { herdrWorkspace: c.herdrWorkspace } : {}) };
  return [{ key: "gitq.board", scope: "machine", value }];
}

type Written = "copied" | "held" | "unreadable" | "failed";

function writeCopy(copy: Copy, t: Tally): Written {
  if (storeHolds(copy.key)) return "held";
  if (!validateWrite(getDef(copy.key)!, copy.value, { scope: copy.scope }).ok) return "unreadable";
  try {
    if (copy.scope === "user") setSetting(copy.key, copy.value, "user");
    else setSetting(copy.key, copy.value, "machine");
  } catch (err) {
    t.failed.push(`${copy.key}: ${firstLine(err)}`);
    return "failed";
  }
  if (!storeHolds(copy.key)) {
    t.failed.push(`${copy.key}: the copy did not read back`);
    return "failed";
  }
  t.copied++;
  if (copy.key.startsWith("board.") || copy.key === "mattstack.roster") t.boardCopied = true;
  return "copied";
}

/** The file moves aside only once every field it holds is in a store, so a refused or failed field keeps it for a hand fix or a rerun. */
function importFile(p: FileProbes, file: string, read: Reader, t: Tally): Record<string, unknown> | null {
  const raw = p.readFile(file);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const copies = isObject(parsed) ? read(parsed) : null;
  if (!isObject(parsed) || copies === null) {
    t.leftInPlace++;
    return null;
  }
  const written = copies.map((copy) => writeCopy(copy, t));
  if (written.includes("failed")) return parsed;
  if (written.includes("unreadable")) {
    t.leftInPlace++;
    return parsed;
  }
  try {
    p.rename(file, `${file}.imported`);
  } catch (err) {
    t.failed.push(`moving an old file aside: ${firstLine(err)}`);
  }
  return parsed;
}

/** The registered repos by the name gitq's board would give them; a name two repos share resolves to nothing. */
function pathsByName(): Map<string, string | null> {
  const byName = new Map<string, Set<string>>();
  for (const row of getKnownRepos()) {
    const first = row.registered !== false ? row.worktrees[0] : undefined;
    if (!first) continue;
    const parsed = parseIdentity(row.repoName);
    const name = parsed ? repoBasename(parsed.id) : row.repoName;
    byName.set(name, (byName.get(name) ?? new Set()).add(first.path));
  }
  return new Map([...byName].map(([name, paths]) => [name, paths.size === 1 ? [...paths][0]! : null]));
}

/** A repo gitq's own config.json already names with a folder. */
function pathFromFile(fileRepos: unknown, name: string): string | null {
  if (!Array.isArray(fileRepos)) return null;
  const entry = fileRepos.find((r) => isObject(r) && typeof r.path === "string" && r.path !== "" && (typeof r.name === "string" ? r.name : basename(r.path)) === name);
  return entry ? (entry as { path: string }).path : null;
}

function readRepos(p: FileProbes, file: string): unknown {
  try {
    const raw = p.readFile(file);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isObject(parsed) ? parsed.repos : null;
  } catch {
    return null;
  }
}

/** rt setup used to seed gitq.board with bare repo names, which gitq refuses. Returns true when gitq's own file must stay: a name is still bare, or the fixed value could not be written. */
function repairGitqBoard(t: Tally, fileRepos: unknown): boolean {
  const resolved = getSetting<{ repos?: unknown }>("gitq.board");
  const repos = resolved.value?.repos;
  if (onlyDefault(resolved) || !Array.isArray(repos) || !repos.some((r) => typeof r === "string")) return false;
  const index = pathsByName();
  const fixed = repos.map((r) => {
    if (typeof r !== "string") return r;
    const path = index.get(r) ?? pathFromFile(fileRepos, r);
    return path ? { path, name: r } : null;
  });
  if (fixed.includes(null)) {
    t.unrepaired = true;
    return true;
  }
  try {
    setSetting("gitq.board", { ...(resolved.value as Record<string, unknown>), repos: fixed }, "machine");
  } catch (err) {
    t.failed.push(`gitq.board: ${firstLine(err)}`);
    return true;
  }
  t.repaired = true;
  return false;
}

const BOARD_NOT_RESTARTED = "rt could not restart your board, so restart it to pick up these settings";

function withNote(o: StepOutcome, note: string): StepOutcome {
  return { ...o, detail: o.detail ? `${o.detail}. ${note}` : note };
}

function outcome(t: Tally): StepOutcome {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (t.failed.length > 0) {
    return {
      state: "failed",
      detail: `Could not copy ${t.failed.length} old ${plural(t.failed.length, "setting", "settings")}: ${t.failed[0]}`,
      remedy: "Run rt settings check, fix what it names, then Retry",
    };
  }
  const notes = [
    t.repaired ? "Gave each repo on your gitq board its folder" : null,
    t.unrepaired ? `Some repos on your gitq board are not on this Mac, so rt left that setting${t.gitqFileKept ? " and your old gitq file" : ""} as it was` : null,
    t.teamFields ? "Your old board file also holds team settings, which a team admin sets" : null,
    t.leftInPlace > 0
      ? `${t.leftInPlace} old ${plural(t.leftInPlace, "file has", "files have")} a value rt could not read, so rt left ${plural(t.leftInPlace, "it", "them")} where ${plural(t.leftInPlace, "it is", "they are")}`
      : null,
  ].filter((s): s is string => s !== null);
  if (t.copied === 0 && !t.repaired) return { state: "skipped", detail: ["There were no old board or gitq settings to copy", ...notes].join(". ") };
  const copied = t.copied > 0 ? [`Copied ${t.copied} old board or gitq ${plural(t.copied, "setting", "settings")} into your settings`] : [];
  return { state: "done", detail: [...copied, ...notes].join(". ") };
}

export interface ImportAppSettingsSeams {
  /** The board reads its settings once at boot, and it starts before this migration runs. */
  restartBoard(p: Probes): Promise<boolean>;
}

const realSeams: ImportAppSettingsSeams = { restartBoard: (p) => restartAppWithDeck(p, "board") };

export function makeImportAppSettingsMigration(seams: ImportAppSettingsSeams = realSeams): MigrationDef {
  return {
    id: "2026-10-11-import-app-settings",
    title: "Copy your old board and gitq settings into your settings",
    async run(ctx) {
      const p = ctx.p;
      const t: Tally = { copied: 0, boardCopied: false, repaired: false, unrepaired: false, gitqFileKept: false, teamFields: false, leftInPlace: 0, failed: [] };
      const board = [...new Set(boardRoots(p, sourceBoardRoots()))].map((root) => join(root, "config.json")).find((file) => p.exists(file));
      if (board) {
        const parsed = importFile(p, board, boardCopies, t);
        if (parsed) t.teamFields = boardTeamFields(parsed);
      }
      const gitq = p.env.GITQ_APP_ROOT ? resolve(p.env.GITQ_APP_ROOT) : join(p.home, ".mattstack", "gitq");
      importFile(p, join(gitq, "settings.json"), gitqSettingsCopies, t);
      const boardFile = join(gitq, "config.json");
      const keepFile = repairGitqBoard(t, readRepos(p, boardFile));
      if (keepFile) t.gitqFileKept = p.exists(boardFile);
      else importFile(p, boardFile, gitqBoardCopies, t);
      const result = outcome(t);
      if (!t.boardCopied) return result;
      let restarted = false;
      try {
        restarted = await seams.restartBoard(p);
      } catch {
        restarted = false;
      }
      return restarted ? result : withNote(result, BOARD_NOT_RESTARTED);
    },
  };
}

export const importAppSettingsMigration: MigrationDef = makeImportAppSettingsMigration();
