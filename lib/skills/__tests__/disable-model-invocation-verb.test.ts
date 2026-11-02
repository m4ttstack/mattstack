import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { userSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { childEnv } from "../../subprocess.ts";
import type { CapturedOut } from "../../ui/__tests__/capture-out.ts";
import * as packsModule from "../packs.ts";
import * as reconcileModule from "../disable-model-invocation.ts";
import { PERSONAL_MARK } from "../disable-model-invocation-line.ts";
import { captureSkills, runExpectingCleanExit } from "./helpers.ts";
import { skillsDisableModelInvocation, skillsSurface } from "../../../commands/skills.ts";
import { TREE } from "../../command-tree-def.ts";
import { Readable } from "node:stream";
import { installFakePick, type PickFake } from "../../ui/pick-fake.ts";

const KEY = "widgets@market";
const plain = (name: string) => `---\nname: ${name}\ndescription: d\n---\nbody\n`;
const lockedSource = `---\nname: locked\ndescription: d\ndisable-model-invocation: true\n---\nbody\n`;
const read = (f: string) => readFileSync(f, "utf8");

function put(file: string, text: string): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

let tmp: string;
let io: CapturedOut;
let savedHome: string | undefined;
let savedConfigDir: string | undefined;
let discovery: ReturnType<typeof spyOn>;

interface Fixture {
  packDir: string;
  installed: (name: string) => string;
}

/** A pack with public alpha, gamma and locked, an internal hidden, a public-listed base unit, and an installed copy of the same skills. */
function fixture(opts: { packDir?: string; marketplace?: string | null; plugin?: string; extra?: string[] } = {}): Fixture {
  const plugin = opts.plugin ?? "widgets";
  const extra = opts.extra ?? [];
  const packDir = opts.packDir ?? join(tmp, "pack");
  put(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0" }));
  put(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["alpha", "gamma", "locked", "base-unit", ...extra] }));
  for (const name of extra) put(join(packDir, "skills", name, "SKILL.md"), plain(name));
  for (const name of ["alpha", "gamma", "hidden"]) put(join(packDir, "skills", name, "SKILL.md"), plain(name));
  put(join(packDir, "skills", "locked", "SKILL.md"), lockedSource);
  put(join(packDir, "attachments", "base-unit", "SKILL.md"), plain("base-unit"));
  put(join(packDir, "attachments", "base-unit", "compiled.json"), JSON.stringify({ base: "acme-base", version: null, files: ["SKILL.md"] }));

  const version = join(process.env.HOME!, ".claude", "plugins", "cache", "market", plugin, "1.0.0");
  put(join(version, ".claude-plugin", "plugin.json"), JSON.stringify({ name: plugin, version: "1.0.0" }));
  for (const name of ["alpha", "gamma", "hidden", "locked", ...extra]) put(join(version, "skills", name, "SKILL.md"), name === "locked" ? lockedSource : plain(name));

  const marketplace = opts.marketplace === undefined ? "market" : opts.marketplace;
  discovery.mockReturnValue([{ name: plugin, dir: realpathSync(packDir), layout: "flat", surfacePath: join(packDir, "pack", "surface.jsonc"), marketplace }]);
  return { packDir, installed: (name) => join(version, "skills", name, "SKILL.md") };
}

const chosen = () => getSetting<Record<string, string[]>>("rt.skills.disableModelInvocation").value;
const lastJson = () => JSON.parse(io.lines().at(-1)!);

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "disable-model-invocation-verb-")));
  savedHome = process.env.HOME;
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = join(tmp, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  discovery = spyOn(packsModule, "discoverPacks");
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  discovery.mockRestore();
  process.env.HOME = savedHome;
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = 0;
});

