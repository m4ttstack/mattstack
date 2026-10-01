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
import { userSettingsPath } from "../../lib/rt-paths.ts";
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
    expect(cap.stderr()).toBe("[failed] The value is not valid JSON  debug\n  why: A string needs its own quotes, so the shell does not eat them: '\"debug\"'.\n");
    expect(cap.stdout()).toBe("");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("a missing scope names the three scopes and the command to type", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"'])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toBe(
      "[failed] Say which settings to write\n  why: A value lives in exactly one of your user, team or machine settings.\n  next: rt settings set <key> <value> --scope user|team|machine\n",
    );
  });

  test("a team name with the user scope is refused", async () => {
    await expect(settingsSet(["rt.logLevel", '"debug"', "--scope", "user", "--team", "acme"])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toContain("[failed] A team name only goes with the team scope");
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
});
