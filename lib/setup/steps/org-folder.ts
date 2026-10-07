/**
 * The org clone's folder follows the org's name (the marker's `org`). This
 * step runs on every update and every full apply: it checks each piece
 * (records, folder, repo index, Claude marketplace) against the clone as it
 * stands and does only what is off, so a run that stopped halfway finishes at
 * the next one. The folder piece runs in the daemon (`org:move`) when one is
 * up, because the daemon owns the registry the move rewrites; it never
 * renames beside a daemon that cannot do it.
 */

import { join } from "path";
import { orgDirUnder, orgsDirUnder } from "../../rt-paths.ts";
import { daemonPresentIn, locateMovedRepo } from "../../repo-locate-dispatch.ts";
import { clearIdentityMemo, deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { classifyLocate, cleanupMovedRecords, runOrgMove, type LocateFn, type OrgMoveResult } from "../../team/org-folder-move.ts";
import { markerState } from "../../team/org-marker.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { parseOriginUrl } from "../team-settings.ts";
import { convergeMarketplace } from "./org-folder-marketplace.ts";
import { toFailedOutcome } from "./step-utils.ts";

export const ORG_MOVE_TIMEOUT_MS = 120_000;
export const ORG_FOLDER_REMEDY = "Run rt setup update --force after the fix";
export const DAEMON_STALE_REMEDY = "Run rt daemon restart, then rt setup update --force";
export const DAEMON_SLOW_REMEDY = "Wait a minute, then run rt setup update --force";

function tilde(home: string, path: string): string {
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The clone's own serialized identity: every relocation is scoped to it, because an unscoped locate refuses whenever any other repo rt knows is missing. */
async function cloneIdentity(dir: string): Promise<string> {
  clearIdentityMemo();
  return serializeIdentity(await deriveRepoIdentity(dir));
}

/** Replaceable in tests: the relocation, the identity derivation and the marketplace piece all reach outside the Probes seam. */
export const orgFolderSeams = { locate: locateMovedRepo, identity: cloneIdentity, marketplace: convergeMarketplace };

interface Clone {
  dir: string;
  folder: string;
  org: string;
  target: string;
}

interface MoveReply {
  ok: boolean;
  code?: string;
  data?: OrgMoveResult;
  error?: string;
  failure?: { code: string; message: string };
}

function scan(p: Probes): { clones: Clone[]; strays: string[]; unreadable: string[]; folders: Set<string> } {
  const t = (path: string): string => tilde(p.home, path);
  const clones: Clone[] = [];
  const strays: string[] = [];
  const unreadable: string[] = [];
  const folders = new Set<string>();
  for (const root of [orgsDirUnder(p.home), join(p.home, ".mattstack", "teams")]) {
    for (const folder of p.readDir(root).sort()) {
      // A dotfile the Finder leaves (.DS_Store) is not a folder anyone leaked.
      if (folder.startsWith(".")) continue;
      const dir = join(root, folder);
      folders.add(folder);
      const marker = markerState(p, dir);
      if (marker.kind === "none") {
        strays.push(t(dir));
        continue;
      }
      if (marker.kind === "invalid") {
        unreadable.push(`${t(dir)} has a marker rt could not read (${marker.why}), left alone`);
        continue;
      }
      clones.push({ dir, folder, org: marker.org, target: orgDirUnder(p.home, marker.org) });
    }
  }
  return { clones, strays, unreadable, folders };
}

function originOf(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw === null ? null : parseOriginUrl(raw);
}

const dirtyWords = (dir: string): string =>
  `${dir} has uncommitted changes to tracked files. Commit them if they are yours, or discard them with a checkout of the tracked files on a Mac that only pulls, then run the update again`;
const rebasingWords = (dir: string): string => `${dir} is in the middle of a rebase. Finish or abort it, then run the update again`;

async function refusal(p: Probes, clone: Clone, claimed: Set<string>): Promise<string | null> {
  const dir = tilde(p.home, clone.dir);
  const target = tilde(p.home, clone.target);
  if (claimed.has(clone.target)) return `${dir} is a second clone of the ${clone.org} org, so it stayed where it is`;
  const status = await p.exec(["git", "-C", clone.dir, "status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) {
    // Unknown is dirty: a clone whose status cannot be read is never renamed.
    return `rt could not read the git status of ${dir} (${status.stderr.trim() || `exit ${status.code}`}), so it stayed where it is`;
  }
  if (status.stdout.trim() !== "") return dirtyWords(dir);
  if (p.exists(join(clone.dir, ".git", "rebase-merge")) || p.exists(join(clone.dir, ".git", "rebase-apply"))) return rebasingWords(dir);
  if (p.exists(clone.target)) {
    const source = originOf(p, clone.dir);
    return source !== null && source === originOf(p, clone.target)
      ? `the ${clone.org} org sits in both ${dir} and ${target}. Move the old copy aside`
      : `${target} already holds a clone of a different origin, so ${dir} stayed where it is`;
  }
  return null;
}

const locate: LocateFn = async (newPath) => {
  const outcome = await orgFolderSeams.locate({ newPath, repo: await orgFolderSeams.identity(newPath) });
  return outcome.ok ? { ok: true, moved: !outcome.dryRun } : { ok: false, error: outcome.error };
};

type DaemonMove = { result: OrgMoveResult } | { lateMove: true } | { refused: string } | { failed: string; remedy: string };

/** The daemon re-runs the step's clone checks once the engine is paused; these codes are the same refusals, not failures. */
const DAEMON_REFUSALS = new Set(["dirty", "rebasing", "status-unreadable"]);

async function moveViaDaemon(p: Probes, clone: Clone): Promise<DaemonMove> {
  const dir = tilde(p.home, clone.dir);
  const res = (await p.daemon("org:move", { from: clone.dir, to: clone.target }, ORG_MOVE_TIMEOUT_MS)) as MoveReply | null;
  if (res === null) {
    // No answer is a client timeout; the daemon may still finish the move after it, so the disk says what happened.
    if (!p.exists(clone.dir) && p.exists(clone.target)) return { lateMove: true };
    return { failed: `The rt daemon did not answer within two minutes and may still be moving ${dir}`, remedy: DAEMON_SLOW_REMEDY };
  }
  if (!res.ok && res.code === "unknown-command") return { failed: `The running rt daemon does not know how to move an org folder, so ${dir} stayed where it is`, remedy: DAEMON_STALE_REMEDY };
  const code = res.ok ? undefined : res.failure?.code;
  if (code !== undefined && DAEMON_REFUSALS.has(code)) {
    return { refused: code === "dirty" ? dirtyWords(dir) : code === "rebasing" ? rebasingWords(dir) : `${dir} was not moved: ${res.failure!.message}` };
  }
  if (!res.ok && res.data) return { result: res.data };
  if (!res.ok || !res.data) return { failed: `${dir} was not moved: ${res.failure?.message ?? res.error ?? "the daemon gave no reason"}`, remedy: ORG_FOLDER_REMEDY };
  return { result: res.data };
}

/** The pieces a clone at its target still needs: its index row (scoped locate) and the records an earlier name left behind. */
async function inPlacePieces(p: Probes, clone: Clone, folders: Set<string>): Promise<{ indexError: string } | { removed: string[] }> {
  const located = await locate(clone.target);
  if (!located.ok && classifyLocate(located.error) === "failed") return { indexError: located.error };
  return { removed: cleanupMovedRecords(p, clone.org, (name) => folders.has(name)) };
}

function moveFailure(p: Probes, clone: Clone, result: OrgMoveResult): string {
  const dir = tilde(p.home, clone.dir);
  const target = tilde(p.home, clone.target);
  if (!result.folderMoved) return `${dir} was not moved (${result.stage}): ${result.error}`;
  const what = result.stage === "cleanup" ? "its old records were not removed" : "its repo index row was not updated";
  return `${dir} moved to ${target} but ${what}: ${result.error}`;
}

export async function convergeOrgFolder(ctx: ApplyContext): Promise<StepOutcome> {
  const p = ctx.p;
  const { clones, strays, unreadable, folders } = scan(p);
  const strayNote = [...(strays.length ? [`not an org clone, left alone: ${strays.join(", ")}`] : []), ...unreadable].join("; ") || null;
  if (clones.length === 0) return { state: "skipped", detail: ["No org on this Mac", strayNote].filter(Boolean).join("; ") };

  const t = (path: string): string => tilde(p.home, path);
  const notes: string[] = [];
  /** A refusal is a clone rt chose to leave alone; everything else is a daemon or move failure. */
  const failures: { detail: string; remedy: string; refusal?: true }[] = [];
  const partials: { detail: string; commands: string[]; line: string }[] = [];
  const claimed = new Set<string>();
  let moved = false;
  const daemonUp = daemonPresentIn(join(p.home, ".mattstack", "rt"), p);

  for (const clone of clones) {
    let movedNow = false;
    if (clone.dir !== clone.target) {
      const why = await refusal(p, clone, claimed);
      if (why !== null) {
        failures.push({ detail: why, remedy: ORG_FOLDER_REMEDY, refusal: true });
        continue;
      }
      // Only a move claims its target: a clone already in place answers a second copy through the target-exists check, which names both folders.
      claimed.add(clone.target);
      const outcome = daemonUp ? await moveViaDaemon(p, clone) : { result: await runOrgMove(p, { from: clone.dir, to: clone.target, locate }) };
      if ("refused" in outcome) {
        failures.push({ detail: outcome.refused, remedy: ORG_FOLDER_REMEDY, refusal: true });
        continue;
      }
      if ("failed" in outcome) {
        failures.push({ detail: outcome.failed, remedy: outcome.remedy });
        continue;
      }
      if ("result" in outcome && !outcome.result.ok) {
        failures.push({ detail: moveFailure(p, clone, outcome.result), remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      movedNow = moved = true;
      folders.delete(clone.folder);
      folders.add(clone.org);
      let removed: string[];
      if ("lateMove" in outcome) {
        // The daemon gave up answering, not moving: its index and cleanup outcome is unknown, so the in-place pieces settle them now.
        const pieces = await inPlacePieces(p, clone, folders);
        if ("indexError" in pieces) {
          failures.push({ detail: `${t(clone.dir)} moved to ${t(clone.target)} but its repo index row was not updated: ${pieces.indexError}`, remedy: ORG_FOLDER_REMEDY });
          continue;
        }
        removed = pieces.removed;
      } else {
        removed = outcome.result.removed;
      }
      notes.push(`Moved ${clone.org} to ${t(clone.target)}`);
      if (removed.length) notes.push(`removed ${removed.map(t).join(", ")}`);
    } else {
      const pieces = await inPlacePieces(p, clone, folders);
      if ("indexError" in pieces) {
        failures.push({ detail: `${t(clone.dir)} is in place but its repo index row was not updated: ${pieces.indexError}`, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      notes.push(`${clone.org} already in place`);
      if (pieces.removed.length) notes.push(`removed ${pieces.removed.map(t).join(", ")}`);
    }
    const market = await orgFolderSeams.marketplace(ctx, { dir: clone.target, stalePaths: movedNow ? [clone.dir] : [] });
    const commands = market.state === "partial" ? (market.commands ?? []) : [];
    const line = `${clone.org}: ${market.detail}${commands.length ? `. Run: ${commands.join(", then ")}` : ""}`;
    ctx.log("org.folder", `marketplace ${market.state}: ${line}`);
    if (market.state === "partial") partials.push({ detail: `${clone.org}: ${market.detail}`, commands, line });
  }

  if (strayNote) notes.push(strayNote);
  if (moved) ctx.reloadTeam?.();

  if (failures.length) {
    const remedy = [DAEMON_STALE_REMEDY, DAEMON_SLOW_REMEDY].find((r) => failures.some((f) => f.remedy === r)) ?? ORG_FOLDER_REMEDY;
    // The handed-back plugin commands are built only during the re-point and never come back on a rerun, so they ride in the detail.
    const detail = [...failures.map((f) => f.detail), ...notes, ...partials.map((m) => m.line)].join("; ");
    // A full apply runs this step too, and a failed step stops Install; a clone rt left alone must not.
    const blocking = failures.some((f) => !f.refusal) || ctx.update === true;
    return { state: blocking ? "failed" : "partial", detail, remedy };
  }
  if (partials.length) {
    // A partial with no commands (Claude missing, an unreadable list) has nothing to run by hand yet, so it needs the fix-then-rerun.
    const commands = partials.flatMap((m) => m.commands);
    const rerun = partials.some((m) => m.commands.length === 0);
    const remedy = commands.length === 0 ? ORG_FOLDER_REMEDY : `Run ${commands.join(", then ")}${rerun ? ", then rt setup update --force" : ""}`;
    return { state: "partial", detail: [...notes, ...partials.map((m) => m.detail)].join("; "), remedy };
  }
  return { state: "done", detail: notes.join("; ") };
}

export const orgFolderStep: StepDef = {
  id: "org.folder",
  title: "Move your org folder",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: async (ctx) => {
    try {
      return await convergeOrgFolder(ctx);
    } catch (err) {
      return toFailedOutcome(err);
    }
  },
};