describe("rt skills disable-model-invocation set", () => {
  test("--on writes the user setting and marks the installed copy", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    expect(lastJson()).toEqual({ names: ["alpha"], on: true, applied: true, warnings: [] });
    expect(chosen()).toEqual({ [KEY]: ["alpha"] });
    expect(read(userSettingsPath())).toContain("rt.skills.disableModelInvocation");
    expect(read(fx.installed("alpha"))).toContain(PERSONAL_MARK);
    expect(read(fx.installed("gamma"))).toBe(plain("gamma"));
  });

  test("--off removes the name, keeps the plugin key and restores the original bytes", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "gamma", "--on", "--pack", "widgets", "--json"]);
    await skillsDisableModelInvocation(["set", "alpha", "--off", "--pack", "widgets", "--json"]);
    expect(lastJson()).toEqual({ names: ["alpha"], on: false, applied: true, warnings: [] });
    expect(chosen()).toEqual({ [KEY]: ["gamma"] });
    expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
    expect(read(fx.installed("gamma"))).toContain(PERSONAL_MARK);

    await skillsDisableModelInvocation(["set", "gamma", "--off", "--pack", "widgets", "--json"]);
    expect(chosen()).toEqual({ [KEY]: [] });
    expect(read(fx.installed("gamma"))).toBe(plain("gamma"));
  });

  test("--off on a name that was never chosen succeeds and changes nothing", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--off", "--pack", "widgets", "--json"]);
    expect(lastJson()).toEqual({ names: ["alpha"], on: false, applied: true, warnings: [] });
    expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
  });

  test("choices for other plugins survive a set", async () => {
    fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    setSetting("rt.skills.disableModelInvocation", { ...chosen(), "other@elsewhere": ["x"] }, "user");
    await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
    expect(chosen()).toEqual({ [KEY]: ["alpha", "gamma"], "other@elsewhere": ["x"] });
  });

  test("an unwritable installed copy keeps the saved choice and reports applied false with a warning", async () => {
    const fx = fixture();
    chmodSync(fx.installed("alpha"), 0o444);
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    const result = lastJson();
    expect(result).toMatchObject({ names: ["alpha"], on: true, applied: false });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(fx.installed("alpha"));
    expect(chosen()).toEqual({ [KEY]: ["alpha"] });
    expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
  });

  test("a warning about a skill outside this call does not make it unapplied", async () => {
    const fx = fixture();
    chmodSync(fx.installed("gamma"), 0o444);
    await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    const result = lastJson();
    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(fx.installed("gamma"));
    expect(read(fx.installed("alpha"))).toContain(PERSONAL_MARK);
  });

  test("a plugin that is not installed stores the choice and counts as applied", async () => {
    const fx = fixture();
    rmSync(join(process.env.HOME!, ".claude", "plugins"), { recursive: true });
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    expect(lastJson()).toEqual({ names: ["alpha"], on: true, applied: true, warnings: [] });
    expect(chosen()).toEqual({ [KEY]: ["alpha"] });
    expect(existsSync(fx.installed("alpha"))).toBe(false);
  });

  test("the person is told when the installed copy was not reached", async () => {
    const fx = fixture();
    chmodSync(fx.installed("alpha"), 0o444);
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets"]);
    const text = io.lines().concat(io.errLines()).join("\n");
    expect(text).toContain("alpha");
    expect(text).toContain("installed copy");
    expect(text).toContain("read-only");
    expect(text).toContain("After the file can be written, run rt skills disable-model-invocation reapply");
    expect(text).not.toContain("Your choice is saved, but the installed copy was not changed");
  });

  test("a warning about another chosen skill is shown even though this call applied", async () => {
    const fx = fixture();
    chmodSync(fx.installed("gamma"), 0o444);
    await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
    io.restore();
    io = captureSkills();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets"]);
    const text = io.lines().concat(io.errLines()).join("\n");
    expect(text).toContain("alpha has model invocation disabled");
    expect(text).toContain("gamma");
    expect(text).not.toContain("After the file can be written");
  });

  test("a plugin-level warning makes applied false and is shown", async () => {
    fixture();
    const reconcile = spyOn(reconcileModule, "reconcileDisableModelInvocation").mockReturnValue({ changed: [], warnings: [`${KEY}: boom`] });
    try {
      await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
      expect(lastJson()).toEqual({ names: ["alpha"], on: true, applied: false, warnings: [`${KEY}: boom`] });
      io.restore();
      io = captureSkills();
      await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets"]);
      expect(io.lines().concat(io.errLines()).join("\n")).toContain("boom");
    } finally {
      reconcile.mockRestore();
    }
  });

  for (const flag of ["--on", "--off"]) {
    test(`${flag} with an unreadable settings store is refused before anything is reconciled`, async () => {
      const fx = fixture();
      await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
      const marked = read(fx.installed("gamma"));
      put(userSettingsPath(), "{ this is not json");
      const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", flag, "--pack", "widgets"]));
      expect(result.exitCode).toBe(2);
      expect(read(userSettingsPath())).toBe("{ this is not json");
      expect(read(fx.installed("gamma"))).toBe(marked);
      expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
    });
  }

  test("a stored value of the wrong shape is refused like an unreadable store", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
    const marked = read(fx.installed("gamma"));
    put(userSettingsPath(), '{ "rt.skills.disableModelInvocation": ["gamma"] }');
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", "--off", "--pack", "widgets"]));
    expect(result.exitCode).toBe(2);
    expect(read(fx.installed("gamma"))).toBe(marked);
  });

  test("set refuses --dry-run and writes nothing", async () => {
    const fx = fixture();
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", "--on", "--dry-run", "--pack", "widgets"]));
    expect(result.exitCode).toBe(1);
    expect(chosen()).toEqual({});
    expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
  });

  for (const [label, names, reason] of [
    ["an internal row", ["hidden"], "hidden"],
    ["a base row", ["base-unit"], "acme-base"],
    ["an unknown name", ["nope"], "nope"],
    ["a good name beside an internal one", ["alpha", "hidden"], "hidden"],
  ] as const) {
    test(`${label} is refused and nothing is written`, async () => {
      const fx = fixture();
      const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", ...names, "--on", "--pack", "widgets"]));
      expect(result.exitCode).toBe(2);
      expect(io.stderr()).toContain(reason);
      expect(chosen()).toEqual({});
      expect(existsSync(userSettingsPath()) ? read(userSettingsPath()) : "").not.toContain(KEY);
      expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
    });
  }

  test("a refusal under --json is an error object and exit 2", async () => {
    fixture();
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "hidden", "--on", "--pack", "widgets", "--json"]));
    expect(result.exitCode).toBe(2);
    expect(lastJson()).toMatchObject({ ok: false, error: expect.stringContaining("hidden") });
  });

  test("a row whose source already sets true is locked and refused with the reason", async () => {
    const fx = fixture();
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "locked", "--off", "--pack", "widgets"]));
    expect(result.exitCode).toBe(2);
    expect(io.stderr()).toContain("locked");
    expect(io.stderr()).toContain("pack");
    expect(chosen()).toEqual({});
    expect(read(fx.installed("locked"))).toBe(lockedSource);
  });

  test("a pack with no marketplace is refused", async () => {
    fixture({ marketplace: null });
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets"]));
    expect(result.exitCode).toBe(2);
    expect(chosen()).toEqual({});
  });

  test("set needs exactly one of --on and --off", async () => {
    fixture();
    expect((await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", "--pack", "widgets"]))).exitCode).toBe(1);
    expect((await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "alpha", "--on", "--off", "--pack", "widgets"]))).exitCode).toBe(1);
    expect(chosen()).toEqual({});
  });

  test("a member who does not own the pack can still set", async () => {
    seedOrg({ org: "acme", username: "dev4", roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } }, teams: { widgets: {} } });
    const packDir = join(process.env.HOME!, ".mattstack", "orgs", "acme", "mattstack", "teams", "widgets", "plugin");
    const fx = fixture({ packDir });
    const refused = await runExpectingCleanExit(() => skillsSurface(["set", "alpha", "--internal", "--pack-dir", packDir]));
    expect(refused.exitCode).toBe(2);

    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    expect(lastJson()).toMatchObject({ applied: true });
    expect(chosen()).toEqual({ [KEY]: ["alpha"] });
    expect(read(fx.installed("alpha"))).toContain(PERSONAL_MARK);
  });

  test("the pack's git status stays clean through on and off", async () => {
    const fx = fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fx.packDir, env: childEnv(), encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "pack");
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    expect(git("status", "--porcelain")).toBe("");
    await skillsDisableModelInvocation(["set", "alpha", "--off", "--pack", "widgets", "--json"]);
    expect(git("status", "--porcelain")).toBe("");
  });
});

