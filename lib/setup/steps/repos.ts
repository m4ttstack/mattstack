/**
 * `repos.clone`: places every repo the team snapshot declares as tracked
 * (`mattstack.tracking`) where the "Your repos" rows say: a recorded
 * checkout is indexed, a recorded clone location is cloned into exactly, an
 * existing clone rt finds is indexed, and anything else clones to the
 * default the row showed. A joiner's app-driven Install leaves an
 * unanswered repo for the rows (needs-you). Individual failures (auth,
 * network, timeout) are logged with a reason and never stop the run; the
 * step then reports `partial`, naming them.
 */

import { dirname } from "path";
import { updateRepoIndexAsync } from "../../repo-index.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { linkPath } from "../../deps/links.ts";
import { gitWithToken } from "../../team/git-credential.ts";
import { withoutUrls } from "../../team/redact.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { PROGRESS_SHAPE, REMOTE_COUNTING, parseGitProgress, splitProgressLines } from "../git-progress.ts";
import type { ExecResult } from "../probes.ts";
import {
  checkCheckout,
  checkCloneTarget,
  clearCloneFailure,
  clearDeferred,
  clearJoining,
  clearPlacement,
  configuredRepoRoots,
  isReusableCloneOf,
  markDeferred,
  readPlacements,
  recordCloneFailure,
  repoBasename,
  resolvePlacements,
  takenFor,
} from "../repo-placement.ts";
import { expandHome, promoteStagedRepoRoot } from "../repo-root.ts";
import { homeGitDir } from "./home.ts";
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

export { repoBasename };

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
 * Null when indexed, else why not.
 */
async function indexDest(identity: string, dest: string): Promise<string | null> {
  // The index keys on the serialized identity; `identity` here is already the
  // raw host/path the tracked-repos setting carries.
  const indexed = await updateRepoIndexAsync(serializeIdentity({ kind: "remote", id: identity }), dest);
  if (indexed.ok) return null;
  const run = indexed.next ? `Run ${indexed.next}, then rt repos locate ${dest}` : `Run rt repos locate ${dest}`;
  return `${dest} is in place, but ${identity} is indexed at a path that no longer exists and could not be moved (${indexed.error}). ${run}`;
}

/** Each whole line git writes goes to `ctx.progress` when it reads as progress; a line split across chunks waits for its end. */
function progressReader(ctx: ApplyContext): (chunk: string) => void {
  let pending = "";
  return (chunk) => {
    const text = pending + chunk;
    const cut = Math.max(text.lastIndexOf("\r"), text.lastIndexOf("\n")) + 1;
    pending = text.slice(cut);
    for (const line of splitProgressLines(text.slice(0, cut))) {
      const report = parseGitProgress(line);
      if (report) ctx.progress?.("repos.clone", report);
    }
  };
}

function cloningDetail(base: string, n: number, total: number, found: string[]): string {
  const head = `Cloning ${base} (${n} of ${total})`;
  if (found.length === 0) return head;
  const names = found.length === 1 ? found[0]! : `${found.slice(0, -1).join(", ")} and ${found.at(-1)!}`;
  return `${head} · ${names} ${found.length === 1 ? "was" : "were"} already on this Mac`;
}

/** Never empty: git killed without a word still says how it ended. */
function cloneFailureReason(result: ExecResult): string {
  const stderr = splitProgressLines(result.stderr)
    .filter((line) => !PROGRESS_SHAPE.test(line) && !REMOTE_COUNTING.test(line))
    .join("\n");
  const output = withoutUrls(`${result.stdout}\n${stderr}`.trim());
  if (result.code === TIMED_OUT && !output) return `timed out after ${CLONE_TIMEOUT_MS / 60_000} minutes`;
  if (result.signal) return `${output ? `${output} ` : ""}git was killed by ${result.signal} (exit ${result.code})`.trim();
  return output ? `${output} (git exited ${result.code})` : `git exited ${result.code} with no output`;
}

/**
 * Append-only, so a root set by hand or by an earlier setup stays first. The
 * machine store lives inside the home repo, so nothing is written before it
 * exists (the guard `promoteStagedRepoRoot` carries).
 */
