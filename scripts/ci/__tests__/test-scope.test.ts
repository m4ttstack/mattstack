import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  alwaysRun,
  alwaysRunPaths,
  CHANGED_ARGS,
  collectSources,
  decide,
  e2eReach,
  existingPluginDirs,
  isPluginTree,
  jobsFor,
  macosOnlyTests,
  pluginDirs,
  prPluginDirs,
  ROOT,
  RT_PLUGIN_TRIGGERS,
  rtTriggeredPluginDirs,
  selectedTests,
  shardCount,
  splitForMacos,
  unitDirs,
  websiteChanged,
  type Decision,
  type ScopeInput,
} from "../test-scope.ts";

// Synthetic unit test sources: one parity test that reads a Swift file and a
// tray shell script by path, and one plain test.
const sources = new Map<string, string>([
  [
    "lib/__tests__/dev-mode.test.ts",
    `const swift = readFileSync(join(ROOT, "rt-tray/Sources-core/Flavor/FlavorLaunch.swift"), "utf8");
     const build = readFileSync(join(ROOT, "rt-tray", "build.sh"), "utf8");`,
  ],
  ["lib/__tests__/plain.test.ts", `expect(add(1, 2)).toBe(3);`],
]);
const preloadImports = new Set(["packages/rt-client/src/test-isolation.ts", "lib/__tests__/home-env.ts"]);

function pr(changed: string[]): ScopeInput {
  return { event: "pull_request", changed, sources, preloadImports };
}

// The real unit sources, for cases that depend on what an actual rt test reads.
const real = collectSources();
function prInput(changed: string[]): ScopeInput {
  return { event: "pull_request", changed, ...real };
}