function withTTY<T>(fn: () => Promise<T>): Promise<T> {
  const previousStdin = process.stdin;
  const fakeStdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });
  return fn().finally(() => Object.defineProperty(process, "stdin", { value: previousStdin, configurable: true }));
}

describe("rt skills disable-model-invocation set with no names", () => {
  let fake: PickFake;
  afterEach(() => fake?.restore());

  test("at a terminal it opens a picker over the eligible skills and applies the choice", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "gamma", "--on", "--pack", "widgets", "--json"]);
    fake = installFakePick([{ kind: "result", result: { action: "select", value: null, query: "", values: ["alpha"] } }]);
    await withTTY(() => skillsDisableModelInvocation(["set", "--on", "--pack", "widgets"]));
    expect(fake.calls).toHaveLength(1);
    const rows = fake.calls[0]!.request.rows;
    expect(rows.map((r) => r.value)).toEqual(["alpha", "gamma"]);
    expect(JSON.stringify(rows.find((r) => r.value === "gamma")!.left)).toContain("model invocation disabled");
    expect(JSON.stringify(rows.find((r) => r.value === "alpha")!.left)).toContain("Claude can invoke it");
    expect(chosen()).toEqual({ [KEY]: ["gamma", "alpha"] });
    expect(read(fx.installed("alpha"))).toContain(PERSONAL_MARK);
  });

  test("cancelling the picker changes nothing", async () => {
    fixture();
    fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    await withTTY(() => skillsDisableModelInvocation(["set", "--on", "--pack", "widgets"]));
    expect(chosen()).toEqual({});
  });

  test("at a terminal without --on or --off it asks which, with no picker", async () => {
    fixture();
    fake = installFakePick([]);
    const result = await runExpectingCleanExit(() => withTTY(() => skillsDisableModelInvocation(["set", "--pack", "widgets"])));
    expect(result.exitCode).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  test("without a terminal it keeps the which-skill failure and opens no picker", async () => {
    fixture();
    fake = installFakePick([]);
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", "--on", "--pack", "widgets"]));
    expect(result.exitCode).toBe(1);
    expect(io.stderr()).toStartWith("Which skill?");
    expect(fake.calls).toHaveLength(0);
  });

  test("under --json even at a terminal it keeps the which-skill failure", async () => {
    fixture();
    fake = installFakePick([]);
    const result = await runExpectingCleanExit(() => withTTY(() => skillsDisableModelInvocation(["set", "--on", "--pack", "widgets", "--json"])));
    expect(result.exitCode).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  test("the tree declares a picker for the omitted skill names", () => {
    const set = TREE.skills!.subcommands!["disable-model-invocation"]!.subcommands!.set!;
    expect(set.omitBehavior).toBe("picker");
    expect(set.args!.find((a) => a.name === "Skills")!.optional).toBeUndefined();
  });
});

describe("the next step after an unapplied choice", () => {
  test("a read-only copy points at reapply for after the file is writable", async () => {
    const fx = fixture();
    chmodSync(fx.installed("alpha"), 0o444);
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets"]);
    expect(io.lines().concat(io.errLines()).join("\n")).toContain("After the file can be written, run rt skills disable-model-invocation reapply");
  });

  test("any other reason gets the why and no reapply step", async () => {
    const fx = fixture();
    writeFileSync(fx.installed("alpha"), "no frontmatter here\n");
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets"]);
    const text = io.lines().concat(io.errLines()).join("\n");
    expect(text).toContain("no frontmatter");
    expect(text).toContain("Your choice is saved");
    expect(text).not.toContain("disable-model-invocation reapply");
  });
});

describe("rt skills disable-model-invocation list", () => {
  test("gives each public pack skill its state and leaves out internal and base rows", async () => {
    fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    await skillsDisableModelInvocation(["list", "--pack", "widgets", "--json"]);
    expect(lastJson()).toEqual({
      pack: "widgets",
      rows: [
        { name: "alpha", disableModelInvocation: "on" },
        { name: "gamma", disableModelInvocation: "off" },
        { name: "locked", disableModelInvocation: "locked" },
      ],
    });
  });

  test("a pack with no marketplace is refused", async () => {
    fixture({ marketplace: null });
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["list", "--pack", "widgets"]));
    expect(result.exitCode).toBe(2);
  });
});

