/**
 * The branch an org clone has checked out is the branch rt reads, syncs and
 * publishes on this Mac, so an admin can try a breaking change on a branch
 * while every other member stays on main.
 */

import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";

export function shellQuote(s: string): string {
  return /^[\w./:@=-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

/** Null when no branch is checked out (a detached HEAD, or git could not say). */
export async function checkedOutBranch(p: Pick<Probes, "exec">, dir: string): Promise<string | null> {
  const head = await p.exec(["git", "symbolic-ref", "-q", "--short", "HEAD"], { cwd: dir });
  const branch = head.code === 0 ? head.stdout.trim() : "";
  return branch === "" ? null : branch;
}

export async function orgBranch(p: Pick<Probes, "exec">, dir: string): Promise<string> {
  const branch = await checkedOutBranch(p, dir);
  if (branch === null) {
    throw new UserActionableError("org-detached", "Your copy of the org has no branch checked out", {}, {
      why: "rt reads, syncs and publishes the branch your copy of the org is on.",
      next: `git -C ${shellQuote(dir)} switch main`,
    });
  }
  return branch;
}
