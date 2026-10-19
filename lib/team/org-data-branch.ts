/**
 * Switches an org clone, in place, onto the branch its org's data lives on.
 * The two branches share no history, so this is a checkout of an unrelated
 * branch, never a merge. Unpushed commits on the org's data are replayed onto
 * it; a clone with anything unsaved, or commits that cannot be replayed, is
 * held with its old branch untouched.
 */

import { basename } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { warn } from "../ui/warn.ts";
import { gitWithToken } from "./git-credential.ts";
import { checkedOutBranch, knownDataBranch } from "./org-branch.ts";
import { applyRoleCone } from "./org-cone.ts";
import { gateVerdict, headHoldsOrgStore, showMarkerAt } from "./org-layout.ts";
import { DATA_README_REL, markerState, ORG_MARKER_REL, POINTER_REL } from "./org-marker.ts";
import { withoutUrls } from "./redact.ts";
import { containsCommit } from "./remote-head.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { editTeamLocal, readTeamLocal } from "./team-local.ts";

export type HeldMove =
  | { kind: "held"; why: "dirty"; files: string[] }
  | { kind: "held"; why: "uncarried"; commits: number; reason: "outside" | "clash" }
  | { kind: "held"; why: "unpushed"; commits: number; branch: string }
  | { kind: "held"; why: "stranded"; commits: number; branch: string }
  | { kind: "held"; why: "detached" };

export type MoveResult =
  | { kind: "moved"; branch: string; carried?: number }
  | { kind: "already"; branch: string }
  | HeldMove
  | { kind: "failed"; log: string };

/** What a convergence may also end in: origin could not be asked, so whether the data moved is unknown until the next try. */
export type ConvergeResult = MoveResult | { kind: "unchecked"; log: string };

export const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
/** The branch `rt team create` starts an org's data on. */
export const DEFAULT_DATA_BRANCH = "mattstack";
/** The branch whose only file is the marker naming the data branch: what an invite and a join read first. */
export const POINTER_BRANCH = "main";

/** A clone on the data branch fetches that branch and nothing else. */
export const dataBranchRefspec = (branch: string): string => `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
const FILES_SHOWN = 5;
/** Every path the org's data branch holds; a commit touching anything else is not the org's data and is never carried. */
const DATA_PATH = (path: string): boolean =>
  path.startsWith("mattstack/") || path.startsWith(".claude-plugin/") || path === ".sops.yaml" || path === ".gitignore" || path === DATA_README_REL;

const commitsWord = (n: number): string => (n === 1 ? "1 unpublished commit" : `${n} unpublished commits`);

export const MOVED_DONE = (branch: string, carried = 0): string =>
  `Moved your copy of the org to the ${branch} branch${carried > 0 ? `, with your ${commitsWord(carried)}` : ""}`;

/** The words every surface (the org.folder step, `rt team pull`, the org.layout row) shows for a held move. */
export function heldCopy(held: HeldMove): { detail: string; remedy: string } {
  if (held.why === "dirty") {
    const shown = held.files.slice(0, FILES_SHOWN).join(", ");
    const more = held.files.length > FILES_SHOWN ? ` and ${held.files.length - FILES_SHOWN} more` : "";
    return { detail: `Your copy of the org has unsaved changes: ${shown}${more}`, remedy: "Save or discard those changes, then run rt team pull" };
  }
  if (held.why === "unpushed") {
    const one = held.commits === 1;
    return {
      detail: `Your copy of the org has ${held.commits} ${one ? "commit" : "commits"} on ${held.branch} that ${one ? "is" : "are"} not pushed yet, so rt did not switch`,
      remedy: "Push them first, then try again",
    };
  }
  if (held.why === "stranded") {
    const one = held.commits === 1;
    return {
      detail: `Your copy of the org has ${held.commits} ${one ? "commit" : "commits"} on the ${held.branch} branch that origin does not have, so rt did not switch to it`,
      remedy: `Ask an org admin to help move ${one ? "it" : "them"}`,
    };
  }
  if (held.why === "uncarried") {
    const one = held.commits === 1;
    const why = held.reason === "outside"
      ? `${one ? "it changes" : "they change"} files outside the org's data`
      : `${one ? "it clashes" : "they clash"} with changes already there`;
    return {
      detail: `rt could not carry ${commitsWord(held.commits)} to the org's data branch, because ${why}`,
      remedy: `Ask an org admin to help move ${one ? "it" : "them"}`,
    };
  }
  return { detail: "Your copy of the org is not on a branch", remedy: "Switch it back to a branch, then run rt team pull" };
}

