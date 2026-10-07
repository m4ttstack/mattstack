import { existsSync } from "fs";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { applyLocate, isRefusal, planLocate } from "../../repo-locate.ts";
import { mattstackHome, orgsDir } from "../../rt-paths.ts";
import { validateSlug } from "../../secrets/store.ts";
import { clearIdentityMemo, deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { runOrgMove, type LocateFn, type MoveProbes } from "../../team/org-folder-move.ts";
import { markerOrg } from "../../team/org-marker.ts";
import type { TeamSnapshotsHandle } from "../team-snapshots.ts";
import type { HandlerMap } from "./types.ts";

export interface OrgHandlerOpts {
  /** Excludes reconciler passes for the duration of `fn`; `org:move` relocates the clone's registry rows itself, so it must never go through `repos:locate`, which takes this same hold. */
  withReconcilerHeld: <T>(fn: () => Promise<T>) => Promise<T>;
  refreshWatchedRepos: () => void;
  emitEvent: (topic: string, payload: unknown) => void;
  teamSnapshots: Pick<TeamSnapshotsHandle, "pause" | "resume">;
  probes?: MoveProbes;
  exec?: Probes["exec"];
}

const refuse = (code: string, message: string) => ({ ok: false as const, error: `${code}: ${message}`, failure: { code, message } });

/** Relocates the clone's index row in this process, scoped to the clone's own identity: unscoped, planLocate refuses a clone with no row of its own while any other repo rt knows is missing. The hold is already held, so the `repos:locate` handler (which takes it) would deadlock. */
async function locateDirect(newPath: string): Promise<{ ok: true; moved: true; identity: string } | { ok: false; error: string }> {
  // The memo may still hold the clone's identity derived at its old path, which would scope the locate to a stale key.
  clearIdentityMemo();
  const identity = serializeIdentity(await deriveRepoIdentity(newPath));
  const plan = await planLocate({ newPath, repo: identity });
  if (isRefusal(plan)) return { ok: false, error: `${plan.refusal}: ${plan.message}` };
  const result = await applyLocate(plan);
  return result.ok ? { ok: true, moved: true, identity: result.identity } : { ok: false, error: result.error ?? "locate failed" };
}

/** The step checked the clone before asking, but a pull or commit the snapshot engine finished since then can leave it dirty or mid-rebase, so the checks run again once the engine is paused. */
async function cloneRefusal(exec: Probes["exec"], source: string): Promise<ReturnType<typeof refuse> | null> {
  if (existsSync(join(source, ".git", "rebase-merge")) || existsSync(join(source, ".git", "rebase-apply"))) {
    return refuse("rebasing", `${source} is in the middle of a rebase`);
  }
  const status = await exec(["git", "-C", source, "status", "--porcelain", "--untracked-files=no"], { timeoutMs: 30_000 });
  if (status.code !== 0) return refuse("status-unreadable", `rt could not read the git status of ${source} (${status.stderr.trim() || `exit ${status.code}`})`);
  if (status.stdout.trim() !== "") return refuse("dirty", `${source} has uncommitted changes to tracked files`);
  return null;
}

/**
 * Refusal codes, each as `{ ok: false, error, failure: { code, message } }`:
 * from-required, to-required, to-outside-orgs, from-outside-home, from-missing,
 * not-an-org-clone, marker-mismatch, to-exists (before the pause), and
 * rebasing, status-unreadable, dirty, move-failed (after it, inside the hold).
 * A move-failed reply also carries the move's result as `data`, so the caller
 * can tell a folder that moved from one that did not.
 */
export function createOrgHandlers(opts: OrgHandlerOpts): Record<"org:move", (payload: any) => Promise<any>> & HandlerMap {
  const probes = opts.probes ?? createRealProbes();
  const exec = opts.exec ?? createRealProbes().exec;
  return {
    "org:move": async (payload) => {
      const from = payload?.from;
      const to = payload?.to;
      if (typeof from !== "string" || from.length === 0 || !isAbsolute(from)) return refuse("from-required", "from must be an absolute path");
      if (typeof to !== "string" || to.length === 0 || !isAbsolute(to)) return refuse("to-required", "to must be an absolute path");
      const target = resolve(to);
      const org = basename(target);
      let slugOk = true;
      try {
        validateSlug(org);
      } catch {
        slugOk = false;
      }
      if (dirname(target) !== orgsDir() || !slugOk) return refuse("to-outside-orgs", `${to} is not a folder directly under ${orgsDir()}`);
      const source = resolve(from);
      if (!source.startsWith(`${mattstackHome()}/`)) return refuse("from-outside-home", `${from} is not under ${mattstackHome()}`);
      if (!existsSync(source)) return refuse("from-missing", `${from} does not exist`);
      const marked = markerOrg(probes, source);
      if (marked === null) return refuse("not-an-org-clone", `${from} carries no org marker`);
      if (marked !== org) return refuse("marker-mismatch", `${from} holds the ${marked} org, not ${org}`);
      if (source !== target && existsSync(target)) return refuse("to-exists", `${to} already exists`);

      const slugs = [...new Set([basename(source), org])];
      try {
        await opts.teamSnapshots.pause(slugs);
        return await opts.withReconcilerHeld(async () => {
          const refused = await cloneRefusal(exec, source);
          if (refused !== null) return refused;
          let identity: string | null = null;
          const locate: LocateFn = async (newPath) => {
            const located = await locateDirect(newPath);
            if (located.ok) identity = located.identity;
            return located;
          };
          const result = await runOrgMove(probes, { from: source, to: target, locate });
          // A cleanup failure lands after the index row moved: watchers must follow it, since a retry finds `from` gone.
          if (result.index === "moved") {
            opts.refreshWatchedRepos();
            opts.emitEvent("repo:moved", { identity, from: source, to: target });
          }
          if (!result.ok) return { ...refuse("move-failed", `${result.stage}: ${result.error}`), data: result };
          opts.emitEvent("org:moved", { from: source, to: target });
          return { ok: true, data: result };
        });
      } finally {
        await opts.teamSnapshots.resume(slugs);
      }
    },
  };
}
