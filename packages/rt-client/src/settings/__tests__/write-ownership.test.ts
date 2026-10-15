import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readOrgRoles, readOrgRoster } from "../active-team.ts";
import { orgSettingsPath } from "../paths.ts";
import { readStore } from "../stores.ts";
import { setSetting, SettingsOwnershipRefusal } from "../write.ts";
import { seedOrg } from "../../../test/org-fixture.ts";

describe("settings/write: the org store guard", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-ownership-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const roles = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
  const roster = [
    { username: "dev0", teams: [] },
    { username: "dev1", teams: ["widgets"] },
    { username: "dev2", teams: ["widgets"] },
    { username: "dev3", teams: ["gadgets"] },
    { username: "dev4", teams: ["gadgets"] },
  ];
  const seedAs = (username: string) => seedOrg({ org: "acme", username, roster, roles, settings: { "board.gitlabHost": "gitlab.example.com" } });
  const withTeams = (username: string, teams: string[]) => roster.map((e) => (e.username === username ? { ...e, teams } : e));

  test("a team owner may put an existing member on their own team", () => {
    seedAs("dev2");
    setSetting("mattstack.roster", withTeams("dev4", ["gadgets", "widgets"]), "org");
    expect(readOrgRoster("acme").find((e) => e.username === "dev4")?.teams).toEqual(["gadgets", "widgets"]);
  });

  test("a team owner may not change another team's membership", () => {
    seedAs("dev2");
    const before = readFileSync(orgSettingsPath("acme"), "utf8");
    expect(() => setSetting("mattstack.roster", withTeams("dev4", []), "org")).toThrow(SettingsOwnershipRefusal);
    expect(() => setSetting("mattstack.roster", withTeams("dev4", []), "org")).toThrow(
      "rt: You don't own gadgets, so you can't change who is on it. Ask dev1 (an org admin) to make this change.",
    );
    expect(readFileSync(orgSettingsPath("acme"), "utf8")).toBe(before);
  });

  test("a team owner may not add someone to the org", () => {
    seedAs("dev2");
    expect(() => setSetting("mattstack.roster", [...roster, { username: "dev5", teams: ["widgets"] }], "org")).toThrow(SettingsOwnershipRefusal);
  });

  test("a team owner still may not write any other org key", () => {
    seedAs("dev2");
    expect(() => setSetting("board.gitlabHost", "x", "org")).toThrow(SettingsOwnershipRefusal);
  });

  test("a member is refused the roster as before", () => {
    seedAs("dev4");
    expect(() => setSetting("mattstack.roster", withTeams("dev4", ["gadgets", "widgets"]), "org")).toThrow(
      "rt: The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change.",
    );
  });

  test("an admin may not change the owners list", () => {
    seedAs("dev1");
    const before = readFileSync(orgSettingsPath("acme"), "utf8");
    expect(() => setSetting("mattstack.org", { owners: ["dev0", "dev1"], admins: ["dev1"], teams: {} }, "org")).toThrow(SettingsOwnershipRefusal);
    expect(() => setSetting("mattstack.org", { owners: ["dev0", "dev1"], admins: ["dev1"], teams: {} }, "org")).toThrow(
      "rt: Only an org owner can change who the org owners are. Ask dev0 (an org owner) to make this change.",
    );
    expect(readFileSync(orgSettingsPath("acme"), "utf8")).toBe(before);
  });

  test("an admin still changes everything else in the org store", () => {
    seedAs("dev1");
    setSetting("mattstack.org", { ...roles, admins: ["dev1", "dev3"] }, "org");
    setSetting("board.gitlabHost", "gitlab.acme.test", "org");
    expect(readOrgRoles("acme").admins).toEqual(["dev1", "dev3"]);
    expect(readStore(orgSettingsPath("acme")).global["board.gitlabHost"]).toBe("gitlab.acme.test");
  });

  test("an org owner may change the owners list", () => {
    seedAs("dev0");
    setSetting("mattstack.org", { ...roles, owners: ["dev0", "dev1"] }, "org");
    expect(readOrgRoles("acme").owners).toEqual(["dev0", "dev1"]);
  });
});
