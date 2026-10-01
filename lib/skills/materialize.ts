import { dirname, join } from "path";
import { findInstalledPluginDir, PLUGIN_REF_RE } from "./installed-plugins.ts";
import { isPackDir, parseRemote, readZonesFrom, zoneTeamConfigReads, type InitFs, type RepoRef, type ZoneInfo } from "./init.ts";
import { FragmentError, mergeLayers, parseFragment, readManifestZone, renderManifest, type Fragment, type Layer } from "./manifest-merge.ts";
import { legacyManifestPath, packManifestPath } from "./manifest-paths.ts";

export type MaterializeFs = InitFs & { rename(from: string, to: string): void };

export type PackOutcome =
  | { pack: string; zone: string; ok: true; path: string; layers: string[] }
  | { pack: string; zone: string; ok: false; detail: string };

export type MaterializeRepoOutcome =
  | { kind: "no-remote" }
  | { kind: "undeclared"; repo: string }
  | { kind: "written"; repo: string; slug: string; packs: PackOutcome[]; migrated: string | null; pruned: string[]; pruneWarnings: string[] };

export type MaterializeDeps = {
  fs: MaterializeFs;
  mattstackRoot: string;
  claudeHome: string;
  enginePackDir: string;
  installedPluginDir?: (ref: string) => string | null;
};

function readFragment(fs: MaterializeFs, path: string): Fragment | null {
  const text = fs.readFile(path);
  return text === null ? null : parseFragment(text, path);
}

/** A pack's own fragment, parsed once: the base check and the merge read the same parse. */
type ClaimingPack = { name: string; own: Fragment | { error: string } };

function claimingPacksIn(fs: MaterializeFs, zone: ZoneInfo): ClaimingPack[] {
  const packsDir = join(zone.dir, "mattstack", "packs");
  const out: ClaimingPack[] = [];
  for (const name of fs.readDir(packsDir).sort()) {
    if (!isPackDir(fs, join(packsDir, name))) continue;
    const path = join(packsDir, name, "pack", "skills.jsonc");
    try {
      const own = readFragment(fs, path);
      if (!own) out.push({ name, own: { error: `${path} is missing` } });
      else if (own.base !== true) out.push({ name, own });
    } catch (err) {
      if (!(err instanceof FragmentError)) throw err;
      out.push({ name, own: { error: err.message } });
    }
  }
  return out;
}

function baseLayer(deps: MaterializeDeps, pack: string, ref: string): Layer | { error: string } {
  if (!PLUGIN_REF_RE.test(ref)) return { error: `${pack} extends "${ref}", which is not a <plugin>@<marketplace> reference` };
  const lookup = deps.installedPluginDir ?? ((r: string) => findInstalledPluginDir(deps.fs, deps.claudeHome, r));
  const dir = lookup(ref);
  if (!dir) return { error: `${pack} extends ${ref}, which is not installed; add it to the team's claude.plugins` };
  const fragmentPath = join(dir, "pack", "skills.jsonc");
  const fragment = readFragment(deps.fs, fragmentPath);
  if (!fragment) return { error: `${pack} extends ${ref}, but ${fragmentPath} is missing` };
  if (fragment.extends) return { error: `${pack} extends ${ref}, which extends ${fragment.extends}; a base pack cannot extend another` };
  return { label: `base:${ref.split("@")[0]}`, fragment };
}

function materializePack(deps: MaterializeDeps, zone: ZoneInfo, pack: string, own: Fragment, repo: string, slug: string, defaults: Layer | null, override: Layer | null): PackOutcome {
  try {
    const layers: Layer[] = [];
    if (defaults) layers.push(defaults);
    if (own.extends !== undefined) {
      const base = baseLayer(deps, pack, own.extends);
      if ("error" in base) return { pack, zone: zone.slug, ok: false, detail: base.error };
      layers.push(base);
    }
    layers.push({ label: "pack", fragment: own });
    if (override) layers.push(override);

    const path = packManifestPath(deps.mattstackRoot, slug, pack);
    const text = renderManifest(mergeLayers(layers), { repo, pack, zone: zone.slug });
    deps.fs.mkdirp(dirname(path));
    const tmp = `${path}.tmp`;
    deps.fs.writeFile(tmp, text);
    deps.fs.rename(tmp, path);
    return { pack, zone: zone.slug, ok: true, path, layers: layers.map((l) => l.label) };
  } catch (err) {
    if (err instanceof FragmentError) return { pack, zone: zone.slug, ok: false, detail: err.message };
    throw err;
  }
}

/**
 * Sets aside (renames to `.stale`, never deletes) a bindings file this run did not write, but only when the zone its
 * header records is present here (its marker reads as a team zone and its team.jsonc parses) and no longer holds a
 * claiming pack of that name for this repo. A file whose zone is absent or partial (not cloned yet, mid-sync, an
 * unreadable mount) or that records no zone is left alone, as is every pack this run claimed, ok or failed, so a
 * broken pack keeps its last good bindings. One limit remains: a pack directory caught mid-checkout (its
 * pack/skills.jsonc momentarily absent) reads as no longer claiming, so its file can be set aside until the next
 * materialize rewrites it; that is a rename, never a delete.
 */
