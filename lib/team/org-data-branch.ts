/**
 * Switches an org clone, in place, onto the branch its org's data lives on.
 * The two branches share no history, so this is a checkout of an unrelated
 * branch, never a merge. Unpushed commits on the org's data are replayed onto
 * it; a clone with anything unsaved, or commits that cannot be replayed, is
 * held with its old branch untouched.
 */

import { basename } from "path";
import type { Probes } from "../setup/probes.ts";
import { warn } from "../ui/warn.ts";
import { gitWithToken } from "./git-credential.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { applyRoleCone } from "./org-cone.ts";
import { gateVerdict, markerAtRef } from "./org-layout.ts";
import { markerState } from "./org-marker.ts";
import { withoutUrls } from "./redact.ts";
import { storedForgeToken } from "./stored-forge-token.ts";

export type HeldMove =
  | { kind: "held"; why: "dirty"; files: string[] }
  | { kind: "held"; why: "uncarried"; commits: number; reason: "outside" | "clash" }
  | { kind: "held"; why: "detached" };

export type MoveResult =
  | { kind: "moved"; branch: string; carried?: number }
  | { kind: "already"; branch: string }
  | HeldMove
  | { kind: "failed"; log: string };

/** What a convergence may also end in: origin could not be asked, so whether the data moved is unknown until the next try. */
export type ConvergeResult = MoveResult | { kind: "unchecked"; log: string };

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const FILES_SHOWN = 5;
/** Every path the org's data branch holds; a commit touching anything else is not the org's data and is never carried. */
const DATA_PATH = (path: string): boolean =>
  path.startsWith("mattstack/") || path.startsWith(".claude-plugin/") || path === ".sops.yaml" || path === ".gitignore";

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

async function unpushed(p: Pick<Probes, "exec">, dir: string): Promise<Ready | Blocker> {
  // Against every origin ref, not the branch's own: a missing tracking ref must not make local commits look pushed.
  const listed = await p.exec(["git", "rev-list", "--reverse", "HEAD", "--not", "--remotes=origin"], { cwd: dir, env: ENV });
  if (listed.code !== 0) return { kind: "failed", log: withoutUrls(listed.stderr) };
  const commits = listed.stdout.split("\n").filter(Boolean);
  for (const commit of commits) {
    const touched = await p.exec(["git", "diff-tree", "-r", "--root", "--no-commit-id", "--name-only", commit], { cwd: dir, env: ENV });
    if (touched.code !== 0) return { kind: "failed", log: withoutUrls(touched.stderr) };
    if (touched.stdout.split("\n").filter(Boolean).some((path) => !DATA_PATH(path))) {
      return { kind: "held", why: "uncarried", commits: commits.length, reason: "outside" };
    }
  }
  return { kind: "ready", commits };
}

async function blockerOn(p: Pick<Probes, "exec">, dir: string, current: string | null): Promise<Ready | Blocker> {
  const status = await p.exec(["git", "status", "--porcelain=v1", "--untracked-files=no"], { cwd: dir, env: ENV });
  if (status.code !== 0) return { kind: "failed", log: withoutUrls(status.stderr) };
  const files = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (files.length > 0) return { kind: "held", why: "dirty", files };
  if (current === null) return { kind: "held", why: "detached" };
  return unpushed(p, dir);
}

/** What keeps the clone from moving now: unsaved changes, no branch checked out, or unpushed commits the move cannot carry. Null when nothing does; a clash with the data branch shows only when the move tries. */
export async function moveBlocker(p: Pick<Probes, "exec">, dir: string): Promise<Blocker | null> {
  const blocker = await blockerOn(p, dir, await checkedOutBranch(p, dir));
  return blocker.kind === "ready" ? null : blocker;
}

const CLASH_RE = /conflict|could not apply|after resolving|is a merge/i;

/**
 * Checks out `branch` from origin and replays the old branch's unpushed
 * commits onto it, authorship kept. A clash puts everything back: the old
 * branch checked out with its commits, the refspec untouched, and no data
 * branch left behind that was not there before.
 */
export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string): Promise<MoveResult> {
  const current = await checkedOutBranch(p, dir);
  if (current === branch) return { kind: "already", branch };
  const ready = await blockerOn(p, dir, current);
  if (ready.kind !== "ready") return ready;
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", refspec], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) return { kind: "failed", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const existed = (await p.exec(["git", "rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: dir, env: ENV })).code === 0;
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

/**
 * Moves a clone whose own marker names no data branch (a layout 3 clone)
 * once origin's copy of its branch points at one, then narrows it to the
 * role's cone. Null when there is nothing to move: a clone whose marker
 * already names a data branch (a trial branch included), a detached HEAD,
 * no origin, or an origin branch that still holds the data. `unchecked`
 * when origin could not be asked: nothing was tried.
 */
export async function convergeDataBranch(
  p: Probes,
  dir: string,
  opts: { readToken?: (p: Probes, remote: string) => Promise<string | null> } = {},
): Promise<ConvergeResult | null> {
  const own = markerState(p, dir);
  if (own.kind !== "org" || own.dataBranch !== null) return null;
  const branch = await checkedOutBranch(p, dir);
  if (branch === null) return null;
  const url = await p.exec(["git", "remote", "get-url", "origin"], { cwd: dir, env: ENV });
  if (url.code !== 0) return null;
  const remote = url.stdout.trim();
  let token: string | null = null;
  try {
    token = await (opts.readToken ?? storedForgeToken)(p, remote);
  } catch (err) {
    warn("org-data-branch", `could not read the forge token for ${withoutUrls(remote)}; fetching with git's own credentials`, { context: { err: String(err) } });
  }
  const tracking = `refs/remotes/origin/${branch}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", `+refs/heads/${branch}:${tracking}`], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) return { kind: "unchecked", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const shown = await p.exec(["git", "show", markerAtRef(tracking)], { cwd: dir, env: ENV });
  let verdict;
  try {
    verdict = gateVerdict(shown, branch, null);
  } catch (err) {
    return { kind: "unchecked", log: withoutUrls(err instanceof Error ? err.message : String(err)) };
  }
  if (verdict?.kind !== "moved") return null;
  const result = await moveCloneToDataBranch(p, dir, verdict.dataBranch, token, remote);
  if (result.kind === "moved") {
    try {
      await applyRoleCone(p, dir, basename(dir));
    } catch (err) {
      warn("org-data-branch", `moved ${basename(dir)} to the ${result.branch} branch but could not narrow it to the role's folders`, { context: { err: String(err) } });
    }
  }
  return result;
}
