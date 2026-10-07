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
import { locateMovedRepo } from "../../repo-locate-dispatch.ts";
import { clearIdentityMemo, deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { classifyLocate, cleanupMovedRecords, runOrgMove, type LocateFn, type OrgMoveResult } from "../../team/org-folder-move.ts";
import { markerOrg } from "../../team/org-marker.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { parseOriginUrl } from "../team-settings.ts";
import { convergeMarketplace } from "./org-folder-marketplace.ts";
import { toFailedOutcome } from "./step-utils.ts";

export const ORG_MOVE_TIMEOUT_MS = 120_000;
export const ORG_FOLDER_REMEDY = "Run rt setup update --force after the fix";
export const DAEMON_STALE_REMEDY = "Run rt daemon restart, then rt setup update --force";

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

function scan(p: Probes): { clones: Clone[]; strays: string[]; folders: Set<string> } {
  const clones: Clone[] = [];
  const strays: string[] = [];
  const folders = new Set<string>();
  for (const root of [orgsDirUnder(p.home), join(p.home, ".mattstack", "teams")]) {
    for (const folder of p.readDir(root).sort()) {
      // A dotfile the Finder leaves (.DS_Store) is not a folder anyone leaked.
      if (folder.startsWith(".")) continue;
      const dir = join(root, folder);
      folders.add(folder);
      const org = markerOrg(p, dir);
      if (org === null) {
        strays.push(dir);
        continue;
      }
      clones.push({ dir, folder, org, target: orgDirUnder(p.home, org) });
    }
  }
  return { clones, strays, folders };
}

function originOf(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw === null ? null : parseOriginUrl(raw);
}

async function refusal(p: Probes, clone: Clone, claimed: Set<string>): Promise<string | null> {
  if (claimed.has(clone.target)) return `${clone.dir} is a second clone of the ${clone.org} org, so it stayed where it is`;
  const status = await p.exec(["git", "-C", clone.dir, "status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) {
    // Unknown is dirty: a clone whose status cannot be read is never renamed.
    return `rt could not read the git status of ${clone.dir} (${status.stderr.trim() || `exit ${status.code}`}), so it stayed where it is`;
  }
  if (status.stdout.trim() !== "") {
    return `${clone.dir} has uncommitted changes to tracked files. Commit them if they are yours, or discard them with a checkout of the tracked files on a Mac that only pulls, then run the update again`;
  }
  if (p.exists(join(clone.dir, ".git", "rebase-merge")) || p.exists(join(clone.dir, ".git", "rebase-apply"))) {
    return `${clone.dir} is in the middle of a rebase. Finish or abort it, then run the update again`;
  }
  if (p.exists(clone.target)) {
    const source = originOf(p, clone.dir);
    return source !== null && source === originOf(p, clone.target)
      ? `the ${clone.org} org sits in both ${clone.dir} and ${clone.target}. Move the old copy aside`
      : `${clone.target} already holds a clone of a different origin, so ${clone.dir} stayed where it is`;
  }
  return null;
}

const locate: LocateFn = async (newPath) => {
  const outcome = await orgFolderSeams.locate({ newPath, repo: await orgFolderSeams.identity(newPath) });
  return outcome.ok ? { ok: true, moved: !outcome.dryRun } : { ok: false, error: outcome.error };
};

async function moveViaDaemon(p: Probes, clone: Clone): Promise<{ result: OrgMoveResult } | { failed: string; remedy: string }> {
  const res = (await p.daemon("org:move", { from: clone.dir, to: clone.target }, ORG_MOVE_TIMEOUT_MS)) as MoveReply | null;
  if (res === null) return { failed: `The rt daemon is running but did not answer, so ${clone.dir} stayed where it is`, remedy: DAEMON_STALE_REMEDY };
  if (!res.ok && res.code === "unknown-command") return { failed: `The running rt daemon does not know how to move an org folder, so ${clone.dir} stayed where it is`, remedy: DAEMON_STALE_REMEDY };
  if (!res.ok || !res.data) return { failed: `${clone.dir} was not moved: ${res.failure?.message ?? res.error ?? "the daemon gave no reason"}`, remedy: ORG_FOLDER_REMEDY };
  return { result: res.data };
}

export async function convergeOrgFolder(ctx: ApplyContext): Promise<StepOutcome> {
  const p = ctx.p;
  const { clones, strays, folders } = scan(p);
  const strayNote = strays.length ? `not an org clone, left alone: ${strays.join(", ")}` : null;
  if (clones.length === 0) return { state: "skipped", detail: ["No org on this Mac", strayNote].filter(Boolean).join("; ") };

  const notes: string[] = [];
  const failures: { detail: string; remedy: string }[] = [];
  const partials: { detail: string; commands: string[] }[] = [];
  const claimed = new Set<string>();
  let moved = false;
  const daemonUp = p.exists(join(p.home, ".mattstack", "rt", "rt.sock"));

  for (const clone of clones) {
    let movedNow = false;
    if (clone.dir !== clone.target) {
      const why = await refusal(p, clone, claimed);
      if (why !== null) {
        failures.push({ detail: why, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      // Only a move claims its target: a clone already in place answers a second copy through the target-exists check, which names both folders.
      claimed.add(clone.target);
      const outcome = daemonUp ? await moveViaDaemon(p, clone) : { result: await runOrgMove(p, { from: clone.dir, to: clone.target, locate }) };
      if ("failed" in outcome) {
        failures.push({ detail: outcome.failed, remedy: outcome.remedy });
        continue;
      }
      if (!outcome.result.ok) {
        failures.push({ detail: `${clone.dir} was not moved (${outcome.result.stage}): ${outcome.result.error}`, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      movedNow = moved = true;
      folders.delete(clone.folder);
      folders.add(clone.org);
      notes.push(`Moved ${clone.org} to ${clone.target}`);
      if (outcome.result.removed.length) notes.push(`removed ${outcome.result.removed.join(", ")}`);
    } else {
      const located = await locate(clone.dir);
      if (!located.ok && classifyLocate(located.error) === "failed") {
        failures.push({ detail: `${clone.dir} is in place but its repo index row was not updated: ${located.error}`, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      const removed = cleanupMovedRecords(p, clone.org, (name) => folders.has(name));
      notes.push(`${clone.org} already in place`);
      if (removed.length) notes.push(`removed ${removed.join(", ")}`);
    }
    const market = await orgFolderSeams.marketplace(ctx, { dir: clone.target, stalePaths: movedNow ? [clone.dir] : [] });
    ctx.log("org.folder", `${clone.org}: marketplace ${market.state}: ${market.detail}`);
    if (market.state === "partial") partials.push({ detail: `${clone.org}: ${market.detail}`, commands: market.commands ?? [] });
  }

  if (strayNote) notes.push(strayNote);
  if (moved) ctx.reloadTeam?.();

  if (failures.length) {
    const remedy = failures.some((f) => f.remedy === DAEMON_STALE_REMEDY) ? DAEMON_STALE_REMEDY : ORG_FOLDER_REMEDY;
    return { state: "failed", detail: [...failures.map((f) => f.detail), ...notes].join("; "), remedy };
  }
  if (partials.length) {
    // A partial with no commands (Claude missing, an unreadable list) has nothing to run by hand yet, so the fix-then-rerun remedy covers it.
    const remedy = partials.every((m) => m.commands.length > 0) ? `Run ${partials.flatMap((m) => m.commands).join(", then ")}` : ORG_FOLDER_REMEDY;
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
