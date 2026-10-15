# Org forge access (plan 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rt keeps the org repo's forge access in line with the org's roles, on GitLab and GitHub alike, applied only on an admin's Mac that granted it: it grants the repo access each role needs and keeps the data branch's push list to the people whose role pushes it.

**Architecture:** One forge-neutral interface, `OrgForgeAccess` (`lib/team/forge-access.ts`), with a GitHub and a GitLab implementation that call `gh api` / `glab api` through `forge.ts`'s existing CLI path. A pure planner (`forge-access-plan.ts`) turns the org's roles and roster into the wanted access and compares it with what the forge reports. An orchestrator (`forge-access-apply.ts`) reads, reports and, when the machine-local `rtMayManageMembership` latch is on, applies the difference; the `org.forge-access` setup row, an update-safe setup step, a daemon sweep and the new `rt team forge-access` verb all call it. When the wanted access moved, the step and the sweep then call plan 4's `followRosterChange`, so a promotion or demotion re-encrypts the admin-only secrets too.

**Tech Stack:** Bun, TypeScript, bun:test; `gh` 2.x and `glab` 1.x (`api --input -`, `--paginate`).

**Spec:** `docs/superpowers/specs/2026-10-15-org-data-branch-and-roles-design.md`, section "Forge access" (subsections "The interface", "Who should have what", "When rt applies it", "Demotion and removal"). Admin-only secrets are plan 4; the data branch move, sparse checkout, create, invite and join are plan 2. Depends on plan 1 (`docs/superpowers/plans/2026-10-15-org-roles.md`): `OrgRoles.owners`, the `org-owner` role, `isOrgAdmin`, `MarkerState.dataBranch` and `dataBranchOf` (its Task 9). Depends on plan 4 (`docs/superpowers/plans/2026-10-15-org-admin-secrets.md`), which merges first: `followRosterChange` in `lib/team/admin-secrets.ts` (its Task 3).

Ruling recorded after the first draft (Matt): rt never lowers anyone's existing repo-wide level. It only grants what a role needs and manages the data branch's push list. Repo access comes off only through `rt team members remove`, as today.

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, copy, docs).
- This repo is public: placeholders only (`acme`, `widgets`, `gadgets`, `dev1` to `dev9`), never a real company, person or repo.
- Usernames compare without case, always through `sameUser` (`packages/rt-client/src/settings/active-team.ts`).
- Every person-facing sentence follows the output layer rules in AGENTS.md: plain copy, a command goes in `next` (or ends the sentence), refusals by policy are `refused`, never `failed`.
- "org owners, admins and team owners are on the push list and have write; members and people on no team have read." Levels: GitLab Reporter (read), Developer (write); GitHub `read` (`pull`), `write` (`push`).
- **rt never lowers repo access.** It grants only what a role needs (write for org owners, admins and team owners; read for members who have less than read) and manages the data branch's push list (adds and removes names). It never lowers anyone's existing repo-wide level, even a member with write. Repo access is removed only by `rt team members remove`, as today. Someone who leaves the roster or a role comes off the push list only.
- "rt never edits rules on any branch other than the data branch." The data branch is the one `dataBranchOf` (plan 1, `lib/team/org-branch.ts`) returns, and rt manages it only when the clone's marker names a `dataBranch`; a marker without one (layout 3 and below, data on `main`) is left alone. When `dataBranchOf(...)` equals this Mac's `readTeamLocal(...).trialBranch` (plan 2's trial branch, recorded by `rt team branch use`), rt does nothing to that branch, and the row says the access sync waits while this Mac is on a trial branch.
- rt grants repo membership only to usernames it derives from the org's roster and roles. People on the forge who are not on the roster keep their repo access untouched; only the data branch's push list, which rt owns, drops them.
- `TeamLocalRecord` (`lib/team/team-local.ts`) gains a field in two parallel plans: plan 2 adds `trialBranch?: string`, this plan adds `forgeAccess?: ForgeAccessRecord` and the same `trialBranch?: string` declaration it reads. Whichever merges second keeps one `trialBranch` line; the merge is trivial.
- After a successful apply whose wanted access moved since this Mac last applied it, the update-safe step and the daemon sweep call plan 4's `followRosterChange(p, slug, orgStore, secrets): Promise<{ reencrypted: string[]; failure: string | null }>` verbatim (it never throws), so promotion and demotion re-encrypt the admin-only secrets.
- "When the forge refuses (a missing permission), rt does not work around it: the setup row shows the admin the one step to do on that forge by hand." When the forge cannot name who may push, the copy says: anyone with write access can push the data branch, and only rt's own guard limits what they change there.
- rt applies the difference only on a Mac whose role is admin or org owner (`isOrgAdmin`) and whose `rtMayManageMembership` latch is on. Without the latch, everything only reports.
- Every forge write goes through `gh`/`glab` via `forgeArgv` (`lib/team/forge.ts`), token in the CLI's env variable (`forgeAuthEnv`), never argv. `packages/glance` is not touched (it stays read-only).
- Existing `--json` envelopes keep their keys (`rt team manage-membership --json` keeps `slug`, `mayManage`, `offerable`).
- File footprint: plan 2 owns `org-marker.ts`, `org-layout.ts`, `home-snapshot.ts`, `team-snapshots.ts`, `join.ts`, `invite.ts`, `create.ts`, `org-clone.ts` and the `org.folder` step; plan 4 owns `lib/secrets/team-store.ts`, `lib/team/admin-secrets.ts` and the switchboard token readers. This plan only imports from those, with one exception called out in Task 5 (`invite.ts`'s `resolveForgeAccess`, a function plan 2 does not change). In `commands/team.ts` and `lib/command-tree-def.ts` it adds new functions and nodes and edits only `teamManageMembership`, one condition and prompt in `teamInvite`, one `REFUSAL_CODES` entry, one optional `TeamDeps` field, and the `manage-membership` node's copy.
- Run bun tests from the repo root (`bun test <path>`), targeted files only; CI runs the full suite.
- Commit after each task; only the files the task touched.

## Review Focus

1. An org whose marker names no `dataBranch` (every org before conversion, whose data still sits on `main` beside application code): rt must make no forge call that writes, and must never protect or set a push list on `main`. The verb reports "not yet"; the setup row is absent.
2. A marker whose `dataBranch` is `main`, `master` or the repo's default branch (a hand-edited marker): rt refuses with a plain step and writes nothing.
3. Anyone's existing repo level, whether on the roster or not (a member with write, a developer using the same repo for code, someone who just left a role or the roster): never lowered. Only the data branch push list drops people.
4. A grant that comes back as a pending GitHub invitation, or fails, must keep that person off the push list in the same run (GitHub rejects the whole push list when one name lacks write), and the rest of the run still applies.
5. A forge that is slow, unreachable or refuses a read: the setup row turns into one honest row and never takes the accounts group down; the daemon sweep logs and carries on. Likewise this Mac sitting on a trial branch: no forge write, and the row says the sync waits.

Tests that pin them: 1 and 2 in Task 4 (and the row's null in Task 7), 3 in Tasks 1 and 4, 4 in Task 4, 5 in Tasks 4, 7 and 9.

---

### Task 1: The forge-neutral types and the access planner

**Files:**
- Create: `lib/team/forge-access.ts`
- Create: `lib/team/forge-access-plan.ts`
- Modify: `lib/team/forge.ts` (export `FailureReason`, `classifyExecFailure`, `forgeAuthEnv`, `parseForgeRemote`, `splitOwnerRepo`, `lookupGitlabUserId`; add the `export` keyword only, no body changes)
- Test: `lib/team/__tests__/forge-access-plan.test.ts`

**Interfaces:**
- Consumes: `OrgRoles` (with `owners`, plan 1), `roleOf`, `isOrgAdmin` (`packages/rt-client/src/settings/org-roles.ts`), `RosterEntry`, `sameUser` (`active-team.ts`), `HANDLE_PATTERN` (`lib/team/invite.ts`, import only).
- Produces (forge-access.ts): `AccessLevel`, `LEVEL_RANK`, `ForgeMember`, `PushList`, `ForgeResult<T>`, `OrgForgeAccess`, `ApiCall`, `forgeApi`, `parseJson`, `pagedList`, `apiText`, `httpStatus`, `done`, `refusal`, `FORGE_API_TIMEOUT_MS`.
- Produces (forge-access-plan.ts): `WantedMember`, `Wanted`, `wantedAccess(roles, roster): Wanted`, `AccessDiff` (`grant`, `addPush`, `removePush`, `waiting`; no lowering of any kind), `accessDiff(wanted, members, pushList): AccessDiff`, `hasChanges(diff): boolean`, `fingerprintOf(wanted, branch): string`, `diffLines(diff, branch): string[]`, `limitSentence(pushList, branch): string | null`.

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/forge-access-plan.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { OrgRoles, RosterEntry } from "../../../packages/rt-client/src/settings/active-team.ts";
import type { ForgeMember } from "../forge-access.ts";
import { accessDiff, diffLines, fingerprintOf, hasChanges, limitSentence, wantedAccess } from "../forge-access-plan.ts";

const roles: OrgRoles = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: [] } } };
const roster: RosterEntry[] = [
  { username: "dev0", teams: [] },
  { username: "dev1", teams: ["widgets"] },
  { username: "Dev2", teams: ["widgets"] },
  { username: "dev3", teams: ["widgets"] },
  { username: "dev4", teams: [] },
];
const member = (username: string, level: ForgeMember["level"], more: Partial<ForgeMember> = {}): ForgeMember => ({ username, level, inherited: false, pending: false, ...more });

describe("wantedAccess", () => {
  test("org owners, admins and team owners get write and push; members and people on no team get read", () => {
    const wanted = wantedAccess(roles, roster);
    expect(wanted.members).toEqual([
      { username: "dev0", level: "write" },
      { username: "dev1", level: "write" },
      { username: "Dev2", level: "write" },
      { username: "dev3", level: "read" },
      { username: "dev4", level: "read" },
    ]);
    expect(wanted.pushers).toEqual(["dev0", "dev1", "Dev2"]);
  });
  test("a role holder missing from the roster is still wanted, once, whatever the case", () => {
    const wanted = wantedAccess({ ...roles, admins: ["dev1", "DEV9"] }, [...roster, { username: "dev9" }]);
    expect(wanted.members.filter((m) => m.username.toLowerCase() === "dev9")).toEqual([{ username: "dev9", level: "write" }]);
  });
  test("a name that is not a forge username never becomes wanted", () => {
    const wanted = wantedAccess(roles, [...roster, { username: "../x" }, { username: "a b" }, { username: "-x" }, { username: "  " }]);
    expect(wanted.members.map((m) => m.username)).not.toContain("../x");
    expect(wanted.invalid).toEqual(["../x", "a b", "-x"]);
  });
});

describe("accessDiff", () => {
  const wanted = wantedAccess(roles, roster);
  const named = (users: string[]) => ({ kind: "named" as const, users });

  test("raises who lacks their level, and never lowers anyone: a member with write keeps it, forge admins stay", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "read"), member("dev3", "write"), member("dev4", "admin")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([{ username: "Dev2", level: "write" }]);
    expect(diff.addPush).toEqual([]);
    expect(diff.removePush).toEqual([]);
    expect(hasChanges(diff)).toBe(true);
    expect(Object.keys(diff).sort()).toEqual(["addPush", "grant", "removePush", "waiting"]);
  });
  test("someone with no access at all, or only guest access, is granted read", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "guest")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([{ username: "dev3", level: "read" }, { username: "dev4", level: "read" }]);
  });
  test("write that comes from a group or team, or is held by someone off the roster, is left as it is", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "write", { inherited: true }), member("dev4", "read"), member("dev7", "write")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([]);
    expect(hasChanges(diff)).toBe(false);
  });
  test("the push list is the pushers, by name without case, and drops anyone else", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "read"), member("dev4", "read")], named(["DEV1", "dev7"]));
    expect(diff.addPush).toEqual(["dev0", "Dev2"]);
    expect(diff.removePush).toEqual(["dev7"]);
  });
  test("an unprotected branch needs every pusher; an open or unavailable one has no list to change", () => {
    const members = [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "read"), member("dev4", "read")];
    expect(accessDiff(wanted, members, { kind: "unprotected" }).addPush).toEqual(["dev0", "dev1", "Dev2"]);
    expect(accessDiff(wanted, members, { kind: "open", why: "x" }).addPush).toEqual([]);
    expect(accessDiff(wanted, members, { kind: "unavailable", why: "x" }).addPush).toEqual([]);
  });
  test("an invitation not yet accepted is waiting, never granted again", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write", { pending: true }), member("dev3", "read"), member("dev4", "read")], named(["dev0", "dev1"]));
    expect(diff.grant).toEqual([]);
    expect(diff.waiting).toEqual(["Dev2"]);
  });
  test("someone who left the roster or lost a role comes off the push list only, and keeps their repo level", () => {
    const short = wantedAccess({ ...roles, teams: { widgets: { owners: [] } } }, roster.filter((e) => e.username !== "dev3"));
    const diff = accessDiff(short, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "write"), member("dev4", "read")], named(["dev0", "dev1", "dev2", "dev3"]));
    expect(diff.removePush).toEqual(["dev2", "dev3"]);
    expect(diff.grant).toEqual([]);
  });
});

describe("fingerprintOf", () => {
  test("ignores order and case, and moves with a level or the branch", () => {
    const a = wantedAccess(roles, roster);
    const b = wantedAccess(roles, [...roster].reverse().map((e) => ({ ...e, username: e.username.toUpperCase() })));
    expect(fingerprintOf(a, "mattstack")).toBe(fingerprintOf(b, "mattstack"));
    expect(fingerprintOf(a, "mattstack")).not.toBe(fingerprintOf(a, "trial"));
    expect(fingerprintOf(a, "mattstack")).not.toBe(fingerprintOf(wantedAccess({ ...roles, admins: ["dev1", "dev3"] }, roster), "mattstack"));
  });
});

