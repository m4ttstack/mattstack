import { dirname, join } from "path";
import { findInstalledPluginDir, PLUGIN_REF_RE } from "./installed-plugins.ts";
import { parseRemote, readZonesFrom, type InitFs, type ZoneInfo } from "./init.ts";
import { FragmentError, mergeLayers, parseFragment, renderManifest, type Fragment, type Layer } from "./manifest-merge.ts";
import { legacyManifestPath, packManifestPath } from "./manifest-paths.ts";

export type MaterializeFs = InitFs & { rename(from: string, to: string): void };

export type PackOutcome =
  | { pack: string; zone: string; ok: true; path: string; layers: string[] }
  | { pack: string; zone: string; ok: false; detail: string };

export type MaterializeRepoOutcome =
  | { kind: "no-remote" }
  | { kind: "undeclared"; repo: string }
  | { kind: "written"; repo: string; slug: string; packs: PackOutcome[]; migrated: string | null };

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

function packsIn(fs: MaterializeFs, zone: ZoneInfo): string[] {
  const packsDir = join(zone.dir, "mattstack", "packs");
  return fs.readDir(packsDir).filter((name) => fs.exists(join(packsDir, name, "pack", "skills.jsonc"))).sort();
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

function materializePack(deps: MaterializeDeps, zone: ZoneInfo, pack: string, repo: string, slug: string, defaults: Layer | null, override: Layer | null): PackOutcome {
  const fragmentPath = join(zone.dir, "mattstack", "packs", pack, "pack", "skills.jsonc");
  try {
    const own = readFragment(deps.fs, fragmentPath);
    if (!own) return { pack, zone: zone.slug, ok: false, detail: `${fragmentPath} is missing` };
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
    const text = renderManifest(mergeLayers(layers), { repo, pack });
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

export function materializeRepo(deps: MaterializeDeps, remote: string | null): MaterializeRepoOutcome {
  const ref = remote ? parseRemote(remote) : null;
  if (!ref) return { kind: "no-remote" };
  const repo = `${ref.host}/${ref.path}`;

  const zones = readZonesFrom(deps.fs, join(deps.mattstackRoot, "teams"))
    .filter((z) => z.host === ref.host && z.projects.includes(ref.path));
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

  const claims = zones.map((zone) => ({ zone, names: packsIn(deps.fs, zone) }));
  const zonesByPack = new Map<string, string[]>();
  for (const { zone, names } of claims) {
    for (const pack of names) zonesByPack.set(pack, [...(zonesByPack.get(pack) ?? []), zone.slug]);
  }

  const packs: PackOutcome[] = [];
  for (const { zone, names } of claims) {
    if (names.length > 1) {
      const detail = `zone "${zone.slug}" holds ${names.length} packs (${names.join(", ")}) that all claim ${repo}; a zone binds one pack per repo, so move the others to a zone that declares no projects`;
      for (const pack of names) packs.push({ pack, zone: zone.slug, ok: false, detail });
      continue;
    }
    for (const pack of names) {
      const holders = zonesByPack.get(pack)!;
      if (holders.length > 1) {
        const detail = `pack "${pack}" is in ${holders.length} zones (${[...holders].sort().join(", ")}) that all claim ${repo}; they would all write one file, so declare the repo in only one of them`;
        packs.push({ pack, zone: zone.slug, ok: false, detail });
        continue;
      }
      packs.push(sharedError !== null
        ? { pack, zone: zone.slug, ok: false, detail: sharedError }
        : materializePack(deps, zone, pack, repo, ref.slug, defaults, override));
    }
  }
  packs.sort((a, b) => a.pack.localeCompare(b.pack) || a.zone.localeCompare(b.zone));

  let migrated: string | null = null;
  const legacy = legacyManifestPath(deps.mattstackRoot, ref.slug);
  if (packs.some((p) => p.ok) && deps.fs.exists(legacy)) {
    migrated = `${legacy}.migrated`;
    deps.fs.rename(legacy, migrated);
  }

  return { kind: "written", repo, slug: ref.slug, packs, migrated };
}
