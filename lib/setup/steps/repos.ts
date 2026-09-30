/**
 * `repos.clone`: clones every repo the team snapshot declares as tracked
 * (`mattstack.tracking`) into the first configured `rt.repoRoots` entry,
 * unless a clone of it already exists: at the destination, at the path the
 * repo index holds for it (`rt repos register`), or directly under any repo
 * root. Individual failures (auth, network, timeout) are logged with a reason
 * and never stop the run; the step then reports `partial`, naming them.
 */

import { join } from "path";
import { resolveIndexPathForIdentity, updateRepoIndexAsync } from "../../repo-index.ts";
import { getSetting } from "../../settings/resolve.ts";
import { deriveRepoIdentity, normalizeRemote, serializeIdentity } from "../../settings/identity.ts";
import { linkPath } from "../../deps/links.ts";
import { gitWithToken } from "../../team/git-credential.ts";
import { withoutUrls } from "../../team/redact.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import type { ExecResult } from "../probes.ts";
import { expandHome, promoteStagedRepoRoot } from "../repo-root.ts";
import { trustedForgeTokenFor } from "./forge-token.ts";
import { toFailedOutcome } from "./step-utils.ts";

/** Mirrors lib/team/join.ts's own clone env — never prompt for credentials in an unattended run, and never let a global gitconfig credential helper substitute one in behind the operator's back. */
const CLONE_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_PROTOCOL_FROM_USER: "0" };
/**
 * A large monorepo takes tens of minutes on an ordinary connection, so the
 * hard budget is only a backstop. A stalled transfer is caught sooner by git
 * itself through `CLONE_STALL_ARGS`, which leaves a slow-but-moving clone alone.
 */
