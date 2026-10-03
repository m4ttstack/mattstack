/**
 * Who may write what in the org clone. The check catches accidents from
 * anyone using rt; it is not a security boundary, since the forge decides
 * who can actually push.
 */

import { posix } from "path";
import { readOrgRoles, sameUser, type OrgRoles } from "./active-team.ts";
import { TEAM_NAME_RE } from "./stores.ts";
import { readForgeUsername } from "./team-local-read.ts";

export type OrgRole = { kind: "admin" } | { kind: "owner"; teams: string[] } | { kind: "member" } | { kind: "unknown" };

export const ORG_MANAGED_ROOTS: readonly string[] = ["mattstack", ".sops.yaml", ".claude-plugin"];

export function roleOf(username: string | null, roles: OrgRoles): OrgRole {
  if (username === null || username.trim() === "") return { kind: "unknown" };
  if (roles.admins.some((admin) => sameUser(admin, username))) return { kind: "admin" };
  const teams = Object.entries(roles.teams)
    .filter(([, team]) => team.owners.some((owner) => sameUser(owner, username)))
    .map(([name]) => name)
    .sort();
  return teams.length > 0 ? { kind: "owner", teams } : { kind: "member" };
}

export function ownedRoots(role: OrgRole): string[] {
  if (role.kind === "admin") return [...ORG_MANAGED_ROOTS];
  if (role.kind === "owner") return role.teams.map((team) => `mattstack/teams/${team}`);
  return [];
}

function under(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function normalized(relPath: string): string {
  return posix.normalize(relPath.split("\\").join("/"));
}

export function mayWritePath(role: OrgRole, relPath: string): boolean {
  const path = normalized(relPath);
  if (path.startsWith("/") || path === ".." || path.startsWith("../")) return false;
  return ownedRoots(role).some((root) => under(root, path));
}

function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

function adminsClause(admins: string[]): string {
  return `${names(admins)} (${admins.length === 1 ? "an org admin" : "org admins"})`;
}

export function writeRefusalFor(role: OrgRole, roles: OrgRoles, relPath: string): { message: string; why: string } | null {
  if (mayWritePath(role, relPath)) return null;
  if (role.kind === "unknown") {
    return { message: "rt can't tell who you are, so it will not change the org's shared files", why: "Connect your forge account in Setup, then try again." };
  }
  const team = /^mattstack\/teams\/([^/]+)(\/|$)/.exec(normalized(relPath))?.[1];
  const noAdmins = "This org names no admins yet. Its mattstack.org setting has to list one.";
  if (team !== undefined && TEAM_NAME_RE.test(team)) {
    const owners = roles.teams[team]?.owners ?? [];
    const ask = [
      ...(owners.length > 0 ? [`${names(owners)} (the team's ${owners.length === 1 ? "owner" : "owners"})`] : []),
      ...(roles.admins.length > 0 ? [adminsClause(roles.admins)] : []),
    ];
    return {
      message: `The ${team} team's files belong to its owners`,
      why: ask.length > 0 ? `Ask ${ask.join(" or ")} to make this change.` : noAdmins,
    };
  }
  return {
    message: "The org's shared files belong to its admins",
    why: roles.admins.length > 0 ? `Ask ${adminsClause(roles.admins)} to make this change.` : noAdmins,
  };
}

export function currentRole(org: string): OrgRole {
  return roleOf(readForgeUsername(org), readOrgRoles(org));
}