function setAsideStale(deps: MaterializeDeps, ref: RepoRef, owned: Set<string>, allZones: ZoneInfo[]): { pruned: string[]; warnings: string[] } {
  const pruned: string[] = [];
  const warnings: string[] = [];
  for (const pack of deps.fs.readDir(join(deps.mattstackRoot, "repos", ref.slug, "packs")).sort()) {
    if (owned.has(pack)) continue;
    const path = packManifestPath(deps.mattstackRoot, ref.slug, pack);
    const text = deps.fs.readFile(path);
    const recorded = text === null ? null : readManifestZone(text);
    const zone = recorded === null ? undefined : allZones.find((z) => z.slug === recorded);
    if (!zone || !zoneTeamConfigReads(deps.fs, zone.dir)) continue;
    const stillClaims = zone.host === ref.host && zone.projects.includes(ref.path) &&
      claimingPacksIn(deps.fs, zone).some((c) => c.name === pack);
    if (stillClaims) continue;
    try {
      deps.fs.rename(path, `${path}.stale`);
      pruned.push(`${path}.stale`);
    } catch (err) {
      warnings.push(`could not set aside ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { pruned, warnings };
}

export function materializeRepo(deps: MaterializeDeps, remote: string | null): MaterializeRepoOutcome {
  const ref = remote ? parseRemote(remote) : null;
  if (!ref) return { kind: "no-remote" };
  const repo = `${ref.host}/${ref.path}`;

  const allZones = readZonesFrom(deps.fs, join(deps.mattstackRoot, "teams"));
  const zones = allZones.filter((z) => z.host === ref.host && z.projects.includes(ref.path));
  if (zones.length === 0) return { kind: "undeclared", repo };

  let defaults: Layer | null = null;
  let override: Layer | null = null;
  let sharedError: string | null = null;
  try {
    const engineFragment = readFragment(deps.fs, join(deps.enginePackDir, "pack", "skills.jsonc"));
    if (engineFragment) defaults = { label: "default", fragment: engineFragment };
    const overrideFragment = readFragment(deps.fs, join(deps.mattstackRoot, "user", "skills", "overrides.jsonc"));
    if (overrideFragment) override = { label: "override", fragment: overrideFragment };
  } catch (err) {
    if (!(err instanceof FragmentError)) throw err;
    sharedError = err.message;
  }

  const claims = zones.map((zone) => ({ zone, claiming: claimingPacksIn(deps.fs, zone) }));
  const zonesByPack = new Map<string, string[]>();
  for (const { zone, claiming } of claims) {
    for (const { name } of claiming) zonesByPack.set(name, [...(zonesByPack.get(name) ?? []), zone.slug]);
  }

  const packs: PackOutcome[] = [];
  for (const { zone, claiming } of claims) {
    const names = claiming.map((c) => c.name);
    if (names.length > 1) {
      const detail = `zone "${zone.slug}" holds ${names.length} packs (${names.join(", ")}) that all claim ${repo}; a zone binds one pack per repo, so mark a shared base pack "base": true, or move the others to a zone that declares no projects`;
      for (const pack of names) packs.push({ pack, zone: zone.slug, ok: false, detail });
      continue;
    }
    for (const { name: pack, own } of claiming) {
      const holders = zonesByPack.get(pack)!;
      if (holders.length > 1) {
        const detail = `pack "${pack}" is in ${holders.length} zones (${[...holders].sort().join(", ")}) that all claim ${repo}; they would all write one file, so declare the repo in only one of them`;
        packs.push({ pack, zone: zone.slug, ok: false, detail });
        continue;
      }
      if (sharedError !== null) packs.push({ pack, zone: zone.slug, ok: false, detail: sharedError });
      else if ("error" in own) packs.push({ pack, zone: zone.slug, ok: false, detail: own.error });
      else packs.push(materializePack(deps, zone, pack, own, repo, ref.slug, defaults, override));
    }
  }
  packs.sort((a, b) => a.pack.localeCompare(b.pack) || a.zone.localeCompare(b.zone));

  let migrated: string | null = null;
  const legacy = legacyManifestPath(deps.mattstackRoot, ref.slug);
  if (packs.some((p) => p.ok) && deps.fs.exists(legacy)) {
    migrated = `${legacy}.migrated`;
    deps.fs.rename(legacy, migrated);
  }

  const { pruned, warnings } = setAsideStale(deps, ref, new Set(packs.map((p) => p.pack)), allZones);
  return { kind: "written", repo, slug: ref.slug, packs, migrated, pruned, pruneWarnings: warnings };
}
