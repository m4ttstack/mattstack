import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeStateDb } from "../../state/index.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { teamLocalPath } from "../team-local.ts";
import { adminSecretsFile, readAdminSecret, readTeamRecipients, teamSecretsFile, teamSopsYamlPath, writeTeamRecipients } from "../../secrets/team-store.ts";
import { FakeTeamExecSeam, fakeAgeKeySeamWithKey, seamsWithKey, teamCloneRootFor } from "../../secrets/__tests__/team-fakes.ts";
import { adminKeysIn, followRosterChange, syncAdminSecrets } from "../admin-secrets.ts";

let fixtureHome: string;
let priorHome: string | undefined;
beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-admin-secrets-`));
  process.env.HOME = fixtureHome;
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const OWNER = { username: "dev1", agePublicKey: "age1dev1", teams: [] };
const ADMIN = { username: "dev2", agePublicKey: "age1dev2", teams: ["widgets"] };
const MEMBER = { username: "dev3", agePublicKey: "age1dev3", teams: ["widgets"] };
const org = (roles: { owners?: string[]; admins: string[] }, roster: unknown[] = [OWNER, ADMIN, MEMBER]) => ({
  "mattstack.org": { owners: roles.owners ?? [], admins: roles.admins, teams: {} },
  "mattstack.roster": roster,
});
const MEMBERS_RULE = "creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1dev1,age1dev2,age1dev3\n";

function probesAs(username: string) {
  return fakeProbes({
    home: "/home/x",
    files: {
      "/home/x/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: { widgets: { owners: ["dev3"] } } } }),
      [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: username }),
    },
  });
}

function orgWithMembersRule() {
  const made = seamsWithKey();
  made.execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
  return made;
}

describe("adminKeysIn", () => {
  test("names the owners' and admins' roster keys, never a member's", () => {
    expect(adminKeysIn(org({ owners: ["dev1"], admins: ["dev2"] }))).toEqual({ keys: ["age1dev1", "age1dev2"], holders: ["dev1", "dev2"], withoutKey: [] });
  });
  test("with no owners listed, the admins are the owners", () => {
    expect(adminKeysIn(org({ admins: ["dev1"] })).keys).toEqual(["age1dev1"]);
  });
  test("usernames match without case", () => {
    expect(adminKeysIn(org({ admins: ["dev2"] }, [{ ...ADMIN, username: "Dev2" }])).keys).toEqual(["age1dev2"]);
  });
  test("an owner or admin with no key on the roster is named, not guessed at", () => {
    expect(adminKeysIn(org({ admins: ["dev1", "dev4"] }))).toMatchObject({ keys: ["age1dev1"], withoutKey: ["dev4"] });
  });
});

describe("syncAdminSecrets", () => {
  test("an org that keeps no admin-only secrets, with no token to add, is left exactly as it was", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams);
    expect(result).toMatchObject({ state: "unused", token: "none", added: [], removed: [] });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
    expect(execSeam.calls).toEqual([]);
  });

  test("the first run writes the admins rule and puts this Mac's token in", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ owners: ["dev1"], admins: ["dev2"] }), seams, { token: "admin-1" });
    expect(result).toMatchObject({ state: "updated", token: "seeded", added: ["age1dev1", "age1dev2"], holders: ["dev1", "dev2"] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1", "age1dev2"]);
    expect(readTeamRecipients("acme", seams)).toEqual(["age1dev1", "age1dev2", "age1dev3"]);
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("admin-1");
    expect(execSeam.calls.some((c) => c.cmd.includes(teamSecretsFile("acme", "board")))).toBe(false);
  });

  test("a second run with nothing changed writes nothing", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const store = org({ admins: ["dev1"] });
    await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "admin-1" });
    const before = execSeam.readFile(teamSopsYamlPath("acme"));
    execSeam.calls = [];

    const again = await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "admin-1" });

    expect(again).toMatchObject({ state: "current", token: "kept", added: [], removed: [] });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(before);
    expect(execSeam.calls.filter((c) => c.cmd[1] === "updatekeys" || c.cmd[1] === "-e")).toEqual([]);
  });

  test("a promotion adds the new admin's key and re-encrypts only the admin-only files", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    execSeam.writeFile(teamSecretsFile("acme", "board"), "ciphertext");

    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1", "dev3"] }), seams);

    expect(result).toMatchObject({ state: "updated", added: ["age1dev3"], removed: [], reencrypted: [adminSecretsFile("acme", "rt")] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1", "age1dev3"]);
    expect(execSeam.calls.filter((c) => c.cmd[1] === "updatekeys").map((c) => c.cmd[3])).toEqual([adminSecretsFile("acme", "rt")]);
  });

  test("a demotion takes the key off", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1", "age1dev2"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams);

    expect(result).toMatchObject({ removed: ["age1dev2"], added: [] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1"]);
  });

  test("a failed re-encryption puts the admins rule back as it was", async () => {
    const execSeam = new FakeTeamExecSeam({ failUpdatekeysOnCall: 1 });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    const seams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam };
    execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    const before = execSeam.readFile(teamSopsYamlPath("acme"));

    const err = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1", "dev2"] }), seams).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: "admin-secrets-not-reencrypted", next: "rt team admin-secrets" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(before);
  });

  test("a failed re-encryption with no admins rule before leaves no admins rule", async () => {
    const execSeam = new FakeTeamExecSeam({ failUpdatekeysOnCall: 1 });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    const seams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam };
    execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    await expect(syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams)).rejects.toMatchObject({ code: "admin-secrets-not-reencrypted" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
  });

  test("with no owner or admin key on the roster, nothing is written", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    await expect(syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev9"] }), seams, { token: "admin-1" })).rejects.toMatchObject({ code: "no-admin-keys", next: "rt team members sync" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
  });

  test("a different token already shared is kept unless replacing is asked for", async () => {
    const { seams } = orgWithMembersRule();
    const store = org({ admins: ["dev1"] });
    await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "old" });

    expect((await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "new" })).token).toBe("differs");
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("old");
    expect((await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "new", replaceToken: true })).token).toBe("replaced");
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("new");
  });

  test("a team owner's Mac is refused", async () => {
    const { seams } = orgWithMembersRule();
    await expect(syncAdminSecrets(probesAs("dev3"), "acme", org({ admins: ["dev1"] }), seams, { token: "admin-1" })).rejects.toMatchObject({ code: "team-pull-only" });
  });
});

describe("followRosterChange", () => {
  test("never throws: a failure comes back as text", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    const result = await followRosterChange(probesAs("dev1"), "acme", org({ admins: ["dev9"] }), seams);
    expect(result.reencrypted).toEqual([]);
    expect(result.failure).toContain("No org owner or admin");
  });
});
