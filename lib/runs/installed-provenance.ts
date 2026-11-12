/**
 * A run's provenance for a pack installed from Claude Code's plugin cache,
 * worked out at run start from the loaded skill's own folder
 * (`<cache>/<market>/<plugin>/<version>/<side>/<unit>`): the org commit that
 * carried the installed version, and mattstack from the pack's lock.
 */
import { readdirSync, readFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { readLock } from "../skills/compiled-lock.ts";
import { generatedMarketplaceRef } from "../setup/generated-marketplace.ts";
import { generatedMarketplaceDir, orgDir, orgDirUnder, orgsDirUnder, teamPackDir } from "../rt-paths.ts";
import { childEnv } from "../subprocess.ts";

export type InstalledProvenance = { tokens: string[]; dirty: 0 | 1 };

export type OrgClone = { dir: string; ref: string; packRel: string };

export type InstalledDeps = {
  readFile: (p: string) => string | null;
  git: (cwd: string, args: string[]) => { code: number; stdout: string };
  orgCloneFor: (marketplace: string, plugin: string) => OrgClone | null;
};

const MANIFEST_REL = ".claude-plugin/plugin.json";

/** How far back the data branch's manifest history is read; sync's own bump search reads the same depth. */
const BUMP_SEARCH_DEPTH = 50;

function readJson(readFile: InstalledDeps["readFile"], path: string): Record<string, unknown> | null {
  const text = readFile(path);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function manifestVersion(text: string): string | null {
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The oldest commit of the newest run on `ref` whose manifest carries
 * `version`: a later manifest edit that keeps the version is not the sync
 * that built it, and newer versions above it are skipped.
 */
function bumpCommit(git: InstalledDeps["git"], clone: OrgClone, version: string): string | null {
  const manifest = `${clone.packRel}/${MANIFEST_REL}`;
  const log = git(clone.dir, ["log", "--topo-order", `--max-count=${BUMP_SEARCH_DEPTH}`, "--format=%h", clone.ref, "--", manifest]);
  if (log.code !== 0) return null;
  let bumpedAt: string | null = null;
  for (const sha of log.stdout.split("\n").filter(Boolean)) {
    const shown = git(clone.dir, ["show", `${sha}:${manifest}`]);
    const carries = shown.code === 0 && manifestVersion(shown.stdout) === version;
    if (carries) bumpedAt = sha;
    else if (bumpedAt !== null) break;
  }
  return bumpedAt;
}

/** pack_commits is `name=value,...`, so a value is only ever a plain version or a hex sha. */
const VERSION_VALUE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA_VALUE = /^[0-9a-f]{4,40}$/i;
const PACK_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

const tokenValue = (v: unknown): string | null =>
  typeof v === "string" && (VERSION_VALUE.test(v) || SHA_VALUE.test(v)) ? v : null;

/** The mattstack token and dirty bit the pack's lock recorded for the skill's own target. */
export function lockedMattstack(skillDir: string, readFile: InstalledDeps["readFile"]): { token: string | null; dirty: 0 | 1 } {
  const packRoot = dirname(dirname(skillDir));
  const target = relative(packRoot, skillDir);
  const lock = readLock(packRoot, readFile);
  const value = tokenValue(lock.mattstackSha[target]) ?? tokenValue(lock.targets[target]?.mattstack);
  return { token: value ? `mattstack=${value}` : null, dirty: lock.mattstackDirty[target] === 1 ? 1 : 0 };
}

export function installedProvenance(skillDir: string, deps: InstalledDeps): InstalledProvenance {
  const packRoot = dirname(dirname(skillDir));
  const mattstack = lockedMattstack(skillDir, deps.readFile);
  const manifest = readJson(deps.readFile, join(packRoot, MANIFEST_REL));
  const name = typeof manifest?.name === "string" && PACK_NAME.test(manifest.name) ? manifest.name : null;
  const version = tokenValue(manifest?.version);
  let pack: string | null = null;
  // The mattstack plugin's own lock already names mattstack, and may carry its checkout sha.
  if (name && version && !(name === "mattstack" && mattstack.token)) {
    const market = basename(dirname(dirname(packRoot)));
    const clone = deps.orgCloneFor(market, name);
    const sha = clone ? bumpCommit(deps.git, clone, version) : null;
    pack = `${name}=${sha ?? version}`;
  }
  return { tokens: [pack, mattstack.token].filter((t): t is string => t !== null), dirty: mattstack.dirty };
}

export function realGit(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore", env: childEnv() });
    return { code: r.exitCode, stdout: r.stdout.toString() };
  } catch {
    return { code: 1, stdout: "" };
  }
}

export function realReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Team packs install from the generated marketplace, which carries the org marketplace's own name, so that name finds the clone. */
export function realOrgCloneFor(home: string): (marketplace: string, plugin: string) => OrgClone | null {
  return (marketplace, plugin) => {
    let orgs: string[];
    try {
      orgs = readdirSync(orgsDirUnder(home));
    } catch {
      return null;
    }
    for (const org of orgs.sort()) {
      const generated = readJson(realReadFile, join(generatedMarketplaceDir(home, org), ".claude-plugin", "marketplace.json"));
      if (generated?.name !== marketplace) continue;
      const dir = orgDirUnder(home, org);
      return { dir, ref: generatedMarketplaceRef({ readFile: realReadFile, home }, dir), packRel: relative(orgDir(org), teamPackDir(org, plugin)) };
    }
    return null;
  };
}

export function realInstalledDeps(home: string): InstalledDeps {
  return { readFile: realReadFile, git: realGit, orgCloneFor: realOrgCloneFor(home) };
}
