/**
 * Renders every husk pack an org clone carries, at the clone's pack version
 * with the installed mattstack, after a pull and after setup installs. An
 * unchanged pack costs one input hash. Never throws: a miss is covered when
 * load_skill renders on demand.
 */
import { join } from "node:path";
import type { Probes } from "../setup/probes.ts";
import { rtVersion } from "../setup/update.ts";
import { readZones, zonePackDir } from "./init.ts";
import { ensureTree, renderRoot } from "./render-cache.ts";
import { isHuskPack } from "./render-paths.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir } from "./sources.ts";

export type HuskRender = { pack: string; ok: boolean; detail: string };

function packManifest(p: Probes, packDir: string): { name: string; version: string } | null {
  try {
    const parsed = JSON.parse(p.readFile(join(packDir, ".claude-plugin", "plugin.json")) ?? "null") as { name?: unknown; version?: unknown } | null;
    return typeof parsed?.name === "string" && typeof parsed.version === "string" ? { name: parsed.name, version: parsed.version } : null;
  } catch {
    return null;
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `mattstackDir` renders against `<dir>/plugins/<name>` instead of the installed plugins. */
export async function renderHuskPacks(p: Probes, opts: { org?: string; mattstackDir?: string }): Promise<HuskRender[]> {
  let zones;
  try {
    zones = readZones(p, p.home).filter((z) => (opts.org === undefined || z.org === opts.org) && z.hasPack && isHuskPack(p.readFile, zonePackDir(z)));
  } catch (err) {
    return [{ pack: opts.org ?? "org clone", ok: false, detail: errorText(err) }];
  }
  if (zones.length === 0) return [];

  let engine: { dir: string; version: string } | undefined;
  try {
    engine = (opts.mattstackDir ? resolvePluginRootsFromDir(opts.mattstackDir) : resolvePluginRoots()).byName.mattstack;
  } catch (err) {
    return zones.map((z) => ({ pack: z.team, ok: false, detail: errorText(err) }));
  }
  if (!engine) return zones.map((z) => ({ pack: z.team, ok: false, detail: "mattstack isn't installed on this Mac" }));

  const results: HuskRender[] = [];
  for (const zone of zones) {
    const manifest = packManifest(p, zonePackDir(zone));
    if (!manifest) {
      results.push({ pack: zone.team, ok: false, detail: `${join(zonePackDir(zone), ".claude-plugin", "plugin.json")} names no plugin version` });
      continue;
    }
    try {
      const result = await ensureTree({
        root: renderRoot(p.home),
        zone,
        pack: zone.team,
        installedVersion: manifest.version,
        mattstack: engine.version,
        rtBuild: rtVersion(),
        deps: { fs: p, mattstackRoot: join(p.home, ".mattstack"), enginePackDir: engine.dir },
        mattstackDir: opts.mattstackDir,
      });
      if (!result.ok) results.push({ pack: zone.team, ok: false, detail: result.message });
      else if (result.rendered) results.push({ pack: zone.team, ok: true, detail: `rendered ${manifest.name} ${manifest.version} for mattstack ${engine.version}` });
      else results.push({ pack: zone.team, ok: true, detail: `${manifest.name} ${manifest.version} is up to date` });
    } catch (err) {
      results.push({ pack: zone.team, ok: false, detail: errorText(err) });
    }
  }
  return results;
}

/** The sentence a setup step appends; empty when no pack opts into husks. */
export function renderTally(results: HuskRender[]): string {
  if (results.length === 0) return "";
  const ready = results.filter((r) => r.ok).length;
  const failures = results.filter((r) => !r.ok).map((r) => `; ${r.pack} did not render: ${r.detail}`);
  return `. ${ready} husk pack${ready === 1 ? "" : "s"} ready${failures.join("")}`;
}