type Blocker = HeldMove | { kind: "failed"; log: string };

/** The commits origin has none of, oldest first, or what holds them back from the move. */
type Ready = { kind: "ready"; commits: string[] };

async function unpushed(p: Pick<Probes, "exec">, dir: string, current: string, carry: boolean): Promise<Ready | Blocker> {
  // Against every origin ref, not the branch's own: a missing tracking ref must not make local commits look pushed.
  const listed = await p.exec(["git", "rev-list", "--reverse", "HEAD", "--not", "--remotes=origin"], { cwd: dir, env: ENV });
  if (listed.code !== 0) return { kind: "failed", log: withoutUrls(listed.stderr) };
  const commits = listed.stdout.split("\n").filter(Boolean);
  if (!carry && commits.length > 0) return { kind: "held", why: "unpushed", commits: commits.length, branch: current };
  for (const commit of commits) {
    const touched = await p.exec(["git", "diff-tree", "-r", "--root", "--no-commit-id", "--name-only", commit], { cwd: dir, env: ENV });
    if (touched.code !== 0) return { kind: "failed", log: withoutUrls(touched.stderr) };
    if (touched.stdout.split("\n").filter(Boolean).some((path) => !DATA_PATH(path))) {
      return { kind: "held", why: "uncarried", commits: commits.length, reason: "outside" };
    }
  }
  return { kind: "ready", commits };
}

async function blockerOn(p: Pick<Probes, "exec">, dir: string, current: string | null, carry: boolean): Promise<Ready | Blocker> {
  const status = await p.exec(["git", "status", "--porcelain=v1", "--untracked-files=no"], { cwd: dir, env: ENV });
  if (status.code !== 0) return { kind: "failed", log: withoutUrls(status.stderr) };
  const files = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (files.length > 0) return { kind: "held", why: "dirty", files };
  if (current === null) return { kind: "held", why: "detached" };
  return unpushed(p, dir, current, carry);
}

/** What keeps the clone from moving now: unsaved changes, no branch checked out, or unpushed commits the move cannot carry. Null when nothing does; a clash with the data branch shows only when the move tries. */
export async function moveBlocker(p: Pick<Probes, "exec">, dir: string, opts: MoveOptions = {}): Promise<Blocker | null> {
  const blocker = await blockerOn(p, dir, await checkedOutBranch(p, dir), opts.carry ?? true);
  return blocker.kind === "ready" ? null : blocker;
}

export interface MoveOptions {
  /** Replay unpushed commits onto the target (the one-time convergence). A switch the person chose passes false and holds instead: commits on a branch they were trying stay there. */
  carry?: boolean;
}

const CLASH_RE = /conflict|could not apply|after resolving|is a merge/i;

/**
 * Checks out `branch` from origin and replays the old branch's unpushed
 * commits onto it, authorship kept. A local `branch` holding commits origin
 * lacks is never reset: the move holds and names them. On a clash the old
 * branch is checked out again with its commits and the refspec is left
 * alone; a `branch` the move made is deleted, and one that was already there
 * stays at origin's tip, which already held every commit it had.
 */
