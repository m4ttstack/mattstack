/**
 * An org admin's copy of the org can sit on a branch of their own, to try a
 * change before everyone gets it. The branch is made from the org's data
 * branch when it does not exist yet, and the daemon auto-commits there on
 * this Mac only (`trialBranch`).
 */

import { basename, join } from "path";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { warn } from "../ui/warn.ts";
import { gitWithToken } from "./git-credential.ts";
import { applyRoleCone } from "./org-cone.ts";
import { ENV, heldCopy, moveBlocker, moveCloneToDataBranch, type HeldMove } from "./org-data-branch.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { ORG_MARKER_REL, parseMarker } from "./org-marker.ts";
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

const HELD_WHY: Record<HeldMove["why"], (held: HeldMove) => string> = {
  dirty: () => "Save or discard those changes, then try again.",
  detached: () => "Switch it back to a branch, then try again.",
  uncarried: (held) => heldCopy(held).remedy,
  unpushed: (held) => heldCopy(held).remedy,
  stranded: (held) => heldCopy(held).remedy,
};

function heldError(held: HeldMove, name: string, slug: string): UserActionableError {
  const next = held.why === "unpushed" ? `rt team publish --team ${slug}` : `rt team branch use ${name} --team ${slug}`;
  return new UserActionableError("trial-branch-held", heldCopy(held).detail, {}, { why: HELD_WHY[held.why](held), next });
}

async function remoteOf(p: Probes, dir: string): Promise<string> {
  const url = await p.exec(["git", "remote", "get-url", "origin"], { cwd: dir, env: ENV });
  if (url.code !== 0) {
    throw new UserActionableError("trial-branch-no-remote", "Your copy of the org has no remote to switch branches on", {}, { log: withoutUrls(url.stderr) });
  }
  return url.stdout.trim();
}

async function validName(p: Probes, dir: string, name: string): Promise<boolean> {
  if (name === "HEAD" || name.startsWith("-") || name.includes("@{")) return false;
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

/** A branch with no org store (the pointer a layout 4 org leaves on `main`) is never a usable data branch. */
async function assertHoldsOrgData(p: Probes, dir: string, name: string, token: string | null, remote: string): Promise<void> {
  const tracking = `refs/remotes/origin/${name}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", `+refs/heads/${name}:${tracking}`], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) throw new UserActionableError("trial-branch-failed", `rt could not read the ${name} branch`, {}, { log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) });
  const has = await p.exec(["git", "cat-file", "-e", `${tracking}:${ORG_STORE_REL}`], { cwd: dir, env: ENV });
  if (has.code !== 0) throw new UserActionableError("trial-branch-no-org-data", `The ${name} branch holds no org data, so rt did not switch`);
}

/**
 * The branch origin's `main` points the org's data at: the `dataBranch` its
 * marker names (layout 4), or null when it names none because `main` itself
 * holds the data (layout 3). Whatever branch a marker names for itself says
 * nothing here: a trial made with the conversion script names itself too.
 */
async function publishedDataBranch(p: Probes, dir: string, token: string | null, remote: string): Promise<string | null> {
  const tracking = "refs/remotes/origin/main";
  const fetch = gitWithToken(["fetch", "-q", "origin", `+refs/heads/main:${tracking}`], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) throw new UserActionableError("trial-branch-failed", "rt could not read where the org keeps its data", {}, { log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) });
  const shown = await p.exec(["git", "show", `${tracking}:${ORG_MARKER_REL}`], { cwd: dir, env: ENV });
  const marker = shown.code === 0 ? parseMarker(shown.stdout) : null;
  return marker?.kind === "org" ? marker.dataBranch : null;
}

export async function useBranch(p: Probes, slug: string, name: string, opts: TrialBranchOptions = {}): Promise<BranchUse> {
  const dir = orgDirUnder(p.home, slug);
  if (!p.exists(dir)) {
    throw new UserActionableError("no-team-zone", `The ${slug} team is not on this Mac`, {}, { next: "rt team create" });
  }
  if (!isOrgAdmin(roleFor(p, slug))) {
    throw new UserActionableError("trial-branch-admin-only", "Only an org admin switches the org to a trial branch", {}, { why: "Ask an org admin to try the change." });
  }
  if (!(await validName(p, dir, name))) {
    throw new UserActionableError("bad-branch-name", `"${name}" is not a branch name git accepts`, {}, { why: "Use letters, digits, dashes, dots and slashes." });
  }
  const remote = await remoteOf(p, dir);
  let token: string | null = null;
  try {
    token = await (opts.readToken ?? storedForgeToken)(p, remote);
  } catch (err) {
    warn("trial-branch", `could not read the forge token for ${withoutUrls(remote)}; using git's own credentials`, { context: { err: String(err) } });
  }

  if ((await checkedOutBranch(p, dir)) !== name) {
    const blocker = await moveBlocker(p, dir, { carry: false });
    if (blocker?.kind === "held") throw heldError(blocker, name, slug);
    if (blocker?.kind === "failed") throw new UserActionableError("trial-branch-failed", `rt could not switch your copy of the org to ${name}`, {}, { log: blocker.log });
  }

  const listed = gitWithToken(["ls-remote", "--heads", "origin", `refs/heads/${name}`], token, ENV, { remote });
  const found = await p.exec(listed.argv, { cwd: dir, env: listed.env });
  if (found.code !== 0) throw new UserActionableError("trial-branch-failed", "rt could not look for that branch on the org repo", {}, { log: withoutUrls(`${found.stdout}\n${found.stderr}`.trim()) });
  const created = found.stdout.trim() === "";
  const published = await publishedDataBranch(p, dir, token, remote);
  if (created) {
    const own = parseMarker(p.readFile(join(dir, ORG_MARKER_REL)));
    // The clone's own marker and origin's pointer must both name a data branch: otherwise the org has none to start a new branch from.
    if (published === null || own.kind !== "org" || own.dataBranch === null) {
      throw new UserActionableError("trial-branch-not-moved", "The org has no data branch yet to start a new branch from", {}, { why: "You can switch to a branch the conversion script made, or run rt team pull once the org has moved." });
    }
    await createOnRemote(p, dir, name, published, token, remote);
  } else {
    await assertHoldsOrgData(p, dir, name, token, remote);
  }

  const moved = await moveCloneToDataBranch(p, dir, name, token, remote, { carry: false });
  if (moved.kind === "held") throw heldError(moved, name, slug);
  if (moved.kind === "failed") {
    throw new UserActionableError("trial-branch-failed", `rt could not switch your copy of the org to ${name}`, {}, { log: moved.log });
  }
  try {
    await applyRoleCone(p, dir, basename(dir));
  } catch (err) {
    warn("trial-branch", `switched ${basename(dir)} to the ${name} branch but could not narrow it to the role's folders`, { context: { err: String(err) } });
  }
  const trial = name !== (published ?? "main");
  updateTeamLocal(p, slug, { trialBranch: trial ? name : undefined });
  return { branch: name, created, trial };
}
