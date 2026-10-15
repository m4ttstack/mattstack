/**
 * An org admin's copy of the org can sit on a branch of their own, to try a
 * change before everyone gets it. The branch is made from the org's data
 * branch when it does not exist yet, and the daemon auto-commits there on
 * this Mac only (`trialBranch`).
 */

import { basename } from "path";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { warn } from "../ui/warn.ts";
import { gitWithToken } from "./git-credential.ts";
import { applyRoleCone } from "./org-cone.ts";
import { heldCopy, moveCloneToDataBranch, type HeldMove } from "./org-data-branch.ts";
import { markerState } from "./org-marker.ts";
import { withoutUrls } from "./redact.ts";
import { roleFor } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { updateTeamLocal } from "./team-local.ts";

export interface BranchUse {
  branch: string;
  created: boolean;
  trial: boolean;
}

export interface TrialBranchOptions {
  readToken?: (p: Probes, remote: string) => Promise<string | null>;
}

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

const HELD_WHY: Record<HeldMove["why"], (held: HeldMove) => string> = {
  dirty: () => "Save or discard those changes, then try again.",
  detached: () => "Switch it back to a branch, then try again.",
  uncarried: (held) => heldCopy(held).remedy,
};

async function remoteOf(p: Probes, dir: string): Promise<string> {
  const url = await p.exec(["git", "remote", "get-url", "origin"], { cwd: dir, env: ENV });
  if (url.code !== 0) {
    throw new UserActionableError("trial-branch-no-remote", "Your copy of the org has no remote to switch branches on", {}, { log: withoutUrls(url.stderr) });
  }
  return url.stdout.trim();
}

async function validName(p: Probes, dir: string, name: string): Promise<boolean> {
  if (name === "HEAD" || name.startsWith("-")) return false;
  return (await p.exec(["git", "check-ref-format", "--branch", name], { cwd: dir, env: ENV })).code === 0;
}

/** Makes `name` on origin from the data branch's published tip, never from local commits that are not published. */
async function createOnRemote(p: Probes, dir: string, name: string, dataBranch: string, token: string | null, remote: string): Promise<void> {
  const tracking = `refs/remotes/origin/${dataBranch}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", `+refs/heads/${dataBranch}:${tracking}`], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) throw new UserActionableError("trial-branch-failed", `rt could not read the ${dataBranch} branch to start ${name} from it`, {}, { log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) });
  const push = gitWithToken(["push", "-q", "origin", `${tracking}:refs/heads/${name}`], token, ENV, { remote });
  const pushed = await p.exec(push.argv, { cwd: dir, env: push.env });
  if (pushed.code !== 0) throw new UserActionableError("trial-branch-failed", `rt could not publish the ${name} branch`, {}, { why: "Check that you can push to the org repo.", log: withoutUrls(`${pushed.stdout}\n${pushed.stderr}`.trim()) });
}

export async function useBranch(p: Probes, slug: string, name: string, opts: TrialBranchOptions = {}): Promise<BranchUse> {
  if (!isOrgAdmin(roleFor(p, slug))) {
    throw new UserActionableError("trial-branch-admin-only", "Only an org admin switches the org to a trial branch", {}, { why: "Ask an org admin to try the change." });
  }
  const dir = orgDirUnder(p.home, slug);
  if (!p.exists(dir)) {
    throw new UserActionableError("no-team-zone", `The ${slug} team is not on this Mac`, {}, { next: "rt team create" });
  }
  if (!(await validName(p, dir, name))) {
    throw new UserActionableError("bad-branch-name", `"${name}" is not a branch name git accepts`, {}, { why: "Use letters, digits, dashes, dots and slashes." });
  }
  const marker = markerState(p, dir);
  if (marker.kind !== "org" || marker.dataBranch === null) {
    throw new UserActionableError("trial-branch-not-moved", "Your copy of the org has not moved to its data branch yet, so there is nothing to try a branch from", {}, { next: `rt team pull --team ${slug}` });
  }
  const dataBranch = marker.dataBranch;
  const remote = await remoteOf(p, dir);
  let token: string | null = null;
  try {
    token = await (opts.readToken ?? storedForgeToken)(p, remote);
  } catch (err) {
    warn("trial-branch", `could not read the forge token for ${withoutUrls(remote)}; using git's own credentials`, { context: { err: String(err) } });
  }

  const listed = gitWithToken(["ls-remote", "--heads", "origin", `refs/heads/${name}`], token, ENV, { remote });
  const found = await p.exec(listed.argv, { cwd: dir, env: listed.env });
  if (found.code !== 0) throw new UserActionableError("trial-branch-failed", "rt could not look for that branch on the org repo", {}, { log: withoutUrls(`${found.stdout}\n${found.stderr}`.trim()) });
  const created = found.stdout.trim() === "";
  if (created) await createOnRemote(p, dir, name, dataBranch, token, remote);

  const moved = await moveCloneToDataBranch(p, dir, name, token, remote);
  if (moved.kind === "held") {
    const { detail } = heldCopy(moved);
    throw new UserActionableError("trial-branch-held", detail, {}, { why: HELD_WHY[moved.why](moved), next: `rt team branch use ${name} --team ${slug}` });
  }
  if (moved.kind === "failed") {
    throw new UserActionableError("trial-branch-failed", `rt could not switch your copy of the org to ${name}`, {}, { log: moved.log });
  }
  try {
    await applyRoleCone(p, dir, basename(dir));
  } catch (err) {
    warn("trial-branch", `switched ${basename(dir)} to the ${name} branch but could not narrow it to the role's folders`, { context: { err: String(err) } });
  }
  const trial = name !== dataBranch;
  updateTeamLocal(p, slug, { trialBranch: trial ? name : undefined });
  return { branch: name, created, trial };
}
