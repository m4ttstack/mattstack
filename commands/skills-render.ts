import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { UserActionableError } from "../lib/errors.ts";
import { rtVersion } from "../lib/setup/update.ts";
import { readZones, zonePackDir, type ZoneInfo } from "../lib/skills/init.ts";
import { compareVersions } from "../lib/skills/installed-plugins.ts";
import { ensureTree, renderRoot, withEngine } from "../lib/skills/render-cache.ts";
import { renderHuskPacks, type HuskRender } from "../lib/skills/render-packs.ts";
import { activeMattstack, parseStamp, pickRenderTree, STAMP_FILE, type RenderStamp } from "../lib/skills/render-paths.ts";
import { realResolveFs, versionOfDir } from "../lib/skills/resolve.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir, type PluginRoots } from "../lib/skills/sources.ts";
import { MAP_FILE } from "../lib/skills/unit-maps.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import * as out from "../lib/ui/out.ts";

const USAGE = "rt skills render <plugin>:<unit> --dir <skill dir> [--file <path>] --json";
const SETUP = "rt setup";
const VALUE_FLAGS = ["--dir", "--file", "--mattstack-dir", "--org"];
/** `<plugin>:<unit>`, or the older `<plugin>@<version>:<unit>`. */
const ID_RE = /^([a-z0-9][a-z0-9-]*)(?:@(\d+(?:\.\d+)*))?:([a-z0-9][a-z0-9-]*)$/;

const versionless = (id: string) => id.replace(/@[^:]*:/, ":");

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** `next` and `why` ride the envelope too: load_skill builds its deny from the envelope alone. */
function fail(code: string, message: string, opts: { next?: string; why?: string; log?: string } = {}): UserActionableError {
  return new UserActionableError(code, message, { ...(opts.next ? { next: opts.next } : {}), ...(opts.why ? { why: opts.why } : {}) }, opts);
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim() !== "")?.trim() ?? text;

