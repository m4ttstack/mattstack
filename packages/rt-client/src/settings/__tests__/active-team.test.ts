import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { seedOrg } from "../../../test/org-fixture.ts";
import { activeTeam, activeTeamPack, activeTeamRoster, decideActiveTeam, mergeTeamRoster, readOrgRoles, sameUser, type RosterEntry } from "../active-team.ts";
import { orgSettingsPath, teamFolderDir, teamLocalPath, teamPackDir, userSettingsPath } from "../paths.ts";

const ROSTER: RosterEntry[] = [
  { username: "dev1", teams: ["widgets"] },
  { username: "dev2", teams: ["widgets", "gadgets"] },
  { username: "dev3" },
];
const folders = () => ["gadgets", "widgets"];

describe("decideActiveTeam", () => {
  test("no team lists you: none", () => {
    expect(decideActiveTeam({ username: "dev3", roster: ROSTER, setting: "widgets", teamFolders: folders })).toEqual({ team: null, reason: "no-team", listedOn: [] });
    expect(decideActiveTeam({ username: "stranger", roster: ROSTER, setting: undefined, teamFolders: folders }).reason).toBe("no-team");
  });

  test("the setting names a team you are on: that team", () => {
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: "gadgets", teamFolders: folders })).toEqual({ team: "gadgets", reason: "chosen", listedOn: ["widgets", "gadgets"] });
    expect(decideActiveTeam({ username: "dev1", roster: ROSTER, setting: "widgets", teamFolders: folders }).reason).toBe("chosen");
  });

  test("the setting is unset or names a team you are not on: the first team in your roster entry", () => {
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: undefined, teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets", "gadgets"] });
    expect(decideActiveTeam({ username: "dev2", roster: ROSTER, setting: "sprockets", teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: "dev1", roster: ROSTER, setting: "gadgets", teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets"] });
  });

  test("a member added to a second team keeps their first team", () => {
    const before = [{ username: "dev1", teams: ["widgets"] }];
    const after = [{ username: "dev1", teams: ["widgets", "gadgets"] }];
    expect(decideActiveTeam({ username: "dev1", roster: before, setting: undefined, teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: "dev1", roster: after, setting: undefined, teamFolders: folders }).team).toBe("widgets");
  });

  test("no stored username and the setting names a team folder: that team", () => {
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: "widgets", teamFolders: folders })).toEqual({ team: "widgets", reason: "setting-only", listedOn: [] });
  });

  test("no stored username and no usable setting: none, identity", () => {
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: undefined, teamFolders: folders })).toEqual({ team: null, reason: "identity", listedOn: [] });
    expect(decideActiveTeam({ username: null, roster: ROSTER, setting: "sprockets", teamFolders: folders }).reason).toBe("identity");
  });

  test("usernames compare without case", () => {
    expect(sameUser("Dev1", "dev1")).toBe(true);
    expect(decideActiveTeam({ username: "DEV1", roster: ROSTER, setting: undefined, teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: "dev1", roster: [{ username: "Dev1", teams: ["gadgets"] }], setting: undefined, teamFolders: folders }).team).toBe("gadgets");
  });

  test("a teams entry that is not a team name is ignored and never becomes a path", () => {
    const roster = [{ username: "dev1", teams: ["../x", "Widgets", "", 7 as unknown as string, "widgets"] }];
    expect(decideActiveTeam({ username: "dev1", roster, setting: undefined, teamFolders: folders })).toEqual({ team: "widgets", reason: "first-team", listedOn: ["widgets"] });
  });

  test("a setting that is not a team name never becomes the team", () => {
    const roster = [{ username: "dev1", teams: ["../x", "widgets"] }];
    expect(decideActiveTeam({ username: "dev1", roster, setting: "../x", teamFolders: folders }).team).toBe("widgets");
    expect(decideActiveTeam({ username: null, roster, setting: "../x", teamFolders: () => ["../x"] }).reason).toBe("identity");
  });
});

