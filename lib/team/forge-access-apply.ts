/**
 * Brings the org repo's forge access in line with the org's roles: reads what
 * the forge has, reports the difference, and on an admin's Mac that granted
 * `rtMayManageMembership` applies it. It only grants and manages the data
 * branch's push list; it never lowers anyone's repo access. Only the data
 * branch's rules are ever touched, only once the org's marker names a data
 * branch of its own, and never while this Mac sits on its trial branch.
 */

import { rosterFrom, type RosterEntry } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import { orgDirUnder } from "../rt-paths.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { parseStoreText } from "../settings/stores.ts";
import type { Probes } from "../setup/probes.ts";
import { parseForgeRemote, splitOwnerRepo } from "./forge.ts";
import type { OrgForgeAccess, PushList } from "./forge-access.ts";
import { githubForgeAccess } from "./forge-access-github.ts";
import { gitlabForgeAccess } from "./forge-access-gitlab.ts";
import { accessDiff, fingerprintOf, limitSentence, wantedAccess, type AccessDiff, type Wanted } from "./forge-access-plan.ts";
import { teamRemote } from "./members.ts";
import { checkedOutBranch, dataBranchOf } from "./org-branch.ts";
import { markerState } from "./org-marker.ts";
import { orgStoreFile } from "./org-store.ts";
import { roleFor, rolesFor } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { editTeamLocal, readTeamLocal } from "./team-local.ts";

export interface ForgeAccessSeams {
  forgeToken: (p: Probes, remote: string) => Promise<string | null>;
  access: (p: Probes, remote: string, token: string | null) => OrgForgeAccess | null;
}

export function orgForgeAccessFor(p: Probes, remote: string, token: string | null): OrgForgeAccess | null {
  const parsed = parseForgeRemote(remote);
  if (!parsed) return null;
  if (parsed.provider === "github") {
    const { owner, repo } = splitOwnerRepo(parsed.path);
    return githubForgeAccess(p, remote, owner, repo, token);
  }
  return gitlabForgeAccess(p, remote, parsed.host, parsed.path, token);
}

export function realForgeAccessSeams(): ForgeAccessSeams {
  return { forgeToken: storedForgeToken, access: orgForgeAccessFor };
}

export type ForgeAccessReport =
  | { kind: "not-admin" }
  | { kind: "no-forge" }
  | { kind: "not-yet"; branch: string | null }
  | { kind: "trial"; branch: string }
  | { kind: "refused"; manualSteps: string[] }
  | { kind: "shared-branch"; branch: string }
  | { kind: "ready"; provider: "github" | "gitlab"; branch: string; pushList: PushList; wanted: Wanted; diff: AccessDiff; managing: boolean; lastManualSteps: string[] };

export interface ForgeAccessApplied {
  done: string[];
  manualSteps: string[];
  limit: string | null;
}

export interface AdminFollow {
  reencrypted: string[];
  failure: string | null;
}

/** Plan 4's `followRosterChange` (lib/team/admin-secrets.ts), by its exact signature; never throws. */
export type FollowRosterChange = (p: Pick<Probes, "readFile" | "home">, slug: string, orgStore: Record<string, unknown>, secrets: SecretsSeams) => Promise<AdminFollow>;

// Stands in until plan 4 merges; the import of lib/team/admin-secrets.ts replaces it.
const followRosterChange: FollowRosterChange = async () => ({ reencrypted: [], failure: null });

const SHARED_BRANCH_NAMES = new Set(["main", "master"]);

export function sharedBranchSentence(branch: string): string {
  return `The org's data is on ${branch}, which the rest of the repo uses too, so rt leaves its rules alone. Move the org's data to its own branch first.`;
}

export function orgStoreKeys(p: Pick<Probes, "readFile" | "home">, slug: string): Record<string, unknown> {
  const file = orgStoreFile(p.home, slug);
  const raw = p.readFile(file);
  return raw === null ? {} : parseStoreText(file, raw).global;
}

function rosterFor(p: Pick<Probes, "readFile" | "home">, slug: string): RosterEntry[] {
  const file = orgStoreFile(p.home, slug);
  const raw = p.readFile(file);
  return raw === null ? [] : rosterFrom(parseStoreText(file, raw));
}

type DataBranch = { kind: "none" } | { kind: "trial"; branch: string } | { kind: "own"; branch: string };

/**
 * The branch rt manages. "none" while the marker names no data branch: the
 * data then shares a branch with the rest of the repo, whose rules rt never
 * edits. "trial" while that branch is the trial this Mac recorded (plan 2's
 * `rt team branch use`): nothing happens until the Mac is back.
 */
async function managedDataBranch(p: Probes, slug: string): Promise<DataBranch> {
  const dir = orgDirUnder(p.home, slug);
  const marker = markerState(p, dir);
  if (marker.kind !== "org" || marker.dataBranch === null) return { kind: "none" };
  const branch = await dataBranchOf(p, dir);
  return branch === readTeamLocal(p, slug).trialBranch ? { kind: "trial", branch } : { kind: "own", branch };
}

export async function wantedFingerprint(p: Probes, slug: string): Promise<string | null> {
  const data = await managedDataBranch(p, slug);
  return data.kind === "own" ? fingerprintOf(wantedAccess(rolesFor(p, slug), rosterFor(p, slug)), data.branch) : null;
}