function rememberRepoRoot(ctx: ApplyContext, parent: string): void {
  const { p } = ctx;
  if (!p.exists(homeGitDir(p.home))) return;
  try {
    const roots = getSetting<string[]>("rt.repoRoots").value ?? [];
    if (roots.some((root) => expandHome(p, root) === parent)) return;
    setSetting("rt.repoRoots", [...roots, parent], "machine");
  } catch (err) {
    ctx.log("repos.clone", `${parent} was not added to rt.repoRoots: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A repo in its place is no longer waiting on an answer, and its folder joins the roots rt scans. */
function landed(ctx: ApplyContext, identity: string, path: string): void {
  clearPlacement(ctx.p, identity);
  clearDeferred(ctx.p, identity);
  clearCloneFailure(ctx.p, identity);
  rememberRepoRoot(ctx, dirname(path));
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
    return p.execStreaming(["git", ...CLONE_STALL_ARGS, "clone", "--progress", sshRemote, dest], { env: SSH_CLONE_ENV, timeoutMs: CLONE_TIMEOUT_MS, onStderr: progressReader(ctx) });
  }

  const remote = `https://${identity}.git`;
  const token = await trustedForgeTokenFor(ctx, remote);
  const git = gitWithToken([...CLONE_STALL_ARGS, "clone", "--progress", remote, dest], token, CLONE_ENV, { remote });
  const result = await p.execStreaming(git.argv, { env: git.env, timeoutMs: CLONE_TIMEOUT_MS, onStderr: progressReader(ctx) });
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

  const skip = skippedIdentities(p.env);
  const tracked = ctx.snapshot?.trackingIdentities ?? [];
  const identities = tracked.filter((identity) => {
    const base = repoBasename(identity);
    return !skip.has(identity) && !skip.has(base);
  });

  if (identities.length === 0) {
    clearJoining(p);
    return { state: "skipped", detail: "No repos to clone" };
  }

  // The rows resolve over the whole tracked list too, so both agree on which of two same-named repos keeps the default.
  const resolved = await resolvePlacements(p, tracked, configuredRepoRoots(p));
  const { deferred, joining } = readPlacements(p);
  const joiner = ctx.intent?.mode === "join" || joining === true;
  const waitsForRows = (identity: string) => ctx.appDriven === true && !ctx.nonInteractive && !ctx.ci && (joiner || deferred.includes(identity));

  let cloned = 0;
  const found: string[] = [];
  const failed: string[] = [];
  const waiting: string[] = [];

  /** The reason is kept for the repo's row, which shows it with a Retry. */
  const fail = (identity: string, reason: string, line = reason): void => {
    const base = repoBasename(identity);
    failed.push(base);
    ctx.log("repos.clone", `${base}: ${line}`);
    recordCloneFailure(p, identity, reason);
  };
  const place = async (identity: string, path: string): Promise<boolean> => {
    const refused = await indexDest(identity, path);
    if (refused !== null) {
      fail(identity, refused);
      return false;
    }
    landed(ctx, identity, path);
    return true;
  };

  for (const [i, identity] of identities.entries()) {
    const base = repoBasename(identity);
    const placement = resolved[identity]!;

    if (placement.mode === "checkout") {
      if (placement.source === "recorded") {
        const check = await checkCheckout(p, identity, placement.path, { tracked });
        if (!check.ok) {
          fail(identity, check.detail);
          continue;
        }
      } else {
        ctx.log("repos.clone", `${base}: using the existing clone at ${placement.path}`);
      }
      if (await place(identity, placement.path)) found.push(base);
      continue;
    }

    if (placement.source === "default" && waitsForRows(identity)) {
      markDeferred(p, identity);
      waiting.push(base);
      continue;
    }

    // A run that cloned but could not index leaves its placement behind; the clone is there, so index it.
    if (await isReusableCloneOf(p, placement.path, identity)) {
      if (await place(identity, placement.path)) found.push(base);
      continue;
    }

    const target = checkCloneTarget(p, placement.path, takenFor(resolved, tracked, identity));
    if (!target.ok) {
      fail(identity, target.detail);
      continue;
    }
    const dest = target.path;

    // An empty folder the member chose is cloned into and never removed. Otherwise claiming `dest` with an exclusive mkdir makes "this run created it" a fact rather than an earlier observation, so the cleanup below can never remove a folder something else made meanwhile.
    const chosenEmpty = p.statPath(dest) !== null;
    if (!chosenEmpty) {
      p.mkdirp(dirname(dest));
      if (!p.mkdirExclusive(dest)) {
        fail(identity, `${dest} appeared while this step was running; left alone, rerun the step to check it`);
        continue;
      }
    }

    ctx.emit({ event: "step", id: "repos.clone", state: "running", detail: cloningDetail(base, i + 1, identities.length, found) });
    const result = await cloneInto(ctx, identity, dest);
    if (result.code !== 0) {
      const reason = cloneFailureReason(result);
      fail(identity, reason, `clone failed: ${reason}`);
      if (!chosenEmpty) p.removeDir(dest);
      continue;
    }

    if (await place(identity, dest)) cloned++;
  }

  // From here the deferred list carries which repos still wait on an answer.
  clearJoining(p);

  const failures = failed.length > 0 ? `. Failed: ${failed.join(", ")}` : "";
  if (waiting.length > 0) {
    return { state: "needs-you", detail: `cloned ${cloned}, present ${found.length}, ${waiting.length} waiting for you${failures}`, remedy: "Choose where your repos go in Setup" };
  }
  const tally = `cloned ${cloned}, present ${found.length}, failed ${failed.length}`;
  if (failed.length === 0) return { state: "done", detail: tally };
  return {
    state: "partial",
    detail: `${tally}. Failed: ${failed.join(", ")}`,
    remedy: "The step log says why. Fix that, then Retry. If you already have a clone, run rt repos register <path> first and rt uses it instead of cloning again.",
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
