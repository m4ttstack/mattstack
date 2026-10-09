import { describe, test, expect, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { createClaudeSkills } from "../../agent-integrations/claude/skills.ts";
import { codexReadRoots, createCodexSkills } from "../../agent-integrations/codex/skills.ts";
import { resourceKey, type PluginListEntry } from "../sources.ts";
import { discoverPacks } from "../packs.ts";
import { readSkillInventory } from "../writing-style-sources.ts";
import type { SkillRunner } from "../installed-plugins.ts";

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function plugin(dir: string, manifestDir: string, name: string, version: string): void {
  writeFile(join(dir, manifestDir, "plugin.json"), JSON.stringify({ name, version }));
  writeFile(join(dir, "skills", "hello", "SKILL.md"), `---\nname: hello\ndescription: ${version}\n---\nbody ${version}\n`);
}

type CodexRow = { name: string; marketplaceName: string; version: string; enabled?: boolean; pluginId?: string; installed?: boolean };

function codexStdout(rows: CodexRow[]): string {
  return JSON.stringify({
    installed: rows.map((r) => ({
      pluginId: r.pluginId ?? `${r.name}@${r.marketplaceName}`, name: r.name, marketplaceName: r.marketplaceName,
      version: r.version, installed: r.installed ?? true, enabled: r.enabled ?? true,
    })),
    available: [],
  });
}

let root: string;
let home: string;
let codexHome: string;
let claudeDir: string;
let spawnedCommands: string[];

function runner(stdout: string, status = 0): SkillRunner {
  return async (bin, args, opts) => {
    spawnedCommands.push(basename(bin));
    spawnedArgs.push({ args, env: opts.env });
    return { status, stdout, stderr: status === 0 ? "" : "boom\nsecond line" };
  };
}
let spawnedArgs: { args: string[]; env: Record<string, string | undefined> }[];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "harness-inventory-")));
  home = join(root, "home");
  codexHome = join(root, "codex-home");
  claudeDir = join(home, ".claude");
  mkdirSync(home, { recursive: true });
  spawnedCommands = [];
  spawnedArgs = [];
});

const codexCache = () => join(codexHome, "plugins", "cache");
const claudeCache = () => join(claudeDir, "plugins", "cache");

describe("Codex inventory never invokes Claude", () => {
  test("lists, roots and resolves through codex alone", async () => {
    const dir = join(codexCache(), "mk", "demo", "1.2.0");
    plugin(dir, ".codex-plugin", "demo", "1.2.0");
    const skills = createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner(codexStdout([{ name: "demo", marketplaceName: "mk", version: "1.2.0" }])) });

    const inv = await skills.inventory();
    expect(inv).toEqual({ ok: true, data: [{ id: "demo@mk", installPath: dir, enabled: true, version: "1.2.0", harness: "codex", profile: codexHome }] });
    expect(await skills.resourceRoots()).toEqual({ ok: true, data: [dir] });
    expect(await skills.resolveResource("demo", "skills/hello/SKILL.md")).toEqual({ ok: true, data: join(dir, "skills", "hello", "SKILL.md") });

    expect(spawnedCommands).not.toContain("claude");
    expect(spawnedCommands.every((c) => c === "codex")).toBe(true);
    expect(spawnedArgs[0]!.args).toEqual(["plugin", "list", "--json"]);
    expect(spawnedArgs[0]!.env.CODEX_HOME).toBe(codexHome);
  });

  test("the ambient profile reads ~/.codex", async () => {
    const dir = join(home, ".codex", "plugins", "cache", "mk", "demo", "1.0.0");
    plugin(dir, ".codex-plugin", "demo", "1.0.0");
    const skills = createCodexSkills({ env: { HOME: home }, bin: () => "/opt/bin/codex", run: runner(codexStdout([{ name: "demo", marketplaceName: "mk", version: "1.0.0" }])) });
    const inv = await skills.inventory();
    expect(inv.ok && inv.data[0]).toMatchObject({ installPath: dir, profile: "default" });
    expect(spawnedArgs[0]!.env.CODEX_HOME).toBe(join(home, ".codex"));
  });

  test("a missing codex is not-ready, and nothing falls through to claude", async () => {
    const skills = createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => null, run: runner("[]") });
    for (const result of [await skills.inventory(), await skills.resourceRoots(), await skills.resolveResource("demo", "x.md")]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not-ready");
    }
    expect(spawnedCommands).toEqual([]);
  });

  test("a failed listing and an unreadable one are explicit faults", async () => {
    const failed = await createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner("", 2) }).inventory();
    expect(failed).toEqual({ ok: false, error: { code: "not-ready", message: "codex plugin list failed: boom" } });
    const garbled = await createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner("not json") }).inventory();
    expect(garbled.ok).toBe(false);
    if (!garbled.ok) expect(garbled.error.code).toBe("invalid");
    expect(spawnedCommands).not.toContain("claude");
  });

  test("a profile that names no Codex home is invalid without spawning", async () => {
    const result = await createCodexSkills({ profile: "work", env: { HOME: home }, bin: () => "/opt/bin/codex", run: runner("{}") }).inventory();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
    expect(spawnedCommands).toEqual([]);
  });

  test("uninstalled marketplace rows are not inventory", async () => {
    const skills = createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner(codexStdout([{ name: "demo", marketplaceName: "mk", version: "1.0.0", installed: false }])) });
    expect(await skills.inventory()).toEqual({ ok: true, data: [] });
  });
});