async function inspect(p: Probes, slug: string, seams: ForgeAccessSeams): Promise<{ report: ForgeAccessReport; access: OrgForgeAccess | null }> {
  if (!isOrgAdmin(roleFor(p, slug))) return { report: { kind: "not-admin" }, access: null };
  const data = await managedDataBranch(p, slug);
  if (data.kind === "none") return { report: { kind: "not-yet", branch: await checkedOutBranch(p, orgDirUnder(p.home, slug)) }, access: null };
  if (data.kind === "trial") return { report: { kind: "trial", branch: data.branch }, access: null };
  const branch = data.branch;
  const remote = teamRemote(p, slug);
  const access = remote === null ? null : seams.access(p, remote, await seams.forgeToken(p, remote));
  if (access === null) return { report: { kind: "no-forge" }, access: null };

  const main = await access.defaultBranch();
  if (!main.ok) return { report: { kind: "refused", manualSteps: main.manualSteps }, access };
  if (SHARED_BRANCH_NAMES.has(branch.toLowerCase()) || branch === main.value) {
    return { report: { kind: "shared-branch", branch }, access };
  }
  const pushList = await access.readPushList(branch);
  if (!pushList.ok) return { report: { kind: "refused", manualSteps: pushList.manualSteps }, access };
  const members = await access.readMembers();
  if (!members.ok) return { report: { kind: "refused", manualSteps: members.manualSteps }, access };

  const local = readTeamLocal(p, slug);
  const wanted = wantedAccess(rolesFor(p, slug), rosterFor(p, slug));
  const diff = accessDiff(wanted, members.value, pushList.value);
  return {
    report: { kind: "ready", provider: access.provider, branch, pushList: pushList.value, wanted, diff, managing: local.rtMayManageMembership, lastManualSteps: local.forgeAccess?.manualSteps ?? [] },
    access,
  };
}

export async function readForgeAccess(p: Probes, slug: string, seams: ForgeAccessSeams = realForgeAccessSeams()): Promise<ForgeAccessReport> {
  return (await inspect(p, slug, seams)).report;
}

export async function applyForgeAccess(p: Probes, slug: string, seams: ForgeAccessSeams = realForgeAccessSeams()): Promise<{ report: ForgeAccessReport; applied: ForgeAccessApplied | null }> {
  const { report, access } = await inspect(p, slug, seams);
  if (report.kind !== "ready" || !report.managing || access === null) return { report, applied: null };
  const { branch, diff, wanted } = report;
  const key = (u: string) => u.toLowerCase();
  const done: string[] = [];
  const manualSteps: string[] = [];
  let limit: string | null = null;

  // Grants come first: a forge only puts someone with write on a push list. They only ever raise a level.
  const offList = new Set(diff.waiting.map(key));
  for (const g of diff.grant) {
    const r = await access.grant(g.username, g.level);
    if (!r.ok) {
      manualSteps.push(...r.manualSteps);
      offList.add(key(g.username));
    } else if (r.value === "invited") {
      offList.add(key(g.username));
      done.push(`Invited ${g.username} to the repo with ${g.level} access`);
    } else {
      done.push(`Gave ${g.username} ${g.level} access`);
    }
  }

  let list: PushList = report.pushList;
  if (list.kind === "unprotected") {
    const r = await access.protect(branch);
    if (!r.ok) manualSteps.push(...r.manualSteps);
    else if (r.value === "unavailable") list = { kind: "unavailable", why: "This forge plan can't protect the branch" };
    else {
      done.push(`Protected the ${branch} branch`);
      list = { kind: "named", users: [] };
    }
  }
  if (list.kind === "unavailable") limit = limitSentence(list, branch);
  const listChanges = diff.addPush.length + diff.removePush.length > 0;
  if (list.kind === "open" || (list.kind === "named" && listChanges)) {
    const pushers = wanted.pushers.filter((u) => !offList.has(key(u)));
    const r = await access.setPushList(branch, pushers);
    if (!r.ok) manualSteps.push(...r.manualSteps);
    else if (r.value === "cannot-name-users") limit = limitSentence({ kind: "open", why: "This forge can't limit pushes to named people here" }, branch);
    else done.push(`Set who can push ${branch}: ${pushers.join(", ")}`);
  }

  editTeamLocal(p, slug, () => ({ forgeAccess: { fingerprint: fingerprintOf(wanted, branch), manualSteps } }));
  return { report, applied: { done, manualSteps, limit } };
}

/**
 * The step and the sweep come through here: after an apply that ran, when the
 * org's roles or roster moved since this Mac last applied them, the admin-only
 * secrets follow too (plan 4), so a promotion or demotion re-encrypts them.
 */
export async function applyForgeAccessAndFollow(
  p: Probes,
  slug: string,
  secrets: SecretsSeams,
  seams: ForgeAccessSeams = realForgeAccessSeams(),
  follow: FollowRosterChange = followRosterChange,
): Promise<{ report: ForgeAccessReport; applied: ForgeAccessApplied | null; admin: AdminFollow | null }> {
  const before = readTeamLocal(p, slug).forgeAccess?.fingerprint ?? null;
  const wanted = await wantedFingerprint(p, slug);
  const { report, applied } = await applyForgeAccess(p, slug, seams);
  const moved = applied !== null && wanted !== null && wanted !== before;
  const admin = moved ? await follow(p, slug, orgStoreKeys(p, slug), secrets) : null;
  // A failed follow puts the old fingerprint back (an empty one when there was none, which no real fingerprint equals) so the next sweep follows again.
  if (admin?.failure != null) editTeamLocal(p, slug, (current) => ({ forgeAccess: { fingerprint: before ?? "", manualSteps: current.forgeAccess?.manualSteps ?? [] } }));
  return { report, applied, admin };
}
