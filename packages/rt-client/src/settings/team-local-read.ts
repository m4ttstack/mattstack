/**
 * Two fields of the machine-local team record, for the write guard and the
 * active-team resolver. The record itself is owned by
 * repo-tools/lib/team/team-local.ts; this reads only what they need and never
 * writes.
 */

import { readFileSync } from "fs";
import { teamLocalPath } from "./paths.ts";

/** Unreadable, absent or malformed all read as false, so nothing that predates the field is refused. */
export function isJoinedTeam(team: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(teamLocalPath(team), "utf8"));
    return typeof parsed === "object" && parsed !== null && (parsed as { joinedByRt?: unknown }).joinedByRt === true;
  } catch {
    return false;
  }
}

/** Null when the record is absent, unreadable, or carries no username. */
export function readForgeUsername(org: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(teamLocalPath(org), "utf8"));
    const name = typeof parsed === "object" && parsed !== null ? (parsed as { forgeUsername?: unknown }).forgeUsername : undefined;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
  } catch {
    return null;
  }
}