describe("same ID in two hosts stays distinct", () => {
  test("Claude and Codex copies of one plugin keep their own versions and paths", async () => {
    const claudeVersion = join(claudeCache(), "mk", "demo", "1.0.0");
    const codexVersion = join(codexCache(), "mk", "demo", "2.0.0");
    plugin(claudeVersion, ".claude-plugin", "demo", "1.0.0");
    plugin(codexVersion, ".codex-plugin", "demo", "2.0.0");
    const claudeList: PluginListEntry[] = [{ id: "demo@mk", installPath: claudeVersion, enabled: true, scope: "user", version: "1.0.0" }];
    const claude = createClaudeSkills({ env: { HOME: home }, bin: () => "/opt/bin/claude", run: runner(JSON.stringify(claudeList)) });
    const codex = createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner(codexStdout([{ name: "demo", marketplaceName: "mk", version: "2.0.0" }])) });

    const a = await claude.inventory();
    const b = await codex.inventory();
    if (!a.ok || !b.ok) throw new Error("inventory failed");
    const all = [...a.data, ...b.data];
    expect(all.map((e) => e.id)).toEqual(["demo@mk", "demo@mk"]);
    expect(new Set(all.map(resourceKey)).size).toBe(2);
    expect(all.map((e) => `${e.harness}:${e.version}`).sort()).toEqual(["claude:1.0.0", "codex:2.0.0"]);

    expect(await claude.resolveResource("demo@mk", "skills/hello/SKILL.md")).toEqual({ ok: true, data: join(claudeVersion, "skills", "hello", "SKILL.md") });
    expect(await codex.resolveResource("demo@mk", "skills/hello/SKILL.md")).toEqual({ ok: true, data: join(codexVersion, "skills", "hello", "SKILL.md") });
    expect(await claude.resourceRoots()).toEqual({ ok: true, data: [claudeVersion] });
    expect(await codex.resourceRoots()).toEqual({ ok: true, data: [codexVersion] });
  });

  test("a bare name shared by two marketplaces in one host is ambiguous; the full id chooses", async () => {
    const one = join(codexCache(), "mk", "demo", "1.0.0");
    const two = join(codexCache(), "other", "demo", "3.0.0");
    plugin(one, ".codex-plugin", "demo", "1.0.0");
    plugin(two, ".codex-plugin", "demo", "3.0.0");
    const codex = createCodexSkills({
      env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex",
      run: runner(codexStdout([{ name: "demo", marketplaceName: "mk", version: "1.0.0" }, { name: "demo", marketplaceName: "other", version: "3.0.0" }])),
    });
    const bare = await codex.resolveResource("demo", "skills/hello/SKILL.md");
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error.code).toBe("ambiguous");
    expect(await codex.resolveResource("demo@other", "skills/hello/SKILL.md")).toEqual({ ok: true, data: join(two, "skills", "hello", "SKILL.md") });
    expect(await codex.resourceRoots()).toEqual({ ok: true, data: [one, two] });
  });

  test("a Claude failure is the Claude adapter's fault and never reads Codex", async () => {
    const claude = createClaudeSkills({ env: { HOME: home }, bin: () => null, run: runner("[]") });
    const result = await claude.inventory();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-ready");
    expect(spawnedCommands).toEqual([]);
  });
});

