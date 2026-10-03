import { rolesFrom, type OrgRoles } from "../../packages/rt-client/src/settings/active-team.ts";
import { roleOf, writeRefusalFor, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { UserActionableError } from "../errors.ts";
import { parseStoreText } from "../settings/stores.ts";
import type { Probes } from "../setup/probes.ts";
import { orgStoreFile } from "./org-store.ts";
import { readTeamLocal } from "./team-local.ts";

type Reads = Pick<Probes, "readFile" | "home">;

export function rolesFor(p: Reads, org: string): OrgRoles {
  const file = orgStoreFile(p.home, org);
  const raw = p.readFile(file);
  return raw === null ? { admins: [], teams: {} } : rolesFrom(parseStoreText(file, raw));
}

export function roleFor(p: Reads, org: string): OrgRole {
  return roleOf(readTeamLocal(p, org).forgeUsername ?? null, rolesFor(p, org));
}

/** The one refusal every verb that changes the org clone raises, so the wording cannot drift between them. */
export function assertMayWrite(p: Reads, org: string, relPath: string): void {
  const roles = rolesFor(p, org);
  const refusal = writeRefusalFor(roleOf(readTeamLocal(p, org).forgeUsername ?? null, roles), roles, relPath);
  if (refusal) throw new UserActionableError("team-pull-only", refusal.message, {}, { why: refusal.why });
}
