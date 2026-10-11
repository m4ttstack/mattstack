import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { hookState } from "../../../commands/hooks.ts";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { repoDataDir, userSettingsPath } from "../../rt-paths.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { ORG_LAYOUT } from "../../team/org-marker.ts";
import type { ApplyContext, StepOutcome } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { importLegacySettingsMigration, legacyHooksValue, parsePreferencesStyle } from "../migrations/import-legacy-settings.ts";

const REPO = "gitlab.example.com/acme/widgets";
const OFF = JSON.stringify({ enabled: false, hooks: { "pre-push": false } });
const OLD_SHIM = '#!/bin/bash\nHOOKS_CONFIG="/x/hooks.json"\ngrep -o \'"enabled"\' "$HOOKS_CONFIG"\n';
const NOTHING: StepOutcome = { state: "skipped", detail: "There were no old settings to copy" };

describe("2026-10-10-import-legacy-settings", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;
  const run = () => importLegacySettingsMigration.run({} as ApplyContext);

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-import-legacy-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const remoteDir = (id: string) => serializeIdentity({ kind: "remote", id });
  function writeHooks(dirName: string, body: string): string {
    const dir = repoDataDir(dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hooks.json"), body);
    return join(dir, "hooks.json");
  }
  function writeOldShim(dirName: string, hook: string): string {
    const dir = join(repoDataDir(dirName), "hooks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, hook), OLD_SHIM, { mode: 0o755 });
    return join(dir, hook);
  }
  function writePrefs(text: string): string {
    const file = join(home, ".mattstack", "user", "skills", "preferences.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }
  const PREFS = "## Writing style\n\nwriting-style: `mattstack:writing-style-sparse`\n\n## Other\nkeep me\n";

  test("is the last migration", () => {
    expect(MIGRATIONS.at(-1)).toBe(importLegacySettingsMigration);
    expect(importLegacySettingsMigration.id).toBe("2026-10-10-import-legacy-settings");
  });

  test("with nothing to copy it is skipped and creates no store", async () => {
    expect(await run()).toEqual(NOTHING);
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("copies a repo's hooks.json into that repo's user section and renames the file", async () => {
    const file = writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 1 repo into your settings" });
    const resolved = getSetting<{ enabled: boolean; hooks: Record<string, boolean> }>("rt.hooks", { repoIdentity: REPO });
    expect(resolved.value).toMatchObject({ enabled: false, hooks: { "pre-push": false } });
    expect(resolved.provenance.map((p) => p.scope)).toContain("user.repo");
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.imported`, "utf8")).toBe(OFF);
  });

  test("an installed shim that reads hooks.json is rewritten to ask rt", async () => {
    writeHooks(remoteDir(REPO), OFF);
    const shim = writeOldShim(remoteDir(REPO), "pre-push");
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 1 repo into your settings. Updated rt's hook scripts in 1 repo" });
    const text = readFileSync(shim, "utf8");
    expect(text).toContain("hooks enabled");
    expect(text).not.toContain("hooks.json");
    expect(existsSync(join(dirname(shim), "pre-commit"))).toBe(true);
  });

  test("pre-push stays off through the import and the shim swap", async () => {
    writeHooks(remoteDir(REPO), JSON.stringify({ enabled: true, hooks: { "pre-push": false } }));
    writeOldShim(remoteDir(REPO), "pre-push");
    await run();
    const clone = join(home, "widgets");
    execFileSync("git", ["init", "-q", clone]);
    execFileSync("git", ["-C", clone, "remote", "add", "origin", `https://${REPO}.git`]);
    expect(hookState("pre-push", clone)).toBe("off");
    expect(hookState("pre-commit", clone)).toBe("on");
  });

  test.skipIf(process.getuid?.() === 0)("a repo whose shims cannot all be rewritten keeps its hooks.json, every shim still reads the old choice, and the retry finishes", async () => {
    const file = writeHooks(remoteDir(REPO), OFF);
    const shim = writeOldShim(remoteDir(REPO), "pre-push");
    const preCommit = join(dirname(shim), "pre-commit");
    chmodSync(shim, 0o444);
    try {
      const result = await run();
      expect(result.state).toBe("failed");
      expect(readFileSync(shim, "utf8")).toBe(OLD_SHIM);
      expect(readFileSync(file, "utf8")).toBe(OFF);
      expect(getSetting("rt.hooks", { repoIdentity: REPO }).provenance.map((p) => p.scope)).toContain("user.repo");
      const clone = join(home, "widgets");
      execFileSync("git", ["init", "-q", clone]);
      execFileSync("git", ["-C", clone, "remote", "add", "origin", `https://${REPO}.git`]);
      const preCommitOld = existsSync(preCommit) && readFileSync(preCommit, "utf8") === OLD_SHIM;
      expect(preCommitOld || hookState("pre-commit", clone) === "off").toBe(true);
    } finally {
      chmodSync(shim, 0o755);
    }
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 1 repo into your settings. Updated rt's hook scripts in 1 repo" });
    expect(readFileSync(shim, "utf8")).toContain("hooks enabled");
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.imported`, "utf8")).toBe(OFF);
  });

  test.skipIf(process.getuid?.() === 0)("a repo whose choices cannot be copied keeps its old shims and its hooks.json, and the run fails so it retries", async () => {
    const file = writeHooks(remoteDir(REPO), OFF);
    const shim = writeOldShim(remoteDir(REPO), "pre-push");
    const storeDir = dirname(userSettingsPath());
    mkdirSync(storeDir, { recursive: true });
    chmodSync(storeDir, 0o555);
    try {
      const result = await run();
      expect(result.state).toBe("failed");
    } finally {
      chmodSync(storeDir, 0o755);
    }
    expect(readFileSync(shim, "utf8")).toBe(OLD_SHIM);
    expect(existsSync(join(dirname(shim), "pre-commit"))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(OFF);
    expect(getSetting("rt.hooks", { repoIdentity: REPO }).provenance.every((p) => p.scope === "default")).toBe(true);
  });

  test("a remote-less repo's shims are rewritten, and its hooks.json is left where it is", async () => {
    const pathDir = serializeIdentity({ kind: "path", id: "/src/widgets" });
    const file = writeHooks(pathDir, OFF);
    const shim = writeOldShim(pathDir, "pre-push");
    expect(await run()).toEqual({ state: "done", detail: "Updated rt's hook scripts in 1 repo" });
    expect(readFileSync(shim, "utf8")).toContain("hooks enabled");
    expect(readFileSync(file, "utf8")).toBe(OFF);
  });

  test("a second run imports nothing more", async () => {
    writeHooks(remoteDir(REPO), OFF);
    writePrefs(PREFS);
    await run();
    const store = readFileSync(userSettingsPath(), "utf8");
    expect(await run()).toEqual(NOTHING);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(store);
  });

  test("a repo a store already sets keeps its value, and its hooks.json is not imported", async () => {
    setSetting("rt.hooks", { enabled: true, hooks: {} }, "machine", { repoIdentity: REPO });
    const file = writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual(NOTHING);
    expect(getSetting<{ enabled: boolean }>("rt.hooks", { repoIdentity: REPO }).value.enabled).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(OFF);
  });

  test("a store value the resolver refuses still counts as set, and is never overwritten", async () => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    const text = JSON.stringify({ repos: { [REPO]: { "rt.hooks": "not an object" } } });
    writeFileSync(userSettingsPath(), text);
    writeHooks(remoteDir(REPO), OFF);
    expect(await run()).toEqual(NOTHING);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(text);
  });

  test("an old name-keyed folder is left alone", async () => {
    writeHooks("widgets", OFF);
    expect(await run()).toEqual(NOTHING);
  });

  test("a hooks.json that will not parse is left where it is and is not a failure", async () => {
    const file = writeHooks(remoteDir(REPO), "{ not json");
    expect(await run()).toEqual({ state: "skipped", detail: "There were no old settings to copy. 1 old file could not be read, so rt left it where it is" });
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  test("copies the writing-style line into your user settings and leaves preferences.md as it was", async () => {
    const file = writePrefs(PREFS);
    expect(await run()).toEqual({ state: "done", detail: "Copied your writing style into your settings" });
    const resolved = getSetting("skills.writingStyle");
    expect(resolved.value).toBe("mattstack:writing-style-sparse");
    expect(resolved.provenance.map((p) => p.scope)).toEqual(["user"]);
    expect(readFileSync(file, "utf8")).toBe(PREFS);
  });

  test("hooks and a writing style in one run are named together", async () => {
    writeHooks(remoteDir(REPO), OFF);
    writeHooks(remoteDir("gitlab.example.com/acme/gadgets"), OFF);
    writePrefs(PREFS);
    expect(await run()).toEqual({ state: "done", detail: "Copied your hook choices for 2 repos and your writing style into your settings" });
  });

  test("a writing style your team sets keeps winning: preferences.md is not copied", async () => {
    const seeded = seedOrg({
      layout: ORG_LAYOUT,
      org: "acme",
      username: "dev1",
      roster: [{ username: "dev1", teams: ["widgets"] }],
      roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } },
      teams: { widgets: { "skills.writingStyle": "mattstack:writing-style-structured" } },
    });
    const dir = join(home, ".mattstack", "orgs", seeded.org);
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    writePrefs(PREFS);
    expect(await run()).toEqual(NOTHING);
    expect(getSetting("skills.writingStyle").value).toBe("mattstack:writing-style-structured");
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("a writing-style line with an invalid id is not copied", async () => {
    writePrefs("## Writing style\nwriting-style: `-rf`\n");
    expect(await run()).toEqual(NOTHING);
  });
});

describe("legacyHooksValue", () => {
  test("keeps the switch and boolean hook entries, drops the rest", () => {
    expect(legacyHooksValue({ enabled: false, hooks: { "pre-push": false, "pre-commit": "yes" } })).toEqual({ enabled: false, hooks: { "pre-push": false } });
    expect(legacyHooksValue({})).toEqual({ enabled: true, hooks: {} });
  });
  test("anything but an object is unreadable", () => {
    for (const raw of [null, [], "x", 3]) expect(legacyHooksValue(raw)).toBeNull();
  });
});

describe("parsePreferencesStyle", () => {
  test("reads the backticked value on the keyed line", () => {
    expect(parsePreferencesStyle("## Writing style\n\nwriting-style: `acme:team-writing-style`\n\nLoad it first.\n")).toBe("acme:team-writing-style");
  });
  test("reads an unquoted value", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: team-voice\n")).toBe("team-voice");
  });
  test("no keyed line, no section, or a keyed line in another section reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nLoad `x:y` before drafting.\n")).toBeNull();
    expect(parsePreferencesStyle("## Dev process runner\nwriting-style: `x:y`\n")).toBeNull();
    expect(parsePreferencesStyle("## Writing style\n\n## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
  test("an invalid id reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: `-rf`\n")).toBeNull();
  });
  test("an indented next heading still ends the section", () => {
    expect(parsePreferencesStyle("## Writing style\n\n  ## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
});