describe("references that refuse rather than become roots", () => {
  function codexWith(rows: CodexRow[]) {
    return createCodexSkills({ env: { HOME: home, CODEX_HOME: codexHome }, bin: () => "/opt/bin/codex", run: runner(codexStdout(rows)) });
  }

  test("traversal and absolute resource paths are refused", async () => {
    plugin(join(codexCache(), "mk", "demo", "1.0.0"), ".codex-plugin", "demo", "1.0.0");
    writeFile(join(codexCache(), "mk", "secret.md"), "x");
    const codex = codexWith([{ name: "demo", marketplaceName: "mk", version: "1.0.0" }]);
    for (const bad of ["../../secret.md", "skills/../../../secret.md", "/etc/hosts", "", "./skills/hello/SKILL.md", "skills//hello/SKILL.md"]) {
      const result = await codex.resolveResource("demo", bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("refused");
    }
  });

  test("a symlink inside a plugin that leaves its version folder is refused", async () => {
    const dir = join(codexCache(), "mk", "demo", "1.0.0");
    plugin(dir, ".codex-plugin", "demo", "1.0.0");
    const outside = join(root, "outside");
    writeFile(join(outside, "SKILL.md"), "x");
    symlinkSync(outside, join(dir, "skills", "evil"));
    const result = await codexWith([{ name: "demo", marketplaceName: "mk", version: "1.0.0" }]).resolveResource("demo", "skills/evil/SKILL.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("refused");
  });

  test("a symlinked version folder is listed but never a root", async () => {
    const real = join(root, "elsewhere");
    plugin(real, ".codex-plugin", "linked", "1.0.0");
    mkdirSync(join(codexCache(), "mk", "linked"), { recursive: true });
    symlinkSync(real, join(codexCache(), "mk", "linked", "1.0.0"));
    const codex = codexWith([{ name: "linked", marketplaceName: "mk", version: "1.0.0" }]);
    const inv = await codex.inventory();
    expect(inv.ok && inv.data.map((e) => e.id)).toEqual(["linked@mk"]);
    expect(await codex.resourceRoots()).toEqual({ ok: true, data: [] });
    const result = await codex.resolveResource("linked", "skills/hello/SKILL.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("refused");
  });

  test("a version or marketplace that would climb out of the cache is never a root", async () => {
    plugin(join(codexCache(), "mk", "demo", "1.0.0"), ".codex-plugin", "demo", "1.0.0");
    const codex = codexWith([
      { name: "demo", marketplaceName: "mk", version: ".." },
      { name: "demo", marketplaceName: "..", version: "1.0.0" },
      { name: "demo", marketplaceName: "mk", version: "1.0.0", pluginId: "other@mk" },
    ]);
    expect(await codex.resourceRoots()).toEqual({ ok: true, data: [] });
  });

  test("a Claude install path outside its own cache is a foreign reference and never a root", async () => {
    const foreign = join(codexCache(), "mk", "demo", "1.0.0");
    plugin(foreign, ".codex-plugin", "demo", "1.0.0");
    const checkout = join(root, "checkout");
    plugin(checkout, ".claude-plugin", "loose", "1.0.0");
    const list: PluginListEntry[] = [
      { id: "demo@mk", installPath: foreign, enabled: true },
      { id: "loose@mk", installPath: checkout, enabled: true },
      { id: "demo@mk", installPath: join(claudeCache(), "mk", "demo", "1.0.0", "..", "..", ".."), enabled: true },
      { id: "wrong@mk", installPath: join(claudeCache(), "mk", "demo", "1.0.0"), enabled: true },
    ];
    plugin(join(claudeCache(), "mk", "demo", "1.0.0"), ".claude-plugin", "demo", "1.0.0");
    const claude = createClaudeSkills({ env: { HOME: home }, bin: () => "/opt/bin/claude", run: runner(JSON.stringify(list)) });
    expect(await claude.resourceRoots()).toEqual({ ok: true, data: [] });
    const result = await claude.resolveResource("loose", "skills/hello/SKILL.md");
    expect(result.ok).toBe(false);
  });

  test("CLAUDE_CONFIG_DIR names the Claude cache", async () => {
    const config = join(root, "acct");
    const dir = join(config, "plugins", "cache", "mk", "demo", "1.0.0");
    plugin(dir, ".claude-plugin", "demo", "1.0.0");
    const list: PluginListEntry[] = [{ id: "demo@mk", installPath: dir, enabled: true }];
    const claude = createClaudeSkills({ env: { HOME: home, CLAUDE_CONFIG_DIR: config }, profile: "acct", bin: () => "/opt/bin/claude", run: runner(JSON.stringify(list)) });
    expect(await claude.resourceRoots()).toEqual({ ok: true, data: [dir] });
    const inv = await claude.inventory();
    expect(inv.ok && inv.data[0]).toMatchObject({ harness: "claude", profile: "acct" });
  });
});

describe("Codex roots reach the read guard only through the switch", () => {
  test("off, or Codex not enabled, lists nothing and spawns nothing", () => {
    const list = () => {
      spawnedCommands.push("codex");
      return ["/x"];
    };
    expect(codexReadRoots({ switchOn: () => false, codexEnabled: () => true, roots: list })).toEqual([]);
    expect(codexReadRoots({ switchOn: () => true, codexEnabled: () => false, roots: list })).toEqual([]);
    expect(spawnedCommands).toEqual([]);
    expect(codexReadRoots({ switchOn: () => true, codexEnabled: () => true, roots: list })).toEqual(["/x"]);
  });
});

describe("shared manifest formats", () => {
  test("a Codex plugin's skills roots come from its .codex-plugin manifest", () => {
    const dir = join(codexCache(), "mk", "styles", "1.0.0");
    writeFile(join(dir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "styles", version: "1.0.0", skills: "./custom/" }));
    writeFile(join(dir, "custom", "team-writing-style", "SKILL.md"), "---\nname: team-writing-style\n---\nx\n");
    const inv = readSkillInventory(home, [{ id: "styles@mk", enabled: true, installPath: dir, harness: "codex" }], { userSkillsDirs: [join(codexHome, "skills")] });
    expect(inv.installed.has("styles:team-writing-style")).toBe(true);
  });

  test("the Claude default is unchanged: ~/.claude/skills and .claude-plugin", () => {
    writeFile(join(home, ".claude", "skills", "mine", "SKILL.md"), "---\nname: mine\n---\nx\n");
    expect(readSkillInventory(home, null).installed.has("mine")).toBe(true);
  });

  test("Codex user skills are read from the Codex home when asked", () => {
    writeFile(join(codexHome, "skills", "codex-own", "SKILL.md"), "---\nname: codex-own\n---\nx\n");
    expect(readSkillInventory(home, null, { userSkillsDirs: [join(codexHome, "skills")] }).installed.has("codex-own")).toBe(true);
    expect(readSkillInventory(home, null).installed.has("codex-own")).toBe(false);
  });
});

describe("packs from a Codex local marketplace", () => {
  function codexMarketplace(name: string, plugins: { name: string; path: string }[]): string {
    const market = join(root, `market-${name}`);
    writeFile(join(market, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name, plugins: plugins.map((p) => ({ name: p.name, source: { source: "local", path: p.path } })) }));
    writeFile(join(codexHome, "config.toml"), `[marketplaces.${name}]\nsource_type = "local"\nsource = "${market}"\n`);
    return market;
  }

  test("a pack served by a Codex local marketplace is discovered when asked", () => {
    const market = codexMarketplace("cm", [{ name: "team", path: "./plugins/team" }]);
    writeFile(join(market, "plugins", "team", "pack", "surface.jsonc"), '{ "public": [] }');
    const packs = discoverPacks({ settingsPath: join(root, "none.json"), mattstackRoot: null, codexHome });
    expect(packs.map((p) => [p.name, p.marketplace])).toEqual([["team", "cm"]]);
  });

  test("a Codex entry that leaves its marketplace folder is ignored", () => {
    codexMarketplace("cm", [{ name: "team", path: "../escape" }]);
    writeFile(join(root, "escape", "pack", "surface.jsonc"), '{ "public": [] }');
    expect(discoverPacks({ settingsPath: join(root, "none.json"), mattstackRoot: null, codexHome })).toEqual([]);
  });

  test("a Claude marketplace entry keeps precedence over a Codex one of the same name", () => {
    const market = codexMarketplace("cm", [{ name: "team", path: "./plugins/team" }]);
    writeFile(join(market, "plugins", "team", "pack", "surface.jsonc"), '{ "public": [] }');
    const claudeMarket = join(root, "claude-market");
    writeFile(join(claudeMarket, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "team", source: "./team" }] }));
    writeFile(join(claudeMarket, "team", "pack", "surface.jsonc"), '{ "public": [] }');
    const settingsPath = join(root, "settings.json");
    writeFile(settingsPath, JSON.stringify({ extraKnownMarketplaces: { cl: { source: { source: "directory", path: claudeMarket } } } }));
    const packs = discoverPacks({ settingsPath, mattstackRoot: null, codexHome });
    expect(packs.map((p) => [p.name, p.marketplace])).toEqual([["team", "cl"]]);
  });

  test("without a Codex home nothing changes", () => {
    codexMarketplace("cm", [{ name: "team", path: "./plugins/team" }]);
    expect(discoverPacks({ settingsPath: join(root, "none.json"), mattstackRoot: null, codexHome: null })).toEqual([]);
  });
});
