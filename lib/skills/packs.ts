import { existsSync, readFileSync, readdirSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { stripJsonc } from "./sources.ts";

export type PackLayout = "flat" | "grouped";

export type PackInfo = {
  name: string;
  dir: string;
  layout: PackLayout;
  surfacePath: string;
  marketplace: string | null;
};

export type DiscoverOpts = {
  settingsPath?: string;
  extraPackDirs?: { name: string; dir: string }[];
  /** The `~/.mattstack` root to scan for org clones; defaults to the real one. Pass null to skip the folder scan. */
  mattstackRoot?: string | null;
};

function claudeSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(configDir, "settings.json");
}

function readJsonc(path: string): unknown {
  return JSON.parse(stripJsonc(readFileSync(path, "utf8")));
}

export function surfaceFileFor(dir: string): string | null {
  const candidates = [join(dir, "pack", "surface.jsonc"), join(dir, "surface.jsonc")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function hasNestedSkill(root: string): boolean {
  if (!existsSync(root)) return false;
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = join(root, group.name);
    if (existsSync(join(groupDir, "SKILL.md"))) continue;
    for (const leaf of readdirSync(groupDir, { withFileTypes: true })) {
      if (leaf.isDirectory() && existsSync(join(groupDir, leaf.name, "SKILL.md"))) return true;
    }
  }
  return false;
}

export function detectLayout(dir: string): PackLayout {
  return hasNestedSkill(join(dir, "skills")) || hasNestedSkill(join(dir, "attachments"))
    ? "grouped"
    : "flat";
}

export function packFromDir(name: string, dir: string, marketplace: string | null = null): PackInfo | null {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return null;
  }
  const surfacePath = surfaceFileFor(real);
  if (!surfacePath) return null;
  return { name, dir: real, layout: detectLayout(real), surfacePath, marketplace };
}

type MarketplaceEntry = { name?: string; source?: string | { source?: string; path?: string; url?: string } };

