/**
 * Switches an org clone, in place, onto the branch its org's data lives on.
 * The two branches share no history, so this is a checkout of an unrelated
 * branch, never a merge; a clone with anything unsaved or unpushed is held.
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
  | { kind: "held"; why: "unpushed"; commits: number }
  | { kind: "held"; why: "detached" };

export type MoveResult =
  | { kind: "moved"; branch: string }
  | { kind: "already"; branch: string }
  | HeldMove
  | { kind: "failed"; log: string };

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const FILES_SHOWN = 5;

export const MOVED_DONE = (branch: string): string => `Moved your copy of the org to the ${branch} branch`;

/** The words every surface (the org.folder step, `rt team pull`, the org.layout row) shows for a held move. */
export function heldCopy(held: HeldMove): { detail: string; remedy: string } {
  if (held.why === "dirty") {
    const shown = held.files.slice(0, FILES_SHOWN).join(", ");
    const more = held.files.length > FILES_SHOWN ? ` and ${held.files.length - FILES_SHOWN} more` : "";
    return { detail: `Your copy of the org has unsaved changes: ${shown}${more}`, remedy: "Save or discard those changes, then run rt team pull" };
  }
  if (held.why === "unpushed") {
    const what = held.commits === 1 ? "1 commit that is" : `${held.commits} commits that are`;
    return { detail: `Your copy of the org has ${what} not published yet`, remedy: "Run rt team publish first, then rt team pull" };
  }
  return { detail: "Your copy of the org is not on a branch", remedy: "Switch it back to a branch, then run rt team pull" };
}

async function blockerOn(p: Pick<Probes, "exec">, dir: string, current: string | null): Promise<HeldMove | { kind: "failed"; log: string } | null> {
  const status = await p.exec(["git", "status", "--porcelain=v1", "--untracked-files=no"], { cwd: dir, env: ENV });
  if (status.code !== 0) return { kind: "failed", log: withoutUrls(status.stderr) };
  const files = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (files.length > 0) return { kind: "held", why: "dirty", files };
  if (current === null) return { kind: "held", why: "detached" };
  // Against every origin ref, not the branch's own: a missing tracking ref must not make local commits look pushed.
  const ahead = await p.exec(["git", "rev-list", "--count", "HEAD", "--not", "--remotes=origin"], { cwd: dir, env: ENV });
  if (ahead.code !== 0) return { kind: "failed", log: withoutUrls(ahead.stderr) };
  const commits = Number(ahead.stdout.trim());
  return commits > 0 ? { kind: "held", why: "unpushed", commits } : null;
}

/** What keeps the clone from moving now: unsaved changes, no branch checked out, or commits origin does not have. Null when nothing does. */
export async function moveBlocker(p: Pick<Probes, "exec">, dir: string): Promise<HeldMove | { kind: "failed"; log: string } | null> {
  return blockerOn(p, dir, await checkedOutBranch(p, dir));
}

export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string): Promise<MoveResult> {
  const current = await checkedOutBranch(p, dir);
  if (current === branch) return { kind: "already", branch };
  const blocker = await blockerOn(p, dir, current);
  if (blocker !== null) return blocker;
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  const fetch = gitWithToken(["fetch", "-q", "origin", refspec], token, ENV, { remote });
  const fetched = await p.exec(fetch.argv, { cwd: dir, env: fetch.env });
  if (fetched.code !== 0) return { kind: "failed", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const checkout = await p.exec(["git", "checkout", "-q", "-B", branch, `refs/remotes/origin/${branch}`], { cwd: dir, env: ENV });
  if (checkout.code !== 0) return { kind: "failed", log: withoutUrls(checkout.stderr) };
  await p.exec(["git", "branch", "-q", "--set-upstream-to", `origin/${branch}`], { cwd: dir, env: ENV });
  await p.exec(["git", "config", "--replace-all", "remote.origin.fetch", refspec], { cwd: dir, env: ENV });
  return { kind: "moved", branch };
}

/**
 * Moves a clone whose own marker names no data branch (a layout 3 clone)
 * once origin's copy of its branch points at one, then narrows it to the
 * role's cone. Null when there is nothing to move: a clone whose marker
 * already names a data branch (a trial branch included), a detached HEAD,
 * no origin, or an origin branch that still holds the data.
 */
export async function convergeDataBranch(
  p: Probes,
  dir: string,
  opts: { readToken?: (p: Probes, remote: string) => Promise<string | null> } = {},
): Promise<MoveResult | null> {
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
  if (fetched.code !== 0) return { kind: "failed", log: withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim()) };
  const shown = await p.exec(["git", "show", markerAtRef(tracking)], { cwd: dir, env: ENV });
  let verdict;
  try {
    verdict = gateVerdict(shown, branch, null);
  } catch (err) {
    return { kind: "failed", log: withoutUrls(err instanceof Error ? err.message : String(err)) };
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
