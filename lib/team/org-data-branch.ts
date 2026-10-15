/**
 * Switches an org clone, in place, onto the branch its org's data lives on.
 * The two branches share no history, so this is a checkout of an unrelated
 * branch, never a merge; a clone with anything unsaved or unpushed is held.
 */

import type { Probes } from "../setup/probes.ts";
import { gitWithToken } from "./git-credential.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { withoutUrls } from "./redact.ts";

export type MoveResult =
  | { kind: "moved"; branch: string }
  | { kind: "already"; branch: string }
  | { kind: "held"; why: "dirty"; files: string[] }
  | { kind: "held"; why: "unpushed"; commits: number }
  | { kind: "failed"; log: string };

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

export async function moveCloneToDataBranch(p: Pick<Probes, "exec">, dir: string, branch: string, token: string | null, remote: string): Promise<MoveResult> {
  const current = await checkedOutBranch(p, dir);
  if (current === branch) return { kind: "already", branch };
  const status = await p.exec(["git", "status", "--porcelain=v1", "--untracked-files=no"], { cwd: dir, env: ENV });
  if (status.code !== 0) return { kind: "failed", log: withoutUrls(status.stderr) };
  const files = status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  if (files.length > 0) return { kind: "held", why: "dirty", files };
  if (current !== null) {
    const ahead = await p.exec(["git", "rev-list", "--count", `refs/remotes/origin/${current}..HEAD`], { cwd: dir, env: ENV });
    const commits = ahead.code === 0 ? Number(ahead.stdout.trim()) : 0;
    if (commits > 0) return { kind: "held", why: "unpushed", commits };
  }
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
