import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BUNFIG_GUARD, buildTreeRows, launcherArgs, type LauncherSpec, WORKSPACE_BUILD_ARGS } from "../build-apps.ts";

/** The recipe writes dist/app/main.js, which records the HOME it ran under
    and answers --version. */
function fakeApp(root: string, name: string, opts: { skills?: boolean; serve?: boolean; dotenv?: boolean } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  const homeFile = join(dir, "dist", `${name}.home`);
  const main = `require("fs").writeFileSync(${JSON.stringify(homeFile)}, process.env.HOME ?? ""); console.log("${name} 0.0.0");`;
  writeFileSync(join(dir, "main.src.js"), main);
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name, displayName: name, icon: "icon.svg",
    ...(opts.serve ? { port: 11090, includeInBundle: true } : {}),
    bundle: {
      build: "mkdir -p dist/app && cp main.src.js dist/app/main.js && echo asset > dist/app/logo-abc.svg",
      artifact: "dist/app",
      ...(opts.dotenv === undefined ? {} : { dotenv: opts.dotenv }),
    },
  }));
  writeFileSync(join(dir, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  if (opts.skills) {
    mkdirSync(join(dir, "skills", "hello"), { recursive: true });
    writeFileSync(join(dir, "skills", "hello", "SKILL.md"), "# hello\n");
  }
  return dir;
}

/** A sh stand-in for the C launcher with the same lookup: bun and the
    bundle beside its own path. */
function shellLauncher(specs: LauncherSpec[]) {
  return (spec: LauncherSpec) => {
    specs.push(spec);
    writeFileSync(spec.out, `#!/bin/sh\nd=$(cd "$(dirname "$0")" && pwd)\nexec "$d/bun" "$d/${spec.name}-app/main.js" "$@"\n`);
  };
}

function treeRow(name: string, extra: Record<string, unknown> = {}) {
  return { name, version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
    bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`], exposeByDefault: false,
    entitlements: "none", status: "bundled", kind: "helper", ...extra };
}

describe("build-apps", () => {
  test("lands each tree row as a launcher beside its bundle, like fetch-deps would", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, serve: true });
    fakeApp(apps, "beta", { dotenv: false });
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      treeRow("alpha", { skills: true, serve: { port: 11090, args: [] } }),
      treeRow("beta"),
      { name: "jq", version: "1", license: "MIT", url: "https://example.invalid/jq", sha256: "0".repeat(64),
        archive: "raw", extract: "", bundlePath: "Contents/Helpers/jq", exec: ["Contents/Helpers/jq"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper" },
    ] }));
    const deps = join(work, "deps");
    const specs: LauncherSpec[] = [];
    const built = await buildTreeRows({
      appsRoot: apps, depsRoot: deps, lockPath: lock, arch: "arm64", log: () => {},
      compileLauncher: shellLauncher(specs),
    });
    expect(built).toEqual(["alpha", "beta"]);
    expect(specs.map(({ name, dotenv, arch }) => ({ name, dotenv, arch }))).toEqual([
      { name: "alpha", dotenv: true, arch: "arm64" },
      { name: "beta", dotenv: false, arch: "arm64" },
    ]);
    expect(specs[0]!.out).toBe(join(deps, "arm64", "alpha"));
    expect(readFileSync(join(deps, "arm64", "alpha-app", "main.js"), "utf8")).toContain("alpha 0.0.0");
    expect(existsSync(join(deps, "arm64", "alpha-app", "logo-abc.svg"))).toBe(true);
    expect(readFileSync(join(deps, "arm64", "alpha-app", "bunfig.toml"), "utf8")).toBe(BUNFIG_GUARD);
    expect(existsSync(join(deps, "arm64", "alpha-identity", "mattstack.deck.json"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "alpha-skills", "hello", "SKILL.md"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "beta-skills"))).toBe(false);
    expect(existsSync(join(deps, "arm64", "jq"))).toBe(false);
    const smokeHome = readFileSync(join(apps, "alpha", "dist", "alpha.home"), "utf8");
    expect(smokeHome).not.toBe(process.env.HOME);
    expect(smokeHome.startsWith(tmpdir())).toBe(true);
  });

  test("an x86_64 pass compiles an Intel launcher and lands in deps/x86_64", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "epsilon");
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [treeRow("epsilon")] }));
    const deps = join(work, "deps");
    const specs: LauncherSpec[] = [];
    const smoked: string[] = [];
    await buildTreeRows({
      appsRoot: apps, depsRoot: deps, lockPath: lock, arch: "x86_64", log: () => {},
      compileLauncher: shellLauncher(specs),
      smoke: (launcher) => {
        smoked.push(launcher);
        expect(existsSync(join(launcher, "..", "bun"))).toBe(true);
        expect(existsSync(join(launcher, "..", "epsilon-app", "main.js"))).toBe(true);
        return 0;
      },
    });
    expect(specs[0]!.arch).toBe("x86_64");
    expect(existsSync(join(deps, "x86_64", "epsilon-app", "main.js"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "epsilon"))).toBe(false);
    expect(smoked).toHaveLength(1);
  });

  test("refuses an artifact that is not a bundle directory", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const dir = fakeApp(apps, "gamma");
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "gamma", bundle: { build: "true", artifact: "dist/app" } }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [treeRow("gamma")] }));
    await expect(buildTreeRows({
      appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {},
      compileLauncher: shellLauncher([]),
    })).rejects.toThrow(/gamma: dist\/app\/main\.js missing/);
  });

  test("fails the row when the launcher cannot run its bundle", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "zeta");
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [treeRow("zeta")] }));
    await expect(buildTreeRows({
      appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {},
      compileLauncher: shellLauncher([]), bunPath: "/nonexistent/bun",
    })).rejects.toThrow(/zeta: launcher --version exited/);
  });

  test("calls buildPackages once, before any recipe build runs", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const marker = join(work, "packages-built");
    const dir = fakeApp(apps, "delta");
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
      name: "delta",
      bundle: { build: `test -f ${marker} && mkdir -p dist/app && cp main.src.js dist/app/main.js`, artifact: "dist/app" },
    }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [treeRow("delta")] }));
    let calls = 0;
    const built = await buildTreeRows({
      appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {},
      compileLauncher: shellLauncher([]),
      buildPackages: () => { calls++; writeFileSync(marker, ""); },
    });
    expect(calls).toBe(1);
    expect(built).toEqual(["delta"]);
  });

  test("the launcher compile bakes the name, the .env choice and the arch", () => {
    const args = launcherArgs({ name: "boxscore", dotenv: false, arch: "x86_64", out: "/o/boxscore" }, "/src/main.c");
    expect(args).toContain('-DHELPER_NAME="boxscore"');
    expect(args).toContain("-DHELPER_DOTENV=0");
    expect(args.slice(0, 2)).toEqual(["-arch", "x86_64"]);
    expect(args.slice(-3)).toEqual(["/src/main.c", "-o", "/o/boxscore"]);
  });

  test("the workspace build filter excludes glance-react", () => {
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=!@mattstack/glance-react");
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=./packages/*");
  });
});