describe("rt skills surface list --json", () => {
  test("public rows carry on, off or locked and internal and base rows carry no field", async () => {
    fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    await skillsSurface(["list", "--pack", "widgets", "--json"]);
    const rows = lastJson().rows as { name: string; disableModelInvocation?: string }[];
    const state = (name: string) => rows.find((r) => r.name === name)!;
    expect(state("alpha").disableModelInvocation).toBe("on");
    expect(state("gamma").disableModelInvocation).toBe("off");
    expect(state("locked").disableModelInvocation).toBe("locked");
    expect(state("hidden")).not.toHaveProperty("disableModelInvocation");
    expect(state("base-unit")).not.toHaveProperty("disableModelInvocation");
  });

  test("a discovery failure leaves the field off and never fails the list", async () => {
    const fx = fixture();
    discovery.mockImplementation(() => {
      throw new Error("unconverted team pack");
    });
    await skillsSurface(["list", "--pack-dir", fx.packDir, "--json"]);
    const rows = lastJson().rows as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("alpha");
    for (const row of rows) expect(row).not.toHaveProperty("disableModelInvocation");
  });

  test("a pinned mattstack root skips discovery and carries no field", async () => {
    const fx = fixture();
    await skillsSurface(["list", "--pack-dir", fx.packDir, "--mattstack-dir", join(tmp, "root"), "--json"]);
    expect(discovery).not.toHaveBeenCalled();
    for (const row of lastJson().rows) expect(row).not.toHaveProperty("disableModelInvocation");
  });

  test("a pack with no marketplace carries no field on any row", async () => {
    fixture({ marketplace: null });
    await skillsSurface(["list", "--pack", "widgets", "--json"]);
    for (const row of lastJson().rows) expect(row).not.toHaveProperty("disableModelInvocation");
  });
});

