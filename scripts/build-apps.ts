#!/usr/bin/env bun
/**
 * Builds every deps.lock row with source "tree" from this checkout into
 * rt-tray/deps/<arch>/, in the layout scripts/fetch-deps.sh produces for a
 * downloaded row: the artifact at <name>, the launcher identity at
 * <name>-identity, the agent skills at <name>-skills. build.sh then bundles
 * both kinds of row the same way. The workspace packages under packages/*
 * are built first: a recipe's dist import (settings-kit, tui-kit, ...) is
 * only fresh once its own package has been rebuilt from source in this run.
 *
 *   bun scripts/build-apps.ts [--arch arm64|x86_64]
 * Env: RT_DEPS_ROOT (default rt-tray/deps), RT_DEPS_LOCK (default
 * rt-tray/deps.lock), RT_APPS_ROOT (default apps/).
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { parseDepsLock } from "../lib/bundle-layout.ts";
import { stageIdentity } from "./lib/app-identity.ts";
import { readBundleRecipe } from "./lib/validate-manifest.ts";

const ROOT = resolve(import.meta.dir, "..");

export interface BuildAppsSeams {
  appsRoot: string;
  depsRoot: string;
  lockPath: string;
  arch: BuildArch;
  log(line: string): void;
  /** Builds the packages/* workspace before any recipe runs. */
  buildPackages?: () => void;
  /** Runs `<artifact> --version` under home; returns the exit status. */
  smoke?: (artifact: string, home: string) => number | null;
}

export type BuildArch = "arm64" | "x86_64";

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

// Each app's compile script passes this to `bun build --compile --target`.
const BUN_TARGET: Record<BuildArch, string> = { arm64: "bun-darwin-arm64", x86_64: "bun-darwin-x64" };

function smokeFor(arch: BuildArch): (artifact: string, home: string) => number | null {
  // An x86_64 artifact runs on the arm64 build host under Rosetta.
  const prefix = arch === "x86_64" ? ["arch", "-x86_64"] : [];
  return (artifact, home) => {
    const [cmd, ...rest] = [...prefix, artifact, "--version"];
    return spawnSync(cmd!, rest, { stdio: "ignore", env: { HOME: home, PATH: "/usr/bin:/bin" } }).status;
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
      const env = { ...process.env, MATTSTACK_BUN_TARGET: BUN_TARGET[s.arch] };
      const run = spawnSync("bash", ["-c", recipe.build], { cwd: app, stdio: "inherit", env });
      if (run.status !== 0) throw new Error(`${row.name}: bundle.build exited ${run.status}`);
      const artifact = join(app, recipe.artifact);
      if (!existsSync(artifact) || !(statSync(artifact).mode & 0o111)) {
        throw new Error(`${row.name}: ${recipe.artifact} missing or not executable`);
      }
      const status = smoke(artifact, smokeHome);
      if (status !== 0) throw new Error(`${row.name}: ${recipe.artifact} --version exited ${status}`);
      for (const suffix of ["", "-identity", "-skills", ".sha256", "-identity.sha256", "-skills.sha256"]) {
        rmSync(join(deps, `${row.name}${suffix}`), { recursive: true, force: true });
      }
      copyFileSync(artifact, join(deps, row.name));
      chmodSync(join(deps, row.name), 0o755);
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
