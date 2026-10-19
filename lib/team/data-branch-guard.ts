/**
 * Two ways a forge can lose an org's data that the branch's own protection
 * does not stop: a maintainer deletes the data branch, or a merge request
 * merges it into `main`. Every member's copy holds the full branch, so a
 * deleted one can be pushed back from any admin's copy; a merge is reverted
 * by hand on `main`, which rt never writes beyond its pointer.
 */

import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { warn } from "../ui/warn.ts";
import { applyForgeAccess, realForgeAccessSeams, type ForgeAccessSeams } from "./forge-access-apply.ts";
import { gitWithToken } from "./git-credential.ts";
import { readMainBranch } from "./main-pointer.ts";
import { knownDataBranch } from "./org-branch.ts";
import { ENV } from "./org-data-branch.ts";
import { withoutUrls } from "./redact.ts";
import { roleFor, rolesFor } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { editTeamLocal, readTeamLocal } from "./team-local.ts";

export const GONE_SENTENCE = "The org's data branch is gone from the forge, and your copy still has it";
export const MERGED_SENTENCE = "Org data was merged into main. Revert that commit";
/** A setup row asks the forge while someone waits on it. */
const ASK_TIMEOUT_MS = 15_000;

export type DataBranchCheck =
  | { kind: "present"; branch: string; sha: string }
  /** Origin lost the branch; `local` is this copy's tip of it. */
  | { kind: "gone"; branch: string; local: string }
  /** Origin lost the branch and this copy has none to push back. */
  | { kind: "lost"; branch: string }
  | { kind: "unknown"; branch: string; log: string };

export type MainCheck = { kind: "clean" } | { kind: "merged"; files: string[] } | { kind: "unknown"; log: string };

export interface GuardOptions {
  readToken?: (p: Probes, remote: string) => Promise<string | null>;
}

interface Origin {
  dir: string;
  branch: string;
  remote: string;
  token: string | null;
}

/** The data branch and how to reach origin for it; null for an org whose data has no branch of its own, or a copy with no origin. */
async function originFor(p: Probes, slug: string, opts: GuardOptions): Promise<Origin | null> {
  const dir = orgDirUnder(p.home, slug);
  const branch = knownDataBranch(p, dir);
  if (branch === null) return null;
  const url = await p.exec(["git", "remote", "get-url", "origin"], { cwd: dir, env: ENV });
  if (url.code !== 0 || url.stdout.trim() === "") return null;
  const remote = url.stdout.trim();
  let token: string | null = null;
  try {
    token = await (opts.readToken ?? storedForgeToken)(p, remote);
  } catch (err) {
    warn("data-branch-guard", `could not read the forge token for ${withoutUrls(remote)}; asking with git's own credentials`, { context: { err: String(err) } });
  }
  return { dir, branch, remote, token };
}

async function localTip(p: Probes, dir: string, ref: string): Promise<string | null> {
  const r = await p.exec(["git", "rev-parse", "--verify", "-q", ref], { cwd: dir, env: ENV });
  return r.code === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : null;
}

/**
 * Whether origin still has the org's data branch. A branch origin has is
 * remembered as its last known tip, so a restore can tell a copy that is
 * behind even after a pruning fetch drops the tracking ref.
 */
export async function checkDataBranch(p: Probes, slug: string, opts: GuardOptions = {}): Promise<DataBranchCheck | null> {
  const origin = await originFor(p, slug, opts);
  if (origin === null) return null;
  const { dir, branch, remote, token } = origin;
  const lookup = gitWithToken(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], token, ENV, { remote });
  const listed = await p.exec(lookup.argv, { cwd: dir, env: lookup.env, timeoutMs: ASK_TIMEOUT_MS });
  if (listed.code !== 0) return { kind: "unknown", branch, log: withoutUrls(`${listed.stdout}\n${listed.stderr}`.trim()) };
  const sha = listed.stdout.trim().split(/\s+/)[0] ?? "";
  if (sha !== "") {
    if (readTeamLocal(p, slug).dataBranchTip !== sha) editTeamLocal(p, slug, () => ({ dataBranchTip: sha }));
    return { kind: "present", branch, sha };
  }
  const local = await localTip(p, dir, `refs/heads/${branch}`);
  return local === null ? { kind: "lost", branch } : { kind: "gone", branch, local };
}

/** Whether origin's `main` holds org files besides the pointer: the data branch merged into it. */
export async function checkMainForOrgData(p: Probes, slug: string, opts: GuardOptions = {}): Promise<MainCheck | null> {
  const origin = await originFor(p, slug, opts);
  if (origin === null) return null;
  try {
    const main = await readMainBranch(p, origin.remote, origin.token, { timeoutMs: ASK_TIMEOUT_MS });
    // Until main's pointer names a data branch, main still holds the org's data on purpose (a trial move, a pointer waiting on a merge request).
    if (main === null || main.pointer?.dataBranch == null || main.orgFiles.length === 0) return { kind: "clean" };
    return { kind: "merged", files: main.orgFiles };
  } catch (err) {
    return { kind: "unknown", log: withoutUrls(err instanceof UserActionableError ? (err.log ?? err.message) : String(err)) };
  }
}

export interface RestorePlan {
  branch: string;
  sha: string;
  subject: string;
  /** Commits this copy holds past origin's last known tip; null when no tip was ever known. */
  ahead: number | null;
}

