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
import { ensureTree, renderRoot, withEngine } from "./render-cache.ts";
import { activeMattstack, isHuskPack } from "./render-paths.ts";
import { resolvePluginRootsAsync, type PluginRoots } from "./sources.ts";

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

const PLUGIN_LIST_TIMEOUT_MS = 60_000;

/**
 * The daemon runs this, so the plugin list comes from `roots`, an async
 * listing with a deadline, never the blocking resolvePluginRoots.
 */
export async function renderHuskPacks(p: Probes, opts: { org?: string; roots?: () => Promise<PluginRoots> }): Promise<HuskRender[]> {
  let zones;
  try {
    zones = readZones(p, p.home).filter((z) => (opts.org === undefined || z.org === opts.org) && z.hasPack && isHuskPack(p.readFile, zonePackDir(z)));
  } catch (err) {
    return [{ pack: opts.org ?? "org clone", ok: false, detail: errorText(err) }];
  }
  if (zones.length === 0) return [];
  const failAll = (detail: string) => zones.map((z) => ({ pack: z.team, ok: false, detail }));

  const engine = activeMattstack(p, p.home);
  if (!engine) return failAll("mattstack isn't installed on this Mac");
  let pluginRoots: PluginRoots;
  try {
    pluginRoots = withEngine(await (opts.roots ?? (() => resolvePluginRootsAsync({ timeoutMs: PLUGIN_LIST_TIMEOUT_MS })))(), engine);
  } catch (err) {
    return failAll(`Claude Code's plugin list could not be read: ${errorText(err)}`);
  }

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
        pluginRoots,
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