describe("activeTeam on disk", () => {
  const origHome = process.env.HOME;
  let home: string;

  function write(file: string, value: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  }

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-active-team-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("no org clone: no-org", () => {
    expect(activeTeam()).toEqual({ org: null, team: null, reason: "no-org", username: null, listedOn: [] });
  });

  test("reads the roster, the stored username and the user setting", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER, "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } });
    write(teamLocalPath("acme"), { forgeUsername: "dev2" });
    write(userSettingsPath(), { "mattstack.activeTeam": "gadgets" });
    expect(activeTeam()).toEqual({ org: "acme", team: "gadgets", reason: "chosen", username: "dev2", listedOn: ["widgets", "gadgets"] });
    expect(activeTeamRoster().map((e) => e.username)).toEqual(["dev2"]);
    expect(readOrgRoles("acme")).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } });
  });

  test("the stored username and the roster may differ in case", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER });
    write(teamLocalPath("acme"), { forgeUsername: "Dev1" });
    expect(activeTeam()).toMatchObject({ team: "widgets", reason: "first-team", username: "Dev1" });
  });

  test("with no active team the roster is everyone", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER });
    write(teamLocalPath("acme"), { forgeUsername: "dev3" });
    expect(activeTeamRoster().map((e) => e.username)).toEqual(["dev1", "dev2", "dev3"]);
  });

  test("a setting-only team must be a folder on disk", () => {
    write(orgSettingsPath("acme"), { "mattstack.roster": ROSTER });
    write(userSettingsPath(), { "mattstack.activeTeam": "widgets" });
    expect(activeTeam().reason).toBe("identity");
    mkdirSync(teamFolderDir("acme", "widgets"), { recursive: true });
    expect(activeTeam()).toMatchObject({ team: "widgets", reason: "setting-only" });
  });

  test("malformed roles read as nobody", () => {
    write(orgSettingsPath("acme"), { "mattstack.org": { admins: "dev1", teams: [] } });
    expect(readOrgRoles("acme")).toEqual({ admins: [], teams: {} });
  });
});

describe("mergeTeamRoster", () => {
  const full: RosterEntry[] = [
    { username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] },
    { username: "dev2", teams: ["widgets", "gadgets"] },
    { username: "dev3", teams: ["gadgets"] },
  ];

  test("an edit in one team's view never touches members of other teams", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev1", name: "Dev 1" }, { username: "dev2" }]);
    expect(out).toEqual([
      { username: "dev1", name: "Dev 1", agePublicKey: "age1aaa", teams: ["widgets"] },
      { username: "dev2", teams: ["widgets", "gadgets"] },
      { username: "dev3", teams: ["gadgets"] },
    ]);
  });

  test("a member added in the view joins that team; one already in the org gains it", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev1" }, { username: "dev2" }, { username: "DEV3" }, { username: "dev4", name: "Dev Four" }]);
    expect(out.find((e) => e.username === "dev3")!.teams).toEqual(["gadgets", "widgets"]);
    expect(out[3]).toEqual({ username: "dev4", name: "Dev Four", teams: ["widgets"] });
  });

  test("a member removed from the view leaves the team but stays in the org", () => {
    const out = mergeTeamRoster(full, "widgets", [{ username: "dev2" }]);
    expect(out[0]).toEqual({ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: [] });
    expect(out.length).toBe(3);
  });

  test("with no active team the edit is the whole roster", () => {
    expect(mergeTeamRoster(full, null, [{ username: "dev9" }])).toEqual([{ username: "dev9" }]);
  });
});

describe("activeTeamPack", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "rt-active-pack-"))); process.env.HOME = home; });
  afterEach(() => { process.env.HOME = origHome; rmSync(home, { recursive: true, force: true }); });

  function seed(fragment: string | null): void {
    seedOrg({ org: "acme", username: "dev1", roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {} } });
    if (fragment !== null) {
      const file = join(teamPackDir("acme", "widgets"), "pack", "skills.jsonc");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, fragment);
    }
  }

  test("the team's name when its folder holds a pack", () => {
    seed(`// bindings\n{ "version": 1 }`);
    expect(activeTeamPack()).toBe("widgets");
  });
  test("null with no pack, a base pack, an unreadable fragment, or no active team", () => {
    seed(null);
    expect(activeTeamPack()).toBeNull();
    seed(`{ "base": true }`);
    expect(activeTeamPack()).toBeNull();
    seed(`{ not json`);
    expect(activeTeamPack()).toBeNull();
    seedOrg({ org: "acme", username: "stranger", teams: { widgets: {} } });
    expect(activeTeamPack()).toBeNull();
  });
});