export type ProtectOutcome = { kind: "protected" } | { kind: "already" } | { kind: "unavailable" } | { kind: "no-forge" } | { kind: "refused"; manualSteps: string[] };

export interface RestoreResult {
  plan: RestorePlan;
  pushed: boolean;
  protect: ProtectOutcome | null;
  /** The org's push list, applied again when rt manages forge access on this Mac. */
  pushList: "applied" | "skipped" | "refused";
}

export interface RestoreOptions extends GuardOptions {
  push: boolean;
  forgeAccessSeams?: ForgeAccessSeams;
}

function refused(code: string, message: string, why?: string, next?: string): UserActionableError {
  return new UserActionableError(code, message, {}, { ...(why ? { why } : {}), ...(next ? { next } : {}) });
}

/**
 * Pushes this copy's data branch back to a forge that lost it, then protects
 * it again. Org owners and admins only. Without `push` it only says what it
 * would push. A copy behind origin's last known tip is refused: pushing it
 * would drop commits another Mac published.
 */
export async function restoreDataBranch(p: Probes, slug: string, opts: RestoreOptions): Promise<RestoreResult> {
  if (!isOrgAdmin(roleFor(p, slug))) {
    const admins = rolesFor(p, slug).admins;
    throw refused("restore-not-admin", "Only an org owner or admin can restore the org's data branch", admins.length > 0 ? `Ask ${admins.join(" or ")}.` : "Ask an org admin.");
  }
  const origin = await originFor(p, slug, opts);
  if (origin === null) throw refused("restore-no-data-branch", "This org keeps its data on main, so there is no data branch to restore");
  const { dir, branch, remote, token } = origin;
  const check = await checkDataBranch(p, slug, opts);
  if (check?.kind === "unknown") {
    throw new UserActionableError("restore-unreachable", "rt could not ask the forge whether the data branch is there", {}, { why: "Check your network, then try again.", log: check.log });
  }
  if (check?.kind === "present") throw refused("restore-not-needed", `The ${branch} branch is still on the forge, so there is nothing to restore`);
  if (check?.kind !== "gone") throw refused("restore-no-copy", `Your copy of the org has no ${branch} branch, so rt cannot restore it from this Mac`, "Run this on another admin's Mac whose copy has it.");

  // Either may be the newer: the tracking ref stops moving while a pull is held, and the record lags a copy that fetched without the guard.
  const tips = [await localTip(p, dir, `refs/remotes/origin/${branch}`), readTeamLocal(p, slug).dataBranchTip ?? null].filter((t): t is string => t !== null);
  let ahead: number | null = null;
  for (const tip of new Set(tips)) {
    const contains = await p.exec(["git", "merge-base", "--is-ancestor", tip, check.local], { cwd: dir, env: ENV });
    if (contains.code !== 0) {
      throw refused(
        "restore-behind",
        "Your copy of the data branch is behind what the forge last had, so rt did not push it",
        "Pushing it would drop commits someone else published. Restore from a Mac whose copy has them.",
      );
    }
    const counted = await p.exec(["git", "rev-list", "--count", `${tip}..${check.local}`], { cwd: dir, env: ENV });
    const past = counted.code === 0 ? Number(counted.stdout.trim()) : null;
    ahead = past === null ? ahead : ahead === null ? past : Math.min(ahead, past);
  }
  const subject = (await p.exec(["git", "log", "-1", "--format=%s", check.local], { cwd: dir, env: ENV })).stdout.trim();
  const plan: RestorePlan = { branch, sha: check.local, subject, ahead };
  if (!opts.push) return { plan, pushed: false, protect: null, pushList: "skipped" };

  const push = gitWithToken(["push", "-q", "origin", `${check.local}:refs/heads/${branch}`], token, ENV, { remote });
  const pushed = await p.exec(push.argv, { cwd: dir, env: push.env });
  if (pushed.code !== 0) {
    throw new UserActionableError("restore-push-failed", `rt could not push the ${branch} branch back`, {}, { why: "Check that you can push to the org repo.", log: withoutUrls(`${pushed.stdout}\n${pushed.stderr}`.trim()) });
  }
  editTeamLocal(p, slug, () => ({ dataBranchTip: check.local }));

  const seams = opts.forgeAccessSeams ?? realForgeAccessSeams();
  const protect = await reprotect(p, branch, remote, token, seams);
  let pushList: RestoreResult["pushList"] = "skipped";
  if (readTeamLocal(p, slug).rtMayManageMembership) {
    try {
      const { applied } = await applyForgeAccess(p, slug, seams);
      pushList = applied && !applied.incomplete ? "applied" : "refused";
    } catch (err) {
      warn("data-branch-guard", `restored ${branch} but could not apply the org's push list`, { context: { err: String(err) } });
      pushList = "refused";
    }
  }
  return { plan, pushed: true, protect, pushList };
}

async function reprotect(p: Probes, branch: string, remote: string, token: string | null, seams: ForgeAccessSeams): Promise<ProtectOutcome> {
  const access = seams.access(p, remote, token);
  if (access === null) return { kind: "no-forge" };
  const list = await access.readPushList(branch);
  if (!list.ok) return { kind: "refused", manualSteps: list.manualSteps };
  if (list.value.kind !== "unprotected") return { kind: "already" };
  const r = await access.protect(branch);
  if (!r.ok) return { kind: "refused", manualSteps: r.manualSteps };
  return r.value === "unavailable" ? { kind: "unavailable" } : { kind: "protected" };
}
