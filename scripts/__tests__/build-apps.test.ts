import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTreeRows, WORKSPACE_BUILD_ARGS } from "../build-apps.ts";

function fakeApp(root: string, name: string, opts: { skills?: boolean; serve?: boolean; codexTarget?: string } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  const homeFile = join(dir, "dist", `${name}.home`);
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name, displayName: name, icon: "icon.svg",
    ...(opts.serve ? { port: 11090, includeInBundle: true } : {}),
    bundle: {
      build: `printf '#!/bin/sh\\necho ${name} 0.0.0\\nprintf %%s "$HOME" > ${homeFile}\\n' > dist/${name} && chmod 755 dist/${name}`,
      artifact: `dist/${name}`,
    },
  }));
  writeFileSync(join(dir, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  if (opts.skills) {
    mkdirSync(join(dir, "skills", "hello"), { recursive: true });
    writeFileSync(join(dir, "skills", "hello", "SKILL.md"), "# hello\n");
  }
  if (opts.codexTarget !== undefined) {
    mkdirSync(join(dir, "skills-targets", "codex", "hello"), { recursive: true });
    writeFileSync(join(dir, "skills-targets", "codex", "hello", "SKILL.md"), opts.codexTarget);
    writeFileSync(join(dir, "skills-targets", "codex", "skills-target.json"), '{"harness":"codex"}\n');
  }
  return dir;
}

describe("build-apps", () => {
  test("lands every tree row like fetch-deps would", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, serve: true });
    fakeApp(apps, "beta");
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "alpha", version: "", license: "MIT", source: "tree", skills: true, archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/alpha", exec: ["Contents/Helpers/alpha"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper", serve: { port: 11090, args: [] } },
      { name: "beta", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/beta", exec: ["Contents/Helpers/beta"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" },
      { name: "jq", version: "1", license: "MIT", url: "https://example.invalid/jq", sha256: "0".repeat(64),
        archive: "raw", extract: "", bundlePath: "Contents/Helpers/jq", exec: ["Contents/Helpers/jq"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper" },
    ] }));
    const deps = join(work, "deps");
    const built = await buildTreeRows({ appsRoot: apps, depsRoot: deps, lockPath: lock, arch: "arm64", log: () => {} });
    expect(built).toEqual(["alpha", "beta"]);
    expect(readFileSync(join(deps, "arm64", "alpha"), "utf8")).toContain("alpha 0.0.0");
    expect(existsSync(join(deps, "arm64", "alpha-identity", "mattstack.deck.json"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "alpha-skills", "hello", "SKILL.md"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "beta-skills"))).toBe(false);
    expect(existsSync(join(deps, "arm64", "jq"))).toBe(false);
    const smokeHome = readFileSync(join(apps, "alpha", "dist", "alpha.home"), "utf8");
    expect(smokeHome).not.toBe(process.env.HOME);
    expect(smokeHome.startsWith(tmpdir())).toBe(true);
  });

  test("refuses an artifact the recipe did not produce", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const dir = fakeApp(apps, "gamma");
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "gamma", bundle: { build: "true", artifact: "dist/gamma" } }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "gamma", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/gamma", exec: ["Contents/Helpers/gamma"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" } ] }));
    await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {} }))
      .rejects.toThrow(/gamma: dist\/gamma missing or not executable/);
  });

  test("calls buildPackages once, before any recipe build runs", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const marker = join(work, "packages-built");
    const dir = join(apps, "delta");
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
      name: "delta",
      bundle: {
        build: `test -f ${marker} && printf '#!/bin/sh\\necho delta 0.0.0\\n' > dist/delta && chmod 755 dist/delta`,
        artifact: "dist/delta",
      },
    }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "delta", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/delta", exec: ["Contents/Helpers/delta"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" },
    ] }));
    let calls = 0;
    const built = await buildTreeRows({
      appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {},
      buildPackages: () => { calls++; writeFileSync(marker, ""); },
    });
    expect(calls).toBe(1);
    expect(built).toEqual(["delta"]);
  });

  function treeLock(work: string, names: string[]): string {
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: names.map((name) => (
      { name, version: "", license: "MIT", source: "tree", skills: true, archive: "raw", extract: "",
        bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" })) }));
    return lock;
  }

  test("stages Codex's own build of an app's skills beside Claude's", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, codexTarget: "# hello for codex\n" });
    fakeApp(apps, "gitq", { skills: true });
    fakeApp(apps, "beta", { skills: true });
    const deps = join(work, "deps");
    const logs: string[] = [];
    await buildTreeRows({ appsRoot: apps, depsRoot: deps, lockPath: treeLock(work, ["alpha", "gitq", "beta"]), arch: "arm64", log: (l) => logs.push(l) });
    expect(readFileSync(join(deps, "arm64", "alpha-skills", "hello", "SKILL.md"), "utf8")).toBe("# hello\n");
    expect(readFileSync(join(deps, "arm64", "alpha-skills-codex", "hello", "SKILL.md"), "utf8")).toBe("# hello for codex\n");
    expect(existsSync(join(deps, "arm64", "alpha-skills-codex", "skills-target.json"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "gitq-skills-codex"))).toBe(false);
    expect(logs).toContain("  . gitq: its skills are withheld from Codex until they carry the questions fragment");
    expect(existsSync(join(deps, "arm64", "beta-skills-codex"))).toBe(false);
    expect(logs).toContain("  . beta: no Codex build of its skills");
  });

  test("refuses a Codex skills tree with no codex marker", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const dir = fakeApp(apps, "alpha", { skills: true, codexTarget: "# hello\n" });
    rmSync(join(dir, "skills-targets", "codex", "skills-target.json"));
    await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: treeLock(work, ["alpha"]), arch: "arm64", log: () => {} }))
      .rejects.toThrow(/alpha: skills-targets\/codex has no codex skills-target.json/);
  });

  test("refuses a Codex skills tree that still names a Claude skill variable", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, codexTarget: "Run ${CLAUDE_SKILL_DIR}/x.sh\n" });
    await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: treeLock(work, ["alpha"]), arch: "arm64", log: () => {} }))
      .rejects.toThrow(/names a Claude skill variable/);
  });

  test("refuses a Codex skills tree that names a tool Codex does not have", async () => {
    for (const tool of ["AskUserQuestion", "SendMessage"]) {
      const work = mkdtempSync(join(tmpdir(), "build-apps-"));
      const apps = join(work, "apps");
      fakeApp(apps, "alpha", { skills: true, codexTarget: `Ask with ${tool}.\n` });
      await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: treeLock(work, ["alpha"]), arch: "arm64", log: () => {} }))
        .rejects.toThrow(`body names ${tool}, which the codex target does not have`);
    }
  });

  test("the workspace build filter excludes glance-react", () => {
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=!@mattstack/glance-react");
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=./packages/*");
  });
});
