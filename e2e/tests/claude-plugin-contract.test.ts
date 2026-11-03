/**
 * The claude CLI behaviors pack-cache.ts is built on, asserted against the real
 * binary. Opt-in because no CI workflow installs claude: RT_CLAUDE_PLUGIN_E2E=1.
 * Every branch in settlePack keys off one of these, so a claude behavior change
 * must fail loudly here rather than silently in production. The second block
 * pins the git-subdir install team packs use: what reaches the cache and when.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { createTestHome } from "../harness.ts";
import { childEnv } from "../../lib/subprocess.ts";

const enabled = process.env.RT_CLAUDE_PLUGIN_E2E === "1" && Bun.which("claude") !== null;

// describe.skipIf prints no reason, so a placeholder carries it.
if (!enabled) {
  test.skip("claude plugin contract: needs RT_CLAUDE_PLUGIN_E2E=1 and claude on PATH", () => {});
}

describe.skipIf(!enabled)("claude plugin contract", () => {
  let home: string;
  let market: string;
  const id = "demopack@probeorg";

  /** The streams are kept apart because the matchers are: isNotFound/isAlready/isAlreadyDisabled read stderr alone, so a combined string here would pass through a stream change they would not survive. */
  function claude(args: string[]): { code: number; stdout: string; stderr: string } {
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
    // Explicit, because execFileSync inherits stderr by default and the error
    // path would then hand back a null stderr for every probe below.
    const stdio: ("ignore" | "pipe")[] = ["ignore", "pipe", "pipe"];
    try {
      return { code: 0, stdout: execFileSync("claude", args, { encoding: "utf8", env, stdio }), stderr: "" };
    } catch (err) {
      const e = err as { status: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  function version(): string {
    return JSON.parse(claude(["plugin", "list", "--json"]).stdout).find((p: { id: string }) => p.id === id).version;
  }

  function isEnabled(): boolean {
    return JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).enabledPlugins[id] === true;
  }

  function setVersion(v: string): void {
    writeFileSync(join(market, "packs/demo/.claude-plugin/plugin.json"), JSON.stringify({ name: "demopack", version: v, skills: "./skills/" }));
  }

  let cleanup: () => void;

  afterAll(() => cleanup?.());

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    market = join(home, "market");
    mkdirSync(join(market, ".claude-plugin"), { recursive: true });
    mkdirSync(join(market, "packs/demo/.claude-plugin"), { recursive: true });
    mkdirSync(join(market, "packs/demo/skills/hello"), { recursive: true });
    writeFileSync(join(market, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "probeorg", owner: { name: "probe" }, plugins: [{ name: "demopack", source: "./packs/demo" }] }));
    writeFileSync(join(market, "packs/demo/skills/hello/SKILL.md"), "---\nname: hello\ndescription: probe\n---\nhi\n");
    setVersion("1.0.0");
    claude(["plugin", "marketplace", "add", market]);
  });

  test("install enables the plugin, which is why rt must disable a team pack", () => {
    expect(claude(["plugin", "install", id]).code).toBe(0);
    expect(isEnabled()).toBe(true);
  });

  test("disable then update preserves the disabled state", () => {
    expect(claude(["plugin", "disable", id]).code).toBe(0);
    setVersion("1.1.0");
    expect(claude(["plugin", "update", id, "-y"]).code).toBe(0);
    expect(version()).toBe("1.1.0");
    expect(isEnabled()).toBe(false);
  });

  test("disable on an already-disabled pack exits non-zero saying already disabled", () => {
    const res = claude(["plugin", "disable", id]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/already disabled/i);
  });

  test("uninstall clears the plugin and its enabledPlugins entry", () => {
    expect(claude(["plugin", "uninstall", id]).code).toBe(0);
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.enabledPlugins[id]).toBeUndefined();
  });

  test("update on an uninstalled plugin exits non-zero with wording our absence matcher recognizes", () => {
    const res = claude(["plugin", "update", id, "-y"]);
    expect(res.code).not.toBe(0);
    // The exact wording moved between claude releases ("not found" -> "is not
    // installed"); isNotFound accepts both, so the pattern pins recognition
    // rather than freezing today's exact string.
    expect(res.stderr).toMatch(/not found|not installed/i);
  });

  test("uninstall on an absent pack matches isAlreadyGone's phrasing", () => {
    const res = claude(["plugin", "uninstall", id]);
    expect(res.code).not.toBe(0);
    // isAlreadyGone is the one matcher that reads both streams, so this probe does too.
    expect(`${res.stdout}\n${res.stderr}`).toMatch(/not installed|not found/i);
  });
});