function fileUrlPath(url: string | undefined): string | null {
  if (typeof url !== "string" || !url.startsWith("file://")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/**
 * Where a catalog entry's pack lives on this machine. A relative or absolute
 * `source` is a directory next to the marketplace. A url source with a
 * file:// url is the dev marketplace's shape: Claude Code refuses symlinked
 * plugin paths, so a checkout is served as a clone of itself, and the
 * checkout (not the cache clone) is the pack to read. A git-subdir source
 * with a file:// url is the same idea one level down: the checkout plus the
 * subdirectory. Any other git-subdir is a remote clone rt cannot read.
 */
function pluginDirOf(marketDir: string, source: MarketplaceEntry["source"]): string | null {
  if (typeof source === "string") return source === "" ? null : isAbsolute(source) ? source : resolve(marketDir, source);
  if (!source || typeof source !== "object") return null;
  if (source.source === "git-subdir") {
    const url = fileUrlPath(source.url);
    if (!url || typeof source.path !== "string" || source.path === "") return null;
    const root = resolve(url);
    const dir = resolve(root, source.path);
    return dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep) ? dir : null;
  }
  if (source.path) return isAbsolute(source.path) ? source.path : resolve(marketDir, source.path);
  return source.source === "url" ? fileUrlPath(source.url) : null;
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Packs found by where they sit in an org clone rather than through a
 * registered marketplace: the org base pack is never installed, and a team
 * pack must be compilable before anyone has added the org's marketplace.
 * A folder name reaches a path only when it is a valid team name.
 */
export function orgFolderPacks(mattstackRoot: string): PackInfo[] {
  const found: PackInfo[] = [];
  const teams = join(mattstackRoot, "teams");
  for (const org of subdirs(teams)) {
    const orgDir = join(teams, org);
    let marker: { role?: unknown } | null;
    try {
      marker = readJsonc(join(orgDir, "mattstack", "mattstack.jsonc")) as { role?: unknown } | null;
    } catch {
      continue;
    }
    if (marker?.role !== "org") continue;
    let marketplace: string | null = null;
    try {
      const name = (readJsonc(join(orgDir, ".claude-plugin", "marketplace.json")) as { name?: unknown } | null)?.name;
      if (typeof name === "string") marketplace = name;
    } catch {
      marketplace = null;
    }
    const basesDir = join(orgDir, "mattstack", "org", "packs");
    for (const base of subdirs(basesDir)) {
      if (!TEAM_NAME_RE.test(base)) continue;
      const pack = packFromDir(base, join(basesDir, base), marketplace);
      if (pack) found.push(pack);
    }
    const teamsDir = join(orgDir, "mattstack", "teams");
    for (const team of subdirs(teamsDir)) {
      if (!TEAM_NAME_RE.test(team)) continue;
      const pack = packFromDir(team, join(teamsDir, team, "packs", team), marketplace);
      if (pack) found.push(pack);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A pack is any plugin served from a directory marketplace that carries a
 * surface.jsonc -- discovery reads what is actually installed instead of a
 * hardcoded pack list, so a new team pack appears the moment its marketplace
 * is registered.
 */
export function discoverPacks(opts: DiscoverOpts = {}): PackInfo[] {
  const found = new Map<string, PackInfo>();
  const settingsPath = opts.settingsPath ?? claudeSettingsPath();

  if (existsSync(settingsPath)) {
    let settings: { extraKnownMarketplaces?: Record<string, { source?: { source?: string; path?: string } }> } = {};
    try {
      settings = readJsonc(settingsPath) as typeof settings;
    } catch {
      settings = {};
    }
    for (const [marketplaceKey, marketplace] of Object.entries(settings.extraKnownMarketplaces ?? {})) {
      const src = marketplace.source;
      if (!src || src.source !== "directory" || !src.path) continue;
      const marketDir = src.path.startsWith("~") ? join(homedir(), src.path.slice(1)) : src.path;
      const manifest = join(marketDir, ".claude-plugin", "marketplace.json");
      if (!existsSync(manifest)) continue;
      let entries: MarketplaceEntry[] = [];
      try {
        entries = ((readJsonc(manifest) as { plugins?: MarketplaceEntry[] }).plugins) ?? [];
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.name) continue;
        const pluginDir = pluginDirOf(marketDir, entry.source);
        if (!pluginDir) continue;
        const pack = packFromDir(entry.name, pluginDir, marketplaceKey);
        if (pack && !found.has(pack.name)) found.set(pack.name, pack);
      }
    }
  }

  for (const extra of opts.extraPackDirs ?? []) {
    const pack = packFromDir(extra.name, extra.dir, null);
    if (pack && !found.has(pack.name)) found.set(pack.name, pack);
  }

  const root = opts.mattstackRoot === undefined ? join(process.env.HOME ?? homedir(), ".mattstack") : opts.mattstackRoot;
  if (root !== null) {
    for (const pack of orgFolderPacks(root)) if (!found.has(pack.name)) found.set(pack.name, pack);
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The pack whose tree contains startDir, or null. Walks upward on the same
 * surface.jsonc marker discovery uses, so a compile run from inside a
 * worktree acts on that worktree's sources rather than whatever checkout the
 * marketplace registry points at. The name is the directory basename;
 * callers with a better identity source (the pack's own plugin.json) may
 * override it.
 */
export function findEnclosingPack(startDir: string): PackInfo | null {
  let dir: string;
  try {
    dir = realpathSync(startDir);
  } catch {
    return null;
  }
  while (true) {
    const surfacePath = surfaceFileFor(dir);
    const parent = dirname(dir);
    // When the parent claims this same surface file (its pack/surface.jsonc
    // candidate), dir is a grouped root's pack/ config subdir, not the root
    // -- defer to the parent, which the next iteration accepts. A flat pack
    // whose root directory is literally named "pack" loses this tiebreak and
    // resolves to its parent; that shape has no unambiguous marker.
    const parentClaimsSame = parent !== dir && surfaceFileFor(parent) === surfacePath;
    if (surfacePath && !parentClaimsSame) return packFromDir(basename(dir), dir, null);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function packDirOf(pack: PackInfo): string {
  return pack.dir;
}

export function surfaceConfigDir(pack: PackInfo): string {
  return dirname(pack.surfacePath);
}
