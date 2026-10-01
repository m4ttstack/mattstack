/**
 * `rt settings get` prints a payload: the value alone on stdout, every note
 * on stderr. `list` and `explain` print for a person on stdout, and under
 * --json keep stdout to the one envelope rt_verb parses.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsExplain, settingsGet, settingsList } from "../settings-keys.ts";
import { setSetting, setSettingsNoticeSink } from "../../lib/settings/write.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt settings get / list / explain", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: ReturnType<typeof captureOut>;
  let exits: number[];
  const origExit = process.exit;
  let restoreSink: () => void;

  beforeEach(() => {
    const previousSink = setSettingsNoticeSink(() => {});
    restoreSink = () => void setSettingsNoticeSink(previousSink);
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-get-")));
    process.env.HOME = home;
    closeStateDb();
    exits = [];
    (process as any).exit = (code?: number) => { exits.push(code ?? 0); throw new Error(`__exit_${code}`); };
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    restoreSink();
    cap.restore();
    (process as any).exit = origExit;
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("the value is the payload on stdout and the notes go to stderr", async () => {
    setSetting("rt.logLevel", "debug", "user");
    await settingsGet(["rt.logLevel"]);
    expect(cap.stdout()).toBe("debug\n");
    expect(cap.stderr()).toBe("rt.logLevel:\n  from your user settings\n");
  });

  test("a structured value is pretty JSON, and the source names the layer it came from", async () => {
    setSetting("rt.repoRoots", ["~/code"], "machine");
    await settingsGet(["rt.repoRoots"]);
    expect(cap.stdout()).toBe('[\n  "~/code"\n]\n');
    expect(cap.stderr()).toBe("rt.repoRoots:\n  from this Mac's settings\n");
  });

  test("the value is written raw on stdout and cleaned in the list", async () => {
    setSetting("rt.logLevel", "a\u001b[2Jb\nc", "user");
    await settingsGet(["rt.logLevel"]);
    expect(cap.stdout()).toBe("a\u001b[2Jb\nc\n");
    // `get` moved human text to stderr for the rest of the process; put it back before the human verb.
    cap.reset();
    cap.clear();
    await settingsList([]);
    // The key column is padded to the widest registered key.
    expect(cap.stdout()).toMatch(/^rt\.logLevel\s+ab c$/m);
    expect(cap.stdout()).not.toContain("\u001b");
  });

  test("an unknown key fails plainly", async () => {
    await expect(settingsGet(["rt.nope"])).rejects.toThrow("__exit_1");
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toBe("[failed] No setting is called rt.nope\n  next: rt settings list\n");
    await expect(settingsExplain(["rt.nope"])).rejects.toThrow("__exit_1");
    expect(exits).toEqual([1, 1]);
  });

  test("get without a key says what to type", async () => {
    await expect(settingsGet([])).rejects.toThrow("__exit_1");
    expect(cap.stderr()).toBe("[failed] Name the setting to read\n  next: rt settings get <key>\n");
  });

  test("list --json keeps stdout to one JSON value when the repo has no identity", async () => {
    const repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-local-repo-")));
    try {
      execSync("git init -q", { cwd: repoPath });
      setKvValue("repo-index", "local-only", repoPath);
      await settingsList(["--repo", "local-only", "--json"]);
      expect(cap.lines()).toHaveLength(1);
      expect(JSON.parse(cap.stdout()).ok).toBe(true);
      expect(cap.stderr()).toBe("[warning] Repo settings for local-only are out of reach  its remote is not one rt can key on\n  next: rt settings explain rt.repoIdentityOverrides\n");
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });

  test("explain draws the key as a tree with one child per rung, weakest first", async () => {
    setSetting("rt.logLevel", "debug", "user");
    await settingsExplain(["rt.logLevel"]);
    const lines = cap.stdout().split("\n");
    expect(lines[0]).toBe("rt.logLevel");
    expect(lines[1]).toMatch(/^  - default\s+built-in default\s+info$/);
    expect(lines.some((l) => /^  - user\s+\S*settings\.user\.jsonc\s+debug$/.test(l))).toBe(true);
    expect(lines.some((l) => /^  - machine\s+.*not set$/.test(l))).toBe(true);
    expect(lines.findIndex((l) => l.startsWith("  - user"))).toBeLessThan(lines.findIndex((l) => l.startsWith("  - machine")));
    expect(cap.stderr()).toBe("");
  });
});
