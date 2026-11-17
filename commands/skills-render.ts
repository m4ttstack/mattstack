import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { UserActionableError } from "../lib/errors.ts";
import { rtVersion } from "../lib/setup/update.ts";
import { readZones, zonePackDir, type ZoneInfo } from "../lib/skills/init.ts";
import { compareVersions } from "../lib/skills/installed-plugins.ts";
import { ensureTree, renderRoot } from "../lib/skills/render-cache.ts";
import { realResolveFs, versionOfDir } from "../lib/skills/resolve.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir } from "../lib/skills/sources.ts";
import { MAP_FILE } from "../lib/skills/unit-maps.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import * as out from "../lib/ui/out.ts";

const USAGE = "rt skills render <plugin>:<unit> --dir <skill dir> [--file <path>] --json";
const SETUP = "rt setup";
const ID_RE = /^([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function fail(code: string, message: string, opts: { next?: string; log?: string } = {}): UserActionableError {
  return new UserActionableError(code, message, opts.next ? { next: opts.next } : {}, opts);
}

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
  const claims = (folder: string) => {
    try {
      return (JSON.parse(readFileSync(join(folder, MAP_FILE), "utf8")) as { id?: unknown }).id === id;
    } catch {
      return false;
    }
  };
  return candidates.find(claims) ?? candidates[0] ?? null;
}

export async function skillsRender(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const id = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const dir = flag(args, "--dir");
  const match = id ? ID_RE.exec(id) : null;
  if (!id || !match || !dir) throw fail("usage", "Name the skill as <plugin>:<unit> and pass its own folder with --dir.", { next: USAGE });
  const [, plugin, unit] = match as unknown as [string, string, string];
  const file = flag(args, "--file") ?? "SKILL.md";
  const mattstackDir = flag(args, "--mattstack-dir");
  const home = process.env.HOME || homedir();
  const probes = createRealProbes();

  const packVersion = versionOfDir(id, plugin, dir, { fs: realResolveFs, home });
  if (packVersion === null) throw fail("render-bad-dir", `${dir} isn't inside an installed copy of ${plugin}.`, { next: USAGE });
  const zone: ZoneInfo | undefined = readZones(probes, home).find((z) => pluginName(zonePackDir(z)) === plugin);
  if (!zone) throw fail("render-no-pack", `No org clone on this Mac carries the ${plugin} pack.`, { next: SETUP });
  const engine = (mattstackDir ? resolvePluginRootsFromDir(mattstackDir) : resolvePluginRoots()).byName.mattstack;
  if (!engine) throw fail("render-no-mattstack", "mattstack isn't installed on this Mac.", { next: SETUP });

  const result = await ensureTree({
    root: renderRoot(home),
    zone,
    pack: zone.team,
    installedVersion: packVersion,
    mattstack: engine.version,
    rtBuild: rtVersion(),
    deps: { fs: probes, mattstackRoot: join(home, ".mattstack"), enginePackDir: engine.dir },
    mattstackDir,
  });
  if (!result.ok) {
    if (result.reason === "missing") throw fail("render-missing", `${plugin} ${packVersion} isn't rendered on this Mac.`, { next: SETUP, log: result.message });
    if (result.builtWith !== undefined && compareVersions(result.builtWith, engine.version) > 0) {
      throw fail("render-engine-old", `${plugin} was built with mattstack ${result.builtWith}; this Mac has ${engine.version}.`, { next: SETUP, log: result.message });
    }
    throw fail("render-failed", `${plugin} ${packVersion} didn't render on this Mac.`, { log: result.message });
  }

  const folder = unitFolder(result.dir, id, unit);
  if (!folder) throw fail("render-no-unit", `${id} isn't in the rendered ${plugin} ${packVersion}.`);
  const path = join(folder, file);
  if (posix.isAbsolute(file) || !posix.normalize(path).startsWith(`${folder}/`) || !existsSync(path)) {
    throw fail("render-no-file", `${id} has no file ${file}.`);
  }
  const body = readFileSync(path, "utf8");
  if (json) {
    out.json({ ok: true, id, packVersion, mattstack: result.stamp.mattstack, rtBuild: result.stamp.rtBuild, treeDir: result.dir, path, body });
    return;
  }
  out.payload(body);
}
