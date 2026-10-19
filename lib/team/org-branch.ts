/**
 * The branch an org clone has checked out is the branch rt reads, syncs and
 * publishes on this Mac, so an admin can try a breaking change on a branch
 * while every other member stays on the org's data branch.
 */

import { basename } from "path";
import { UserActionableError } from "../errors.ts";
import { markerState } from "./org-marker.ts";
import { readTeamLocal } from "./team-local.ts";
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

/**
 * The org's data branch as this Mac knows it without asking origin: the team
 * record first, which no branch switch can change, then the copy's own marker
 * (the root pointer on `main`, the folder marker elsewhere). A marker naming
 * this Mac's trial branch is not the org's. Null for an org whose data has no
 * branch of its own (layout 3).
 */
export function knownDataBranch(p: Pick<Probes, "readFile" | "home">, dir: string): string | null {
  const record = readTeamLocal(p, basename(dir));
  if (record.dataBranch) return record.dataBranch;
  const own = markerState(p, dir);
  if (own.kind !== "org" || own.dataBranch === null || own.dataBranch === record.trialBranch) return null;
  return own.dataBranch;
}

type BranchProbes = Pick<Probes, "exec"> & Partial<Pick<Probes, "readFile" | "home">>;

export async function orgBranch(p: BranchProbes, dir: string): Promise<string> {
  const branch = await checkedOutBranch(p, dir);
  if (branch === null) {
    const home = p.readFile && p.home !== undefined ? knownDataBranch({ readFile: p.readFile, home: p.home }, dir) : null;
    throw new UserActionableError("org-detached", "Your copy of the org has no branch checked out", {}, {
      why: "rt reads, syncs and publishes the branch your copy of the org is on.",
      next: `git -C ${shellQuote(dir)} switch ${shellQuote(home ?? "main")}`,
    });
  }
  return branch;
}

/** The branch that holds the org's data: the marker's `dataBranch` (layout 4 on), else the branch checked out. */
export async function dataBranchOf(p: Pick<Probes, "exec" | "readFile">, dir: string): Promise<string> {
  const state = markerState(p, dir);
  if (state.kind === "org" && state.dataBranch !== null) return state.dataBranch;
  return orgBranch(p, dir);
}
