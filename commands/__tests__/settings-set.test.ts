/**
 * `rt settings set` and `unset` confirm in one line and hang the share tip
 * under it in the same print call, so the tip reads as part of the answer
 * and never as an error.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsSet, settingsUnset } from "../settings-keys.ts";
import { orgSettingsPath, teamSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import { readStore } from "../../lib/settings/stores.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const TIP = "  tip: Saved rt.logLevel on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs.\n  next: rt home remote set\n";

describe("rt settings set / unset output", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: ReturnType<typeof captureOut>;
  let exits: number[];
  const origExit = process.exit;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-set-")));
    process.env.HOME = home;
    closeStateDb();
    exits = [];
    (process as any).exit = (code?: number) => { exits.push(code ?? 0); throw new Error(`__exit_${code}`); };
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    cap.restore();
    (process as any).exit = origExit;
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a user write with no home remote prints the confirmation and the tip under it, nothing on stderr", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "user"]);
    expect(cap.stdout()).toBe(`[ok] Saved rt.logLevel  your user settings\n${TIP}`);
    expect(cap.stderr()).toBe("");
    expect(readFileSync(userSettingsPath(), "utf8")).toContain('"rt.logLevel"');
  });

  test("a machine write prints only the confirmation", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "machine"]);
    expect(cap.stdout()).toBe("[ok] Saved rt.logLevel  this Mac's settings\n");
  });

  test("a bare word is refused with the quoting tip and nothing is written", async () => {
    await expect(settingsSet(["rt.logLevel", "debug", "--scope", "user"])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toBe("The value is not valid JSON  debug\n  why: A string needs its own quotes, so the shell does not eat them: '\"debug\"'.\n");
    expect(cap.stdout()).toBe("");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("a missing scope names the four scopes and the command to type", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"'])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toBe(
      "Say which settings to write\n  why: A value lives in exactly one of your user, org, team or machine settings.\n  next: rt settings set <key> <value> --scope user|org|team|machine\n",
    );
  });

  test("a team name with the user scope is refused", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"', "--scope", "user", "--team", "acme"])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toStartWith("A team name only goes with the team scope");
    expect(cap.stderr()).toContain("why: You asked for the user scope.");
  });

  test("unset with a team name at the user scope points at the unset command", async () => {
    await expect(settingsUnset(["rt.logLevel", "--scope", "user", "--team", "acme"])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toContain("next: rt settings unset <key> --scope team --team <name>");
    expect(exits).toEqual([1]);
  });

  test("unset of an absent key is skipped, not failed, and prints no tip", async () => {
    await settingsUnset(["rt.logLevel", "--scope", "user"]);
    expect(cap.stdout()).toBe("[skipped] rt.logLevel was not set  nothing to remove from your user settings\n");
    expect(cap.stderr()).toBe("");
    expect(exits).toEqual([]);
  });

  test("unset of a present key prints Removed and the removal tip", async () => {
    await settingsSet(["rt.logLevel", '"debug"', "--scope", "user"]);
    cap.clear();
    await settingsUnset(["rt.logLevel", "--scope", "user"]);
    expect(cap.stdout()).toBe(
      "[ok] Removed rt.logLevel  from your user settings\n" +
        "  tip: Removed rt.logLevel on this Mac only. Your home repo has no remote yet, so the change will not reach your other Macs.\n" +
        "  next: rt home remote set\n",
    );
    expect(readFileSync(userSettingsPath(), "utf8")).not.toContain('"rt.logLevel"');
  });

  describe("org and team scopes", () => {
    beforeEach(() => {
      seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} }, roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {}, gadgets: {} } });
    });

    test("set --scope org writes the org store", async () => {
      await settingsSet(["board.gitlabHost", '"gitlab.example.com"', "--scope", "org"]);
      expect(readStore(orgSettingsPath("acme")).global["board.gitlabHost"]).toBe("gitlab.example.com");
      expect(cap.stdout()).toStartWith("[ok] Saved board.gitlabHost  the org's settings\n");
    });

    test("set --scope team writes your own team's store", async () => {
      await settingsSet(["board.title", '"Widgets"', "--scope", "team"]);
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("Widgets");
      expect(cap.stdout()).toStartWith("[ok] Saved board.title  your team's settings\n");
    });

    test("set --scope team --team gadgets writes that team folder", async () => {
      await settingsSet(["board.title", '"Gadgets"', "--scope", "team", "--team", "gadgets"]);
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("Gadgets");
      expect(cap.stdout()).toStartWith("[ok] Saved board.title  the gadgets team's settings\n");
    });

    test("a team name with the org scope is refused", async () => {
      await expect(settingsSet(["board.gitlabHost", '"x"', "--scope", "org", "--team", "widgets"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toStartWith("A team name only goes with the team scope");
      expect(cap.stderr()).toContain("why: You asked for the org scope.");
    });

    test("an unknown scope names the four scopes", async () => {
      await expect(settingsSet(["board.title", '"x"', "--scope", "everyone"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toContain("why: The scopes are user, org, team and machine.");
    });
  });

  describe("a role that does not own the store", () => {
    const ORG_REFUSAL = "[refused] The org's shared files belong to its admins\n  why: Ask dev1 (an org admin) to make this change.\n";

    function seedAs(username: string | undefined): { orgStore: string; teamStores: Record<string, string> } {
      return seedOrg({
        org: "acme",
        username,
        roles: { admins: ["dev1"], teams: { gadgets: { owners: ["dev2"] } } },
        roster: [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["gadgets"] }, { username: "dev3", teams: ["widgets"] }],
        settings: { "board.gitlabHost": "gitlab.example.com" },
        teams: { widgets: { "board.title": "Widgets" }, gadgets: {} },
      });
    }

    test("a member's org write is a refused note, exits 1 and leaves the store alone", async () => {
      const { orgStore } = seedAs("dev3");
      const before = readFileSync(orgStore);
      await expect(settingsSet(["board.gitlabHost", '"x"', "--scope", "org"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toBe(ORG_REFUSAL);
      expect(cap.stdout()).toBe("");
      expect(readFileSync(orgStore).equals(before)).toBe(true);
    });

    test("a member's org unset is a refused note and exits 1", async () => {
      const { orgStore } = seedAs("dev3");
      const before = readFileSync(orgStore);
      await expect(settingsUnset(["board.gitlabHost", "--scope", "org"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toBe(ORG_REFUSAL);
      expect(readFileSync(orgStore).equals(before)).toBe(true);
    });

    test("a member's team write names the team's owners and the admins", async () => {
      const { teamStores } = seedAs("dev3");
      const before = readFileSync(teamStores.gadgets!);
      await expect(settingsSet(["board.title", '"x"', "--scope", "team", "--team", "gadgets"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toBe(
        "[refused] The gadgets team's files belong to its owners\n  why: Ask dev2 (the team's owner) or dev1 (an org admin) to make this change.\n",
      );
      expect(readFileSync(teamStores.gadgets!).equals(before)).toBe(true);
    });

    test("an owner's org write is a refused note", async () => {
      seedAs("dev2");
      await expect(settingsSet(["board.gitlabHost", '"x"', "--scope", "org"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toBe(ORG_REFUSAL);
    });

    test("an owner's unset in another team's folder is a refused note", async () => {
      const { teamStores } = seedAs("dev2");
      const before = readFileSync(teamStores.widgets!);
      await expect(settingsUnset(["board.title", "--scope", "team", "--team", "widgets"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toStartWith("[refused] The widgets team's files belong to its owners\n");
      expect(readFileSync(teamStores.widgets!).equals(before)).toBe(true);
    });

    test("a Mac that cannot tell who you are still fails, since connecting the forge account fixes it", async () => {
      seedAs(undefined);
      await expect(settingsSet(["board.gitlabHost", '"x"', "--scope", "org"])).rejects.toThrow("__exit_1");
      expect(cap.stderr()).toStartWith("can't tell who you are");
    });
  });
});