export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string, opts: MoveOptions = {}): Promise<MoveResult> {
  const current = await checkedOutBranch(p, dir);
  if (current === branch) return { kind: "already", branch };
  const ready = await blockerOn(p, dir, current, opts.carry ?? true);
  if (ready.kind !== "ready") return ready;
  const refspec = dataBranchRefspec(branch);
  const fetch = gitWithToken(["fetch", "-q", "origin", refspec], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) return { kind: "failed", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const existed = (await p.exec(["git", "rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: dir, env: ENV })).code === 0;
  if (existed) {
    const stranded = await strandedOn(p, dir, branch);
    if (stranded !== null) return stranded;
  }
  const checkout = await p.exec(["git", "checkout", "-q", "-B", branch, `refs/remotes/origin/${branch}`], { cwd: dir, env: ENV });
  if (checkout.code !== 0) return { kind: "failed", log: withoutUrls(checkout.stderr) };
  if (ready.commits.length > 0) {
    const picked = await p.exec(["git", "cherry-pick", ...ready.commits], { cwd: dir, env: ENV });
    if (picked.code !== 0) {
      await p.exec(["git", "cherry-pick", "--abort"], { cwd: dir, env: ENV });
      const back = await p.exec(["git", "checkout", "-q", current!], { cwd: dir, env: ENV });
      if (back.code === 0 && !existed) await p.exec(["git", "branch", "-q", "-D", branch], { cwd: dir, env: ENV });
      const log = withoutUrls(`${picked.stdout}\n${picked.stderr}`.trim());
      if (back.code !== 0) return { kind: "failed", log: `${log}\n${withoutUrls(back.stderr)}`.trim() };
      return CLASH_RE.test(log) ? { kind: "held", why: "uncarried", commits: ready.commits.length, reason: "clash" } : { kind: "failed", log };
    }
  }
  await p.exec(["git", "branch", "-q", "--set-upstream-to", `origin/${branch}`], { cwd: dir, env: ENV });
  await p.exec(["git", "config", "--replace-all", "remote.origin.fetch", refspec], { cwd: dir, env: ENV });
  return ready.commits.length > 0 ? { kind: "moved", branch, carried: ready.commits.length } : { kind: "moved", branch };
}

/** What `git checkout -B` would throw away: commits on the local `branch` that its origin copy does not hold. Null when there are none. */
async function strandedOn(p: Pick<Probes, "exec">, dir: string, branch: string): Promise<HeldMove | { kind: "failed"; log: string } | null> {
  const local = `refs/heads/${branch}`;
  const tracking = `refs/remotes/origin/${branch}`;
  const ancestor = await p.exec(["git", "merge-base", "--is-ancestor", local, tracking], { cwd: dir, env: ENV });
  if (ancestor.code === 0) return null;
  if (ancestor.code !== 1) return { kind: "failed", log: withoutUrls(ancestor.stderr) };
  const counted = await p.exec(["git", "rev-list", "--count", local, "--not", tracking], { cwd: dir, env: ENV });
  if (counted.code !== 0) return { kind: "failed", log: withoutUrls(counted.stderr) };
  return { kind: "held", why: "stranded", commits: Number(counted.stdout.trim()), branch };
}

async function forgeToken(p: Probes, remote: string, readToken: (p: Probes, remote: string) => Promise<string | null>): Promise<string | null> {
  try {
    return await readToken(p, remote);
  } catch (err) {
    warn("org-data-branch", `could not read the forge token for ${withoutUrls(remote)}; fetching with git's own credentials`, { context: { err: String(err) } });
    return null;
  }
}

/**
 * Moves a clone whose own marker names no data branch (a layout 3 clone)
 * once origin's copy of its branch points at one, then narrows it to the
 * role's cone. A clone sitting on `main`'s pointer (its marker names the data
 * branch, its HEAD holds no org store) moves to the branch the pointer names.
 * Null when there is nothing to move: a clone on a data or trial branch
 * (HEAD holds the org store), a detached HEAD, no origin, or an origin branch
 * that still holds the data. `unchecked` when origin could not be asked:
 * nothing was tried.
 */
export async function convergeDataBranch(
  p: Probes,
  dir: string,
  opts: { readToken?: (p: Probes, remote: string) => Promise<string | null> } = {},
): Promise<ConvergeResult | null> {
  const own = markerState(p, dir);
  const recorded = knownDataBranch(p, dir);
  if (own.kind !== "org" && recorded === null) return null;
  const branch = await checkedOutBranch(p, dir);
  if (branch === null) return null;
  if (recorded !== null && (branch === recorded || (await headHoldsOrgStore(p.exec, dir)) !== false)) return null;
  const url = await p.exec(["git", "remote", "get-url", "origin"], { cwd: dir, env: ENV });
  if (url.code !== 0) return null;
  const remote = url.stdout.trim();
  const token = await forgeToken(p, remote, opts.readToken ?? storedForgeToken);
  let target = recorded;
  if (target === null) {
    const tracking = `refs/remotes/origin/${branch}`;
    const fetch = gitWithToken(["fetch", "-q", "origin", `+refs/heads/${branch}:${tracking}`], token, ENV, { remote });
    const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
    if (fetched.code !== 0) return { kind: "unchecked", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
    const shown = await showMarkerAt((spec) => p.exec(["git", "show", spec], { cwd: dir, env: ENV }), tracking);
    let verdict;
    try {
      verdict = gateVerdict(shown, branch, null);
    } catch (err) {
      return { kind: "unchecked", log: withoutUrls(err instanceof Error ? err.message : String(err)) };
    }
    if (verdict?.kind !== "moved") return null;
    target = verdict.dataBranch;
  }
  const result = await moveCloneToDataBranch(p, dir, target, token, remote);
  if (result.kind === "moved") {
    try {
      await applyRoleCone(p, dir, basename(dir));
    } catch (err) {
      warn("org-data-branch", `moved ${basename(dir)} to the ${result.branch} branch but could not narrow it to the role's folders`, { context: { err: String(err) } });
    }
    await rememberDataBranch(p, dir);
  }
  return result;
}

/**
 * Writes the data branch this copy is on, and origin's last known tip of it,
 * into the team record. Only a copy on the data branch (`known`, as a join
 * cloned it, else the one its own marker names), whose HEAD holds the org
 * store, and that is not this Mac's trial counts; a record naming another
 * branch is never overwritten, and the tip only moves forward. True when it
 * wrote the branch itself.
 */
export async function rememberDataBranch(p: Probes, dir: string, known?: string): Promise<boolean> {
  const slug = basename(dir);
  const own = markerState(p, dir);
  const record = readTeamLocal(p, slug);
  const branch = await checkedOutBranch(p, dir);
  const named = known ?? (own.kind === "org" ? own.dataBranch : null);
  if (named === null || branch !== named || branch === record.trialBranch) return false;
  if (record.dataBranch !== undefined && record.dataBranch !== branch) return false;
  if ((await headHoldsOrgStore(p.exec, dir)) !== true) return false;
  const tip = await p.exec(["git", "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`], { cwd: dir, env: ENV });
  const sha = tip.code === 0 && tip.stdout.trim() !== "" ? tip.stdout.trim() : undefined;
  const forward = sha !== undefined && sha !== record.dataBranchTip
    && (record.dataBranchTip === undefined || (await p.exec(["git", "merge-base", "--is-ancestor", record.dataBranchTip, sha], { cwd: dir, env: ENV })).code === 0);
  const newBranch = record.dataBranch !== branch;
  if (!newBranch && !forward) return false;
  editTeamLocal(p, slug, () => ({ dataBranch: branch, ...(forward ? { dataBranchTip: sha } : {}) }));
  return newBranch;
}

/** git's words for a push origin turned away because the branch there holds commits this one lacks. */
const REJECTED_RE = /\[rejected\]|fetch first|non-fast-forward/i;

export interface PendingPointer {
  dataBranch: string;
  sha: string;
}

/**
 * The pointer `rt team create` built on a local `main` and not yet pushed,
 * or null. Only a `main` holding the marker and nothing else counts: a
 * converged clone's old `main` holds the org's data and is never pushed.
 * `checkedOut` saves a git call when the caller already knows the branch.
 */
export async function pendingPointer(p: Pick<Probes, "exec" | "readFile">, dir: string, checkedOut?: string | null): Promise<PendingPointer | null> {
  const own = markerState(p, dir);
  if (own.kind !== "org" || own.dataBranch === null) return null;
  if ((checkedOut === undefined ? await checkedOutBranch(p, dir) : checkedOut) !== own.dataBranch) return null;
  const ref = `refs/heads/${POINTER_BRANCH}`;
  const listed = await p.exec(["git", "ls-tree", "-r", "--name-only", ref], { cwd: dir, env: ENV });
  if (listed.code !== 0 || ![POINTER_REL, ORG_MARKER_REL].includes(listed.stdout.trim())) return null;
  const sha = await p.exec(["git", "rev-parse", "--verify", "-q", ref], { cwd: dir, env: ENV });
  return sha.code === 0 && sha.stdout.trim() !== "" ? { dataBranch: own.dataBranch, sha: sha.stdout.trim() } : null;
}

const notEmpty = (log: string) => new UserActionableError("remote-not-empty", "The team repo already has commits", {}, {
  why: "rt starts a team in an empty repo.",
  log: `${log}; rt team create expects an existing EMPTY repository`,
});

/**
 * Refuses a new org's first publish when origin already holds a `main` or a
 * data branch this clone did not push there (a repo the forge seeded with a
 * README, say), before anything is written to it. A branch this clone pushed
 * on an earlier try passes, so a publish that stopped part way can finish.
 */
export async function assertOriginTakesNewOrg(p: Probes, dir: string, pointer: PendingPointer, target: string, token: string | null, remote: string | null): Promise<void> {
  const heads = [`refs/heads/${POINTER_BRANCH}`, `refs/heads/${pointer.dataBranch}`];
  const lookup = gitWithToken(["ls-remote", "--refs", "--", target, ...heads], token, ENV, { remote });
  const listed = await p.exec(lookup.argv, { cwd: dir, env: lookup.env });
  if (listed.code !== 0) {
    throw new UserActionableError("push-failed", "rt could not check that the team repo is empty", {}, { log: withoutUrls(`${listed.stdout}\n${listed.stderr}`.trim()) });
  }
  for (const row of listed.stdout.split("\n").filter(Boolean)) {
    const [sha = "", ref = ""] = row.split("\t");
    if (ref === heads[0] && sha === pointer.sha) continue;
    if (ref === heads[1] && (await containsCommit(p, dir, sha, `refs/heads/${pointer.dataBranch}`))) continue;
    throw notEmpty(`origin already holds ${ref}`);
  }
}

/**
 * Pushes the pointer `rt team create` left on a local `main`, once the data
 * branch is on origin, then drops it, so the clone fetches the data branch
 * alone. False when the clone holds no pointer to push: an org created
 * before, or one whose pointer is already pushed.
 */
export async function publishPointer(p: Pick<Probes, "exec" | "readFile">, dir: string, token: string | null, remote: string): Promise<boolean> {
  const pointer = await pendingPointer(p, dir);
  if (pointer === null) return false;
  const failed = (log: string) => new UserActionableError("pointer-push-failed", "rt pushed the org but not its main branch", {}, {
    why: "main tells the people you invite which branch holds the org. Retry to push it.",
    log: withoutUrls(log.trim()),
  });
  // Narrowed before the push, so the push leaves no tracking ref for main behind.
  const narrowed = await p.exec(["git", "config", "--replace-all", "remote.origin.fetch", dataBranchRefspec(pointer.dataBranch)], { cwd: dir, env: ENV });
  if (narrowed.code !== 0) throw failed(narrowed.stderr);
  const push = gitWithToken(["push", "-q", "origin", `refs/heads/${POINTER_BRANCH}:refs/heads/${POINTER_BRANCH}`], token, ENV, { remote });
  const pushed = await p.exec(push.argv, { cwd: dir, env: push.env });
  if (pushed.code !== 0) {
    const log = withoutUrls(`${pushed.stdout}\n${pushed.stderr}`.trim());
    if (REJECTED_RE.test(log)) {
      throw new UserActionableError("remote-not-empty", "The team repo's main branch already has commits", {}, {
        why: "rt starts a team in an empty repo, so it left main as it is.",
        log,
      });
    }
    throw failed(log);
  }
  const dropped = await p.exec(["git", "branch", "-q", "-D", POINTER_BRANCH], { cwd: dir, env: ENV });
  if (dropped.code !== 0) throw failed(dropped.stderr);
  return true;
}