describe("decide", () => {
  test("a push or a merge-queue run is always full", () => {
    expect(decide({ ...pr(["docs/a.md"]), event: "push" }).mode).toBe("full");
    expect(decide({ ...pr([]), event: "merge_group" }).mode).toBe("full");
  });

  test("an empty diff skips with its own reason", () => {
    const decision = decide(pr([]));
    expect(decision.mode).toBe("skip");
    expect(decision.reason).toBe("no changed files");
  });

  test("docs nothing reads skip", () => {
    expect(decide(pr(["docs/architecture.md", "AGENTS.md"])).mode).toBe("skip");
  });

  test("a PR that only moves agent rules skips the unit shards", () => {
    expect(decide(pr([".claude/rules/output-layer.md", "AGENTS.md"])).mode).toBe("skip");
  });

  test("swift nothing reads skips", () => {
    expect(decide(pr(["rt-tray/Sources-core/Tray/Menu.swift"])).mode).toBe("skip");
  });

  test("a swift file a parity test reads by path runs that test whole, not the suite", () => {
    const decision = decide(pr(["rt-tray/Sources-core/Flavor/FlavorLaunch.swift"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["lib/__tests__/dev-mode.test.ts"]);
    expect(decision.reason).toContain("1 file(s) read by a test");
  });

  test("a tray file a test reads by basename runs its readers whole", () => {
    const decision = decide(pr(["rt-tray/build.sh"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra?.length).toBeGreaterThan(0);
  });

  test("a tray plist nothing names skips", () => {
    expect(decide(pr(["rt-tray/LaunchAgent.plist"])).mode).toBe("skip");
  });

  test("a markdown fixture is full even when nothing names it", () => {
    expect(decide(pr(["lib/__tests__/fixtures/compile-native/pack/notes.md"])).mode).toBe("full");
  });

  test("a markdown file next to a typescript change drops out, so the change runs --changed", () => {
    const decision = decide(pr(["README.md", "lib/x.ts"]));
    expect(decision.mode).toBe("changed");
    expect(decision.reason).toContain("1 file(s) no unit test reads");
  });

  test.each([
    ["AGENTS.md"],
    ["docs/release-and-distribution.md"],
    ["website/docs/apps/board-guide.mdx"],
    ["apps/chat/package.json"],
    ["apps/console/AGENTS.md"],
    ["plugins/mattstack/skills/a/SKILL.md"],
    ["rt-tray/Sources-core/Tray/Menu.swift"],
  ])("%s beside typescript still runs --changed", (f) => {
    expect(decide(prInput([f, "lib/daemon.ts"])).mode).toBe("changed");
  });

  test("a doc a unit test reads beside typescript runs --changed plus that reader", () => {
    const decision = decide(pr(["rt-tray/Sources-core/Flavor/FlavorLaunch.swift", "lib/x.ts"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["lib/__tests__/dev-mode.test.ts"]);
  });

  test("a read file whose reader is not a test runs the tests importing the reader", () => {
    const reading = new Map(sources);
    reading.set("lib/helper.ts", `readFileSync(join(ROOT, "docs/strongdm.md"))`);
    const graph = new Map([["lib/__tests__/a.test.ts", ["lib/helper.ts"]], ["lib/__tests__/b.test.ts", []], ["lib/helper.ts", []]]);
    const tests = ["lib/__tests__/a.test.ts", "lib/__tests__/b.test.ts"];
    const decision = decide({ event: "pull_request", changed: ["docs/strongdm.md"], sources: reading, preloadImports, tests, graph });
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["lib/__tests__/a.test.ts"]);
  });

  test("a source file a test reads as text, without importing it, adds that test to the changed run", () => {
    const decision = decide(prInput(["lib/daemon.ts"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toContain("lib/daemon/__tests__/gate-push.test.ts");
  });

  test("a source file named by a non-test source adds nothing: only a test's own read counts in the shards", () => {
    const reading = new Map(sources);
    reading.set("lib/orphan.ts", `readFileSync(join(ROOT, "lib/daemon.ts"))`);
    const decision = decide({ event: "pull_request", changed: ["lib/daemon.ts"], sources: reading, preloadImports, tests: [], graph: new Map() });
    expect(decision.mode).toBe("changed");
    expect(decision.extra).not.toContain("lib/orphan.ts");
  });

  test("a source file whose basename other files share is matched by path, not name", () => {
    const reading = new Map(sources);
    reading.set("lib/__tests__/names.test.ts", `const where = "setup.ts";`);
    const decision = decide({ event: "pull_request", changed: ["commands/setup.ts"], sources: reading, preloadImports, tracked: real.tracked });
    expect(decision.extra ?? []).not.toContain("lib/__tests__/names.test.ts");
  });

  test("a read file whose reader is not a test runs full when no import graph is at hand", () => {
    const reading = new Map(sources);
    reading.set("lib/helper.ts", `readFileSync(join(ROOT, "docs/strongdm.md"))`);
    const decision = decide({ event: "pull_request", changed: ["docs/strongdm.md"], sources: reading, preloadImports });
    expect(decision.mode).toBe("full");
    expect(decision.reason).toContain("lib/helper.ts");
  });

  test("a read file whose reader no test imports runs full rather than nothing", () => {
    const reading = new Map(sources);
    reading.set("lib/helper.ts", `readFileSync(join(ROOT, "docs/strongdm.md"))`);
    const graph = new Map([["lib/__tests__/b.test.ts", []], ["lib/helper.ts", []]]);
    const decision = decide({ event: "pull_request", changed: ["docs/strongdm.md"], sources: reading, preloadImports, tests: ["lib/__tests__/b.test.ts"], graph });
    expect(decision.mode).toBe("full");
  });

  test("a non-typescript file outside the skip set still forces full in a mixed diff", () => {
    expect(decide(pr(["README.md", "lib/x.ts", "scripts/repo-purity.sh"])).mode).toBe("full");
  });

  test("skills are never docs", () => {
    expect(decide(pr(["skills/rt-chat/notes.md"])).mode).toBe("full");
  });

  test("the stub-rt tree is typescript, not swift", () => {
    expect(decide(pr(["rt-tray/Tests/stub-rt/stub.ts"])).mode).toBe("changed");
  });

  test("the vm helpers tree is typescript, not tray", () => {
    expect(decide(pr(["rt-tray/vm/run/helpers/x.ts"])).mode).toBe("changed");
  });

  test("a preload import is full", () => {
    expect(decide(pr(["packages/rt-client/src/test-isolation.ts"])).mode).toBe("full");
  });

  test("the preload itself and the scope script are full", () => {
    expect(decide(pr(["test-setup.ts"])).mode).toBe("full");
    expect(decide(pr(["scripts/ci/test-scope.ts"])).mode).toBe("full");
  });

  test("a shell script or json anywhere is full", () => {
    expect(decide(pr(["scripts/repo-purity.sh"])).mode).toBe("full");
    expect(decide(pr(["lib/__tests__/example.json", "lib/x.ts"])).mode).toBe("full");
  });

  test("typescript the import graph can see is changed", () => {
    expect(decide(pr(["lib/x.ts", "commands/y.ts"])).mode).toBe("changed");
  });

  test("every decision carries a reason", () => {
    for (const changed of [["docs/a.md"], ["lib/x.ts"], ["rt-tray/build.sh"]]) {
      expect(decide(pr(changed)).reason.length).toBeGreaterThan(0);
    }
  });

  test("an apps-only PR skips the unit shards", () => {
    const d = decide(prInput(["apps/board/src/App.tsx", "packages/ui/src/index.ts", "docs/apps/README.md"]));
    expect(d.mode).toBe("skip");
  });

  test("apps root config read by a unit test still runs", () => {
    // scripts/__tests__/turbo-inputs.test.ts reads turbo.json
    const d = decide(prInput(["turbo.json"]));
    expect(d.mode).not.toBe("skip");
  });

  test("an apps fixture does not force the full suite", () => {
    const d = decide(prInput(["apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json"]));
    expect(d.mode).toBe("skip");
  });

  test("an apps package.json skips too, since //#turbo:test covers it", () => {
    const d = decide(prInput(["apps/board/package.json"]));
    expect(d.mode).toBe("skip");
  });

  test("an apps skills edit skips too, since //#turbo:test runs the skills-tree guard", () => {
    expect(decide(prInput(["apps/gitq/skills/sync/SKILL.md"])).mode).toBe("skip");
  });

  test("a glance source change runs rt's unit suite", () => {
    expect(decide(prInput(["packages/glance/src/index.ts"])).mode).toBe("full");
  });

  test("glance-react and typescript-config are apps trees", () => {
    expect(
      decide(
        prInput(["packages/glance-react/lib/x.tsx", "packages/typescript-config/base.json", "docs/glance/README.md"])
      ).mode
    ).toBe("skip");
  });
});

describe("unitDirs", () => {
  test("parses the directory list from the test script", () => {
    expect(unitDirs({ scripts: { test: "bun test lib commands scripts" } })).toEqual(["lib", "commands", "scripts"]);
  });

  test("refuses a test script that is not a bare bun test run", () => {
    expect(() => unitDirs({ scripts: { test: "vitest run" } })).toThrow(/bare bun test/);
    expect(() => unitDirs({ scripts: { test: "bun test --timeout 20000 lib" } })).toThrow(/bare bun test/);
  });

  test("the real script parses and test:timings, test:watch and test:all delegate to it", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const dirs = unitDirs(pkg);
    // Every dir keeps its "./" prefix: this is what lands in the dirs=
    // GITHUB_OUTPUT line CI runs as `bun test $DIRS`, and a bare name there
    // is a substring filter that sweeps in any path containing it.
    for (const dir of dirs) expect(dir.startsWith("./")).toBe(true);
    expect(dirs).toContain("./lib");
    expect(dirs).toContain("./commands");
    expect(pkg.scripts["test:timings"]).toMatch(/\bbun run test\b/);
    expect(pkg.scripts["test:watch"]).toMatch(/\bbun run test\b/);
    expect(pkg.scripts["test:all"]).toMatch(/\bbun run test\b/);
    const dirsList = dirs.join(" ");
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name === "test") continue;
      expect(script).not.toContain(dirsList);
    }
  });
});

describe("alwaysRun", () => {
  test("resolves every no-* guard across the unit directories and every file exists", () => {
    const files = alwaysRun();
    for (const name of ["no-ui-in-cli", "no-eager-tui", "no-url-pathname", "no-top-level-await", "no-daemon-sync-exec"]) {
      expect(files).toContain(`lib/__tests__/${name}.test.ts`);
    }
    for (const f of [
      "lib/__tests__/no-spawn-without-env.test.ts",
      "lib/__tests__/no-hand-built-repo-paths.test.ts",
      "lib/state/__tests__/no-legacy-state-sources.test.ts",
      "packages/rt-client/test/no-unlisted-command-call-sites.test.ts",
    ]) {
      expect(files).toContain(f);
    }
    for (const f of files) expect(existsSync(join(ROOT, f))).toBe(true);
  });
});

describe("alwaysRunPaths", () => {
  test("every token in the emitted always= line keeps its \"./\" prefix", () => {
    const line = alwaysRunPaths().join(" ");
    const tokens = line.split(" ");
    expect(tokens.length).toBe(alwaysRun().length);
    for (const token of tokens) expect(token.startsWith("./")).toBe(true);
  });
});

describe("CHANGED_ARGS", () => {
  test("the diff lists both paths of a rename", () => {
    expect(CHANGED_ARGS).toContain("--no-renames");
  });
});

describe("collectSources", () => {
  test("reaches the preload's imports and the tray parity reads, and leaves itself out", () => {
    const { sources, preloadImports } = collectSources();
    expect(preloadImports.has("packages/rt-client/src/test-isolation.ts")).toBe(true);
    expect(preloadImports.has("lib/__tests__/home-env.ts")).toBe(true);
    expect(sources.get("lib/__tests__/dev-mode.test.ts")).toContain("FlavorLaunch.swift");
    expect(sources.has("scripts/ci/__tests__/test-scope.test.ts")).toBe(false);
    expect(sources.has("commands/worktree.ts")).toBe(true);
  });
});

describe("plugins", () => {
  test("a plugins-only diff skips the shards and names the plugin", () => {
    const changed = ["plugins/mattstack/skills/a/SKILL.md", "plugins/mattstack/tests/certify.sh"];
    expect(decide(pr(changed)).mode).toBe("skip");
    expect(pluginDirs(changed)).toEqual(["plugins/mattstack"]);
  });
  test("a plugins-only diff that an rt test reads by repo path runs that test whole", () => {
    const reading = new Map(sources);
    reading.set(
      "lib/__tests__/plugin-parity.test.ts",
      `const manifest = readFileSync(join(ROOT, "plugins/herdr-chat/plugin.json"), "utf8");`,
    );
    const decision = decide({ event: "pull_request", changed: ["plugins/herdr-chat/plugin.json"], sources: reading, preloadImports });
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["lib/__tests__/plugin-parity.test.ts"]);
  });
  test("a plugin file matches by repo path only, never by a shared basename", () => {
    const reading = new Map(sources);
    reading.set("lib/__tests__/skill-shape.test.ts", `const skill = readFileSync(join(dir, "SKILL.md"), "utf8");`);
    const changed = ["plugins/herdr-chat/skills/chat/SKILL.md"];
    expect(decide({ event: "pull_request", changed, sources: reading, preloadImports }).mode).toBe("skip");
  });
  test("a plugin change beside rt code runs --changed and still names the plugin", () => {
    const changed = ["plugins/herdr-chat/src/lib.rs", "lib/foo.ts"];
    expect(decide(pr(changed)).mode).toBe("changed");
    expect(pluginDirs(changed)).toEqual(["plugins/herdr-chat"]);
  });
  test("isPluginTree needs a plugin name segment", () => {
    expect(isPluginTree("plugins/herdr-chat/Cargo.toml")).toBe(true);
    expect(isPluginTree("plugins/README.md")).toBe(false);
    expect(isPluginTree("lib/plugins/x.ts")).toBe(false);
  });
  test("existingPluginDirs lists every plugin directory, sorted, and nothing when the folder is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "test-scope-plugins-"));
    try {
      expect(existingPluginDirs(root)).toEqual([]);
      mkdirSync(join(root, "plugins", "zeta"), { recursive: true });
      mkdirSync(join(root, "plugins", "herdr-chat"), { recursive: true });
      writeFileSync(join(root, "plugins", "README.md"), "");
      expect(existingPluginDirs(root)).toEqual(["plugins/herdr-chat", "plugins/zeta"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("rt changes that affect a plugin", () => {
  function withPlugin<T>(name: string | null, fn: (root: string) => T): T {
    const root = mkdtempSync(join(tmpdir(), "test-scope-triggers-"));
    try {
      if (name) mkdirSync(join(root, "plugins", name), { recursive: true });
      return fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  test("every trigger names a plugins/<name> directory", () => {
    for (const dir of Object.values(RT_PLUGIN_TRIGGERS)) expect(dir).toMatch(/^plugins\/[^/]+$/);
  });
  test.each([
    "lib/mcp/tools.ts",
    "commands/mcp.ts",
    "lib/skills/compile.ts",
    "commands/skills-sync.ts",
    "commands/skills.ts",
    "lib/command-tree-def.ts",
    "lib/command-tree-resolve.ts",
    "lib/command-tree.ts",
    "cli.ts",
  ])("%s runs plugin-mattstack when the plugin exists", (f) => {
    withPlugin("mattstack", (root) => expect(rtTriggeredPluginDirs([f], root)).toEqual(["plugins/mattstack"]));
  });
  test("an unrelated rt change triggers no plugin", () => {
    withPlugin("mattstack", (root) =>
      expect(rtTriggeredPluginDirs(["lib/foo.ts", "commands/worktree.ts", "lib/mcpish.ts", "docs/cli.ts.md"], root)).toEqual([]),
    );
  });
  test("a trigger for a plugin directory that does not exist is dropped", () => {
    withPlugin(null, (root) => expect(rtTriggeredPluginDirs(["lib/mcp/tools.ts"], root)).toEqual([]));
  });
  test.each([".github/workflows/checks.yml", "scripts/ci/test-scope.ts"])("%s runs every plugin job", (f) => {
    const root = mkdtempSync(join(tmpdir(), "test-scope-all-plugins-"));
    try {
      mkdirSync(join(root, "plugins", "mattstack"), { recursive: true });
      mkdirSync(join(root, "plugins", "herdr-chat"), { recursive: true });
      expect(prPluginDirs([f], root)).toEqual(["plugins/herdr-chat", "plugins/mattstack"]);
      expect(prPluginDirs(["lib/foo.ts"], root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("a PR's plugin set lists a plugin touched directly and by an rt path once", () => {
    withPlugin("mattstack", (root) =>
      expect(prPluginDirs(["plugins/mattstack/README.md", "lib/mcp/tools.ts", "plugins/herdr-chat/x.ts"], root)).toEqual([
        "plugins/herdr-chat",
        "plugins/mattstack",
      ]),
    );
  });
});

describe("websiteChanged", () => {
  test("site, generator and command tree changes build the site", () => {
    expect(websiteChanged(["website/docs/rt/index.mdx"])).toBe(true);
    expect(websiteChanged(["scripts/gen-docs.ts"])).toBe(true);
    expect(websiteChanged(["scripts/lib/docs-render.ts"])).toBe(true);
    expect(websiteChanged(["scripts/gen-rt-cool-redirects.ts"])).toBe(true);
    expect(websiteChanged(["scripts/check-rt-cool-redirects.ts"])).toBe(true);
    expect(websiteChanged(["lib/command-tree-def.ts"])).toBe(true);
    expect(websiteChanged([".github/workflows/checks.yml"])).toBe(true);
  });
  test("unrelated changes skip it", () => {
    expect(websiteChanged(["lib/daemon.ts", "apps/board/src/a.ts", "README.md"])).toBe(false);
  });
});

describe("workflow wiring", () => {
  type Step = { name?: string; run?: string };
  type Job = { needs?: string | string[]; if?: string; outputs?: Record<string, string>; "runs-on"?: string; steps?: Step[] };
  function jobs(file: string): Record<string, Job> {
    return (Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as { jobs: Record<string, Job> }).jobs;
  }
  function needs(job: Job): string[] {
    return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
  }
  const jobKeys = Object.keys(jobsFor("push", []));

  test.each([
    ["checks.yml", "checks"],
    ["e2e.yml", "e2e"],
  ])("the %s gate needs every job but itself, except the advisory pty gate", (file, gate) => {
    const all = jobs(file);
    const expected = Object.keys(all).filter((name) => name !== gate && name !== "glitter-pty");
    expect(needs(all[gate]!).sort()).toEqual(expected.sort());
    expect(all[gate]!.if).toBe("always()");
  });

  function runs(job: Job): string {
    return (job.steps ?? []).map((step) => step.run ?? "").join("\n");
  }

  describe.each([
    ["checks.yml", "unit"],
    ["timings.yml", "timings"],
  ])("%s %s", (file, name) => {
    test("runs on ubuntu and leaves out every test on the macOS list", () => {
      const job = jobs(file)[name]!;
      expect(job["runs-on"]).toBe("ubuntu-latest");
      expect(runs(job)).toContain("sed 's/^/--path-ignore-patterns=/' scripts/ci/macos-only-tests.txt");
    });

    test("sets its git identity at system scope: the preload moves HOME, so a global one never reaches a test", () => {
      expect(runs(jobs(file)[name]!)).toContain("git config --system user.name");
    });
  });

  test("unit-macos runs on macOS, only when scope names tests", () => {
    const job = jobs("checks.yml")["unit-macos"]!;
    expect(job["runs-on"]).toBe("macos-latest");
    expect(job.if).toBe("needs.scope.outputs.macos != ''");
    expect(runs(job)).toContain("$TESTS");
  });

  describe("the checks gate on unit-macos", () => {
    const passing = { SCOPE: "success", STATIC: "success", GO: "success", DECK: "success", UNIT: "success", UNIT_MACOS: "success", GUARDS: "success", HERDR_CHAT: "success", MATTSTACK: "success", WEBSITE: "success", MODE: "full", RUN_GO: "true", RUN_DECK: "true", RUN_MACOS: "./a.test.ts" };
    function gate(env: Record<string, string>): number {
      const script = jobs("checks.yml").checks!.steps!.find((step) => step.name === "Every gate passed")!.run!;
      return Bun.spawnSync(["bash", "-c", script], { env: { PATH: process.env.PATH ?? "", ...passing, ...env }, stdout: "pipe", stderr: "pipe" }).exitCode;
    }

    test("a pass passes", () => {
      expect(gate({})).toBe(0);
    });
    test("a skip passes when scope named no tests", () => {
      expect(gate({ UNIT_MACOS: "skipped", RUN_MACOS: "" })).toBe(0);
    });
    test("a skip fails when scope named tests", () => {
      expect(gate({ UNIT_MACOS: "skipped" })).toBe(1);
    });
    test.each(["failure", "cancelled"])("a %s fails", (result) => {
      expect(gate({ UNIT_MACOS: result })).toBe(1);
    });
  });

  test.each(["checks.yml", "e2e.yml"])("every scope output %s reads is one the script writes", (file) => {
    const scope = Object.values(jobs(file)).find((job) => job.outputs)!;
    const written = new Set(["mode", "shards", "extra", "dirs", "always", "plugins", "macos", ...jobKeys]);
    for (const name of Object.keys(scope.outputs!)) expect(written.has(name)).toBe(true);
  });
});

describe("shard sizing", () => {
  const timings = { "a.test.ts": 60_000, "b.test.ts": 60_000, "c.test.ts": 60_000, "d.test.ts": 60_000, "e.test.ts": 60_000, "f.test.ts": 60_000 };

  test("full and skip runs take three shards", () => {
    expect(shardCount("full", [], timings)).toBe(3);
    expect(shardCount("skip", [], timings)).toBe(3);
  });

  test("a changed run takes as many shards as its tests weigh, one to three", () => {
    expect(shardCount("changed", [], timings)).toBe(1);
    expect(shardCount("changed", ["a.test.ts", "b.test.ts"], timings)).toBe(1);
    expect(shardCount("changed", ["a.test.ts", "b.test.ts", "c.test.ts"], timings)).toBe(2);
    expect(shardCount("changed", Object.keys(timings), timings)).toBe(3);
  });

  test("a test with no recorded timing counts a second", () => {
    const one = { "a.test.ts": 3000 };
    expect(shardCount("changed", ["new.test.ts"], one)).toBe(1);
    expect(shardCount("changed", ["new.test.ts", "a.test.ts"], one)).toBe(3);
  });

  test("no timings file keeps three shards", () => {
    expect(shardCount("changed", ["a.test.ts"], {})).toBe(3);
  });
});

describe("the macOS-only list", () => {
  const list = macosOnlyTests();

  test("every entry is a unit test that exists, so the list cannot go stale", () => {
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) expect(real.tests).toContain(f);
  });

  test("entries are bare paths: a ./ pattern ignores nothing, and ubuntu would run the Mac test", () => {
    for (const f of list) expect(f).not.toStartWith("./");
  });

  test("entries are sorted with no repeats", () => {
    expect(list).toEqual([...new Set(list)].sort());
  });

  test("a blank line is no entry", () => {
    const root = mkdtempSync(join(tmpdir(), "test-scope-macos-list-"));
    try {
      const file = join(root, "list.txt");
      writeFileSync(file, "b.test.ts\n\na.test.ts\n");
      expect(macosOnlyTests(file)).toEqual(["b.test.ts", "a.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("splitForMacos", () => {
  const list = ["lib/__tests__/mac-a.test.ts", "scripts/__tests__/mac-b.test.ts"];
  const plain = "lib/__tests__/plain.test.ts";
  const decision = (mode: Decision["mode"], extra?: string[]): Decision => ({ mode, reason: "r", extra });

  test("a full run takes the whole list", () => {
    expect(splitForMacos(decision("full"), [], [], list).macos).toEqual(list);
  });

  test("a skip takes nothing", () => {
    expect(splitForMacos(decision("skip"), [], [], list).macos).toEqual([]);
  });

  test("a changed run takes only the listed tests the diff reaches", () => {
    const split = splitForMacos(decision("changed"), ["lib/mac-a.ts"], [list[0]!, plain], list);
    expect(split.macos).toEqual([list[0]!]);
  });

  test("a changed run that reaches no listed test takes nothing", () => {
    expect(splitForMacos(decision("changed"), ["lib/x.ts"], [plain], list).macos).toEqual([]);
  });

  test("a listed extra runs on macOS and leaves the ubuntu extra", () => {
    const split = splitForMacos(decision("changed", [list[1]!, plain]), ["rt-tray/x.sh"], [list[1]!, plain], list);
    expect(split.macos).toEqual([list[1]!]);
    expect(split.extra).toEqual([plain]);
  });

  test("shard sizing leaves listed tests out, since ubuntu does not run them", () => {
    const split = splitForMacos(decision("changed"), ["lib/mac-a.ts"], [list[0]!, plain], list);
    expect(split.ubuntu).toEqual([plain]);
  });

  test("a workspace package change takes the whole list, since the import walk cannot follow a bare import", () => {
    expect(splitForMacos(decision("changed"), ["packages/rt-client/src/index.ts"], [plain], list).macos).toEqual(list);
    expect(splitForMacos(decision("changed"), ["packages/git-core/src/diff.ts"], [], list).macos).toEqual(list);
  });

  test("a doc in a workspace package changes no test", () => {
    expect(splitForMacos(decision("changed"), ["packages/rt-client/README.md"], [plain], list).macos).toEqual([]);
  });

  test("the real graph reaches a listed test from the module it imports", () => {
    const selected = selectedTests(["lib/worktree/clonefile.ts"], real.tests, real.graph);
    expect(splitForMacos(decision("changed"), ["lib/worktree/clonefile.ts"], selected, macosOnlyTests()).macos).toContain("lib/worktree/__tests__/clonefile.test.ts");
  });

  test("the live tree: a shell script a listed test reads comes through as an extra", () => {
    const changed = ["rt-tray/scripts/render-launchagents.sh"];
    const d = decide(prInput(changed));
    expect(splitForMacos(d, changed, d.extra ?? [], macosOnlyTests()).macos).toEqual(["scripts/__tests__/render-launchagents.test.ts"]);
  });
});

describe("the scope script's output", () => {
  test("a merge queue run writes the whole list to macos=, ./ prefixed for bun test", () => {
    const root = mkdtempSync(join(tmpdir(), "test-scope-output-"));
    try {
      const file = join(root, "out");
      const run = Bun.spawnSync(["bun", join(ROOT, "scripts/ci/test-scope.ts")], {
        cwd: ROOT,
        env: { ...process.env, EVENT_NAME: "merge_group", GITHUB_OUTPUT: file },
      });
      expect(run.exitCode).toBe(0);
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("macos="));
      expect(line).toBe(`macos=${macosOnlyTests().map((f) => `./${f}`).join(" ")}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("selectedTests", () => {
  const graph = new Map([
    ["lib/__tests__/a.test.ts", ["lib/a.ts"]],
    ["lib/__tests__/b.test.ts", ["lib/b.ts"]],
    ["lib/a.ts", ["lib/shared.ts"]],
    ["lib/b.ts", []],
    ["lib/shared.ts", []],
  ]);
  const tests = ["lib/__tests__/a.test.ts", "lib/__tests__/b.test.ts"];

  test("selects the tests whose import closure reaches a changed file", () => {
    expect(selectedTests(["lib/shared.ts"], tests, graph)).toEqual(["lib/__tests__/a.test.ts"]);
    expect(selectedTests(["lib/b.ts", "README.md"], tests, graph)).toEqual(["lib/__tests__/b.test.ts"]);
  });

  test("a changed test selects itself", () => {
    expect(selectedTests(["lib/__tests__/b.test.ts"], tests, graph)).toEqual(["lib/__tests__/b.test.ts"]);
  });

  test("the real graph sizes a one-module change to one shard", () => {
    const sel = selectedTests(["lib/team/share-pack.ts"], real.tests, real.graph);
    expect(sel).toContain("lib/team/__tests__/share-pack.test.ts");
    const timings = JSON.parse(readFileSync(join(ROOT, "test-timings.json"), "utf8")).files;
    expect(shardCount("changed", sel, timings)).toBe(1);
  });
});

describe("e2e reach", () => {
  const reach = e2eReach();

  test("reaches the commands the module registry imports, and e2e's own imports", () => {
    expect(reach.has("cli.ts")).toBe(true);
    expect(reach.has("commands/worktree.ts")).toBe(true);
    expect(reach.has("lib/state/index.ts")).toBe(true);
    expect(reach.has("lib/herdr/__tests__/fake-herdr.ts")).toBe(true);
  });

  test("a unit-test-only or script-only PR skips e2e", () => {
    expect(jobsFor("pull_request", ["lib/team/__tests__/share-pack.test.ts"], reach).e2e).toBe(false);
    expect(jobsFor("pull_request", ["scripts/ci/plugin-version-bumped.ts"], reach).e2e).toBe(false);
  });

  test("rt source the binary reaches runs e2e", () => {
    expect(jobsFor("pull_request", ["lib/team/share-pack.ts"], reach).e2e).toBe(true);
  });

  test("a deleted rt module runs e2e, since a stale importer may still need it", () => {
    expect(jobsFor("pull_request", ["lib/gone-module.ts"], reach).e2e).toBe(true);
  });

  test("workspace packages and the scope script run e2e whatever the reach", () => {
    expect(jobsFor("pull_request", ["packages/rt-client/src/index.ts"], new Set()).e2e).toBe(true);
    expect(jobsFor("pull_request", ["scripts/ci/test-scope.ts"], new Set()).e2e).toBe(true);
  });
});

describe("the docs site and prose", () => {
  test("a website-only PR skips the unit shards, even a page a test names as data", () => {
    // scripts/__tests__/docs-impact.test.ts names website/docs/apps/board.mdx as an input.
    const changed = ["website/docs/apps/board.mdx", "website/docs/apps/flock-guide.mdx", "website/sidebars.ts", "website/package.json"];
    expect(decide(prInput(changed)).mode).toBe("skip");
  });
  test("mdx is docs", () => {
    expect(decide(pr(["docs/guide.mdx"])).mode).toBe("skip");
  });
  test("website beside rt code runs --changed", () => {
    expect(decide(pr(["website/docs/rt/index.mdx", "lib/x.ts"])).mode).toBe("changed");
  });
});

describe("files the shards never run, beside typescript", () => {
  test("a snapshot runs its own test as an extra, not the full suite", () => {
    const decision = decide(prInput(["commands/__tests__/__snapshots__/setup-copy.test.ts.snap", "commands/setup.ts"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toContain("commands/__tests__/setup-copy.test.ts");
    // Tests that name commands/setup.ts only as "setup.ts" are not readers of it.
    expect(decision.extra?.length).toBeLessThan(4);
  });

  test("a snapshot alone is a changed run of its test", () => {
    const decision = decide(prInput(["commands/__tests__/__snapshots__/dev.test.ts.snap"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["commands/__tests__/dev.test.ts"]);
  });

  test("a snapshot whose test is gone is full", () => {
    expect(decide(prInput(["commands/__tests__/__snapshots__/gone.test.ts.snap"])).mode).toBe("full");
  });

  test.each([
    "e2e/tests/fixtures/sdm-json.json",
    "e2e/tests/smoke.test.ts",
    ".gitignore",
    "rt-tray/vm/README.md",
  ])("%s drops out", (f) => {
    expect(decide(prInput([f, "lib/daemon.ts"])).mode).toBe("changed");
  });

  test.each(["rt-tray/build.sh", "rt-tray/sparkle-minimum-update"])("%s, which a unit test reads, adds that test to the changed run", (f) => {
    const decision = decide(prInput([f, "lib/daemon.ts"]));
    expect(decision.mode).toBe("changed");
    expect(decision.extra?.length).toBeGreaterThan(0);
  });

  test("an e2e file a unit test imports stays in the --changed set", () => {
    const reading = new Map(sources);
    reading.set("e2e/socket-path.ts", "export const x = 1;");
    expect(decide({ event: "pull_request", changed: ["e2e/socket-path.ts"], sources: reading, preloadImports }).mode).toBe("changed");
  });

  test("lockfiles and manifests a test reads stay full", () => {
    expect(decide(prInput(["bun.lock", "lib/daemon.ts"])).mode).toBe("full");
    expect(decide(prInput(["marketplace/marketplace.json"])).mode).toBe("full");
  });
});

describe("what counts as a test reading a file", () => {
  function reads(text: string, changed: string[]) {
    const reading = new Map(sources);
    reading.set("lib/__tests__/reader.test.ts", text);
    return decide({ event: "pull_request", changed, sources: reading, preloadImports }).mode;
  }

  test("a quoted path segment, a joined segment or a template tail counts", () => {
    expect(reads(`readFileSync(join(ROOT, "AGENTS.md"))`, ["AGENTS.md"])).toBe("changed");
    expect(reads(`readFileSync(\`\${ROOT}/AGENTS.md\`)`, ["AGENTS.md"])).toBe("changed");
    expect(reads(`readFileSync(join(ROOT, "docs", "strongdm.md"))`, ["docs/strongdm.md"])).toBe("changed");
  });

  test("prose that mentions the file, or a longer path ending in its name, does not", () => {
    expect(reads(`// Named no-* per AGENTS.md`, ["AGENTS.md"])).toBe("skip");
    expect(reads(`spawn({ prompt: "read AGENTS.md" })`, ["AGENTS.md"])).toBe("skip");
    expect(reads(`docsImpact(["apps/AGENTS.md"])`, ["AGENTS.md"])).toBe("skip");
  });

  test("a full path behind a ../ prefix counts", () => {
    expect(reads(`readFileSync(join(import.meta.dir, "../../plugins/x/ref.md"))`, ["plugins/x/ref.md"])).toBe("changed");
    expect(reads(`readFileSync(join(dir, "../../../rt-tray/Sources-core/A.swift"))`, ["rt-tray/Sources-core/A.swift"])).toBe("changed");
  });

  test("a full path spelled as join() segments counts, an apps file included", () => {
    expect(reads(`join(import.meta.dir, "..", "apps", "board", "switchboard", "server.ts")`, ["apps/board/switchboard/server.ts"])).toBe("changed");
    expect(reads(`join(ROOT, ".github", "workflows", "release.yml")`, [".github/workflows/release.yml"])).toBe("changed");
  });

  test("an apps file's bare basename does not count", () => {
    expect(reads(`join(dir, "server.ts")`, ["apps/board/switchboard/server.ts"])).toBe("skip");
  });

  test("the live tree: files read through ../ and join() run their readers", () => {
    for (const f of [
      "plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md",
      "rt-tray/Sources-core/Services/DevBuild.swift",
      ".github/workflows/release.yml",
      "apps/board/src/slack.ts",
      "apps/board/switchboard/server.ts",
    ]) {
      const decision = decide(prInput([f]));
      expect(decision.mode).toBe("changed");
      expect(decision.extra?.length).toBeGreaterThan(0);
    }
  });

  test("e2e.yml runs full, since the scope test pins its gate", () => {
    expect(decide(pr([".github/workflows/e2e.yml"])).mode).toBe("full");
  });

  test("a file a unit test imports never drops out, whatever its tree", () => {
    const reading = new Map(sources);
    reading.set("scripts/set-platform-version.ts", "export {}");
    expect(decide({ event: "pull_request", changed: ["scripts/set-platform-version.ts"], sources: reading, preloadImports }).mode).toBe(
      "changed",
    );
  });

  test("a no-* guard reading the file does not force full: the guards job runs it", () => {
    const reading = new Map(sources);
    reading.set("lib/__tests__/no-doc-drift.test.ts", `readFileSync(join(ROOT, "AGENTS.md"))`);
    expect(decide({ event: "pull_request", changed: ["AGENTS.md"], sources: reading, preloadImports }).mode).toBe("skip");
  });
});

describe("workflow files", () => {
  test("a workflow nothing reads skips the unit shards", () => {
    expect(decide(prInput([".github/workflows/renovate.yml"])).mode).toBe("skip");
  });
  test("checks.yml runs the shards in full, since it defines them", () => {
    const decision = decide(pr([".github/workflows/checks.yml"]));
    expect(decision.mode).toBe("full");
    expect(decision.reason).toContain("checks.yml");
  });
  test("a workflow a unit test reads by repo path runs that test whole", () => {
    const reading = new Map(sources);
    reading.set("scripts/__tests__/renovate.test.ts", `readFileSync(join(ROOT, ".github/workflows/renovate.yml"))`);
    const changed = [".github/workflows/renovate.yml"];
    const decision = decide({ event: "pull_request", changed, sources: reading, preloadImports });
    expect(decision.mode).toBe("changed");
    expect(decision.extra).toEqual(["scripts/__tests__/renovate.test.ts"]);
  });
});

describe("jobsFor", () => {
  const none = { go: false, deck: false, e2e: false, glitter: false, website: false };
  const every = { go: true, deck: true, e2e: true, glitter: true, website: true };

  test("a push to main or a merge-queue run runs every job", () => {
    expect(jobsFor("push", [])).toEqual(every);
    expect(jobsFor("push", ["docs/a.md"])).toEqual(every);
    expect(jobsFor("merge_group", [])).toEqual(every);
  });

  test("a website-only PR builds the site and nothing else", () => {
    expect(jobsFor("pull_request", ["website/docs/apps/board.mdx", "website/sidebars.ts", "website/package.json"])).toEqual({
      ...none,
      website: true,
    });
  });

  test("a docs-only PR runs none of them", () => {
    expect(jobsFor("pull_request", ["docs/architecture.md", "AGENTS.md", "docs/guide.mdx"])).toEqual(none);
  });

  test.each([
    ["swift", ["rt-tray/Sources-core/Tray/Menu.swift"]],
    ["a plugin", ["plugins/herdr-chat/src/lib.rs"]],
    ["another workflow", [".github/workflows/renovate.yml"]],
    ["another app", ["apps/board/src/App.tsx"]],
  ])("%s runs none of them", (_, changed) => {
    expect(jobsFor("pull_request", changed)).toEqual(none);
  });

  test("rt source runs e2e only", () => {
    expect(jobsFor("pull_request", ["lib/daemon.ts", "commands/worktree.ts"])).toEqual({ ...none, e2e: true });
  });

  test("rt's ui layer also runs the pty gate", () => {
    expect(jobsFor("pull_request", ["lib/ui/out.ts"])).toEqual({ ...none, e2e: true, glitter: true });
  });

  test("Go source runs go and the pty gate, not e2e", () => {
    expect(jobsFor("pull_request", ["ui/internal/views/picker/scroll.go", "ui/go.sum"])).toEqual({
      ...none,
      go: true,
      glitter: true,
    });
  });

  test("a ui fixture both languages read runs go and e2e", () => {
    const jobs = jobsFor("pull_request", ["ui/fixtures/clean-cases.json"]);
    expect(jobs.go).toBe(true);
    expect(jobs.e2e).toBe(true);
  });

  test("deck's own tree runs deck only", () => {
    expect(jobsFor("pull_request", ["apps/deck/src/registry/bundle-catalog.ts"])).toEqual({ ...none, deck: true });
  });

  test("an apps package runs deck, which turbo narrows further", () => {
    expect(jobsFor("pull_request", ["packages/ui/src/index.ts"])).toEqual({ ...none, deck: true });
  });

  test("a workspace package rt links runs deck and e2e", () => {
    expect(jobsFor("pull_request", ["packages/rt-client/src/index.ts"])).toEqual({ ...none, deck: true, e2e: true });
  });

  test("an apps package manifest runs e2e, since a dependency bump can change the binary", () => {
    expect(jobsFor("pull_request", ["packages/ui/package.json"]).e2e).toBe(true);
  });

  test("root manifests run deck and e2e, and package.json also go and the pty gate", () => {
    expect(jobsFor("pull_request", ["package.json"])).toEqual({ ...every, website: false });
    expect(jobsFor("pull_request", ["bun.lock"])).toEqual({ ...none, deck: true, e2e: true });
  });

  test("checks.yml runs every checks job", () => {
    expect(jobsFor("pull_request", [".github/workflows/checks.yml"])).toEqual({ ...none, go: true, deck: true, website: true });
  });

  test("e2e.yml runs both e2e jobs", () => {
    expect(jobsFor("pull_request", [".github/workflows/e2e.yml"])).toEqual({ ...none, e2e: true, glitter: true });
  });

  test("the scope script runs every job", () => {
    expect(jobsFor("pull_request", ["scripts/ci/test-scope.ts"])).toEqual(every);
  });

  test.each([
    "cli.ts",
    "commands/glitter.ts",
    "commands/settings-schema.ts",
    "lib/mission/state.ts",
    "packages/git-core/src/diff.ts",
    "e2e/pty/glitter.test.ts",
    "e2e/socket-path.ts",
    "test-setup.ts",
    "lib/command-tree.ts",
  ])("%s runs the pty gate", (f) => {
    expect(jobsFor("pull_request", [f]).glitter).toBe(true);
  });

  test.each(["lib/daemon.ts", "e2e/tests/smoke.test.ts", "commands/worktree.ts", "lib/command-tree-def.ts"])(
    "%s leaves the pty gate alone",
    (f) => {
      expect(jobsFor("pull_request", [f]).glitter).toBe(false);
    },
  );
});
