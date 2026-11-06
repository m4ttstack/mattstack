#!/usr/bin/env bun
/**
 * Builds every deps.lock row with source "tree" from this checkout into
 * rt-tray/deps/<arch>/, in the layout scripts/fetch-deps.sh produces for a
 * downloaded row: the launcher at <name>, the JS bundle it runs at
 * <name>-app, the launcher identity at <name>-identity, the agent skills at
 * <name>-skills. build.sh then bundles both kinds of row the same way. The
 * workspace packages under packages/* are built first: a recipe's dist
 * import (settings-kit, tui-kit, ...) is only fresh once its own package has
 * been rebuilt from source in this run.
 *
 * Every tree app runs on the one bundled Helpers/bun: the launcher
 * (rt-tray/helper-launcher/main.c) is a few KB per arch, where a
 * `bun build --compile` binary carried its own copy of the runtime.
 *
 *   bun scripts/build-apps.ts [--arch arm64|x86_64]
 * Env: RT_DEPS_ROOT (default rt-tray/deps), RT_DEPS_LOCK (default
 * rt-tray/deps.lock), RT_APPS_ROOT (default apps/).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { parseDepsLock } from "../lib/bundle-layout.ts";
import { stageIdentity } from "./lib/app-identity.ts";
import { readBundleRecipe } from "./lib/validate-manifest.ts";

const ROOT = resolve(import.meta.dir, "..");
export const LAUNCHER_SRC = join(ROOT, "rt-tray", "helper-launcher", "main.c");
// rt-tray/Package.swift's platform floor.
const MACOS_MIN = "14.0";

export type BuildArch = "arm64" | "x86_64";

export interface LauncherSpec {
  name: string;
  /** Whether bun reads a .env from the cwd (bundle.dotenv). */
  dotenv: boolean;
  arch: BuildArch;
  out: string;
}

