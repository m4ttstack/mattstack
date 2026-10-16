/**
 * The daemon auto-commits an org clone only on a branch this Mac approved:
 * the org's data branch, or a trial branch it chose. Sync reads these on every
 * snapshot round, so both are synchronous.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { Probes } from "../setup/probes.ts";
import { markerState } from "./org-marker.ts";
import { readTeamLocal } from "./team-local.ts";

/** A clone whose marker names no data branch (before layout 4) keeps its data on main. */
export function approvedBranches(p: Pick<Probes, "readFile" | "home">, slug: string, dir: string): string[] {
  const marker = markerState(p, dir);
  const data = marker.kind === "org" && marker.dataBranch !== null ? marker.dataBranch : "main";
  const { trialBranch } = readTeamLocal(p, slug);
  return trialBranch && trialBranch !== data ? [data, trialBranch] : [data];
}

/** The branch HEAD points at; null when detached or unreadable. */
export function currentBranchSync(dir: string): string | null {
  try {
    const head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim();
    const prefix = "ref: refs/heads/";
    return head.startsWith(prefix) && head.length > prefix.length ? head.slice(prefix.length) : null;
  } catch {
    return null;
  }
}
