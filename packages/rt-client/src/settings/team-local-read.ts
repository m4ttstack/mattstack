/**
 * Reads `forgeUsername` from the machine-local team record, for the
 * active-team resolver and the role checks. rt's `lib/team/team-local.ts`
 * owns the record; this reads that one field and never writes.
 */

import { readFileSync } from "fs";
import { teamLocalPath } from "./paths.ts";

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