describe("rt skills disable-model-invocation reapply", () => {
  test("restores a line removed by hand and prints nothing", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    writeFileSync(fx.installed("alpha"), plain("alpha"));
    io.restore();
    io = captureSkills();

    await skillsDisableModelInvocation(["reapply"]);

    expect(read(fx.installed("alpha"))).toContain(PERSONAL_MARK);
    expect(io.lines()).toEqual([]);
    expect(io.errLines()).toEqual([]);
  });

  test("--json lists what it changed", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    writeFileSync(fx.installed("alpha"), plain("alpha"));
    await skillsDisableModelInvocation(["reapply", "--json"]);
    expect(lastJson()).toEqual({ changed: [fx.installed("alpha")], warnings: [] });
  });

  test("an empty setting does nothing and prints nothing", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["reapply"]);
    expect(io.lines()).toEqual([]);
    expect(io.errLines()).toEqual([]);
    expect(read(fx.installed("alpha"))).toBe(plain("alpha"));
  });

  test("an unreadable settings store does not fail and prints nothing", async () => {
    fixture();
    put(userSettingsPath(), "{ this is not json");
    await skillsDisableModelInvocation(["reapply"]);
    expect(io.lines()).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("a read-only copy puts its warning on the screen", async () => {
    const fx = fixture();
    await skillsDisableModelInvocation(["set", "alpha", "--on", "--pack", "widgets", "--json"]);
    writeFileSync(fx.installed("alpha"), plain("alpha"));
    chmodSync(fx.installed("alpha"), 0o444);
    await skillsDisableModelInvocation(["reapply"]);
    expect(io.lines().concat(io.errLines()).join("\n")).toContain("alpha");
  });
});

describe("the command tree row", () => {
  test("list, set and reapply are child nodes, none exempt from the picker rule or agent safe", () => {
    const node = TREE.skills!.subcommands!["disable-model-invocation"]!;
    expect(node.fn).toBeUndefined();
    expect(Object.keys(node.subcommands ?? {}).sort()).toEqual(["list", "reapply", "set"]);
    expect(JSON.stringify(node)).not.toContain("exempt");
    expect(node.agentSafe).toBeUndefined();
    for (const child of Object.values(node.subcommands!)) expect(child.agentSafe).toBeUndefined();
  });
});

describe("a skill other plugins name cannot be disabled", () => {
  const TIERING = "model-tiering";
  const mattstack = () => fixture({ plugin: "mattstack", extra: [TIERING] });

  test("set --on is refused with a reason and writes nothing", async () => {
    const fx = mattstack();
    const result = await runExpectingCleanExit(() => skillsDisableModelInvocation(["set", TIERING, "--on", "--pack", "mattstack"]));
    expect(result.exitCode).toBe(2);
    expect(io.stderr()).toContain(TIERING);
    expect(io.stderr()).toContain("other skills");
    expect(chosen()).toEqual({});
    expect(read(fx.installed(TIERING))).toBe(plain(TIERING));
  });

  test("the surface row carries no field, so the Console shows no control", async () => {
    mattstack();
    await skillsSurface(["list", "--pack", "mattstack", "--json"]);
    const rows = lastJson().rows as { name: string; disableModelInvocation?: string }[];
    expect(rows.find((r) => r.name === TIERING)).not.toHaveProperty("disableModelInvocation");
    expect(rows.find((r) => r.name === "alpha")!.disableModelInvocation).toBe("off");
  });

  test("the same name in another plugin is still settable", async () => {
    fixture({ extra: [TIERING] });
    await skillsDisableModelInvocation(["set", TIERING, "--on", "--pack", "widgets", "--json"]);
    expect(chosen()).toEqual({ [KEY]: [TIERING] });
  });
});
