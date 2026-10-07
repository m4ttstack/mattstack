import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { OrgRoles } from "../active-team.ts";
import { currentRole, mayWritePath, orgStoreRefusal, ownedRoots, roleOf, writeRefusalFor } from "../org-roles.ts";

const ROLES: OrgRoles = { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev2", "dev3"] } } };

describe("roleOf", () => {
  test("an admin, an owner of one or several teams, a member, and nobody", () => {
    expect(roleOf("dev1", ROLES)).toEqual({ kind: "admin" });
    expect(roleOf("dev2", ROLES)).toEqual({ kind: "owner", teams: ["gadgets", "widgets"] });
    expect(roleOf("dev3", ROLES)).toEqual({ kind: "owner", teams: ["gadgets"] });
    expect(roleOf("dev4", ROLES)).toEqual({ kind: "member" });
    expect(roleOf(null, ROLES)).toEqual({ kind: "unknown" });
  });
  test("a blank username is nobody", () => {
    expect(roleOf("", ROLES)).toEqual({ kind: "unknown" });
    expect(roleOf("  ", ROLES)).toEqual({ kind: "unknown" });
  });
  test("usernames compare without case", () => {
    expect(roleOf("DEV1", ROLES)).toEqual({ kind: "admin" });
    expect(roleOf("Dev3", ROLES)).toEqual({ kind: "owner", teams: ["gadgets"] });
  });
  test("a stored username and lists that differ only in case are the same person", () => {
    const mixed: OrgRoles = { admins: ["Dev1"], teams: { widgets: { owners: ["DEV2"] } } };
    expect(roleOf("dev1", mixed)).toEqual({ kind: "admin" });
    expect(roleOf("dev2", mixed)).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleOf("Dev2", mixed)).toEqual({ kind: "owner", teams: ["widgets"] });
  });
  test("an admin who is also an owner is an admin", () => {
    expect(roleOf("dev1", { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } })).toEqual({ kind: "admin" });
  });
  test("an org that lists nobody leaves everyone a member", () => {
    expect(roleOf("dev1", { admins: [], teams: {} })).toEqual({ kind: "member" });
  });
  test("an owner listed under a key that is not a plain team name is a member and owns nothing", () => {
    for (const key of ["Widgets", "a/b", "../org", "", "-x", "a b"]) {
      const role = roleOf("dev2", { admins: [], teams: { [key]: { owners: ["dev2"] } } });
      expect(role).toEqual({ kind: "member" });
      expect(ownedRoots(role)).toEqual([]);
    }
  });
  test("only the plain team names count when an owner is listed under several keys", () => {
    expect(roleOf("dev2", { admins: [], teams: { Widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev2"] } } })).toEqual({ kind: "owner", teams: ["gadgets"] });
  });
});

describe("ownedRoots on a hand-built role", () => {
  test("never yields a root for a team name that is not a plain folder name", () => {
    expect(ownedRoots({ kind: "owner", teams: ["Widgets", "a/b", "../org", "gadgets"] })).toEqual(["mattstack/teams/gadgets"]);
  });
});

describe("what a role may write", () => {
  const admin = roleOf("dev1", ROLES);
  const owner = roleOf("dev3", ROLES);
  const member = roleOf("dev4", ROLES);
  const unknown = roleOf(null, ROLES);

  test("an admin owns everything rt manages in the clone, and nothing else", () => {
    expect(ownedRoots(admin)).toEqual(["mattstack", ".sops.yaml", ".claude-plugin"]);
    for (const path of ["mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", ".sops.yaml", ".claude-plugin/marketplace.json", "mattstack/org/secrets/rt.json"]) {
      expect(mayWritePath(admin, path)).toBe(true);
    }
    expect(mayWritePath(admin, "src/index.ts")).toBe(false);
  });

  test("an owner owns their team folders only", () => {
    expect(ownedRoots(owner)).toEqual(["mattstack/teams/gadgets"]);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc")).toBe(true);
    for (const path of ["mattstack/teams/widgets/settings.team.jsonc", "mattstack/org/settings.org.jsonc", ".claude-plugin/marketplace.json", ".sops.yaml", "mattstack/teams/gadgets-evil/x"]) {
      expect(mayWritePath(owner, path)).toBe(false);
    }
  });

  test("a member and an unidentified Mac own nothing", () => {
    expect(ownedRoots(member)).toEqual([]);
    expect(ownedRoots(unknown)).toEqual([]);
    expect(mayWritePath(member, "mattstack/teams/widgets/settings.team.jsonc")).toBe(false);
  });

  test("a path that climbs out is never owned", () => {
    expect(mayWritePath(admin, "mattstack/../../etc/passwd")).toBe(false);
    expect(mayWritePath(owner, "mattstack/teams/gadgets/../widgets/settings.team.jsonc")).toBe(false);
    expect(mayWritePath(admin, "/abs/mattstack/x")).toBe(false);
  });

  test("a path with a backslash is never owned", () => {
    expect(mayWritePath(owner, "mattstack/teams/gadgets\\x")).toBe(false);
    expect(mayWritePath(owner, "mattstack\\teams\\gadgets\\x")).toBe(false);
    expect(mayWritePath(admin, "mattstack\\org\\settings.org.jsonc")).toBe(false);
  });
});

describe("writeRefusalFor names the owner", () => {
  test("a team path names that team's owners and the admins", () => {
    expect(writeRefusalFor(roleOf("dev4", ROLES), ROLES, "mattstack/teams/gadgets/settings.team.jsonc")).toEqual({
      message: "The gadgets team's files belong to its owners",
      why: "Ask dev2 or dev3 (the team's owners) or dev1 (an org admin) to make this change.",
    });
  });
  test("an org path names the admins", () => {
    expect(writeRefusalFor(roleOf("dev3", ROLES), ROLES, "mattstack/org/settings.org.jsonc")).toEqual({
      message: "The org's shared files belong to its admins",
      why: "Ask dev1 (an org admin) to make this change.",
    });
  });
  test("an unidentified Mac is told to identify itself", () => {
    expect(writeRefusalFor(roleOf(null, ROLES), ROLES, "mattstack/org/settings.org.jsonc")).toEqual({
      message: "rt can't tell who you are, so it will not change the org's shared files",
      why: "Connect your forge account in Setup, then try again.",
    });
  });
  test("an org with no admins says so instead of naming nobody", () => {
    const refusal = writeRefusalFor(roleOf("dev4", { admins: [], teams: {} }), { admins: [], teams: {} }, "mattstack/org/settings.org.jsonc");
    expect(refusal?.why).toBe("This org names no admins yet. Its mattstack.org setting has to list one.");
  });
  test("an admin writing outside what rt manages is not told to ask an admin", () => {
    const refusal = writeRefusalFor(roleOf("dev1", ROLES), ROLES, "src/index.ts");
    expect(refusal).toEqual({
      message: "rt does not change that file",
      why: "rt only changes the org's mattstack folder, .sops.yaml and .claude-plugin.",
    });
  });
  test("an allowed write has no refusal", () => {
    expect(writeRefusalFor(roleOf("dev1", ROLES), ROLES, ".sops.yaml")).toBeNull();
  });
});

describe("currentRole reads the disk", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "org-roles-"));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function seed(org: string, orgStore: string | null, username: string | null): void {
    if (orgStore !== null) {
      const dir = join(home, ".mattstack", "orgs", org, "mattstack", "org");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "settings.org.jsonc"), orgStore);
    }
    if (username !== null) {
      const dir = join(home, ".mattstack", "rt", "teams");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${org}.json`), JSON.stringify({ forgeUsername: username }));
    }
  }

  const store = JSON.stringify({ "mattstack.org": { admins: ["Dev1"], teams: { widgets: { owners: ["dev2"] } } } });

  test("the stored username and the org's lists, case aside", () => {
    seed("acme", store, "dev1");
    expect(currentRole("acme")).toEqual({ kind: "admin" });
  });
  test("no stored username is unknown", () => {
    seed("acme", store, null);
    expect(currentRole("acme")).toEqual({ kind: "unknown" });
  });
  test("a missing org store leaves a known user a member", () => {
    seed("acme", null, "dev1");
    expect(currentRole("acme")).toEqual({ kind: "member" });
  });
  test("a malformed org store leaves a known user a member", () => {
    seed("acme", "{ not json", "dev1");
    expect(currentRole("acme")).toEqual({ kind: "member" });
  });
  test("a malformed mattstack.org value leaves a known user a member", () => {
    seed("acme", JSON.stringify({ "mattstack.org": { admins: "dev1", teams: [] } }), "dev1");
    expect(currentRole("acme")).toEqual({ kind: "member" });
  });
  test("orgStoreRefusal lets an admin write the org store and names the admins to anyone else", () => {
    seed("acme", store, "dev1");
    expect(orgStoreRefusal("acme")).toBeNull();
    seed("acme", store, "dev2");
    expect(orgStoreRefusal("acme")).toBe("The org's shared files belong to its admins. Ask Dev1 (an org admin) to make this change.");
    rmSync(join(home, ".mattstack", "rt", "teams", "acme.json"));
    expect(orgStoreRefusal("acme")).toBe("rt can't tell who you are, so it will not change the org's shared files. Connect your forge account in Setup, then try again.");
  });
});