const CLONE_TIMEOUT_MS = 60 * 60_000;
/** Git aborts an HTTP transfer that stays under 1 KB/s for five minutes, with its own error on stderr. */
export const CLONE_STALL_ARGS = ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=300"];
const SSH_CLONE_ENV = { ...CLONE_ENV, GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15" };
const SSH_PROBE_TIMEOUT_MS = 30_000;
/** execWithTimeout's code for a child it killed at the deadline. */
const TIMED_OUT = 124;

/** The identity's last path segment (`github.com/acme/repo` -> `repo`) — the clone destination's directory name. Exported: `steps/skills.ts`'s `board.keys` derives the same registered-repo-name set from tracking identities and must agree with this step on what a repo is called. */
export function repoBasename(identity: string): string {
  return identity.split("/").pop() || identity;
}

/** `RT_SKIP_REPOS`: identities or basenames the operator told Install to leave uncloned. Exported: `board.keys` must not wait on a repo this step will never land. */
export function skippedIdentities(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.RT_SKIP_REPOS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Index `dest` under the tracked identity, reporting a refused move rather
 * than counting the repo present/cloned: the row would still name the path
 * the repo moved away from, so the tally would claim a repo rt cannot reach.
 */
async function indexDest(ctx: ApplyContext, identity: string, base: string, dest: string): Promise<boolean> {
  // The index keys on the serialized identity; `identity` here is already the
  // raw host/path the tracked-repos setting carries.
  const indexed = await updateRepoIndexAsync(serializeIdentity({ kind: "remote", id: identity }), dest);
  if (indexed.ok) return true;
  ctx.log("repos.clone", `${base}: ${dest} is in place, but ${identity} is indexed at a path that no longer exists and could not be moved — ${indexed.error}; run: rt repos locate ${dest}`);
  return false;
}

/** A real clone of `identity`, not just any directory that happens to share its basename — two tracked identities can collide on basename (`gitlab.com/a/api`, `github.com/b/api`), and an unrelated folder can already occupy the path. */
function isCloneOf(p: ApplyContext["p"], dest: string, identity: string): boolean {
  const config = p.readFile(join(dest, ".git", "config"));
  if (config === null) return false;
  // Any remote's URL, in whatever form git accepts (scp-style ssh has no slash after the host), normalized to the identity's own host/path form.
  for (const match of config.matchAll(/^\s*url\s*=\s*(\S+)/gm)) {
    if (normalizeRemote(match[1]!) === identity) return true;
  }
  return false;
}

/** Never empty: git killed without a word still says how it ended. */
function cloneFailureReason(result: ExecResult): string {
  const output = withoutUrls(`${result.stdout}\n${result.stderr}`.trim());
  if (result.code === TIMED_OUT && !output) return `timed out after ${CLONE_TIMEOUT_MS / 60_000} minutes`;
  if (result.signal) return `${output ? `${output} ` : ""}git was killed by ${result.signal} (exit ${result.code})`.trim();
  return output ? `${output} (git exited ${result.code})` : `git exited ${result.code} with no output`;
}

/**
 * `isCloneOf` is only a prefilter: any `url =` line matches it, so a fork
 * whose `upstream` is the tracked repo, or a superproject carrying it as a
 * submodule, would pass. The repo's own derived identity (origin) decides.
 */
async function isReusableCloneOf(p: ApplyContext["p"], path: string, identity: string): Promise<boolean> {
  if (!isCloneOf(p, path, identity)) return false;
  try {
    return serializeIdentity(await deriveRepoIdentity(path)) === serializeIdentity({ kind: "remote", id: identity });
  } catch {
    return false;
  }
}

/** An existing clone of `identity` somewhere other than `dest`: the index's own row first, then any direct child of a repo root. */
async function findExistingClone(p: ApplyContext["p"], identity: string, dest: string, rootPaths: string[]): Promise<{ path: string; indexed: boolean } | null> {
  const indexed = await resolveIndexPathForIdentity(serializeIdentity({ kind: "remote", id: identity }));
  if (indexed && indexed !== dest && (await isReusableCloneOf(p, indexed, identity))) return { path: indexed, indexed: true };
  for (const rootPath of rootPaths) {
    for (const child of p.readDir(rootPath)) {
      const candidate = join(rootPath, child);
      if (candidate !== dest && (await isReusableCloneOf(p, candidate, identity))) return { path: candidate, indexed: false };
    }
  }
  return null;
}

/** The value of a `credential.<url>.helper` that asks rt for its forge token; git appends the operation. */
export function rtCredentialHelper(rtPath: string): string {
  return `!'${rtPath.replace(/'/g, "'\\''")}' git credential`;
}

/**
 * Whether the user's own SSH setup already reaches `sshRemote`. BatchMode
 * makes a missing key, a passphrase prompt or an unknown host key a quick
 * failure rather than a hang, so a machine that has never used SSH with this
 * forge falls through to https.
 */
async function sshReaches(p: ApplyContext["p"], sshRemote: string): Promise<boolean> {
  const result = await p.exec(["git", "ls-remote", "--exit-code", sshRemote, "HEAD"], { env: SSH_CLONE_ENV, timeoutMs: SSH_PROBE_TIMEOUT_MS });
  return result.code === 0 || result.code === 2;
}

/**
 * The clone's origin is what every later fetch uses, rt's worktree pool
 * included. SSH when the user's key already reaches the forge, so it keeps
 * working with the user's own credentials. Otherwise https with rt's token,
 * and rt is then named as that host's credential helper in this clone, which
 * is rt's own to configure; the token itself never lands in the config.
 */
async function cloneInto(ctx: ApplyContext, identity: string, dest: string): Promise<ExecResult> {
  const { p } = ctx;
  const slash = identity.indexOf("/");
  const host = identity.slice(0, slash);
  const sshRemote = `git@${host}:${identity.slice(slash + 1)}.git`;
  if (slash > 0 && (await sshReaches(p, sshRemote))) {
    return p.exec(["git", ...CLONE_STALL_ARGS, "clone", sshRemote, dest], { env: SSH_CLONE_ENV, timeoutMs: CLONE_TIMEOUT_MS });
  }

  const remote = `https://${identity}.git`;
  const token = await trustedForgeTokenFor(ctx, remote);
  const git = gitWithToken([...CLONE_STALL_ARGS, "clone", remote, dest], token, CLONE_ENV, { remote });
  const result = await p.exec(git.argv, { env: git.env, timeoutMs: CLONE_TIMEOUT_MS });
  const rt = linkPath(p.home, "rt");
  if (result.code === 0 && token && p.exists(rt)) {
    // The empty entry clears every helper before it for this host, so git's
    // `store` after a successful auth cannot hand rt's token to a keychain.
    const key = `credential.https://${host}.helper`;
    for (const value of ["", rtCredentialHelper(rt)]) {
      const helper = await p.exec(["git", "-C", dest, "config", "--add", key, value], { env: CLONE_ENV });
      if (helper.code !== 0) {
        ctx.log("repos.clone", `${repoBasename(identity)}: cloned, but rt could not be set as its credential helper: ${withoutUrls(helper.stderr.trim())}`);
        break;
      }
    }
  }
  return result;
}

async function reposCloneRun(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await reposCloneRunUnsafe(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

async function reposCloneRunUnsafe(ctx: ApplyContext): Promise<StepOutcome> {
  const { p } = ctx;

  // `rt setup apply --only repos.clone` is a documented remedy channel and
  // skips settings.seed (step 8), so this step drains staging itself. Above
  // the zero-identities return: a remedy run with nothing to clone must
  // still promote a pre-Install answer, or it sits in the staging file forever.
  promoteStagedRepoRoot(p);

  // Computed BEFORE the root check: zero identities means there is no work
  // regardless of whether a root is configured, and `skipped` — the
  // engine's honest "nothing to do here" — is the truth, not `failed`.
  const skip = skippedIdentities(p.env);
  const identities = (ctx.snapshot?.trackingIdentities ?? []).filter((identity) => {
    const base = repoBasename(identity);
    return !skip.has(identity) && !skip.has(base);
  });

  if (identities.length === 0) {
    return { state: "skipped", detail: "no repos to clone" };
  }

  // No root is a normal condition, not a terminal one: the repos.root row is
  // the GUI's gate, but a CLI install can reach this step unanswered, and
  // `failed` would dead-end Install with a Retry that resumes here and fails
  // identically. The remedy names the validating verb, never a raw settings
  // write, which would accept a path that does not exist.
  const root = getSetting<string[]>("rt.repoRoots").value?.[0];
  if (!root) {
    return { state: "skipped", detail: "no repo root chosen yet ... run rt setup repo-root set <folder>, then re-run rt setup apply to clone your tracked repos" };
  }
  // A hand-authored "~/dev" through rt settings set: the row reads it ready
  // through the same expansion, so the clone must expand too or the two
  // disagree about the identical stored string.
  const rootPath = expandHome(p, root);
  const rootPaths = (getSetting<string[]>("rt.repoRoots").value ?? []).map((r) => expandHome(p, r));

  let cloned = 0;
  let present = 0;
  const failed: string[] = [];

  for (const identity of identities) {
    const base = repoBasename(identity);
    const dest = join(rootPath, base);

    if (p.exists(dest)) {
      if (!isCloneOf(p, dest, identity)) {
        failed.push(base);
        ctx.log("repos.clone", `${base}: ${dest} exists but isn't a clone of ${identity} (basename collision or unrelated folder) — resolve by hand`);
        continue;
      }
      if (await indexDest(ctx, identity, base, dest)) present++;
      else failed.push(base);
      continue;
    }

    const existing = await findExistingClone(p, identity, dest, rootPaths);
    if (existing) {
      ctx.log("repos.clone", `${base}: using the existing clone at ${existing.path}`);
      if (existing.indexed || (await indexDest(ctx, identity, base, existing.path))) present++;
      else failed.push(base);
      continue;
    }

    // Claiming `dest` with an exclusive mkdir makes "this run created it" a fact rather than an earlier observation, so the cleanup below can never remove a folder something else made meanwhile.
    p.mkdirp(rootPath);
    if (!p.mkdirExclusive(dest)) {
      failed.push(base);
      ctx.log("repos.clone", `${base}: ${dest} appeared while this step was running; left alone, rerun the step to check it`);
      continue;
    }

    const result = await cloneInto(ctx, identity, dest);
    if (result.code !== 0) {
      failed.push(base);
      ctx.log("repos.clone", `${base}: clone failed: ${cloneFailureReason(result)}`);
      p.removeDir(dest);
      continue;
    }

    if (await indexDest(ctx, identity, base, dest)) cloned++;
    else failed.push(base);
  }

  const tally = `cloned ${cloned}, present ${present}, failed ${failed.length}`;
  if (failed.length === 0) return { state: "done", detail: tally };
  return {
    state: "partial",
    detail: `${tally} (${failed.join(", ")})`,
    remedy: "The step log says why. Retry this step once that is fixed (rt setup apply --from repos.clone). If you already have a clone, run rt repos register <path> first and rt uses it instead of cloning again.",
  };
}

export const reposCloneStep: StepDef = {
  id: "repos.clone",
  feedsIntercepts: true,
  title: "Clone your repos",
  kind: "rt",
  applies: () => true,
  run: reposCloneRun,
};