describe.skipIf(!enabled)("claude git-subdir install contract", () => {
  const marketplace = "gitmkt";
  const id = `plug@${marketplace}`;
  let home: string;
  let config: string;
  let repo: string;
  let cleanup: () => void;

  function claude(args: string[], configDir = config): { code: number; output: string } {
    const env = { ...childEnv(), HOME: home, CLAUDE_CONFIG_DIR: configDir } as NodeJS.ProcessEnv;
    try {
      return { code: 0, output: execFileSync("claude", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (err) {
      const e = err as { status: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
    }
  }

  function git(cwd: string, args: string[]): string {
    const env = { ...childEnv(), HOME: home, GIT_CONFIG_GLOBAL: "/dev/null" } as NodeJS.ProcessEnv;
    return execFileSync("git", ["-C", cwd, "-c", "user.name=probe", "-c", "user.email=probe@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  }

  function writePack(version: string, description: string): void {
    writeFileSync(join(repo, "packs/plug/.claude-plugin/plugin.json"), JSON.stringify({ name: "plug", version }));
    writeFileSync(join(repo, "packs/plug/skills/ping/SKILL.md"), `---\nname: ping\ndescription: ${description}\n---\nhi\n`);
  }

  function commitPack(version: string, description: string): void {
    writePack(version, description);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", `pack ${version}`]);
  }

  /** A marketplace folder named `gitmkt` whose one entry is a git-subdir source on `url`. */
  function writeMarketplace(dir: string, url: string): string {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    const source = { source: "git-subdir", url, path: "packs/plug", ref: "data" };
    writeFileSync(join(dir, ".claude-plugin/marketplace.json"), JSON.stringify({ name: marketplace, owner: { name: "probe" }, plugins: [{ name: "plug", source }] }));
    return dir;
  }

  function registered(configDir = config): { version: string; installPath: string }[] {
    const file = join(configDir, "plugins/installed_plugins.json");
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, "utf8")).plugins[id] ?? [];
  }

  function cacheVersions(): string[] {
    const dir = join(config, "plugins/cache", marketplace, "plug");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  function cachedSkill(version: string): string {
    return readFileSync(join(config, "plugins/cache", marketplace, "plug", version, "skills/ping/SKILL.md"), "utf8");
  }

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    config = join(home, "claude-config");
    mkdirSync(config, { recursive: true });
    repo = join(home, "orgrepo");
    mkdirSync(join(repo, "packs/plug/.claude-plugin"), { recursive: true });
    mkdirSync(join(repo, "packs/plug/skills/ping"), { recursive: true });
    git(repo, ["init", "-q", "-b", "data"]);
    commitPack("1.0.0", "first");
  });

  afterAll(() => cleanup?.());

  test("a git-subdir file:// install lands in the cache folder the registry names", () => {
    const folder = writeMarketplace(join(home, "mkt-a"), pathToFileURL(repo).href);
    expect(claude(["plugin", "marketplace", "add", folder]).code).toBe(0);
    expect(claude(["plugin", "install", id]).code).toBe(0);
    const entries = registered();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.version).toBe("1.0.0");
    expect(entries[0]!.installPath).toBe(join(config, "plugins/cache", marketplace, "plug", "1.0.0"));
    expect(cachedSkill("1.0.0")).toContain("description: first");
  });

  test("an uncommitted version bump never lands", () => {
    writePack("1.0.9", "edited, uncommitted");
    try {
      claude(["plugin", "update", id, "-y"]);
      expect(cacheVersions()).toEqual(["1.0.0"]);
      expect(registered()[0]!.version).toBe("1.0.0");
      expect(cachedSkill("1.0.0")).toContain("description: first");
    } finally {
      git(repo, ["checkout", "--", "."]);
    }
  });

  test("a committed version bump lands as a new cache folder", () => {
    commitPack("1.0.1", "second");
    expect(claude(["plugin", "update", id, "-y"]).code).toBe(0);
    expect(cacheVersions()).toContain("1.0.1");
    const entries = registered();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.version).toBe("1.0.1");
    expect(entries[0]!.installPath).toBe(join(config, "plugins/cache", marketplace, "plug", "1.0.1"));
    expect(cachedSkill("1.0.1")).toContain("description: second");
  });

  test("a committed content change at an unchanged version is not picked up by update", () => {
    commitPack("1.0.1", "third, same version");
    claude(["plugin", "update", id, "-y"]);
    expect(cacheVersions()).toEqual(["1.0.0", "1.0.1"]);
    expect(registered()[0]!.version).toBe("1.0.1");
    expect(cachedSkill("1.0.1")).toContain("description: second");
  });

  test("ref reads the local branch, not origin/<ref>", () => {
    const bare = join(home, "origin.git");
    const other = join(home, "other");
    git(home, ["init", "-q", "--bare", bare]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-q", "origin", "data"]);
    git(home, ["clone", "-q", "--branch", "data", bare, other]);
    writeFileSync(join(other, "packs/plug/.claude-plugin/plugin.json"), JSON.stringify({ name: "plug", version: "1.0.2" }));
    git(other, ["commit", "-qam", "ahead on the remote"]);
    git(other, ["push", "-q", "origin", "data"]);
    git(repo, ["fetch", "-q", "origin"]);
    expect(git(repo, ["rev-parse", "origin/data"])).not.toBe(git(repo, ["rev-parse", "data"]));

    expect(claude(["plugin", "update", id, "-y"]).code).toBe(0);
    expect(registered()[0]!.version).toBe("1.0.1");
    expect(cacheVersions()).not.toContain("1.0.2");
  });

  test("a same-name marketplace add from another folder is accepted and keeps installed plugins registered", () => {
    const folder = writeMarketplace(join(home, "mkt-b"), pathToFileURL(repo).href);
    expect(claude(["plugin", "marketplace", "add", folder]).code).toBe(0);
    const known = JSON.parse(readFileSync(join(config, "plugins/known_marketplaces.json"), "utf8"));
    expect(JSON.stringify(known[marketplace].source)).toContain("mkt-b");
    expect(registered().map((e) => e.version)).toEqual(["1.0.1"]);
    expect(claude(["plugin", "list", "--json"]).output).toContain(id);
  });

  test("a relative git-subdir url is refused at install", () => {
    const fresh = join(home, "claude-config-relative");
    mkdirSync(fresh, { recursive: true });
    const folder = writeMarketplace(join(home, "mkt-relative"), ".");
    claude(["plugin", "marketplace", "add", folder], fresh);
    const res = claude(["plugin", "install", id], fresh);
    expect(res.code).not.toBe(0);
    expect(res.output).toMatch(/invalid git url/i);
    expect(registered(fresh)).toEqual([]);
  });
});