describe("copy", () => {
  test("diffLines names each change in plain words", () => {
    const diff = { grant: [{ username: "dev2", level: "write" as const }], addPush: ["dev2"], removePush: ["dev7"], waiting: [] };
    expect(diffLines(diff, "mattstack")).toEqual(["Give dev2 write access", "Let dev2 push mattstack", "Stop dev7 pushing mattstack"]);
  });
  test("limitSentence says plainly who can push when the forge cannot name people", () => {
    expect(limitSentence({ kind: "named", users: [] }, "mattstack")).toBeNull();
    expect(limitSentence({ kind: "unprotected" }, "mattstack")).toBeNull();
    expect(limitSentence({ kind: "open", why: "The mattstack branch lets every Developer push" }, "mattstack")).toBe(
      "The mattstack branch lets every Developer push. Anyone with write access can push mattstack, and only rt limits what they change there.",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/forge-access-plan.test.ts`
Expected: FAIL (module `../forge-access-plan.ts` not found).

- [ ] **Step 3: Implement**

In `lib/team/forge.ts`, add `export` to `FailureReason`, `classifyExecFailure`, `forgeAuthEnv`, `parseForgeRemote`, `splitOwnerRepo`, `lookupGitlabUserId` and its `GitlabUserLookup` type. Nothing else changes in that file.

`lib/team/forge-access.ts`:

```ts
/**
 * Forge access for an org repo, the same on GitLab and GitHub: who may push
 * the org's data branch, and each person's repo membership level. rt reads
 * and writes it through `gh api` and `glab api` (forge.ts's CLI path), never
 * through glance, which stays read-only.
 */

import type { ExecResult, Probes } from "../setup/probes.ts";
import { classifyExecFailure, forgeArgv, type FailureReason } from "./forge.ts";

export type AccessLevel = "none" | "guest" | "read" | "write" | "admin";

export const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, guest: 1, read: 2, write: 3, admin: 4 };

export interface ForgeMember {
  username: string;
  level: AccessLevel;
  /** The level comes from a group, a team or the org's base permission rather than the repo's own member list. */
  inherited: boolean;
  /** Invited and not yet accepted (or awaiting approval): no access until then. */
  pending: boolean;
}

export type PushList =
  | { kind: "unprotected" }
  | { kind: "named"; users: string[] }
  /** Protected, but pushes are not limited to named people. */
  | { kind: "open"; why: string }
  /** This forge plan cannot protect the branch at all. */
  | { kind: "unavailable"; why: string };

export type ForgeResult<T> = { ok: true; value: T } | { ok: false; reason: FailureReason; manualSteps: string[] };

export interface OrgForgeAccess {
  readonly provider: "github" | "gitlab";
  defaultBranch(): Promise<ForgeResult<string>>;
  readPushList(branch: string): Promise<ForgeResult<PushList>>;
  /** Replaces the people named on the branch's push list. "cannot-name-users": this forge plan cannot name people, and the branch is left open to anyone with write. */
  setPushList(branch: string, usernames: string[]): Promise<ForgeResult<"set" | "cannot-name-users">>;
  readMembers(): Promise<ForgeResult<ForgeMember[]>>;
  /** Gives a person the repo level named. rt calls it only to raise someone (`accessDiff` never asks for less than they hold). "invited": the forge sent an invitation, and access starts when they accept. */
  grant(username: string, level: "read" | "write"): Promise<ForgeResult<"granted" | "invited">>;
  revoke(username: string): Promise<ForgeResult<"revoked">>;
  /** First-time protection of a branch that has none. */
  protect(branch: string): Promise<ForgeResult<"protected" | "unavailable">>;
}

export const FORGE_API_TIMEOUT_MS = 20_000;

export interface ApiCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  fields?: string[];
  body?: unknown;
  paginate?: boolean;
}

/** A JSON body rides stdin (`--input -`), so arrays and objects reach the forge whole; `-f` fields stay scalars. */
export async function forgeApi(p: Probes, cli: "gh" | "glab", env: Record<string, string> | undefined, call: ApiCall): Promise<ExecResult> {
  const argv = [...forgeArgv(p, cli), "api", "-X", call.method, call.path];
  if (call.paginate) argv.push(...(cli === "gh" ? ["--paginate", "--slurp"] : ["--paginate"]));
  for (const field of call.fields ?? []) argv.push("-f", field);
  if (call.body !== undefined) argv.push("--input", "-");
  return p.exec(argv, {
    ...(env ? { env } : {}),
    ...(call.body !== undefined ? { input: JSON.stringify(call.body) } : {}),
    timeoutMs: FORGE_API_TIMEOUT_MS,
  });
}

export function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** gh's `--paginate --slurp` wraps each page in an outer array; glab's `--paginate` already joins the pages into one. */
export function pagedList(stdout: string, cli: "gh" | "glab"): Record<string, unknown>[] | null {
  const parsed = parseJson(stdout);
  if (!Array.isArray(parsed)) return null;
  const items: unknown[] = cli === "gh" ? parsed.flat(1) : parsed;
  return items.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
}

export function apiText(r: Pick<ExecResult, "stdout" | "stderr">): string {
  return `${r.stdout}\n${r.stderr}`;
}

export function httpStatus(r: Pick<ExecResult, "stdout" | "stderr">): number | null {
  const match = /HTTP (\d{3})/.exec(apiText(r));
  return match ? Number(match[1]) : null;
}

export function done<T>(value: T): ForgeResult<T> {
  return { ok: true, value };
}

function leadStep(reason: FailureReason, cli: "gh" | "glab"): string | null {
  const forge = cli === "gh" ? "GitHub" : "GitLab";
  switch (reason) {
    case "not-installed":
      return `Install the ${forge} command line tool, then sign in: ${cli} auth login`;
    case "not-authenticated":
      return `Sign in, then run this again: ${cli} auth login`;
    case "org-policy":
      return "Let the command line tool's token through your organization's single sign-on, then try again";
    case "insufficient-permission":
      return `Your ${forge} account can't change access on this repo. Someone who administers it does this by hand:`;
    case "unknown-handle":
    case "other":
      return null;
  }
}

/** A refused forge call as the steps a person does by hand: why it failed first, when the CLI's words say, then the forge page. */
export function refusal<T>(r: Pick<ExecResult, "code" | "stdout" | "stderr">, cli: "gh" | "glab", steps: string[]): ForgeResult<T> {
  const reason = classifyExecFailure(r);
  const lead = leadStep(reason, cli);
  return { ok: false, reason, manualSteps: lead ? [lead, ...steps] : steps };
}
```

`lib/team/forge-access-plan.ts`:

```ts
/**
 * What forge access the org's roles call for, and how it differs from what
 * the forge has. Pure: no forge call, no file read.
 */

import { createHash } from "crypto";
import { sameUser, type OrgRoles, type RosterEntry } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../../packages/rt-client/src/settings/org-roles.ts";
import { LEVEL_RANK, type ForgeMember, type PushList } from "./forge-access.ts";
import { HANDLE_PATTERN } from "./invite.ts";

export interface WantedMember {
  username: string;
  level: "read" | "write";
}

export interface Wanted {
  members: WantedMember[];
  pushers: string[];
  /** Roster or role names that are not forge usernames, so they never reach a forge API path. */
  invalid: string[];
}

export function wantedAccess(roles: OrgRoles, roster: RosterEntry[]): Wanted {
  const names: string[] = [];
  const invalid: string[] = [];
  const add = (raw: string) => {
    const name = raw.trim();
    if (name === "" || names.some((n) => sameUser(n, name)) || invalid.includes(name)) return;
    if (HANDLE_PATTERN.test(name)) names.push(name);
    else invalid.push(name);
  };
  for (const entry of roster) add(entry.username);
  for (const name of [...roles.owners, ...roles.admins, ...Object.values(roles.teams).flatMap((team) => team.owners)]) add(name);
  const members = names
    .map((username): WantedMember => {
      const role = roleOf(username, roles);
      return { username, level: isOrgAdmin(role) || role.kind === "owner" ? "write" : "read" };
    })
    .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  return { members, pushers: members.filter((m) => m.level === "write").map((m) => m.username), invalid };
}

/**
 * Only ever adds repo access. rt never lowers an existing repo-wide level,
 * even a member's write, because the repo may hold application code that
 * person works on; repo access comes off only through `rt team members
 * remove`. Losing a role or leaving the roster shows up here as a push list
 * removal and nothing else.
 */
export interface AccessDiff {
  /** People below the level their role needs. */
  grant: WantedMember[];
  addPush: string[];
  removePush: string[];
  /** Invited and not yet accepted. Informational: nothing to do until they accept. */
  waiting: string[];
}

export function accessDiff(wanted: Wanted, members: ForgeMember[], pushList: PushList): AccessDiff {
  const find = (username: string) => members.find((m) => sameUser(m.username, username));
  const diff: AccessDiff = { grant: [], addPush: [], removePush: [], waiting: [] };
  for (const want of wanted.members) {
    const current = find(want.username);
    if (current?.pending) diff.waiting.push(want.username);
    else if (!current || LEVEL_RANK[current.level] < LEVEL_RANK[want.level]) diff.grant.push(want);
  }
  if (pushList.kind === "named") {
    diff.addPush = wanted.pushers.filter((u) => !pushList.users.some((n) => sameUser(n, u)));
    diff.removePush = pushList.users.filter((n) => !wanted.pushers.some((u) => sameUser(n, u)));
  } else if (pushList.kind === "unprotected") {
    diff.addPush = [...wanted.pushers];
  }
  return diff;
}

export function hasChanges(diff: AccessDiff): boolean {
  return diff.grant.length + diff.addPush.length + diff.removePush.length > 0;
}

export function fingerprintOf(wanted: Wanted, branch: string): string {
  const members = wanted.members.map((m) => `${m.username.toLowerCase()}:${m.level}`).sort();
  return createHash("sha256").update(JSON.stringify({ branch, members })).digest("hex");
}

export function diffLines(diff: AccessDiff, branch: string): string[] {
  return [
    ...diff.grant.map((g) => `Give ${g.username} ${g.level} access`),
    ...diff.addPush.map((u) => `Let ${u} push ${branch}`),
    ...diff.removePush.map((u) => `Stop ${u} pushing ${branch}`),
  ];
}

export function limitSentence(pushList: PushList, branch: string): string | null {
  if (pushList.kind !== "open" && pushList.kind !== "unavailable") return null;
  return `${pushList.why}. Anyone with write access can push ${branch}, and only rt limits what they change there.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/forge-access-plan.test.ts lib/team/__tests__/forge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/forge-access.ts lib/team/forge-access-plan.ts lib/team/forge.ts lib/team/__tests__/forge-access-plan.test.ts
git commit -m "forge access: forge-neutral types and the roles-to-access planner"
```

---

### Task 2: GitHub implementation, GitHub fake and the shared contract suite

**Files:**
- Create: `lib/team/forge-access-github.ts`
- Create: `lib/team/__tests__/forge-fakes.ts` (`parseApi`, `fakeGitHub`, `FakeForgeOpts`, `FakeForge`)
- Create: `lib/team/__tests__/forge-access-contract.test.ts`

**Interfaces:**
- Consumes: Task 1's `forge-access.ts`; `forgeAuthEnv`, `revokeRead` (`forge.ts`); `fakeProbes` (`lib/setup/__tests__/fakes.ts`).
- Produces: `githubForgeAccess(p: Probes, remote: string, owner: string, repo: string, token: string | null): OrgForgeAccess`; `fakeGitHub(opts: FakeForgeOpts): FakeForge`; the contract suite's `WORLDS` map, which Task 3 extends with `gitlab`.

GitHub facts this task relies on (confirmed from docs.github.com/en/rest/branches/branch-protection): `PUT /repos/{owner}/{repo}/branches/{branch}/protection` requires `required_status_checks`, `enforce_admins`, `required_pull_request_reviews` and `restrictions` (each may be `null`); `restrictions` is `{ users, teams, apps? }` and applies only to organization-owned repos; `PUT .../protection/restrictions/users` with `{ "users": [...] }` replaces the list; protected branches on private repos need GitHub Pro, Team or Enterprise. Branch protection's user restriction is used rather than a ruleset, because it names users directly and works on every paid plan; rulesets would need a `User` bypass actor plus an `update` rule.

- [ ] **Step 1: Confirm the GitHub details against the forge before coding**

Read-only, against the GitHub harness repo listed in `packages/glance/harness_credentials.json` (`repos[]` with `provider: "github"`; its token comes from `gh auth token`). Use a throwaway branch and delete it after. Record the exact stderr of each:

```bash
REPO=<owner>/<repo from harness_credentials.json>
gh api /repos/$REPO --jq '{default_branch, owner: .owner.type, private}'
git ls-remote https://github.com/$REPO HEAD   # pick the default sha
gh api -X POST /repos/$REPO/git/refs -f ref=refs/heads/rt-forge-access-probe -f sha=<sha>
gh api /repos/$REPO/branches/rt-forge-access-probe/protection        # expect: Branch not protected (HTTP 404)
gh api /repos/$REPO/branches/no-such-branch/protection               # expect: Branch not found (HTTP 404)
echo '{"required_status_checks":null,"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":{"users":[],"teams":[],"apps":[]}}' \
  | gh api -X PUT /repos/$REPO/branches/rt-forge-access-probe/protection --input -
#   org-owned: 200; user-owned: 422 "Only organization repositories can have users and team restrictions"; free private: 403 "Upgrade to GitHub Pro..."
gh api /repos/$REPO/collaborators?affiliation=all\&per_page=100 --paginate --slurp --jq '.[][] | {login, role_name}'
gh api -X DELETE /repos/$REPO/branches/rt-forge-access-probe/protection
gh api -X DELETE /repos/$REPO/git/refs/heads/rt-forge-access-probe
```

If any message differs from the regexes in Step 4 (`NOT_PROTECTED`, `BRANCH_MISSING`, `PLAN_LIMIT`, `ORG_ONLY`), use the observed text in both the implementation and `fakeGitHub`. If `PUT .../restrictions/users` cannot be reached on the harness repo (user-owned), note it in the PR description: the org-owned path is then covered by the fake only, and by Task 11's run if an org-owned test repo is available.

- [ ] **Step 2: Write the fake**

`lib/team/__tests__/forge-fakes.ts`:

```ts
/**
 * In-memory GitHub and GitLab, driven through the same `gh api` / `glab api`
 * argv the real CLIs take, so OrgForgeAccess's contract suite runs one set of
 * tests against both. Error output copies each CLI's shape: the body as JSON
 * on stdout, "<cli>: <message> (HTTP <status>)" on stderr.
 */

import type { ExecResult, Probes } from "../../setup/probes.ts";
import { LEVEL_RANK, type AccessLevel } from "../forge-access.ts";

export interface FakeMember {
  level: AccessLevel;
  inherited?: boolean;
  pending?: boolean;
}

export interface FakeForgeOpts {
  /** Accounts that exist on the forge. */
  users: string[];
  members?: Record<string, FakeMember>;
  /** Defaults to ["main", "mattstack"]. */
  branches?: string[];
  /** Defaults to "main". */
  defaultBranch?: string;
  /** GitHub: a repo a personal account owns. GitLab: the Free plan. Either way the forge cannot name who may push. */
  cannotNameUsers?: boolean;
  /** GitHub only: a private repo on a free plan, which cannot protect any branch. */
  cannotProtect?: boolean;
  /** The token reads but cannot change access: every write is HTTP 403. */
  readOnly?: boolean;
  /** GitHub: accounts added at once rather than invited (members of the owning organization). */
  addedDirectly?: string[];
}

type Exec = (argv: string[], opts?: Parameters<Probes["exec"]>[1]) => ExecResult;

export interface FakeForge {
  exec: Exec;
  /** "METHOD path" for every call that is not a GET. */
  writes: string[];
  members: () => Record<string, { level: AccessLevel; inherited: boolean; pending: boolean }>;
}

export function parseApi(argv: string[], input?: string): { method: string; path: string; fields: Record<string, string>; paginate: boolean; body: unknown } {
  const rest = argv.slice(argv.indexOf("api") + 1);
  let method = "GET";
  let path = "";
  let paginate = false;
  const fields: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-X") method = rest[++i]!;
    else if (arg === "-f" || arg === "-F") {
      const [key, ...value] = rest[++i]!.split("=");
      fields[key!] = value.join("=");
    } else if (arg === "--input") i++;
    else if (arg === "--paginate" || arg === "--slurp") paginate = true;
    else if (!arg.startsWith("-") && path === "") path = arg;
  }
  return { method, path, fields, paginate, body: input ? JSON.parse(input) : undefined };
}

function memberTable(opts: FakeForgeOpts) {
  return new Map(
    Object.entries(opts.members ?? {}).map(([username, m]) => [username.toLowerCase(), { username, level: m.level, inherited: m.inherited ?? false, pending: m.pending ?? false }]),
  );
}

function snapshot(table: ReturnType<typeof memberTable>) {
  return () => Object.fromEntries([...table.values()].map((m) => [m.username, { level: m.level, inherited: m.inherited, pending: m.pending }]));
}

const okJson = (body?: unknown): ExecResult => ({ code: 0, stdout: body === undefined ? "" : JSON.stringify(body), stderr: "" });

export function fakeGitHub(opts: FakeForgeOpts): FakeForge {
  const members = memberTable(opts);
  const branches = new Set(opts.branches ?? ["main", "mattstack"]);
  const rules = new Map<string, { restricted: boolean; users: string[] }>();
  const writes: string[] = [];
  const base = "/repos/acme/widgets";
  const fail = (status: number, message: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ message }), stderr: `gh: ${message} (HTTP ${status})` });
  const exists = (user: string) => opts.users.some((u) => u.toLowerCase() === user.toLowerCase());

  const exec: Exec = (argv, o) => {
    const { method, path, fields, paginate, body } = parseApi(argv, o?.input);
    if (method !== "GET") writes.push(`${method} ${path}`);
    if (method !== "GET" && opts.readOnly) return fail(403, "Must have admin rights to Repository.");
    const [route = "", query = ""] = path.split("?");
    const page = (items: unknown[]) => okJson(paginate ? [items] : items);

    if (method === "GET" && route === base) return okJson({ default_branch: opts.defaultBranch ?? "main", owner: { type: opts.cannotNameUsers ? "User" : "Organization" } });
    if (method === "GET" && route === `${base}/collaborators`) {
      const directOnly = query.includes("affiliation=direct");
      const roleName = (level: AccessLevel) => (level === "admin" ? "admin" : level === "write" ? "write" : level === "read" ? "read" : "none");
      return page([...members.values()].filter((m) => !m.pending && (!directOnly || !m.inherited)).map((m) => ({ login: m.username, role_name: roleName(m.level) })));
    }
    if (method === "GET" && route === `${base}/invitations`) {
      return page([...members.values()].filter((m) => m.pending).map((m) => ({ invitee: { login: m.username }, permissions: m.level === "write" ? "write" : "read" })));
    }

    const collaborator = /^\/repos\/acme\/widgets\/collaborators\/([^/]+)$/.exec(route);
    if (collaborator) {
      const user = decodeURIComponent(collaborator[1]!);
      if (method === "DELETE") {
        members.delete(user.toLowerCase());
        return okJson();
      }
      if (!exists(user)) return fail(404, "Not Found");
      const level: AccessLevel = opts.cannotNameUsers || fields.permission === "push" ? "write" : "read";
      const current = members.get(user.toLowerCase());
      if (current && !current.pending) {
        Object.assign(current, { level, inherited: false });
        return okJson();
      }
      const direct = (opts.addedDirectly ?? []).some((u) => u.toLowerCase() === user.toLowerCase());
      members.set(user.toLowerCase(), { username: user, level, inherited: false, pending: !direct });
      return direct ? okJson() : okJson({ id: 1, invitee: { login: user } });
    }

    const protection = /^\/repos\/acme\/widgets\/branches\/([^/]+)\/protection(\/restrictions\/users)?$/.exec(route);
    if (protection) {
      const branch = decodeURIComponent(protection[1]!);
      if (!branches.has(branch)) return fail(404, "Branch not found");
      if (opts.cannotProtect) return fail(403, "Upgrade to GitHub Pro or make this repository public to enable this feature.");
      const rule = rules.get(branch);
      if (!protection[2]) {
        if (method === "GET") return rule ? okJson(rule.restricted ? { restrictions: { users: rule.users.map((login) => ({ login })), teams: [], apps: [] } } : {}) : fail(404, "Branch not protected");
        if (method === "DELETE") {
          rules.delete(branch);
          return okJson();
        }
        const restrictions = (body as { restrictions?: { users?: string[] } | null }).restrictions;
        if (restrictions && opts.cannotNameUsers) return fail(422, "Only organization repositories can have users and team restrictions");
        rules.set(branch, { restricted: Boolean(restrictions), users: restrictions?.users ?? [] });
        return okJson({});
      }
      if (!rule || !rule.restricted) return fail(404, "Push restrictions not enabled");
      const users = (body as { users: string[] }).users;
      const lacking = users.filter((u) => {
        const m = members.get(u.toLowerCase());
        return !m || m.pending || LEVEL_RANK[m.level] < LEVEL_RANK.write;
      });
      if (lacking.length > 0) return fail(422, `Validation Failed: ${lacking.join(", ")} must have push access`);
      rule.users = [...users];
      return okJson(users.map((login) => ({ login })));
    }
    return fail(404, `fake gh has no route for ${method} ${path}`);
  };

  return { exec, writes, members: snapshot(members) };
}
```

- [ ] **Step 3: Write the failing contract suite**

`lib/team/__tests__/forge-access-contract.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { ForgeMember, ForgeResult, OrgForgeAccess } from "../forge-access.ts";
import { githubForgeAccess } from "../forge-access-github.ts";
import { fakeGitHub, type FakeForge, type FakeForgeOpts } from "./forge-fakes.ts";

export type World = { forge: FakeForge; access: OrgForgeAccess };

export const WORLDS: Record<string, (opts: FakeForgeOpts) => World> = {
  github: (opts) => {
    const forge = fakeGitHub(opts);
    const p = fakeProbes({ exec: forge.exec });
    return { forge, access: githubForgeAccess(p, "git@github.com:acme/widgets.git", "acme", "widgets", "token") };
  },
};

const USERS = ["dev1", "dev2", "dev3", "dev4"];
const valueOf = <T>(r: ForgeResult<T>): T => {
  if (!r.ok) throw new Error(`forge refused: ${r.manualSteps.join(" | ")}`);
  return r.value;
};
const levelOf = async (access: OrgForgeAccess, username: string) => valueOf(await access.readMembers()).find((m: ForgeMember) => m.username === username)?.level;

for (const [name, world] of Object.entries(WORLDS)) {
  describe(`OrgForgeAccess contract: ${name}`, () => {
    test("reads members with their level, and whether it is inherited or still an invitation", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" }, dev3: { level: "read", inherited: true }, dev4: { level: "read", pending: true } } });
      const byName = Object.fromEntries(valueOf(await access.readMembers()).map((m) => [m.username, m]));
      expect(byName.dev1).toMatchObject({ level: "admin", inherited: false, pending: false });
      expect(byName.dev2).toMatchObject({ level: "write", inherited: false, pending: false });
      expect(byName.dev3).toMatchObject({ level: "read", inherited: true });
      expect(byName.dev4).toMatchObject({ pending: true });
    });

    test("grant raises a direct member's level", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "read" }, dev3: { level: "guest" } } });
      expect(await access.grant("dev2", "write")).toEqual({ ok: true, value: "granted" });
      expect(await levelOf(access, "dev2")).toBe("write");
      expect(await access.grant("dev3", "read")).toEqual({ ok: true, value: "granted" });
      expect(await levelOf(access, "dev3")).toBe("read");
    });

    test("grant adds someone new, at once or by invitation", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" } } });
      const r = await access.grant("dev3", "read");
      expect(r.ok && ["granted", "invited"].includes(r.value)).toBe(true);
      expect(valueOf(await access.readMembers()).some((m) => m.username === "dev3")).toBe(true);
    });

    test("an account the forge does not know is a refusal with a step, never a throw", async () => {
      const { access } = world({ users: USERS, members: {} });
      const r = await access.grant("ghost", "read");
      expect(r.ok).toBe(false);
      expect(r.ok ? [] : r.manualSteps).not.toEqual([]);
    });

    test("revoke removes a member, and revoking someone who is not one is fine", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "read" } } });
      expect(await access.revoke("dev2")).toEqual({ ok: true, value: "revoked" });
      expect(await levelOf(access, "dev2")).toBeUndefined();
      expect(await access.revoke("dev3")).toEqual({ ok: true, value: "revoked" });
    });

    test("an unprotected branch reads so; protect, then setPushList names exactly the people given", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" }, dev3: { level: "write" } } });
      expect(await access.readPushList("mattstack")).toEqual({ ok: true, value: { kind: "unprotected" } });
      expect(await access.protect("mattstack")).toEqual({ ok: true, value: "protected" });
      expect(await access.setPushList("mattstack", ["dev1", "dev2", "dev3"])).toEqual({ ok: true, value: "set" });
      const first = valueOf(await access.readPushList("mattstack"));
      expect(first.kind === "named" ? [...first.users].sort() : first).toEqual(["dev1", "dev2", "dev3"]);
      expect(await access.setPushList("mattstack", ["dev1", "dev2"])).toEqual({ ok: true, value: "set" });
      const second = valueOf(await access.readPushList("mattstack"));
      expect(second.kind === "named" ? [...second.users].sort() : second).toEqual(["dev1", "dev2"]);
    });

    test("where the forge cannot name people, setPushList says so and the branch reads as open", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" } }, cannotNameUsers: true });
      expect(valueOf(await access.protect("mattstack"))).toBe("protected");
      expect(await access.setPushList("mattstack", ["dev1", "dev2"])).toEqual({ ok: true, value: "cannot-name-users" });
      expect(valueOf(await access.readPushList("mattstack")).kind).toBe("open");
    });

    test("a token that cannot change access gets a step naming the forge page on every write, never a throw", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "write" } }, readOnly: true });
      for (const r of [await access.grant("dev2", "write"), await access.protect("mattstack"), await access.setPushList("mattstack", ["dev1"])]) {
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.manualSteps.join(" ")).toContain("https://");
      }
    });

    test("a branch the repo does not have is a refusal that says to push it", async () => {
      const { access } = world({ users: USERS, members: {} });
      const r = await access.readPushList("nope");
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.manualSteps.join(" ")).toContain("Push the nope branch");
    });

    test("defaultBranch reads the repo's default branch", async () => {
      expect(await world({ users: USERS, defaultBranch: "trunk" }).access.defaultBranch()).toEqual({ ok: true, value: "trunk" });
    });

    test.if(name === "github")("a plan that cannot protect a private repo's branch reads as unavailable", async () => {
      const { access, forge } = world({ users: USERS, members: { dev1: { level: "admin" } }, cannotProtect: true });
      expect(valueOf(await access.readPushList("mattstack")).kind).toBe("unavailable");
      expect(await access.protect("mattstack")).toEqual({ ok: true, value: "unavailable" });
      expect(forge.writes.every((w) => w.startsWith("PUT"))).toBe(true);
    });
  });
}
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bun test lib/team/__tests__/forge-access-contract.test.ts`
Expected: FAIL (module `../forge-access-github.ts` not found).

- [ ] **Step 5: Implement**

`lib/team/forge-access-github.ts`:

```ts
/**
 * GitHub's half of OrgForgeAccess. The data branch's push list is branch
 * protection's push restriction (`restrictions.users`), which GitHub offers
 * only on repos an organization owns, and protects a private repo's branches
 * only on a paid plan. Collaborator levels: `pull` is read, `push` is write.
 */

import { sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import type { Probes } from "../setup/probes.ts";
import { forgeAuthEnv, revokeRead } from "./forge.ts";
import { apiText, done, forgeApi, httpStatus, pagedList, parseJson, refusal, type AccessLevel, type ApiCall, type ForgeMember, type OrgForgeAccess } from "./forge-access.ts";

const NOT_PROTECTED = /Branch not protected/i;
const BRANCH_MISSING = /Branch not found/i;
const PLAN_LIMIT = /Upgrade to GitHub Pro|make this repository public to enable this feature/i;
const ORG_ONLY = /Only organization repositories can have users and team restrictions/i;

function levelOf(entry: Record<string, unknown>): AccessLevel {
  const role = typeof entry.role_name === "string" ? entry.role_name : "";
  const perms = (entry.permissions ?? {}) as Record<string, unknown>;
  if (role === "admin" || role === "maintain" || perms.admin === true || perms.maintain === true) return "admin";
  if (role === "write" || perms.push === true) return "write";
  if (role === "read" || role === "triage" || perms.pull === true || perms.triage === true) return "read";
  return "none";
}

function inviteLevel(permission: unknown): AccessLevel {
  if (permission === "admin" || permission === "maintain") return "admin";
  if (permission === "write") return "write";
  return permission === "read" || permission === "triage" ? "read" : "none";
}

function login(entry: unknown): string | null {
  const value = (entry as { login?: unknown } | null)?.login;
  return typeof value === "string" ? value : null;
}

export function githubForgeAccess(p: Probes, remote: string, owner: string, repo: string, token: string | null): OrgForgeAccess {
  const env = forgeAuthEnv("github", "github.com", token);
  const base = `/repos/${owner}/${repo}`;
  const accessPage = `https://github.com/${owner}/${repo}/settings/access`;
  const branchesPage = `https://github.com/${owner}/${repo}/settings/branches`;
  const call = (c: ApiCall) => forgeApi(p, "gh", env, c);
  const protection = (branch: string) => `${base}/branches/${encodeURIComponent(branch)}/protection`;
  let ownerType: Promise<unknown> | null = null;
  const personal = async () => {
    ownerType ??= call({ method: "GET", path: base }).then((r) => (r.code === 0 ? (parseJson(r.stdout) as { owner?: { type?: unknown } } | null)?.owner?.type : null));
    return (await ownerType) === "User";
  };

  return {
    provider: "github",

    async defaultBranch() {
      const r = await call({ method: "GET", path: base });
      const branch = r.code === 0 ? (parseJson(r.stdout) as { default_branch?: unknown } | null)?.default_branch : null;
      return typeof branch === "string" ? done(branch) : refusal(r, "gh", [`Open https://github.com/${owner}/${repo}`, "Check that your GitHub account can see this repo"]);
    },

    async readPushList(branch) {
      const r = await call({ method: "GET", path: protection(branch) });
      if (r.code === 0) {
        const users = (parseJson(r.stdout) as { restrictions?: { users?: unknown } } | null)?.restrictions?.users;
        if (!Array.isArray(users)) return done({ kind: "open", why: `The ${branch} branch is protected, but its rule does not limit who can push` });
        return done({ kind: "named", users: users.map(login).filter((u): u is string => u !== null) });
      }
      const text = apiText(r);
      if (NOT_PROTECTED.test(text)) return done({ kind: "unprotected" });
      if (PLAN_LIMIT.test(text)) return done({ kind: "unavailable", why: "GitHub protects a private repo's branches only on a paid plan" });
      if (BRANCH_MISSING.test(text)) return refusal(r, "gh", [`Push the ${branch} branch, then run this again: rt team forge-access`]);
      return refusal(r, "gh", [`Open ${branchesPage}`, `Check the rule for the ${branch} branch`]);
    },

    async setPushList(branch, usernames) {
      if (await personal()) return done("cannot-name-users");
      const r = await call({ method: "PUT", path: `${protection(branch)}/restrictions/users`, body: { users: usernames } });
      if (r.code === 0) return done("set");
      if (ORG_ONLY.test(apiText(r))) return done("cannot-name-users");
      if (httpStatus(r) === 404) {
        return refusal(r, "gh", [`Open ${branchesPage}`, `Edit the rule for ${branch} and turn on "Restrict who can push to matching branches"`, "Then run: rt team forge-access --apply"]);
      }
      return refusal(r, "gh", [`Open ${branchesPage}`, `In the rule for ${branch}, let only ${usernames.join(", ")} push`]);
    },

    async readMembers() {
      const all = await call({ method: "GET", path: `${base}/collaborators?affiliation=all&per_page=100`, paginate: true });
      const allList = all.code === 0 ? pagedList(all.stdout, "gh") : null;
      if (allList === null) return refusal(all, "gh", [`Open ${accessPage}`]);
      const direct = await call({ method: "GET", path: `${base}/collaborators?affiliation=direct&per_page=100`, paginate: true });
      if (direct.code !== 0) return refusal(direct, "gh", [`Open ${accessPage}`]);
      const invites = await call({ method: "GET", path: `${base}/invitations?per_page=100`, paginate: true });
      if (invites.code !== 0) return refusal(invites, "gh", [`Open ${accessPage}`]);
      const directNames = (pagedList(direct.stdout, "gh") ?? []).map(login).filter((u): u is string => u !== null);
      const members: ForgeMember[] = allList.flatMap((entry) => {
        const username = login(entry);
        return username ? [{ username, level: levelOf(entry), inherited: !directNames.some((d) => sameUser(d, username)), pending: false }] : [];
      });
      for (const invite of pagedList(invites.stdout, "gh") ?? []) {
        const username = login(invite.invitee);
        if (username && !members.some((m) => sameUser(m.username, username))) members.push({ username, level: inviteLevel(invite.permissions), inherited: false, pending: true });
      }
      return done(members);
    },

    async grant(username, level) {
      const isPersonal = await personal();
      if (isPersonal && level === "read") {
        return { ok: false, reason: "other", manualSteps: [`${username} can't have read access only: a repo a personal GitHub account owns gives every collaborator write. Move the repo into a GitHub organization to change that.`] };
      }
      const r = await call({ method: "PUT", path: `${base}/collaborators/${encodeURIComponent(username)}`, fields: isPersonal ? [] : [`permission=${level === "write" ? "push" : "pull"}`] });
      // An invitation body (201) means access starts once they accept; an empty 204 means it is in effect now.
      if (r.code === 0) return done(r.stdout.trim().length > 0 ? "invited" : "granted");
      return refusal(r, "gh", [`Open ${accessPage}`, `Give ${username} ${level === "write" ? "Write" : "Read"} access`]);
    },

    async revoke(username) {
      const r = await revokeRead(p, remote, username, token);
      return r.access === "revoked" ? done("revoked") : { ok: false, reason: "other", manualSteps: r.manualSteps };
    },

    async protect(branch) {
      const rule = (restrictions: unknown) => ({ required_status_checks: null, enforce_admins: false, required_pull_request_reviews: null, restrictions, allow_force_pushes: false, allow_deletions: false });
      let r = await call({ method: "PUT", path: protection(branch), body: rule((await personal()) ? null : { users: [], teams: [], apps: [] }) });
      if (r.code !== 0 && ORG_ONLY.test(apiText(r))) r = await call({ method: "PUT", path: protection(branch), body: rule(null) });
      if (r.code === 0) return done("protected");
      if (PLAN_LIMIT.test(apiText(r))) return done("unavailable");
      return refusal(r, "gh", [`Open ${branchesPage}`, `Add a rule for the ${branch} branch that restricts who can push`]);
    },
  };
}
```

- [ ] **Step 6: Run the suite to verify it passes**

Run: `bun test lib/team/__tests__/forge-access-contract.test.ts lib/team/__tests__/forge.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/team/forge-access-github.ts lib/team/__tests__/forge-fakes.ts lib/team/__tests__/forge-access-contract.test.ts
git commit -m "forge access: GitHub implementation, fake and the shared contract suite"
```

---

### Task 3: GitLab implementation and fake, through the same suite

**Files:**
- Create: `lib/team/forge-access-gitlab.ts`
- Modify: `lib/team/__tests__/forge-fakes.ts` (add `fakeGitLab`)
- Modify: `lib/team/__tests__/forge-access-contract.test.ts` (add the `gitlab` world)

**Interfaces:**
- Consumes: Task 1's `forge-access.ts`; `forgeAuthEnv`, `lookupGitlabUserId`, `revokeRead` (`forge.ts`).
- Produces: `gitlabForgeAccess(p: Probes, remote: string, host: string, path: string, token: string | null): OrgForgeAccess`; `fakeGitLab(opts: FakeForgeOpts): FakeForge`.

GitLab facts this task relies on (confirmed from docs.gitlab.com/api/protected_branches): `GET /projects/:id/protected_branches/:name` returns `push_access_levels` entries with `id`, `access_level`, and on Premium/Ultimate `user_id` and `group_id`; `POST /projects/:id/protected_branches` takes `name`, `push_access_level`, `merge_access_level`, `allow_force_push` on every tier; naming users (`allowed_to_push` with `user_id`) is Premium and Ultimate only; `PATCH /projects/:id/protected_branches/:name` takes `allowed_to_push` entries, with no `id` to add one and `{ "id": n, "_destroy": true }` to remove one. Not stated in the docs, and confirmed in Step 1: what Free does with a `user_id` entry, and the 404 body for an unprotected branch.

- [ ] **Step 1: Confirm the GitLab details against the forge before coding**

Against the GitLab harness project in `packages/glance/harness_credentials.json` (`repos[]` with `provider: "gitlab"`; the `owner` user's token, access level 50). Use a throwaway branch and remove it after; never change the two `approver` users' levels, which the glance harness suite depends on.

```bash
export GITLAB_TOKEN=<owner token>   # plus GITLAB_HOST=<host> when it is not gitlab.com
P=$(python3 -I -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' <path_with_namespace>)
glab api projects/$P --jq '{default_branch, plan: .namespace.plan}'
glab api -X POST projects/$P/repository/branches -f branch=rt-forge-access-probe -f ref=<default branch>
glab api projects/$P/protected_branches/rt-forge-access-probe       # record the exact 404 text
glab api -X POST projects/$P/protected_branches -f name=rt-forge-access-probe -f push_access_level=30 -f merge_access_level=40
echo '{"allowed_to_push":[{"user_id":<owner user id>}]}' | glab api -X PATCH projects/$P/protected_branches/rt-forge-access-probe --input -
glab api projects/$P/protected_branches/rt-forge-access-probe --jq '.push_access_levels'
#   Premium/Ultimate: a new entry with user_id. Free: record whether the PATCH failed (status, text) or dropped the entry.
glab api "projects/$P/members/all?per_page=100" --paginate --jq '.[] | {username, access_level, membership_state}'
glab api -X DELETE projects/$P/protected_branches/rt-forge-access-probe
glab api -X DELETE projects/$P/repository/branches/rt-forge-access-probe
```

If Free answers the `user_id` PATCH with an error rather than dropping the entry, keep Step 4's read-back (it handles both) and make `fakeGitLab` return that error when `cannotNameUsers` is set. If any other message differs from the fake, use the observed text in both.

- [ ] **Step 2: Add the fake**

Append to `lib/team/__tests__/forge-fakes.ts`:

```ts
const GITLAB_LEVEL: Record<AccessLevel, number> = { none: 0, guest: 10, read: 20, write: 30, admin: 40 };
const fromGitlab = (n: number): AccessLevel => (n >= 40 ? "admin" : n >= 30 ? "write" : n >= 20 ? "read" : n > 0 ? "guest" : "none");

export function fakeGitLab(opts: FakeForgeOpts): FakeForge {
  const members = memberTable(opts);
  const branches = new Set(opts.branches ?? ["main", "mattstack"]);
  const ids = new Map(opts.users.map((u, i) => [u.toLowerCase(), 101 + i]));
  const nameOf = (id: number) => opts.users.find((u) => ids.get(u.toLowerCase()) === id);
  const rules = new Map<string, { id: number; access_level: number; user_id: number | null; group_id: null }[]>();
  let nextEntry = 1;
  const writes: string[] = [];
  const project = "projects/acme%2Fwidgets";
  const fail = (status: number, message: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ message }), stderr: `glab: ${status} ${message} (HTTP ${status})` });
  const row = (m: { username: string; level: AccessLevel; pending: boolean }) => ({ id: ids.get(m.username.toLowerCase()), username: m.username, access_level: GITLAB_LEVEL[m.level], membership_state: m.pending ? "awaiting" : "active" });

  const exec: Exec = (argv, o) => {
    const { method, path, fields, body } = parseApi(argv, o?.input);
    if (method !== "GET") writes.push(`${method} ${path}`);
    if (method !== "GET" && opts.readOnly) return fail(403, "Forbidden");
    const [route = "", query = ""] = path.split("?");

    if (route === "users") {
      const wanted = new URLSearchParams(query).get("username") ?? "";
      const id = ids.get(wanted.toLowerCase());
      return okJson(id === undefined ? [] : [{ id, username: nameOf(id) }]);
    }
    const user = /^users\/(\d+)$/.exec(route);
    if (user) {
      const name = nameOf(Number(user[1]));
      return name ? okJson({ id: Number(user[1]), username: name }) : fail(404, "404 User Not Found");
    }
    if (route === project) return okJson({ default_branch: opts.defaultBranch ?? "main" });
    if (method === "GET" && route === `${project}/members/all`) return okJson([...members.values()].map(row));
    if (method === "GET" && route === `${project}/members`) return okJson([...members.values()].filter((m) => !m.inherited).map(row));
    if (method === "POST" && route === `${project}/members`) {
      const name = nameOf(Number(fields.user_id));
      if (!name) return fail(404, "404 User Not Found");
      const current = members.get(name.toLowerCase());
      if (current && !current.inherited) return fail(409, "Member already exists");
      members.set(name.toLowerCase(), { username: name, level: fromGitlab(Number(fields.access_level)), inherited: false, pending: false });
      return okJson({});
    }
    const member = /^projects\/acme%2Fwidgets\/members\/(\d+)$/.exec(route);
    if (member) {
      const name = nameOf(Number(member[1]));
      const current = name ? members.get(name.toLowerCase()) : undefined;
      if (!name || !current || current.inherited) return fail(404, "404 Not found");
      if (method === "DELETE") members.delete(name.toLowerCase());
      else current.level = fromGitlab(Number(fields.access_level));
      return okJson({});
    }
    const branchRoute = /^projects\/acme%2Fwidgets\/repository\/branches\/(.+)$/.exec(route);
    if (branchRoute) return branches.has(decodeURIComponent(branchRoute[1]!)) ? okJson({}) : fail(404, "404 Branch Not Found");
    if (method === "POST" && route === `${project}/protected_branches`) {
      const b = body as { name?: string } | undefined;
      const name = b?.name ?? fields.name ?? "";
      if (rules.has(name)) return fail(409, "Protected branch already exists");
      const level = Number((body as { push_access_level?: number } | undefined)?.push_access_level ?? fields.push_access_level ?? 40);
      rules.set(name, [{ id: nextEntry++, access_level: level, user_id: null, group_id: null }]);
      return okJson({});
    }
    const rule = /^projects\/acme%2Fwidgets\/protected_branches\/(.+)$/.exec(route);
    if (rule) {
      const name = decodeURIComponent(rule[1]!);
      const entries = rules.get(name);
      if (!entries) return fail(404, "404 Not found");
      if (method === "GET") return okJson({ name, push_access_levels: entries });
      if (method === "DELETE") {
        rules.delete(name);
        return okJson();
      }
      for (const change of (body as { allowed_to_push: Record<string, unknown>[] }).allowed_to_push) {
        if (change._destroy === true) rules.set(name, (rules.get(name) ?? []).filter((e) => e.id !== change.id));
        else if (typeof change.user_id === "number" && !opts.cannotNameUsers) rules.get(name)!.push({ id: nextEntry++, access_level: 40, user_id: change.user_id, group_id: null });
        else if (typeof change.access_level === "number") rules.get(name)!.push({ id: nextEntry++, access_level: change.access_level, user_id: null, group_id: null });
      }
      return okJson({});
    }
    return fail(404, `fake glab has no route for ${method} ${path}`);
  };

  return { exec, writes, members: snapshot(members) };
}
```

In `forge-access-contract.test.ts`, add the world beside `github` (and the imports `fakeGitLab`, `gitlabForgeAccess`):

```ts
  gitlab: (opts) => {
    const forge = fakeGitLab(opts);
    const p = fakeProbes({ exec: forge.exec });
    return { forge, access: gitlabForgeAccess(p, "https://gitlab.com/acme/widgets.git", "gitlab.com", "acme/widgets", "token") };
  },
```

- [ ] **Step 3: Run the suite to verify the GitLab half fails**

Run: `bun test lib/team/__tests__/forge-access-contract.test.ts`
Expected: FAIL (module `../forge-access-gitlab.ts` not found); the GitHub half still passes once it resolves.

- [ ] **Step 4: Implement**

`lib/team/forge-access-gitlab.ts`:

```ts
/**
 * GitLab's half of OrgForgeAccess. The data branch's push list is the
 * protected branch's "Allowed to push and merge" user entries, which GitLab
 * offers on Premium and Ultimate. A new protection starts open to Developers,
 * so on a plan that cannot name people team owners can still push; once the
 * named users land, setPushList drops that Developer entry.
 * Levels: Reporter (20) is read, Developer (30) is write.
 */

import type { Probes } from "../setup/probes.ts";
import { forgeAuthEnv, lookupGitlabUserId, revokeRead } from "./forge.ts";
import { apiText, done, forgeApi, httpStatus, pagedList, parseJson, refusal, type AccessLevel, type ApiCall, type ForgeMember, type OrgForgeAccess } from "./forge-access.ts";

const DEVELOPER = 30;
const MAINTAINER = 40;
const LEVEL_NUMBER = { read: 20, write: DEVELOPER } as const;
const ROLE_NAME = { read: "Reporter", write: "Developer" } as const;

function levelOf(n: number): AccessLevel {
  if (n >= MAINTAINER) return "admin";
  if (n >= DEVELOPER) return "write";
  if (n >= 20) return "read";
  return n > 0 ? "guest" : "none";
}

interface PushEntry {
  id: number;
  access_level: number;
  user_id: number | null;
  group_id: number | null;
}

function pushEntries(stdout: string): PushEntry[] {
  const levels = (parseJson(stdout) as { push_access_levels?: unknown } | null)?.push_access_levels;
  if (!Array.isArray(levels)) return [];
  return levels.flatMap((e: Record<string, unknown>) =>
    typeof e?.id === "number" && typeof e.access_level === "number"
      ? [{ id: e.id, access_level: e.access_level, user_id: typeof e.user_id === "number" ? e.user_id : null, group_id: typeof e.group_id === "number" ? e.group_id : null }]
      : [],
  );
}

const isDeveloperRole = (e: PushEntry) => e.user_id === null && e.group_id === null && e.access_level === DEVELOPER;

export function gitlabForgeAccess(p: Probes, remote: string, host: string, path: string, token: string | null): OrgForgeAccess {
  const env = forgeAuthEnv("gitlab", host, token);
  const project = `projects/${encodeURIComponent(path)}`;
  const membersPage = `https://${host}/${path}/-/project_members`;
  const branchesPage = `https://${host}/${path}/-/settings/repository`;
  const call = (c: ApiCall) => forgeApi(p, "glab", env, c);
  const rulePath = (branch: string) => `${project}/protected_branches/${encodeURIComponent(branch)}`;
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  const remember = (username: string, id: number) => {
    ids.set(username.toLowerCase(), id);
    names.set(id, username);
  };

  async function idOf(username: string): Promise<number | null> {
    const known = ids.get(username.toLowerCase());
    if (known !== undefined) return known;
    const lookup = await lookupGitlabUserId(p, host, username, token);
    if (lookup.id === null) return null;
    remember(username, lookup.id);
    return lookup.id;
  }

  async function nameOf(id: number): Promise<string | null> {
    const known = names.get(id);
    if (known) return known;
    const r = await call({ method: "GET", path: `users/${id}` });
    const username = r.code === 0 ? (parseJson(r.stdout) as { username?: unknown } | null)?.username : null;
    if (typeof username !== "string") return null;
    remember(username, id);
    return username;
  }

  const unknownUser = (username: string) => ({ ok: false as const, reason: "unknown-handle" as const, manualSteps: [`Check that "${username}" is a real GitLab username: it was not found`] });

  return {
    provider: "gitlab",

    async defaultBranch() {
      const r = await call({ method: "GET", path: project });
      const branch = r.code === 0 ? (parseJson(r.stdout) as { default_branch?: unknown } | null)?.default_branch : null;
      return typeof branch === "string" ? done(branch) : refusal(r, "glab", [`Open https://${host}/${path}`, "Check that your GitLab account can see this project"]);
    },

    async readPushList(branch) {
      const r = await call({ method: "GET", path: rulePath(branch) });
      if (r.code !== 0) {
        if (httpStatus(r) !== 404) return refusal(r, "glab", [`Open ${branchesPage}`, `Check the protected branch rule for ${branch}`]);
        const exists = await call({ method: "GET", path: `${project}/repository/branches/${encodeURIComponent(branch)}` });
        return exists.code === 0 ? done({ kind: "unprotected" }) : refusal(exists, "glab", [`Push the ${branch} branch, then run this again: rt team forge-access`]);
      }
      const entries = pushEntries(r.stdout);
      if (entries.some(isDeveloperRole)) return done({ kind: "open", why: `The ${branch} branch lets every Developer push` });
      const users: string[] = [];
      for (const entry of entries) {
        if (entry.user_id === null) continue;
        const username = await nameOf(entry.user_id);
        if (username) users.push(username);
      }
      return done({ kind: "named", users });
    },

    async setPushList(branch, usernames) {
      const current = await call({ method: "GET", path: rulePath(branch) });
      if (current.code !== 0) return refusal(current, "glab", [`Open ${branchesPage}`, `Protect the ${branch} branch first`]);
      const entries = pushEntries(current.stdout);
      const wanted = new Map<number, string>();
      for (const username of usernames) {
        const id = await idOf(username);
        if (id === null) return unknownUser(username);
        wanted.set(id, username);
      }
      const changes = [
        ...[...wanted.keys()].filter((id) => !entries.some((e) => e.user_id === id)).map((user_id) => ({ user_id })),
        ...entries.filter((e) => e.user_id !== null && !wanted.has(e.user_id)).map((e) => ({ id: e.id, _destroy: true })),
      ];
      if (changes.length > 0) {
        const r = await call({ method: "PATCH", path: rulePath(branch), body: { allowed_to_push: changes } });
        if (r.code !== 0 && [401, 403, 404].includes(httpStatus(r) ?? 0)) {
          return refusal(r, "glab", [`Open ${branchesPage}`, `In the protected branch rule for ${branch}, let only ${usernames.join(", ")} push`]);
        }
      }
      // Read back rather than trust the PATCH: a plan that cannot name people may drop the user entries without an error.
      const after = await call({ method: "GET", path: rulePath(branch) });
      const now = after.code === 0 ? pushEntries(after.stdout) : entries;
      if ([...wanted.keys()].every((id) => now.some((e) => e.user_id === id))) {
        const developers = now.filter(isDeveloperRole).map((e) => ({ id: e.id, _destroy: true }));
        if (developers.length > 0) {
          const closed = await call({ method: "PATCH", path: rulePath(branch), body: { allowed_to_push: developers } });
          if (closed.code !== 0) return refusal(closed, "glab", [`Open ${branchesPage}`, `Stop letting every Developer push ${branch}`]);
        }
        return done("set");
      }
      if (now.some(isDeveloperRole)) return done("cannot-name-users");
      return {
        ok: false,
        reason: "other",
        manualSteps: [`Open ${branchesPage}`, `This GitLab plan can't name who may push, so let Developers push the ${branch} branch, or team owners can't publish`],
      };
    },

    async readMembers() {
      const all = await call({ method: "GET", path: `${project}/members/all?per_page=100`, paginate: true });
      const allList = all.code === 0 ? pagedList(all.stdout, "glab") : null;
      if (allList === null) return refusal(all, "glab", [`Open ${membersPage}`]);
      const direct = await call({ method: "GET", path: `${project}/members?per_page=100`, paginate: true });
      if (direct.code !== 0) return refusal(direct, "glab", [`Open ${membersPage}`]);
      const directIds = new Set((pagedList(direct.stdout, "glab") ?? []).map((m) => m.id).filter((id): id is number => typeof id === "number"));
      const members: ForgeMember[] = [];
      for (const m of allList) {
        if (typeof m.username !== "string" || typeof m.id !== "number" || typeof m.access_level !== "number") continue;
        remember(m.username, m.id);
        members.push({ username: m.username, level: levelOf(m.access_level), inherited: !directIds.has(m.id), pending: m.membership_state === "awaiting" });
      }
      return done(members);
    },

    async grant(username, level) {
      const id = await idOf(username);
      if (id === null) return unknownUser(username);
      const accessLevel = `access_level=${LEVEL_NUMBER[level]}`;
      const added = await call({ method: "POST", path: `${project}/members`, fields: [`user_id=${id}`, accessLevel] });
      if (added.code === 0) return done("granted");
      if (httpStatus(added) === 409 || /already exists/i.test(apiText(added))) {
        const changed = await call({ method: "PUT", path: `${project}/members/${id}`, fields: [accessLevel] });
        if (changed.code === 0) return done("granted");
        return refusal(changed, "glab", [`Open ${membersPage}`, `Change ${username}'s role to ${ROLE_NAME[level]}`]);
      }
      return refusal(added, "glab", [`Open ${membersPage}`, `Invite ${username} with the ${ROLE_NAME[level]} role`]);
    },

    async revoke(username) {
      const r = await revokeRead(p, remote, username, token);
      return r.access === "revoked" ? done("revoked") : { ok: false, reason: "other", manualSteps: r.manualSteps };
    },

    async protect(branch) {
      const r = await call({ method: "POST", path: `${project}/protected_branches`, body: { name: branch, push_access_level: DEVELOPER, merge_access_level: MAINTAINER, allow_force_push: false } });
      if (r.code === 0 || httpStatus(r) === 409) return done("protected");
      return refusal(r, "glab", [`Open ${branchesPage}`, `Protect the ${branch} branch, with Developers allowed to push`]);
    },
  };
}
```

- [ ] **Step 5: Run the suite to verify both halves pass**

Run: `bun test lib/team/__tests__/forge-access-contract.test.ts lib/team/__tests__/forge.test.ts && bunx tsc --noEmit`
Expected: PASS for both `OrgForgeAccess contract: github` and `OrgForgeAccess contract: gitlab`.

- [ ] **Step 6: Commit**

```bash
git add lib/team/forge-access-gitlab.ts lib/team/__tests__/forge-fakes.ts lib/team/__tests__/forge-access-contract.test.ts
git commit -m "forge access: GitLab implementation, through the shared contract suite"
```

---

### Task 4: Read, report and apply forge access for an org

**Files:**
- Create: `lib/team/forge-access-apply.ts`
- Modify: `lib/team/team-local.ts` (`ForgeAccessRecord`, `TeamLocalRecord.forgeAccess` and `TeamLocalRecord.trialBranch`, `readTeamLocal`, the `createdByRt` and `rtMayManageMembership` doc comments)
- Test: `lib/team/__tests__/forge-access-apply.test.ts`, `lib/team/__tests__/team-local.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `dataBranchOf`, `checkedOutBranch` (`org-branch.ts`); `markerState` (`org-marker.ts`, plan 1's `dataBranch` field); `roleFor`, `rolesFor` (`roles.ts`); `isOrgAdmin`; `teamRemote` (`members.ts`); `orgStoreFile` (`org-store.ts`); `storedForgeToken`; `readTeamLocal`, `editTeamLocal`; plan 4's `followRosterChange(p: Pick<Probes, "readFile" | "home">, slug: string, orgStore: Record<string, unknown>, secrets: SecretsSeams): Promise<{ reencrypted: string[]; failure: string | null }>` (`lib/team/admin-secrets.ts`, never throws; `orgStore` is the org store's top-level keys); `SecretsSeams` (`lib/secrets/store.ts`).
- Produces:
  - `ForgeAccessRecord = { fingerprint: string; manualSteps: string[] }`; `TeamLocalRecord.forgeAccess?: ForgeAccessRecord`; `TeamLocalRecord.trialBranch?: string` (the same declaration plan 2 adds; see Global Constraints).
  - `ForgeAccessSeams = { forgeToken(p, remote): Promise<string | null>; access(p, remote, token): OrgForgeAccess | null }`, `realForgeAccessSeams()`.
  - `orgForgeAccessFor(p: Probes, remote: string, token: string | null): OrgForgeAccess | null`.
  - `ForgeAccessReport` = `{ kind: "not-admin" } | { kind: "no-forge" } | { kind: "not-yet"; branch: string | null } | { kind: "trial"; branch: string } | { kind: "refused"; manualSteps: string[] } | { kind: "ready"; provider: "github" | "gitlab"; branch: string; pushList: PushList; wanted: Wanted; diff: AccessDiff; managing: boolean; lastManualSteps: string[] }`.
  - `ForgeAccessApplied = { done: string[]; manualSteps: string[]; limit: string | null }`.
  - `readForgeAccess(p: Probes, slug: string, seams?: ForgeAccessSeams): Promise<ForgeAccessReport>`.
  - `applyForgeAccess(p: Probes, slug: string, seams?: ForgeAccessSeams): Promise<{ report: ForgeAccessReport; applied: ForgeAccessApplied | null }>`.
  - `wantedFingerprint(p: Probes, slug: string): Promise<string | null>` (null while the marker names no `dataBranch`, and while this Mac is on its trial branch).
  - `orgStoreKeys(p: Pick<Probes, "readFile" | "home">, slug: string): Record<string, unknown>` (the org store's top-level keys, `{}` when absent).
  - `AdminFollow = { reencrypted: string[]; failure: string | null }`; `applyForgeAccessAndFollow(p: Probes, slug: string, secrets: SecretsSeams, seams?: ForgeAccessSeams, follow?: typeof followRosterChange): Promise<{ report: ForgeAccessReport; applied: ForgeAccessApplied | null; admin: AdminFollow | null }>`: applies, then calls `follow` only when the apply ran (`applied !== null`) and the wanted fingerprint differs from the one this Mac recorded before it. Tasks 8 and 9 call this, never `applyForgeAccess` directly.

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/team-local.test.ts`, append:

```ts
test("forgeAccess and trialBranch round-trip, and malformed ones read as absent", () => {
  const p = fakeProbes({ home: "/h" });
  writeTeamLocal(p, "acme", { createdByRt: false, joinedByRt: false, rtMayManageMembership: true, trialBranch: "mattstack-trial", forgeAccess: { fingerprint: "abc", manualSteps: ["Open x"] } });
  expect(readTeamLocal(p, "acme").forgeAccess).toEqual({ fingerprint: "abc", manualSteps: ["Open x"] });
  expect(readTeamLocal(p, "acme").trialBranch).toBe("mattstack-trial");
  p.writeFile(teamLocalPath("/h", "acme"), JSON.stringify({ forgeAccess: { fingerprint: 7, manualSteps: "x" }, trialBranch: "" }));
  expect(readTeamLocal(p, "acme").forgeAccess).toBeUndefined();
  expect(readTeamLocal(p, "acme").trialBranch).toBeUndefined();
});
```

`lib/team/__tests__/forge-access-apply.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import { applyForgeAccess, applyForgeAccessAndFollow, readForgeAccess, wantedFingerprint, type ForgeAccessSeams } from "../forge-access-apply.ts";
import { githubForgeAccess } from "../forge-access-github.ts";
import { gitlabForgeAccess } from "../forge-access-gitlab.ts";
import { readTeamLocal, teamLocalPath } from "../team-local.ts";
import { fakeGitHub, fakeGitLab, type FakeForge, type FakeForgeOpts } from "./forge-fakes.ts";

const HOME = "/h";
const DIR = orgDirUnder(HOME, "acme");
const REMOTES = { github: "git@github.com:acme/widgets.git", gitlab: "https://gitlab.com/acme/widgets.git" } as const;
const ORG = { owners: ["dev1"], admins: [], teams: { widgets: { owners: ["dev2"] } } };
const ROSTER = [
  { username: "dev1", teams: ["widgets"] },
  { username: "dev2", teams: ["widgets"] },
  { username: "dev3", teams: ["widgets"] },
];

function setup(provider: "github" | "gitlab", forgeOpts: FakeForgeOpts, opts: { me?: string; latch?: boolean; dataBranch?: string | null; roster?: unknown[]; local?: Record<string, unknown> } = {}) {
  const forge: FakeForge = provider === "github" ? fakeGitHub(forgeOpts) : fakeGitLab(forgeOpts);
  const marker = { role: "org", org: "acme", layout: 4, ...(opts.dataBranch === null ? {} : { dataBranch: opts.dataBranch ?? "mattstack" }) };
  const p = fakeProbes({
    home: HOME,
    exec: forge.exec,
    files: {
      [`${DIR}/.git/config`]: `[remote "origin"]\n\turl = ${REMOTES[provider]}\n`,
      [`${DIR}/mattstack/mattstack.jsonc`]: JSON.stringify(marker),
      [`${DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": ORG, "mattstack.roster": opts.roster ?? ROSTER }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1", rtMayManageMembership: opts.latch ?? true, ...opts.local }),
    },
  });
  const seams: ForgeAccessSeams = {
    forgeToken: async () => "token",
    access: (probes, remote, token) => (provider === "github" ? githubForgeAccess(probes, remote, "acme", "widgets", token) : gitlabForgeAccess(probes, remote, "gitlab.com", "acme/widgets", token)),
  };
  return { p, forge, seams };
}

const USERS = ["dev1", "dev2", "dev3", "dev5"];
const MEMBERS = { dev1: { level: "admin" as const }, dev2: { level: "read" as const }, dev3: { level: "write" as const }, dev5: { level: "write" as const } };

for (const provider of ["github", "gitlab"] as const) {
  describe(`forge access on ${provider}`, () => {
    test("a Mac that does not run the org gets nothing, and the forge is never asked", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { me: "dev3" });
      expect(await readForgeAccess(p, "acme", seams)).toEqual({ kind: "not-admin" });
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
    });

    test("an org whose data has no branch of its own is left alone, main included", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { dataBranch: null });
      expect((await applyForgeAccess(p, "acme", seams)).report.kind).toBe("not-yet");
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
    });

    test("a data branch that is main or the repo's default branch is refused, and nothing is written", async () => {
      for (const [dataBranch, defaultBranch] of [["main", "main"], ["trunk", "trunk"], ["master", "trunk"]] as const) {
        const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS, defaultBranch, branches: [dataBranch, defaultBranch] }, { dataBranch });
        const { report } = await applyForgeAccess(p, "acme", seams);
        expect(report.kind).toBe("refused");
        expect(report.kind === "refused" ? report.manualSteps.join(" ") : "").toContain("own branch");
        expect(forge.writes).toEqual([]);
      }
    });

    test("while this Mac is on its trial branch, nothing is asked of the forge or written", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { dataBranch: "mattstack-trial", local: { trialBranch: "mattstack-trial" } });
      expect((await applyForgeAccess(p, "acme", seams)).report).toEqual({ kind: "trial", branch: "mattstack-trial" });
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
      expect(await wantedFingerprint(p, "acme")).toBeNull();
    });

    test("the report names who to raise and put on the push list, and lowers no one", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS });
      const report = await readForgeAccess(p, "acme", seams);
      if (report.kind !== "ready") throw new Error(report.kind);
      expect(report.diff.grant).toEqual([{ username: "dev2", level: "write" }]);
      expect(report.diff.addPush).toEqual(["dev1", "dev2"]);
      expect(JSON.stringify(report.diff)).not.toContain("dev3");
      expect(JSON.stringify(report.diff)).not.toContain("dev5");
    });

    test("without the latch nothing is written", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { latch: false });
      expect((await applyForgeAccess(p, "acme", seams)).applied).toBeNull();
      expect(forge.writes).toEqual([]);
    });

    test("with the latch rt applies the difference, records it, keeps everyone's level, and a second look finds nothing to do", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS, addedDirectly: USERS });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.manualSteps).toEqual([]);
      expect(forge.members()).toMatchObject({ dev2: { level: "write" }, dev3: { level: "write" }, dev5: { level: "write" } });
      const after = await readForgeAccess(p, "acme", seams);
      expect(after.kind === "ready" ? [after.pushList, after.diff.grant] : after).toEqual([{ kind: "named", users: expect.arrayContaining(["dev1", "dev2"]) }, []]);
      expect(readTeamLocal(p, "acme").forgeAccess?.fingerprint).toBe((await wantedFingerprint(p, "acme"))!);
    });

    test("someone who left a role and the roster comes off the push list only, and keeps their repo level", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: { ...MEMBERS, dev2: { level: "write" }, dev3: { level: "write" } }, addedDirectly: USERS });
      await applyForgeAccess(p, "acme", seams);
      p.writeFile(`${DIR}/mattstack/org/settings.org.jsonc`, JSON.stringify({ "mattstack.org": { ...ORG, teams: { widgets: { owners: [] } } }, "mattstack.roster": ROSTER.filter((e) => e.username !== "dev3") }));
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.done.some((line) => line.startsWith("Set who can push mattstack"))).toBe(true);
      expect(forge.members()).toMatchObject({ dev2: { level: "write" }, dev3: { level: "write" } });
      const after = await readForgeAccess(p, "acme", seams);
      expect(after.kind === "ready" && after.pushList.kind === "named" ? after.pushList.users : null).toEqual(["dev1"]);
    });

    test("a forge that refuses every write gives steps, records them, and never throws", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS, readOnly: true });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.manualSteps.length).toBeGreaterThan(0);
      expect(readTeamLocal(p, "acme").forgeAccess?.manualSteps).toEqual(applied!.manualSteps);
    });

    test("where the forge cannot name people, the run says plainly that anyone with write can push", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS, cannotNameUsers: true, addedDirectly: USERS });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.limit).toContain("Anyone with write access can push mattstack, and only rt limits what they change there.");
    });

    test("the fingerprint moves with the roster and is null until the data has its own branch", async () => {
      const a = setup(provider, { users: USERS, members: MEMBERS });
      const b = setup(provider, { users: USERS, members: MEMBERS }, { roster: [...ROSTER, { username: "dev4", teams: [] }] });
      expect(await wantedFingerprint(a.p, "acme")).not.toBe(await wantedFingerprint(b.p, "acme"));
      expect(await wantedFingerprint(setup(provider, { users: USERS }, { dataBranch: null }).p, "acme")).toBeNull();
    });
  });
}

test("github: someone whose grant is still an invitation stays off the push list, and the rest applies", async () => {
  const { p, forge, seams } = setup("github", { users: USERS, members: { dev1: { level: "admin" }, dev3: { level: "guest" } }, addedDirectly: ["dev1", "dev3"] });
  const { applied } = await applyForgeAccess(p, "acme", seams);
  expect(applied?.done).toContain("Invited dev2 to the repo with write access");
  expect(applied?.manualSteps).toEqual([]);
  const after = await readForgeAccess(p, "acme", seams);
  expect(after.kind === "ready" && after.pushList.kind === "named" ? after.pushList.users : null).toEqual(["dev1"]);
  expect(forge.members().dev3).toMatchObject({ level: "read" });
});

describe("applyForgeAccessAndFollow", () => {
  const secrets = {} as SecretsSeams;
  const recorder = () => {
    const calls: { slug: string; orgStore: Record<string, unknown> }[] = [];
    const follow = async (_p: unknown, slug: string, orgStore: Record<string, unknown>) => {
      calls.push({ slug, orgStore });
      return { reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null };
    };
    return { calls, follow };
  };

  test("follows the roster change once when the wanted access moved, then not again", async () => {
    const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS, addedDirectly: USERS });
    const { calls, follow } = recorder();
    const first = await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow);
    expect(first.admin).toEqual({ reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.orgStore["mattstack.org"]).toEqual(ORG);
    expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("does not follow when nothing was applied: no latch, or a trial branch", async () => {
    for (const opts of [{ latch: false }, { dataBranch: "mattstack-trial", local: { trialBranch: "mattstack-trial" } }]) {
      const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS }, opts);
      const { calls, follow } = recorder();
      expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  test("a follow that reports a failure is passed back, never thrown", async () => {
    const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS, addedDirectly: USERS });
    const result = await applyForgeAccessAndFollow(p, "acme", secrets, seams, async () => ({ reencrypted: [], failure: "sops refused" }));
    expect(result.admin).toEqual({ reencrypted: [], failure: "sops refused" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/forge-access-apply.test.ts lib/team/__tests__/team-local.test.ts`
Expected: FAIL (module not found; `forgeAccess` not read).

- [ ] **Step 3: Implement**

`lib/team/team-local.ts`: replace the `createdByRt` doc comment with "rt created this org's remote itself (`gh repo create`). Provenance only: it confers nothing." Replace the `rtMayManageMembership` doc comment with "The operator has asked rt to manage this org's forge access from this Mac: it grants the repo access each role needs and keeps the data branch's push list, following the org's roles (`lib/team/forge-access-apply.ts`). It never lowers anyone's repo access. Absent means false: a permission that was never granted is not held." Then add:

```ts
export interface ForgeAccessRecord {
  /** The wanted access rt last applied (`fingerprintOf`); the daemon applies again when the org's roles or roster move it. */
  fingerprint: string;
  /** What the forge refused at the last apply, as the steps to do by hand. */
  manualSteps: string[];
}
```

with these on `TeamLocalRecord`:

```ts
  /** The trial branch `rt team branch use` checked this clone out on (plan 2). Forge access waits while the data branch is this one. */
  trialBranch?: string;
  /** The last forge access apply on this Mac. */
  forgeAccess?: ForgeAccessRecord;
```

and in `readTeamLocal`'s returned object:

```ts
...(typeof parsed.trialBranch === "string" && parsed.trialBranch !== "" ? { trialBranch: parsed.trialBranch } : {}),
...(isForgeAccessRecord(parsed.forgeAccess) ? { forgeAccess: parsed.forgeAccess } : {}),
```

```ts
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function isForgeAccessRecord(v: unknown): v is ForgeAccessRecord {
  const r = v as Partial<ForgeAccessRecord> | null | undefined;
  return typeof r?.fingerprint === "string" && isStrings(r.manualSteps);
}
```

If plan 2 has already merged, its `trialBranch` declaration and read line stay and this task adds only `forgeAccess`; keep exactly one of each.

`lib/team/forge-access-apply.ts`:

```ts
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
import { followRosterChange } from "./admin-secrets.ts";
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

const SHARED_BRANCH_NAMES = new Set(["main", "master"]);

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
    return {
      report: { kind: "refused", manualSteps: [`The org's data is on ${branch}, which the rest of the repo uses too, so rt leaves its rules alone. Move the org's data to its own branch first.`] },
      access,
    };
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
  follow: typeof followRosterChange = followRosterChange,
): Promise<{ report: ForgeAccessReport; applied: ForgeAccessApplied | null; admin: AdminFollow | null }> {
  const before = readTeamLocal(p, slug).forgeAccess?.fingerprint ?? null;
  const wanted = await wantedFingerprint(p, slug);
  const { report, applied } = await applyForgeAccess(p, slug, seams);
  const moved = applied !== null && wanted !== null && wanted !== before;
  return { report, applied, admin: moved ? await follow(p, slug, orgStoreKeys(p, slug), secrets) : null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/forge-access-apply.test.ts lib/team/__tests__/team-local.test.ts lib/team/__tests__/forge-access-contract.test.ts && bunx tsc --noEmit`
Expected: PASS. (`lib/team/admin-secrets.ts` exists because plan 4 merges before this plan; if it is missing, stop and rebase on main rather than stub it.)

- [ ] **Step 5: Commit**

```bash
git add lib/team/forge-access-apply.ts lib/team/team-local.ts lib/team/__tests__/forge-access-apply.test.ts lib/team/__tests__/team-local.test.ts
git commit -m "forge access: read, report and apply the org's access on the forge"
```

---

### Task 5: Offer the latch on any org repo

The spec drops the `createdByRt` gate in front of `rtMayManageMembership`. Three places read it today: `teamManageMembership` and `teamInvite` (`commands/team.ts`), `resolveForgeAccess` (`lib/team/invite.ts`) and `membersRemove` (`lib/team/members.ts:443`). `invite.ts` is plan 2's file; this task changes only `resolveForgeAccess` (lines ~288-317), which plan 2 does not touch, so the merge stays mechanical. Say so in the PR description.

**Files:**
- Modify: `commands/team.ts` (`teamManageMembership` body, new exported `manageMembershipBlocks`, `teamInvite`'s `createdByRt` condition and prompt at ~569-574)
- Modify: `lib/team/invite.ts` (`resolveForgeAccess` and its doc comment)
- Modify: `lib/team/members.ts` (`mayManage` at ~443, its manual step, the header comment's MAT-387 sentence)
- Modify: `lib/setup/validators/org.ts` (`team.push-access` row's `why`)
- Test: `commands/__tests__/team.test.ts`, `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/members.test.ts`, `lib/setup/__tests__/validators-org.test.ts`

**Interfaces:**
- Consumes: `isOrgAdmin` (plan 1), `roleFor`, `rolesFor`.
- Produces: `manageMembershipBlocks(slug: string, on: boolean, runsOrg: boolean): Block[]`. `rt team manage-membership --json` keeps `{ slug, mayManage, offerable }`; `offerable` now means "this Mac's role runs the org".

- [ ] **Step 1: Rewrite the failing tests**

In `commands/__tests__/team.test.ts`, `describe("teamManageMembership")`. The file's `adminFiles` fixture makes `dev1` an admin of `acme`, but `manageDeps` overwrites the team-local record, so it must keep the username: change its body to `writeTeamLocal(deps.probes, "acme", { forgeUsername: "dev1", ...record });`. Add beside `adminFiles`:

```ts
const memberFiles = { ...adminFiles, [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: "dev3" }) };
```

and import `manageMembershipBlocks` from `../team.ts` and `renderPlain` from `../../lib/ui/out-plain.ts`. Then:

```ts
test("bare form reports the state and whether this Mac may turn it on", async () => {
  const deps = manageDeps({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false });
  await teamManageMembership(["--team", "acme", "--json"], {}, deps);
  expect(JSON.parse(deps.lines[0]!)).toMatchObject({ slug: "acme", mayManage: false, offerable: true });
});

test("on is offered on any org repo an admin runs, whoever created it", async () => {
  const deps = manageDeps({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false });
  await teamManageMembership(["on", "--team", "acme", "--json"], {}, deps);
  expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(true);
});

test("on is refused for someone who does not run the org, and writes nothing", async () => {
  const deps = baseDeps({ probes: fakeProbes({ home: "/home/x", files: memberFiles }) });
  const code = await runExpectingProcessExit(() => teamManageMembership(["on", "--team", "acme", "--json"], {}, deps));
  expect(code).toBe(2);
  expect(JSON.parse(deps.lines[0]!).error.code).toBe("team-pull-only");
  expect(readTeamLocal(deps.probes, "acme").rtMayManageMembership).toBe(false);
});

test("human mode says who manages forge access, and how to change it", () => {
  expect(renderPlain(manageMembershipBlocks("acme", true, true))).toContain("mattstack manages who can reach acme on the forge");
  expect(renderPlain(manageMembershipBlocks("acme", true, true))).toContain("rt team forge-access --team acme");
  expect(renderPlain(manageMembershipBlocks("acme", false, true))).toContain("rt team manage-membership on");
  expect(renderPlain(manageMembershipBlocks("acme", false, false))).toContain("Only an org admin can turn this on");
});
```

Delete the two tests built on `not-rt-created` ("on is refused where rt did not create the repo", "human mode: on where rt did not create the repo is a refused line" and its `--json` twin) and the old three-case human test; the cases above replace them. In the `teamInvite` test "human output names who to ask, since rt does not manage membership", expect `"rt team manage-membership on --team acme"` instead of `"Ask whoever runs the team repo"`, and rename it "human output points at the latch when rt does not manage membership".

In `lib/team/__tests__/invite.test.ts`, `describe("mintInvite: forge membership is not rt's to grant")` becomes `describe("mintInvite: forge membership follows the latch")`:

```ts
test("the latch alone grants, on any org repo", async () => {
  const grantCalls: string[] = [];
  const { seams } = baseSeams({
    readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: true }),
    grantRead: async (_p, _remote, handle) => {
      grantCalls.push(handle);
      return { access: "granted", manualSteps: [] };
    },
  });
  const result = await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "alice", teams: ["widgets"], now: NOW }, seams);
  expect(grantCalls).toEqual(["alice"]);
  expect(result.forgeAccess).toBe("granted");
});

test("without the latch it never calls the forge, and points at the latch and the forge's page", async () => {
  let called = false;
  const { seams } = baseSeams({
    readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false }),
    grantRead: async () => { called = true; return { access: "granted" as const, manualSteps: [] }; },
  });
  const result = await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);
  expect(called).toBe(false);
  expect(result.forgeAccess).toBe("skipped");
  expect(result.manualSteps[0]).toContain("rt team manage-membership on --team acme");
  expect(result.manualSteps).toContain("Open https://github.com/acme/widgets/settings/access");
});
```

Delete the tests that pin the old gate ("createdByRt without the permission still does not touch the forge", "the permission alone does not grant on a repo rt did not create", and any other that asserts `createdByRt` decides). Keep "the invite is still minted and returned when rt cannot grant".

In `lib/team/__tests__/members.test.ts`, the test at ~606 "the permission alone, without createdByRt, still never calls the forge" (and the MAT-387 comment above it) becomes:

```ts
  test("the latch alone revokes, on any org repo", async () => {
    const remote = "git@github.com:acme/widgets.git";
    const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "orgs", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));

    const revokeCalls: string[] = [];
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: true }),
      revokeRead: async (_p, _remote, handle) => {
        revokeCalls.push(handle);
        return { access: "revoked", manualSteps: [] };
      },
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(revokeCalls).toEqual(["alice"]);
    expect(result.forgeAccess).toBe("revoked");
  });
```

The no-latch test above it (~575) keeps its setup and expects `result.manualSteps.join(" ")` to contain `"can still see the org's repo"` and `` `rt team manage-membership on --team ${SLUG}` `` instead of `"can still see the team repo"`.

In `lib/setup/__tests__/validators-org.test.ts`, the `team.push-access` test asserts `row.why` is `"An org admin grants write access on the forge, or lets rt manage it."`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/team.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/members.test.ts lib/setup/__tests__/validators-org.test.ts`
Expected: FAIL on the rewritten cases.

- [ ] **Step 3: Implement**

`commands/team.ts`, `teamManageMembership` (import `isOrgAdmin` from `../packages/rt-client/src/settings/org-roles.ts`):

```ts
/**
 * The permission is machine-local and never synced, so this is the only
 * non-interactive door to it. Only a Mac whose role runs the org may turn it
 * on: the forge would refuse anyone else's changes anyway.
 */
export async function teamManageMembership(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const state = positional(args, ["--team"])[0];
  if (state !== undefined && state !== "on" && state !== "off") {
    usageError(deps, json, "Choose on or off", "rt team manage-membership [on|off] [--team <slug>] [--json]");
  }

  try {
    const slug = resolveTeamSlug(args, "team manage-membership");
    const runsOrg = isOrgAdmin(roleFor(deps.probes, slug));
    if (state === "on" && !runsOrg) {
      const admins = rolesFor(deps.probes, slug).admins;
      throw new UserActionableError("team-pull-only", "Only an org admin can let mattstack manage forge access", {}, {
        why: admins.length > 0 ? `Ask ${admins.join(" or ")} to turn it on from their Mac.` : "This org names no admins yet.",
      });
    }
    const record = state === undefined ? readTeamLocal(deps.probes, slug) : updateTeamLocal(deps.probes, slug, { rtMayManageMembership: state === "on" });

    if (json) {
      deps.print(JSON.stringify(envelope({ slug, mayManage: record.rtMayManageMembership, offerable: runsOrg })));
      return;
    }
    out.print(...manageMembershipBlocks(slug, record.rtMayManageMembership, runsOrg));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}

export function manageMembershipBlocks(slug: string, on: boolean, runsOrg: boolean): Block[] {
  if (on) {
    return [
      out.line("done", `mattstack manages who can reach ${slug} on the forge`, "membership management is on"),
      out.callout("note", "It follows the org's roles within a few minutes, and again at each app update."),
      out.callout("next", out.cmd(`rt team forge-access --team ${slug}`)),
    ];
  }
  return [
    out.line("off", `You manage who can reach ${slug} on the forge`, "membership management is off"),
    runsOrg ? out.callout("next", out.cmd("rt team manage-membership on")) : out.callout("note", "Only an org admin can turn this on"),
  ];
}
```

`teamInvite`, the offer (the caller is already known to run the org):

```ts
    if (!json && !local.rtMayManageMembership && gate()) {
      const ask = deps.confirm ?? (async (message: string) => (await import("../lib/ui/prompts.ts")).confirm({ message }));
      if (await ask(`Let mattstack manage who can reach this org's repo on the forge? It gives ${handle} read access now and follows the org's roles from then on.`)) {
        updateTeamLocal(deps.probes, slug, { rtMayManageMembership: true });
      }
    }
```

`lib/team/invite.ts`, `resolveForgeAccess`:

```ts
/**
 * rt grants forge access only where the operator turned on
 * `rtMayManageMembership` for this org on this Mac (`rt team manage-membership`).
 */
async function resolveForgeAccess(p: Probes, seams: MintInviteSeams, slug: string, remote: string, handle: string, token: string | null): Promise<{ access: ForgeAccess; manualSteps: string[] }> {
  if (seams.readTeamLocal(p, slug).rtMayManageMembership) return seams.grantRead(p, remote, handle, token);
  return {
    access: "skipped",
    manualSteps: [`Let mattstack give ${handle} access, then invite them again: rt team manage-membership on --team ${slug}`, ...membershipSteps(remote, handle)],
  };
}
```

Also update the file's header comment sentence at ~16 to "only when the operator has granted `rtMayManageMembership` for this org on this Mac".

`lib/team/members.ts` at ~443:

```ts
  const mayManage = local.rtMayManageMembership;
  const revoke =
    remote !== null && mayManage
      ? await seams.revokeRead(p, remote, handle, await seams.forgeToken(p, remote))
      : {
          access: "skipped" as RevokeAccess,
          manualSteps: remote === null ? ([] as string[]) : [`${handle} can still see the org's repo. Remove them there too, or let mattstack manage access: rt team manage-membership on --team ${slug}`],
        };
```

Replace the comment above it with: "Removal fails open: the person keeps their access. So when rt does not manage it here, the caller is told plainly; silence would read as removed." In the file header, change "It revokes forge access only when this machine holds `rtMayManageMembership` for the team (MAT-387); otherwise it says so, because removal fails OPEN." to "It revokes forge access only when this machine holds `rtMayManageMembership` for the org; otherwise it says so, because removal fails open."

`lib/setup/validators/org.ts`, the `team.push-access` row: `why: "An org admin grants write access on the forge, or lets rt manage it."`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test commands/__tests__/team.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/members.test.ts lib/setup/__tests__/validators-org.test.ts && bunx tsc --noEmit`
Expected: PASS. Then `rg -n "createdByRt" lib commands --type ts -g '!**/__tests__/**'` lists only `team-local.ts`, `create.ts` (writes it), `join.ts` and `lib/setup/validators/accounts.ts` (provenance reads unrelated to forge access).

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts lib/team/invite.ts lib/team/members.ts lib/setup/validators/org.ts commands/__tests__/team.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/members.test.ts lib/setup/__tests__/validators-org.test.ts
git commit -m "team: offer forge access management on any org repo an admin runs"
```

---

### Task 6: `rt team forge-access`

**Files:**
- Modify: `commands/team.ts` (new `teamForgeAccess`, `forgeAccessBlocks`; `TeamDeps.forgeAccessSeams?`; `"forge-access-off"` in `REFUSAL_CODES`)
- Modify: `lib/command-tree-def.ts` (new `team.forge-access` node beside `manage-membership`; `manage-membership`'s description and option hints)
- Regenerate: `website/docs/rt/reference/team/` (`bun run docs:gen`)
- Test: `commands/__tests__/team-forge-access.test.ts`

**Interfaces:**
- Consumes: `readForgeAccess`, `applyForgeAccess`, `realForgeAccessSeams`, `ForgeAccessSeams`, `ForgeAccessReport`, `ForgeAccessApplied` (Task 4); `diffLines`, `hasChanges`, `limitSentence` (Task 1).
- Produces: `teamForgeAccess(args, ctx, deps)`; `forgeAccessBlocks(slug: string, report: ForgeAccessReport, applied: ForgeAccessApplied | null): Block[]`; `--json` envelope `{ slug, report, applied }`.

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/team-forge-access.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { teamLocalPath } from "../../lib/team/team-local.ts";
import type { ForgeAccessReport } from "../../lib/team/forge-access-apply.ts";
import { forgeAccessBlocks, teamForgeAccess, type TeamDeps } from "../team.ts";

const ready = (over: Partial<Extract<ForgeAccessReport, { kind: "ready" }>> = {}): ForgeAccessReport => ({
  kind: "ready",
  provider: "gitlab",
  branch: "mattstack",
  pushList: { kind: "named", users: ["dev1"] },
  wanted: { members: [], pushers: ["dev1", "dev2"], invalid: [] },
  diff: { grant: [{ username: "dev2", level: "write" }], addPush: ["dev2"], removePush: [], waiting: [] },
  managing: false,
  lastManualSteps: [],
  ...over,
});

describe("forgeAccessBlocks", () => {
  test("not yet: says rt leaves it alone until the data has its own branch", () => {
    const text = renderPlain(forgeAccessBlocks("acme", { kind: "not-yet", branch: "main" }, null));
    expect(text).toContain("rt leaves forge access alone for now");
    expect(text).toContain("once the org's data has a branch of its own");
  });
  test("on a trial branch: says the access sync waits", () => {
    const text = renderPlain(forgeAccessBlocks("acme", { kind: "trial", branch: "mattstack-trial" }, null));
    expect(text).toContain("Forge access waits while this Mac is on the trial branch mattstack-trial");
    expect(text).toContain(`rt team branch use`);
  });
  test("a difference lists each change and points at the latch when it is off", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready(), null));
    expect(text).toContain("Give dev2 write access");
    expect(text).toContain("Let dev2 push mattstack");
    expect(text).toContain("rt team manage-membership on --team acme");
  });
  test("with the latch on it points at apply", () => {
    expect(renderPlain(forgeAccessBlocks("acme", ready({ managing: true }), null))).toContain("rt team forge-access --apply --team acme");
  });
  test("an applied run lists what changed, the limit and the steps by hand", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready({ managing: true }), { done: ["Gave dev2 write access"], manualSteps: ["Open https://gitlab.com/acme/widgets/-/settings/repository"], limit: "x. Anyone with write access can push mattstack, and only rt limits what they change there." }));
    expect(text).toContain("Gave dev2 write access");
    expect(text).toContain("only rt limits what they change there");
    expect(text).toContain("Open https://gitlab.com/acme/widgets/-/settings/repository");
  });
  test("nothing to change reads as done", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready({ diff: { grant: [], addPush: [], removePush: [], waiting: [] } }), null));
    expect(text).toContain("Forge access matches the org's roles");
  });
});

describe("teamForgeAccess", () => {
  const files = (me: string, latch: boolean) => ({
    "/home/x/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
    [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch }),
  });
  const deps = (me: string, latch: boolean): TeamDeps & { lines: string[] } => {
    const lines: string[] = [];
    return {
      probes: fakeProbes({ home: "/home/x", files: files(me, latch) }),
      print: (s) => lines.push(s),
      exit: (code) => { throw new Error(`exit ${code}`); },
      forgeAccessSeams: { forgeToken: async () => null, access: () => null },
      lines,
    };
  };

  test("--json prints the report in an envelope", async () => {
    const d = deps("dev1", false);
    await teamForgeAccess(["--team", "acme", "--json"], {}, d);
    expect(JSON.parse(d.lines[0]!)).toMatchObject({ slug: "acme", report: { kind: "not-yet" }, applied: null });
  });
  test("--apply with the latch off is refused with the latch as the next step", async () => {
    const d = deps("dev1", false);
    expect(await runExpectingProcessExit(() => teamForgeAccess(["--apply", "--team", "acme", "--json"], {}, d))).toBe(2);
    expect(JSON.parse(d.lines[0]!).error.code).toBe("forge-access-off");
  });
  test("someone who does not run the org is refused", async () => {
    const d = deps("dev3", true);
    expect(await runExpectingProcessExit(() => teamForgeAccess(["--team", "acme", "--json"], {}, d))).toBe(2);
    expect(JSON.parse(d.lines[0]!).error.code).toBe("team-pull-only");
  });
});
```

with this helper at the top of the file (the same one `commands/__tests__/team.test.ts:63` uses; `exitUserError` ends through `process.exit`), and `spyOn` added to the `bun:test` import:

```ts
async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/team-forge-access.test.ts`
Expected: FAIL (`forgeAccessBlocks` / `teamForgeAccess` not exported).

- [ ] **Step 3: Implement**

`commands/team.ts`: add `"forge-access-off",` to `REFUSAL_CODES`; add `forgeAccessSeams?: ForgeAccessSeams;` (doc: "The forge reads and writes `rt team forge-access` makes; real by default.") to `TeamDeps`; import from `../lib/team/forge-access-apply.ts` and `../lib/team/forge-access-plan.ts`. Then:

```ts
export function forgeAccessBlocks(slug: string, report: ForgeAccessReport, applied: ForgeAccessApplied | null): Block[] {
  switch (report.kind) {
    case "not-admin":
      return [out.line("refused", "Only an org admin manages forge access")];
    case "no-forge":
      return [out.line("skipped", "This org's repo is not on GitHub or GitLab, so rt leaves its access alone")];
    case "not-yet":
      return [
        out.line("skipped", "rt leaves forge access alone for now", report.branch ? `the org's data is on ${report.branch}` : undefined),
        out.callout("note", "rt manages forge access once the org's data has a branch of its own."),
      ];
    case "trial":
      return [
        out.line("skipped", `Forge access waits while this Mac is on the trial branch ${report.branch}`),
        out.callout("next", ["Go back to the org's data branch with ", out.cmd("rt team branch use <data branch>")]),
      ];
    case "refused":
      return [out.line("needs-you", "rt could not check forge access"), out.callout("fix", ...report.manualSteps)];
    case "ready": {
      const limit = applied?.limit ?? limitSentence(report.pushList, report.branch);
      const tail: Block[] = [
        ...(limit ? [out.callout("note", limit)] : []),
        ...(report.wanted.invalid.length > 0 ? [out.callout("note", `rt skipped roster names that are not forge usernames: ${report.wanted.invalid.join(", ")}`)] : []),
      ];
      if (applied) {
        const nothing = applied.done.length === 0 && applied.manualSteps.length === 0;
        return [
          ...(nothing ? [out.line("done", "Forge access already matches the org's roles", `branch ${report.branch}`)] : []),
          ...applied.done.map((line) => out.line("done", line)),
          ...tail,
          ...(applied.manualSteps.length > 0 ? [out.callout("fix", ...applied.manualSteps)] : []),
        ];
      }
      const waiting = report.diff.waiting.map((u) => out.line("pending", `${u} has not accepted the forge's invite yet`));
      if (!hasChanges(report.diff)) return [out.line("done", "Forge access matches the org's roles", `branch ${report.branch}`), ...waiting, ...tail];
      return [
        out.line("needs-you", "The forge differs from the org's roles", `branch ${report.branch}`),
        ...diffLines(report.diff, report.branch).map((line) => out.line("pending", line)),
        ...waiting,
        ...tail,
        ...(report.lastManualSteps.length > 0 ? [out.callout("fix", ...report.lastManualSteps)] : []),
        out.callout("next", out.cmd(report.managing ? `rt team forge-access --apply --team ${slug}` : `rt team manage-membership on --team ${slug}`)),
      ];
    }
  }
}

export async function teamForgeAccess(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  try {
    const slug = resolveTeamSlug(args, "team forge-access");
    if (!isOrgAdmin(roleFor(deps.probes, slug))) {
      const admins = rolesFor(deps.probes, slug).admins;
      throw new UserActionableError("team-pull-only", "Only an org admin manages forge access", {}, {
        why: admins.length > 0 ? `Ask ${admins.join(" or ")}.` : "This org names no admins yet.",
      });
    }
    if (apply && !readTeamLocal(deps.probes, slug).rtMayManageMembership) {
      throw new UserActionableError("forge-access-off", "rt doesn't manage forge access for this org on this Mac", {}, { next: `rt team manage-membership on --team ${slug}` });
    }
    const seams = deps.forgeAccessSeams ?? realForgeAccessSeams();
    const result = apply ? await applyForgeAccess(deps.probes, slug, seams) : { report: await readForgeAccess(deps.probes, slug, seams), applied: null };
    if (json) {
      deps.print(JSON.stringify(envelope({ slug, report: result.report, applied: result.applied })));
      return;
    }
    out.print(...forgeAccessBlocks(slug, result.report, result.applied));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}
```

`lib/command-tree-def.ts`, the `manage-membership` node: description `"Let mattstack manage who can reach your org's repo on the forge"`, options `on` hint `"rt follows the org's roles on the forge"`, `off` hint `"you manage forge access yourself"`. Add beside it:

```ts
      "forge-access": {
        description: "See who should reach your org's repo on the forge, and fix it",
        module: "./commands/team.ts",
        fn: "teamForgeAccess",
        args: [
          { name: "Apply", flag: "--apply", type: "boolean", default: false, hint: "Change the forge to match the org's roles" },
          { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; your only one when left out" },
          SETUP_JSON_ARG,
        ],
      },
```

(`./commands/team.ts` is already in `lib/module-registry.ts`.)

- [ ] **Step 4: Run tests, the picker gate and the docs**

Run: `bun test commands/__tests__/team-forge-access.test.ts commands/__tests__/team.test.ts && bun run picker:check && bun run docs:gen`
Expected: PASS; `docs:gen` writes `website/docs/rt/reference/team/forge-access.mdx` and updates `index.mdx` and `manage-membership.mdx`.

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts lib/command-tree-def.ts commands/__tests__/team-forge-access.test.ts website/docs/rt/reference/team
git commit -m "rt team forge-access: see and fix the org's access on the forge"
```

---

### Task 7: The `org.forge-access` setup row

**Files:**
- Create: `lib/setup/validators/org-forge-access.ts`
- Modify: `lib/setup/validators/org.ts` (`orgRows` opts gain `forgeAccess?: () => Promise<Row | null>`; append its row)
- Modify: `lib/setup/plan.ts` (pass `forgeAccess: () => forgeAccessRow(i.p, team.slug)` in the `orgRows` call, ~line 179)
- Test: `lib/setup/__tests__/validators-org-forge-access.test.ts`, `lib/setup/__tests__/validators-org.test.ts`

**Interfaces:**
- Consumes: `readForgeAccess`, `ForgeAccessReport` (Task 4); `hasChanges`, `diffLines`, `limitSentence` (Task 1); `row`, `Row` (`lib/setup/contract.ts`).
- Produces: `FORGE_ACCESS_ROW_ID = "org.forge-access"`; `forgeAccessRow(p: Probes, org: string, read?: (p: Probes, org: string) => Promise<ForgeAccessReport>): Promise<Row | null>`.

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/validators-org-forge-access.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { ForgeAccessReport } from "../../team/forge-access-apply.ts";
import { forgeAccessRow } from "../validators/org-forge-access.ts";
import { fakeProbes } from "./fakes.ts";

const p = fakeProbes({ home: "/h" });
const noDiff = { grant: [], addPush: [], removePush: [], waiting: [] };
const ready = (over: Partial<Extract<ForgeAccessReport, { kind: "ready" }>> = {}): ForgeAccessReport => ({
  kind: "ready", provider: "github", branch: "mattstack", pushList: { kind: "named", users: ["dev1"] },
  wanted: { members: [], pushers: ["dev1"], invalid: [] }, diff: noDiff, managing: true, lastManualSteps: [], ...over,
});
const rowFor = (report: ForgeAccessReport) => forgeAccessRow(p, "acme", async () => report);

describe("forgeAccessRow", () => {
  test("is absent on a Mac that does not run the org, off GitHub and GitLab, and before the data has its own branch", async () => {
    for (const report of [{ kind: "not-admin" }, { kind: "no-forge" }, { kind: "not-yet", branch: "main" }] as ForgeAccessReport[]) expect(await rowFor(report)).toBeNull();
  });
  test("on a trial branch it says the access sync waits", async () => {
    expect(await rowFor({ kind: "trial", branch: "mattstack-trial" })).toMatchObject({
      status: "skipped",
      detail: "Forge access waits while this Mac is on the trial branch mattstack-trial",
      action: null,
    });
  });
  test("matching access is ready, and says plainly when the forge cannot name who may push", async () => {
    expect(await rowFor(ready())).toMatchObject({ id: "org.forge-access", status: "ready", required: false, kind: "access" });
    const open = await rowFor(ready({ pushList: { kind: "open", why: "The mattstack branch lets every Developer push" } }));
    expect(open?.status).toBe("ready");
    expect(open?.detail).toContain("only rt limits what they change there");
  });
  test("a difference without the latch offers the latch", async () => {
    const r = await rowFor(ready({ managing: false, diff: { ...noDiff, grant: [{ username: "dev2", level: "write" }] } }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "run", verb: ["team", "manage-membership", "on", "--team", "acme"] } });
    expect(r?.detail).toContain("Give dev2 write access");
  });
  test("a difference the forge refused shows the step by hand", async () => {
    const r = await rowFor(ready({ diff: { ...noDiff, addPush: ["dev2"] }, lastManualSteps: ["Open https://github.com/acme/widgets/settings/branches"] }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "steps", steps: ["Open https://github.com/acme/widgets/settings/branches"] } });
  });
  test("a difference with the latch and no refusal offers to apply now", async () => {
    const r = await rowFor(ready({ diff: { ...noDiff, removePush: ["dev3"] } }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "run", verb: ["team", "forge-access", "--apply", "--team", "acme"] } });
  });
  test("a refused read shows the steps", async () => {
    expect(await rowFor({ kind: "refused", manualSteps: ["Sign in, then run this again: gh auth login"] })).toMatchObject({ status: "needs-you", action: { type: "steps" } });
  });
  test("a read that throws is one error row, never a throw", async () => {
    const r = await forgeAccessRow(p, "acme", async () => { throw new Error("timed out"); });
    expect(r).toMatchObject({ status: "error", action: { type: "run", verb: ["setup", "status"] } });
  });
});
```

In `validators-org.test.ts`, add: `orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus, forgeAccess: async () => null })` adds nothing, and with `forgeAccess: async () => row({ id: "org.forge-access", ... })` the row is last.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/validators-org-forge-access.test.ts lib/setup/__tests__/validators-org.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/setup/validators/org-forge-access.ts`:

```ts
import { readForgeAccess, type ForgeAccessReport } from "../../team/forge-access-apply.ts";
import { diffLines, hasChanges, limitSentence } from "../../team/forge-access-plan.ts";
import { row, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";

export const FORGE_ACCESS_ROW_ID = "org.forge-access";

const BASE = {
  id: FORGE_ACCESS_ROW_ID,
  kind: "access" as const,
  title: "Forge access",
  why: "Who can push the org's data branch, and who can reach its repo on the forge, follow the org's roles. rt only adds access; it never lowers anyone's.",
  required: false,
  recheck: "on-activate" as const,
};

/** Shown on Macs whose role runs the org. A forge that cannot be read turns into one row, so the accounts group never fails over it. */
export async function forgeAccessRow(p: Probes, org: string, read: (p: Probes, org: string) => Promise<ForgeAccessReport> = readForgeAccess): Promise<Row | null> {
  let report: ForgeAccessReport;
  try {
    report = await read(p, org);
  } catch (err) {
    return row({ ...BASE, status: "error", detail: `rt could not check forge access: ${err instanceof Error ? err.message : String(err)}`, action: { type: "run", label: "Re-check", verb: ["setup", "status"] } });
  }
  switch (report.kind) {
    case "not-admin":
    case "no-forge":
    case "not-yet":
      return null;
    case "trial":
      return row({ ...BASE, status: "skipped", detail: `Forge access waits while this Mac is on the trial branch ${report.branch}` });
    case "refused":
      return row({ ...BASE, status: "needs-you", detail: "rt could not check who has access to the org's repo on the forge", action: { type: "steps", label: "Show steps…", steps: report.manualSteps } });
    case "ready": {
      const limit = limitSentence(report.pushList, report.branch);
      if (!hasChanges(report.diff)) return row({ ...BASE, status: "ready", detail: limit ?? "Forge access matches the org's roles" });
      const detail = `The forge differs from the org's roles: ${diffLines(report.diff, report.branch).join("; ")}`;
      if (!report.managing) return row({ ...BASE, status: "needs-you", detail, action: { type: "run", label: "Let rt manage it", verb: ["team", "manage-membership", "on", "--team", org] } });
      if (report.lastManualSteps.length > 0) return row({ ...BASE, status: "needs-you", detail, action: { type: "steps", label: "Show steps…", steps: report.lastManualSteps } });
      return row({ ...BASE, status: "needs-you", detail, action: { type: "run", label: "Apply now", verb: ["team", "forge-access", "--apply", "--team", org] } });
    }
  }
}
```

`lib/setup/validators/org.ts`: the opts type gains `forgeAccess?: () => Promise<Row | null>`; just before `return rows;` add:

```ts
  const forgeAccess = await opts.forgeAccess?.();
  if (forgeAccess) rows.push(forgeAccess);
```

`lib/setup/plan.ts`: import `forgeAccessRow` from `./validators/org-forge-access.ts` and add `forgeAccess: () => forgeAccessRow(i.p, team.slug),` to the `orgRows` options.

- [ ] **Step 4: Run tests to verify they pass, and the plan composers that build real plans**

Run: `bun test lib/setup/__tests__/validators-org-forge-access.test.ts lib/setup/__tests__/validators-org.test.ts lib/setup/__tests__/plan.test.ts commands/__tests__/setup-plan.test.ts commands/__tests__/onboarding-org.test.ts commands/__tests__/member-upgrade.test.ts`
Expected: PASS. Their fixtures have no `dataBranch` in the marker, so the row is absent and no forge is called; if any fixture does name one, give that test's probes an exec that answers `api` calls with a failure and assert the row reads `needs-you`, not a group error.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/org-forge-access.ts lib/setup/validators/org.ts lib/setup/plan.ts lib/setup/__tests__/validators-org-forge-access.test.ts lib/setup/__tests__/validators-org.test.ts
git commit -m "setup: the org.forge-access row reports who to add and remove on the forge"
```

---

### Task 8: Apply on each update run

**Files:**
- Create: `lib/setup/steps/org-forge-access.ts`
- Modify: `lib/setup/contract.ts` (`STEP_IDS`: `"org.forge-access"` right after `"team.identity"`)
- Modify: `lib/setup/steps/index.ts` (`orgForgeAccessStep` right after `teamIdentityStep` in `STEPS`)
- Modify: `lib/setup/__tests__/update-safe.test.ts` (`UPDATE_SAFE` gains `"org.forge-access"` after `"team.identity"`), `lib/setup/__tests__/contract.test.ts` (`STEP_IDS` literal)
- Test: `lib/setup/__tests__/steps-org-forge-access.test.ts`; refresh `commands/__tests__/__snapshots__/setup-copy.test.ts.snap`

**Interfaces:**
- Consumes: `applyForgeAccessAndFollow` (Task 4); `ctx.teamSecrets(slug)` (`ApplyContext.teamSecrets`, the team secret seams every step must use); `cloneSlugs` (`lib/setup/steps/org.ts`); `roleFor`; `isOrgAdmin`; `readTeamLocal`.
- Produces: `orgForgeAccessStep: StepDef` (`id: "org.forge-access"`, `updateSafe: true`, `applies: () => true`); `forgeAccessStepSeams = { run: applyForgeAccessAndFollow }`.

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/steps-org-forge-access.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import type { SecretsSeams } from "../../secrets/store.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import type { ApplyContext } from "../apply.ts";
import { forgeAccessStepSeams, orgForgeAccessStep } from "../steps/org-forge-access.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/h";
const ORG = `${HOME}/.mattstack/orgs/acme`;
const SECRETS = { marker: "team secrets for acme" } as unknown as SecretsSeams;
const real = forgeAccessStepSeams.run;
afterEach(() => { forgeAccessStepSeams.run = real; });
const ran = (applied: { done: string[]; manualSteps: string[] }, admin: { reencrypted: string[]; failure: string | null } | null = null) =>
  async () => ({ report: { kind: "no-forge" as const }, applied: { ...applied, limit: null }, admin });

function ctx(me: string, latch: boolean): ApplyContext {
  const p = fakeProbes({
    home: HOME,
    dirs: { [`${HOME}/.mattstack/orgs`]: ["acme"] },
    files: {
      [`${ORG}/.git/config`]: "[core]\n",
      [`${ORG}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch }),
    },
  });
  return { p, teamSecrets: (slug: string) => (slug === "acme" ? SECRETS : ({} as SecretsSeams)) } as unknown as ApplyContext;
}

describe("org.forge-access", () => {
  test("skips where rt does not manage forge access", async () => {
    forgeAccessStepSeams.run = async () => { throw new Error("must not run"); };
    expect(await orgForgeAccessStep.run(ctx("dev1", false))).toEqual({ state: "skipped", detail: "rt does not manage forge access on this Mac" });
    expect(await orgForgeAccessStep.run(ctx("dev3", true))).toMatchObject({ state: "skipped" });
  });
  test("passes the org's own team secret seams, and reports what it changed", async () => {
    const seen: unknown[] = [];
    forgeAccessStepSeams.run = async (_p, _slug, secrets) => {
      seen.push(secrets);
      return { report: { kind: "no-forge" }, applied: { done: ["Gave dev2 write access"], manualSteps: [], limit: null }, admin: null };
    };
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toEqual({ state: "done", detail: "acme: Gave dev2 write access" });
    expect(seen).toEqual([SECRETS]);
  });
  test("names the admin-only secrets it re-encrypted after a role change", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: [] }, { reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toEqual({ state: "done", detail: "acme: re-encrypted the admin-only secrets for the current owners and admins" });
  });
  test("a forge refusal is partial, with the verb that shows the steps", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: ["Open https://github.com/acme/widgets/settings/access"] });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toMatchObject({ state: "partial", remedy: "Run rt team forge-access to see the steps" });
  });
  test("an admin-only secrets failure is partial, with the verb that retries it", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: [] }, { reencrypted: [], failure: "sops refused" });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toMatchObject({ state: "partial", remedy: "Run rt team admin-secrets" });
  });
  test("a throw is a failed outcome, never a thrown run", async () => {
    forgeAccessStepSeams.run = async () => { throw new Error("boom"); };
    expect((await orgForgeAccessStep.run(ctx("dev1", true))).state).toBe("failed");
  });
});
```

Update `UPDATE_SAFE` in `update-safe.test.ts` and the `STEP_IDS` literal in `contract.test.ts` to include `"org.forge-access"` after `"team.identity"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/steps-org-forge-access.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/setup/steps/org-forge-access.ts`:

```ts
/**
 * Brings the org repo's forge access in line with the org's roles on each
 * update run, on a Mac whose role runs the org and whose operator turned on
 * `rtMayManageMembership`. Update-safe: it only adds access and sets the data
 * branch's push list, never lowering anyone, and a second run changes
 * nothing. When the roles moved, the admin-only secrets follow (plan 4).
 */

import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { applyForgeAccessAndFollow } from "../../team/forge-access-apply.ts";
import { roleFor } from "../../team/roles.ts";
import { readTeamLocal } from "../../team/team-local.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { cloneSlugs } from "./org.ts";
import { toFailedOutcome } from "./step-utils.ts";

export const forgeAccessStepSeams = { run: applyForgeAccessAndFollow };

async function run(ctx: ApplyContext): Promise<StepOutcome> {
  const slugs = cloneSlugs(ctx.p).filter((slug) => isOrgAdmin(roleFor(ctx.p, slug)) && readTeamLocal(ctx.p, slug).rtMayManageMembership);
  if (slugs.length === 0) return { state: "skipped", detail: "rt does not manage forge access on this Mac" };
  const notes: string[] = [];
  const manual: string[] = [];
  const secretFailures: string[] = [];
  for (const slug of slugs) {
    const { report, applied, admin } = await forgeAccessStepSeams.run(ctx.p, slug, ctx.teamSecrets(slug));
    if (report.kind === "refused") manual.push(...report.manualSteps);
    const changed = [...(applied?.done ?? []), ...(admin && admin.reencrypted.length > 0 ? ["re-encrypted the admin-only secrets for the current owners and admins"] : [])];
    if (changed.length > 0) notes.push(`${slug}: ${changed.join("; ")}`);
    manual.push(...(applied?.manualSteps ?? []));
    if (admin?.failure) secretFailures.push(`${slug}: rt could not lock the admin-only secrets to the current owners and admins`);
  }
  if (manual.length > 0) {
    return { state: "partial", detail: [...notes, ...secretFailures, "The forge refused part of it"].join("; "), remedy: "Run rt team forge-access to see the steps" };
  }
  if (secretFailures.length > 0) return { state: "partial", detail: [...notes, ...secretFailures].join("; "), remedy: "Run rt team admin-secrets" };
  return { state: "done", detail: notes.length > 0 ? notes.join("; ") : "Forge access already matches the org's roles" };
}

export const orgForgeAccessStep: StepDef = {
  id: "org.forge-access",
  title: "Match forge access to the org's roles",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: async (ctx) => {
    try {
      return await run(ctx);
    } catch (err) {
      return toFailedOutcome(err);
    }
  },
};
```

Add `"org.forge-access",` after `"team.identity",` in `STEP_IDS`, and `orgForgeAccessStep,` after `teamIdentityStep,` in `STEPS` (import from `./org-forge-access.ts`).

- [ ] **Step 4: Run tests and refresh the setup copy snapshot**

Run: `bun test lib/setup/__tests__/steps-org-forge-access.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/contract.test.ts lib/setup/__tests__/apply.test.ts commands/__tests__/onboarding-org.test.ts`
Expected: PASS. Then run `bun test commands/__tests__/setup-copy.test.ts`; it fails only on the plan event's step list gaining `org.forge-access` "Match forge access to the org's roles". Read that diff, and only if that is the whole change run `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/org-forge-access.ts lib/setup/steps/index.ts lib/setup/contract.ts lib/setup/__tests__/steps-org-forge-access.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/contract.test.ts commands/__tests__/__snapshots__/setup-copy.test.ts.snap
git commit -m "setup: an update-safe step applies forge access on each update run"
```

---

### Task 9: Apply after a roster or role change

Roster and role edits reach the org store from the board's members screen, the console, `rt team members` and `rt settings set`, all through `setSetting`, with no one seam that can call a forge. A daemon sweep closes that: every two minutes it compares the wanted access (a local read, no forge call) with the fingerprint this Mac last applied, and applies only when they differ. Through `applyForgeAccessAndFollow`, that same apply then re-encrypts the admin-only secrets for the new owners and admins (plan 4's `followRosterChange`), so a promotion or demotion needs no other step.

**Files:**
- Create: `lib/daemon/forge-access-sweep.ts`
- Modify: `lib/daemon.ts` (one `scheduleSweep` beside `invite-replies`, ~line 945)
- Test: `lib/daemon/__tests__/forge-access-sweep.test.ts`

**Interfaces:**
- Consumes: `applyForgeAccessAndFollow`, `wantedFingerprint` (Task 4); `createRealTeamSecretsSeams(slug): SecretsSeams` (`lib/secrets/team-store.ts`, import only; the daemon has no `ApplyContext`); `cloneSlugs`; `roleFor`; `isOrgAdmin`; `readTeamLocal`; `scheduleSweep` (`lib/daemon/safe-timers.ts`).
- Produces: `createForgeAccessSweep(deps: ForgeAccessSweepDeps): () => Promise<void>` with `ForgeAccessSweepDeps = { probes: Probes; slugs?: (p: Probes) => string[]; run?: (p: Probes, slug: string, secrets: SecretsSeams) => ReturnType<typeof applyForgeAccessAndFollow>; secrets?: (slug: string) => SecretsSeams; fingerprint?: typeof wantedFingerprint; log: Pick<Logger, "info" | "warn"> }`.

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/forge-access-sweep.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { SecretsSeams } from "../../secrets/store.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { createForgeAccessSweep } from "../forge-access-sweep.ts";

const HOME = "/h";
function probes(me: string, latch: boolean, applied: string | null) {
  return fakeProbes({
    home: HOME,
    files: {
      [`${HOME}/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch, ...(applied ? { forgeAccess: { fingerprint: applied, manualSteps: [] } } : {}) }),
    },
  });
}
const log = { info: () => {}, warn: () => {} };
const secrets = () => ({}) as SecretsSeams;
const result = (admin: { reencrypted: string[]; failure: string | null } | null = null) => ({ report: { kind: "no-forge" as const }, applied: { done: [], manualSteps: [], limit: null }, admin });

describe("forge access sweep", () => {
  test("applies, with the org's own secret seams, when the wanted access moved since the last apply", async () => {
    const calls: unknown[] = [];
    const seams = { marker: "acme seams" } as unknown as SecretsSeams;
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme"],
      fingerprint: async () => "new",
      secrets: (slug) => (slug === "acme" ? seams : ({} as SecretsSeams)),
      run: async (_p, slug, s) => { calls.push([slug, s]); return result(); },
      log,
    });
    await sweep();
    expect(calls).toEqual([["acme", seams]]);
  });
  test("does nothing when it has not moved, before the data has its own branch or on a trial, without the latch, or off an admin's Mac", async () => {
    const cases = [probes("dev1", true, "same"), probes("dev1", false, "old"), probes("dev3", true, "old")];
    for (const p of cases) {
      let ran = false;
      const sweep = createForgeAccessSweep({ probes: p, slugs: () => ["acme"], fingerprint: async () => "same", secrets, run: async () => { ran = true; return result(); }, log });
      await sweep();
      expect(ran).toBe(false);
    }
    let ran = false;
    await createForgeAccessSweep({ probes: probes("dev1", true, null), slugs: () => ["acme"], fingerprint: async () => null, secrets, run: async () => { ran = true; return result(); }, log })();
    expect(ran).toBe(false);
  });
  test("an admin-only secrets failure after a role change is logged, never thrown", async () => {
    const warned: unknown[] = [];
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme"],
      fingerprint: async () => "new",
      secrets,
      run: async () => result({ reencrypted: [], failure: "sops refused" }),
      log: { info: () => {}, warn: (...args: unknown[]) => { warned.push(args); } },
    });
    await sweep();
    expect(JSON.stringify(warned)).toContain("sops refused");
  });
  test("a tick that arrives while one is still applying does nothing", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sweep = createForgeAccessSweep({ probes: probes("dev1", true, "old"), slugs: () => ["acme"], fingerprint: async () => "new", secrets, run: async () => { calls++; await gate; return result(); }, log });
    const first = sweep();
    await sweep();
    release();
    await first;
    expect(calls).toBe(1);
  });
  test("one org that throws is logged and the next still runs", async () => {
    const warned: unknown[] = [];
    const seen: string[] = [];
    const sweep = createForgeAccessSweep({
      probes: probes("dev1", true, "old"),
      slugs: () => ["acme", "acme"],
      fingerprint: async () => "new",
      secrets,
      run: async (_p, slug) => { seen.push(slug); if (seen.length === 1) throw new Error("timed out"); return result(); },
      log: { info: () => {}, warn: (...args: unknown[]) => { warned.push(args); } },
    });
    await sweep();
    expect(seen.length).toBe(2);
    expect(warned.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/daemon/__tests__/forge-access-sweep.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/daemon/forge-access-sweep.ts`:

```ts
/**
 * Applies forge access soon after the org's roles or roster change, whoever
 * wrote the change (the board, the console, a CLI verb). The comparison is a
 * local read; the forge is asked only when the wanted access moved since this
 * Mac last applied it. The same run re-encrypts the admin-only secrets for the
 * new owners and admins (plan 4's followRosterChange).
 */

import type { Logger } from "pino";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { createRealTeamSecretsSeams } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { cloneSlugs } from "../setup/steps/org.ts";
import { applyForgeAccessAndFollow, wantedFingerprint } from "../team/forge-access-apply.ts";
import { roleFor } from "../team/roles.ts";
import { readTeamLocal } from "../team/team-local.ts";

export interface ForgeAccessSweepDeps {
  probes: Probes;
  slugs?: (p: Probes) => string[];
  run?: (p: Probes, slug: string, secrets: SecretsSeams) => ReturnType<typeof applyForgeAccessAndFollow>;
  secrets?: (slug: string) => SecretsSeams;
  fingerprint?: typeof wantedFingerprint;
  log: Pick<Logger, "info" | "warn">;
}

export function createForgeAccessSweep(deps: ForgeAccessSweepDeps): () => Promise<void> {
  const slugs = deps.slugs ?? cloneSlugs;
  const run = deps.run ?? ((p: Probes, slug: string, secrets: SecretsSeams) => applyForgeAccessAndFollow(p, slug, secrets));
  const secretsFor = deps.secrets ?? createRealTeamSecretsSeams;
  const fingerprint = deps.fingerprint ?? wantedFingerprint;
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      for (const slug of slugs(deps.probes)) {
        try {
          const local = readTeamLocal(deps.probes, slug);
          if (!local.rtMayManageMembership || !isOrgAdmin(roleFor(deps.probes, slug))) continue;
          const wanted = await fingerprint(deps.probes, slug);
          if (wanted === null || wanted === local.forgeAccess?.fingerprint) continue;
          const { applied, admin } = await run(deps.probes, slug, secretsFor(slug));
          if (applied) deps.log.info({ sweep: "forge-access", team: slug, changed: applied.done.length, manual: applied.manualSteps.length, reencrypted: admin?.reencrypted.length ?? 0 }, "forge access applied");
          if (admin?.failure) deps.log.warn({ sweep: "forge-access", team: slug, failure: admin.failure }, "admin-only secrets did not follow the role change");
        } catch (err) {
          deps.log.warn({ err, sweep: "forge-access", team: slug }, "forge access sweep failed for an org");
        }
      }
    } finally {
      running = false;
    }
  };
}
```

`lib/daemon.ts`, after the `invite-replies` sweep:

```ts
        sweepHandles.push(scheduleSweep(
          "forge-access",
          createForgeAccessSweep({ probes: createRealProbes(), log }),
          { bootDelayMs: 120_000, intervalMs: 2 * 60 * 1000 },
          log,
        ));
```

with `import { createForgeAccessSweep } from "./daemon/forge-access-sweep.ts";` beside the other daemon imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/daemon/__tests__/forge-access-sweep.test.ts && bunx tsc --noEmit && bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/forge-access-sweep.ts lib/daemon.ts lib/daemon/__tests__/forge-access-sweep.test.ts
git commit -m "daemon: apply forge access when the org's roles or roster move it"
```

---

### Task 10: Docs

**Files:**
- Modify: `website/docs/start/teams.mdx` (replace "## Forge grants" at ~191-201; the quick reference rows for `manage-membership`, plus one for `forge-access`)
- Modify: `website/TERMINOLOGY.md` (one row: "forge access")

- [ ] **Step 1: Write the section**

Replace "## Forge grants" with:

````mdx
## Forge access

Who can reach the org's repo on the forge follows the org's roles:

| Role | Repo access | Pushes the data branch |
|---|---|---|
| Org owner, admin, team owner | Write (GitHub write, GitLab Developer) | Yes |
| Member, or on no team | Read (GitHub read, GitLab Reporter) | No |

rt changes the forge only after an admin lets it, on their own Mac:

```bash
rt team manage-membership on    # rt manages forge access from this Mac
rt team manage-membership off   # you manage it yourself
```

With it on, rt protects the org's data branch the first time, keeps its push list to the people above, and gives each person the repo access their role needs. It does this a few minutes after a roster or role change, and again at each app update. It never lowers anyone's repo access: someone who loses a role or leaves the roster only comes off the data branch's push list, and `rt team members remove` is what takes repo access away. rt never changes the rules of any other branch, and never touches the repo access of people who are not on the org's roster, such as developers who use the same repo for code.

While your Mac is on a trial branch (`rt team branch use`), rt leaves forge access alone until you are back on the org's data branch.

To see the difference, or to change the forge now:

```bash
rt team forge-access
rt team forge-access --apply
```

On an admin's Mac the **Forge access** row in setup status shows the same difference. When the forge refuses a change, because your account can't administer the repo, the row shows the step to do by hand.

rt manages forge access once the org's data has a branch of its own.

:::note
GitHub limits pushes to named people only on a repo an organization owns, and protects a private repo's branches only on a paid plan. GitLab names people on a protected branch only on Premium and Ultimate. Where the forge can't, anyone with write access can push the data branch, and only rt limits what they change there. The row says so.
:::
````

Quick reference: `| rt team manage-membership [on\|off] | Admins: let rt manage forge access from this Mac |` and `| rt team forge-access [--apply] | Admins: see and fix who can reach the org's repo on the forge |`. If the page still says anywhere that rt grants access only on repos it created, rewrite that sentence to match the section.

- [ ] **Step 2: Check, build and look at it**

Run from the repo root:

```bash
python3 skills/doc-standards/scripts/check_docs.py website/docs/start/teams.mdx --no-vale
bun run docs:check && bun run docs:build
```

Expected: zero errors from `check_docs.py`; check and build pass. Preview the site the way the `rt:docs` skill describes and open `/start/teams#forge-access` in Fast Browser (`fast-browser:browser-driver`); screenshot light and dark and say plainly anything that reads wrong (table width at phone size, the note's wrap).

- [ ] **Step 3: Commit**

```bash
git add website/docs/start/teams.mdx website/TERMINOLOGY.md
git commit -m "docs: forge access follows the org's roles"
```

---

### Task 11: One live run per forge

The spec asks for one live run per forge against the test repos. This touches real forges, so it runs from a scratch script outside the repo, against a throwaway branch, and leaves both repos as it found them.

**Files:** none in the repo. The script lives in the session's temp directory.

- [ ] **Step 1: Write the script**

`$TMPDIR/forge-access-live.ts` (absolute imports into the worktree; `<worktree>` is this plan's worktree):

```ts
import { createRealProbes } from "<worktree>/lib/setup/probes.ts";
import { githubForgeAccess } from "<worktree>/lib/team/forge-access-github.ts";
import { gitlabForgeAccess } from "<worktree>/lib/team/forge-access-gitlab.ts";

const [provider, remote, a, b, token, me] = process.argv.slice(2);
const p = createRealProbes();
const access = provider === "github" ? githubForgeAccess(p, remote!, a!, b!, token || null) : gitlabForgeAccess(p, remote!, a!, b!, token || null);
const branch = "rt-forge-access-live";
const show = (label: string, value: unknown) => console.log(label, JSON.stringify(value));
show("default", await access.defaultBranch());
show("members", await access.readMembers());
show("before", await access.readPushList(branch));
show("protect", await access.protect(branch));
show("after protect", await access.readPushList(branch));
show("set", await access.setPushList(branch, [me!]));
show("after set", await access.readPushList(branch));
show("grant same level (no change)", await access.grant(me!, "write"));
```

- [ ] **Step 2: Run it against each harness repo**

For each repo in `packages/glance/harness_credentials.json`: create `rt-forge-access-live` from the default branch (`gh api -X POST /repos/<repo>/git/refs ...` / `glab api -X POST projects/<id>/repository/branches ...`), then:

```bash
bun "$TMPDIR/forge-access-live.ts" github git@github.com:<owner>/<repo>.git <owner> <repo> "$(gh auth token)" <your github login>
bun "$TMPDIR/forge-access-live.ts" gitlab https://<host>/<path>.git <host> <path> <owner token> <owner username>
```

Expected: no step throws; `before` is `unprotected`; `protect` is `protected` (or `unavailable` on a free private GitHub repo); `after set` is `named` with your login, or `set` returns `cannot-name-users` and `after set` is `open` (a personal GitHub repo, a Free GitLab project). Record which, per forge, in the PR description. Never `grant` either GitLab `approver` user a different level.

- [ ] **Step 3: Clean up**

```bash
gh api -X DELETE /repos/<repo>/branches/rt-forge-access-live/protection; gh api -X DELETE /repos/<repo>/git/refs/heads/rt-forge-access-live
glab api -X DELETE projects/<id>/protected_branches/rt-forge-access-live; glab api -X DELETE projects/<id>/repository/branches/rt-forge-access-live
rm "$TMPDIR/forge-access-live.ts"
```

If a live answer differs from a fake's (a message, a status, Free's handling of a user entry), fix the fake and the implementation together, rerun `bun test lib/team/__tests__/forge-access-contract.test.ts lib/team/__tests__/forge-access-apply.test.ts`, and commit:

```bash
git add lib/team/forge-access-github.ts lib/team/forge-access-gitlab.ts lib/team/__tests__/forge-fakes.ts
git commit -m "forge access: match the fakes to the live forges"
```