function pluginName(packDir: string): string | null {
  try {
    const name = (JSON.parse(readFileSync(join(packDir, ".claude-plugin", "plugin.json"), "utf8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** The unit's folder in a rendered tree, found the way skills_resolve finds it in an installed copy. */
function unitFolder(tree: string, id: string, unit: string): string | null {
  const groups = existsSync(join(tree, "attachments")) ? readdirSync(join(tree, "attachments")) : [];
  const candidates = [join(tree, "skills", unit), join(tree, "attachments", unit), ...groups.map((g) => join(tree, "attachments", g, unit))].filter((c) => existsSync(join(c, "SKILL.md")));
  // A map may carry the older versioned id, and so may the id asked for.
  const claims = (folder: string) => {
    try {
      const mapId = (JSON.parse(readFileSync(join(folder, MAP_FILE), "utf8")) as { id?: unknown }).id;
      return typeof mapId === "string" && versionless(mapId) === versionless(id);
    } catch {
      return false;
    }
  };
  return candidates.find(claims) ?? candidates[0] ?? null;
}

type RenderSeams = { pluginRoots?: () => PluginRoots; renderPacks?: (org: string | undefined) => Promise<HuskRender[]> };

/** The daemon's pull hook runs this in a child rt, so the compile never runs on its event loop; the summary is what the hook logs. */
async function renderAllHuskPacks(args: string[], json: boolean, seams: RenderSeams): Promise<void> {
  const org = flag(args, "--org");
  const results = await (seams.renderPacks ?? ((o) => renderHuskPacks(createRealProbes(), o === undefined ? {} : { org: o })))(org);
  if (json) {
    out.json({ ok: true, results });
    return;
  }
  out.print(...results.map((r) => out.line(r.ok ? "done" : "failed", r.pack, r.detail)));
}

export async function skillsRender(args: string[], seams: RenderSeams = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  if (args.includes("--husk-packs")) return renderAllHuskPacks(args, json, seams);
  const id = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));
  const dir = flag(args, "--dir");
  const match = id ? ID_RE.exec(id) : null;
  if (!id || !match || !dir) throw fail("usage", "Name the skill as <plugin>:<unit> and pass its own folder with --dir.", { next: USAGE });
  const [, plugin, stamped, unit] = match as unknown as [string, string, string | undefined, string];
  const file = flag(args, "--file") ?? "SKILL.md";
  const mattstackDir = flag(args, "--mattstack-dir");
  const home = process.env.HOME || homedir();
  const probes = createRealProbes();

  const packVersion = stamped ?? versionOfDir(id, plugin, dir, { fs: realResolveFs, home });
  if (packVersion === null) {
    throw fail("render-bad-dir", `${dir} isn't inside an installed copy of ${plugin}.`, { why: 'Pass the loaded skill\'s own directory, the one its "Base directory for this skill" line names.' });
  }
  const zone: ZoneInfo | undefined = readZones(probes, home).find((z) => pluginName(zonePackDir(z)) === plugin);
  if (!zone) throw fail("render-no-pack", `No org clone on this Mac carries the ${plugin} pack.`, { next: SETUP });
  const engine = mattstackDir ? resolvePluginRootsFromDir(mattstackDir).byName.mattstack : activeMattstack(probes, home);
  if (!engine) throw fail("render-no-mattstack", "mattstack isn't installed on this Mac.", { next: SETUP });

  const result = await ensureTree({
    home,
    root: renderRoot(home),
    zone,
    pack: zone.team,
    installedVersion: packVersion,
    mattstack: engine.version,
    rtBuild: rtVersion(),
    deps: { fs: probes, mattstackRoot: join(home, ".mattstack"), enginePackDir: engine.dir },
    ...(mattstackDir ? { mattstackDir } : { pluginRoots: () => withEngine((seams.pluginRoots ?? resolvePluginRoots)(), engine) }),
  });
  let tree: { dir: string; stamp: RenderStamp };
  let staleBecause: string | undefined;
  if (result.ok) tree = result;
  else {
    // Nothing renders this version now (the clone moved on, or the render failed); any tree a reader would pick still serves.
    const picked = pickRenderTree(probes, renderRoot(home), plugin, packVersion, engine.version, zone.org);
    const stamp = picked === null ? null : parseStamp(probes.readFile(join(picked, STAMP_FILE)));
    if (picked !== null && stamp !== null) {
      tree = { dir: picked, stamp };
      if (result.reason === "render-failed") staleBecause = firstLine(result.message);
    } else if (result.reason === "missing") throw fail("render-missing", `${plugin} ${packVersion} isn't rendered on this Mac.`, { next: SETUP, log: result.message });
    else if (result.builtWith !== undefined && compareVersions(result.builtWith, engine.version) > 0) {
      throw fail("render-engine-old", `${plugin} was built with mattstack ${result.builtWith}; this Mac has ${engine.version}.`, { next: SETUP, log: result.message });
    } else throw fail("render-failed", `${plugin} ${packVersion} didn't render on this Mac.`, { why: firstLine(result.message), log: result.message });
  }

  const folder = unitFolder(tree.dir, id, unit);
  if (!folder) throw fail("render-no-unit", `${id} isn't in the rendered ${plugin} ${packVersion}.`);
  const path = join(folder, file);
  if (posix.isAbsolute(file) || !posix.normalize(path).startsWith(`${folder}/`) || !existsSync(path)) {
    throw fail("render-no-file", `${id} has no file ${file}.`);
  }
  const body = readFileSync(path, "utf8");
  if (json) {
    out.json({ ok: true, id, packVersion, mattstack: tree.stamp.mattstack, rtBuild: tree.stamp.rtBuild, treeDir: tree.dir, path, body, ...(staleBecause !== undefined ? { staleBecause } : {}) });
    return;
  }
  if (staleBecause !== undefined) out.note(out.line("warn", `${plugin} ${packVersion} didn't render again, so this is the last good render`, staleBecause));
  out.payload(body);
}