export interface BuildAppsSeams {
  appsRoot: string;
  depsRoot: string;
  lockPath: string;
  arch: BuildArch;
  log(line: string): void;
  /** Builds the packages/* workspace before any recipe runs. */
  buildPackages?: () => void;
  /** Writes the Contents/Helpers/<name> launcher for one arch. */
  compileLauncher?: (spec: LauncherSpec) => void;
  /** The bun the smoke probe runs each bundle on; default this process's. */
  bunPath?: string;
  /** Runs `<launcher> --version` under home; returns the exit status. */
  smoke?: (launcher: string, home: string) => number | null;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function launcherArgs(spec: LauncherSpec, src: string = LAUNCHER_SRC): string[] {
  return [
    "-arch", spec.arch, `-mmacosx-version-min=${MACOS_MIN}`, "-O2", "-Wall", "-Wextra", "-Werror",
    `-DHELPER_NAME="${spec.name}"`, `-DHELPER_DOTENV=${spec.dotenv ? 1 : 0}`,
    src, "-o", spec.out,
  ];
}

function compileLauncher(spec: LauncherSpec): void {
  const run = spawnSync("clang", launcherArgs(spec), { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`${spec.name}: launcher compile exited ${run.status}`);
}

export const BUNFIG_GUARD =
  "# Intentionally empty. Contents/Helpers/<name> hands bun this file so a\n" +
  "# bunfig.toml (and its preload) in the caller's cwd is never read.\n";

function smokeFor(arch: BuildArch): (launcher: string, home: string) => number | null {
  // An x86_64 launcher runs on the arm64 build host under Rosetta.
  const prefix = arch === "x86_64" ? ["arch", "-x86_64"] : [];
  return (launcher, home) => {
    const [cmd, ...rest] = [...prefix, launcher, "--version"];
    return spawnSync(cmd!, rest, { stdio: "ignore", cwd: home, env: { HOME: home, PATH: "/usr/bin:/bin" } }).status;
  };
}

export async function buildTreeRows(s: BuildAppsSeams): Promise<string[]> {
  const lock = parseDepsLock(readFileSync(s.lockPath, "utf8"));
  if (lock.arch !== "arm64") throw new Error(`deps.lock arch is ${lock.arch}, this script reads an arm64 lock`);
  const smoke = s.smoke ?? smokeFor(s.arch);
  const deps = join(s.depsRoot, s.arch);
  mkdirSync(deps, { recursive: true });
  s.buildPackages?.();
  // A built app reads ~/.mattstack at import time (deck's boot-env can rename
  // ~/.mattstack/local, core/settings mints a secret into
  // ~/.mattstack/deck/settings.json), so the smoke probe below never sees the
  // real home: it gets a throwaway one, the same isolation
  // rt-tray/check-bundle.sh gives the deck shim's own probe.
  const smokeHome = mkdtempSync(join(tmpdir(), "build-apps-smoke-"));
  try {
    const built: string[] = [];
    for (const row of lock.tools) {
      if (row.source !== "tree") continue;
      if (row.status !== "bundled") { s.log(`  . ${row.name}: pending, not built`); continue; }
      if (!SAFE_NAME.test(row.name)) throw new Error(`refusing unsafe tool name: ${row.name}`);
      const app = join(s.appsRoot, row.name);
      const recipe = readBundleRecipe(join(app, "mattstack.deck.json"));
      s.log(`  -> ${row.name}: ${recipe.build}`);
      const run = spawnSync("bash", ["-c", recipe.build], { cwd: app, stdio: "inherit", env: process.env });
      if (run.status !== 0) throw new Error(`${row.name}: bundle.build exited ${run.status}`);
      const artifact = join(app, recipe.artifact);
      if (!existsSync(join(artifact, "main.js")) || !statSync(artifact).isDirectory()) {
        throw new Error(`${row.name}: ${recipe.artifact}/main.js missing; bundle.artifact names the bundle directory`);
      }
      for (const suffix of ["", "-app", "-identity", "-skills", ".sha256", "-identity.sha256", "-skills.sha256"]) {
        rmSync(join(deps, `${row.name}${suffix}`), { recursive: true, force: true });
      }
      const bundle = join(deps, `${row.name}-app`);
      cpSync(artifact, bundle, { recursive: true });
      writeFileSync(join(bundle, "bunfig.toml"), BUNFIG_GUARD);
      const launcher = join(deps, row.name);
      (s.compileLauncher ?? compileLauncher)({ name: row.name, dotenv: recipe.dotenv, arch: s.arch, out: launcher });
      chmodSync(launcher, 0o755);
      // The launcher finds bun and its bundle beside its own path, as in
      // Contents/Helpers; deps/<arch> has no bun when this runs.
      const helpers = mkdtempSync(join(tmpdir(), "build-apps-helpers-"));
      try {
        cpSync(launcher, join(helpers, row.name));
        symlinkSync(bundle, join(helpers, `${row.name}-app`));
        symlinkSync(s.bunPath ?? process.execPath, join(helpers, "bun"));
        const status = smoke(join(helpers, row.name), smokeHome);
        if (status !== 0) throw new Error(`${row.name}: launcher --version exited ${status}`);
      } finally {
        rmSync(helpers, { recursive: true, force: true });
      }
      stageIdentity(app, join(deps, `${row.name}-identity`), row.name);
      if (row.skills) {
        const skills = join(app, "skills");
        if (!existsSync(skills)) throw new Error(`${row.name}: deps.lock says skills but apps/${row.name}/skills is absent`);
        cpSync(skills, join(deps, `${row.name}-skills`), { recursive: true });
      }
      s.log(`  ok ${row.name}`);
      built.push(row.name);
    }
    return built;
  } finally {
    rmSync(smokeHome, { recursive: true, force: true });
  }
}

// glance-react's dist ships nothing this release bundles (no in-tree
// consumer, no deps.lock row); its own build gates go through
// scripts/turbo.sh check instead, never this release path.
export const WORKSPACE_BUILD_ARGS = ["build", "--filter=./packages/*", "--filter=!@mattstack/glance-react", "--output-logs=errors-only"];

function buildWorkspacePackages(): void {
  // An argv array bypasses the shell entirely, so "./packages/*" reaches
  // turbo's directory filter as one literal string, never glob-expanded.
  const run = spawnSync("bash", ["scripts/turbo.sh", ...WORKSPACE_BUILD_ARGS], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (run.status !== 0) throw new Error(`packages/* build exited ${run.status}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const archAt = args.indexOf("--arch");
  const arch = archAt >= 0 ? args[archAt + 1] : "arm64";
  if (arch !== "arm64" && arch !== "x86_64") { console.error("usage: bun scripts/build-apps.ts [--arch arm64|x86_64]"); process.exit(2); }
  if (process.arch !== "arm64") { console.error(`build host is ${process.arch}; deps/${arch} must be built on arm64`); process.exit(1); }
  const built = await buildTreeRows({
    appsRoot: process.env.RT_APPS_ROOT ?? join(ROOT, "apps"),
    depsRoot: process.env.RT_DEPS_ROOT ?? join(ROOT, "rt-tray", "deps"),
    lockPath: process.env.RT_DEPS_LOCK ?? join(ROOT, "rt-tray", "deps.lock"),
    arch,
    log: (line) => console.log(line),
    buildPackages: buildWorkspacePackages,
  });
  console.log(`Built ${built.length} tree row(s): ${built.join(", ")}`);
}
