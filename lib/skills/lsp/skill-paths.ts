import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripJsonc } from "../../jsonc.ts";
import { normalizePipelines } from "../pipelines.ts";
import { packPathResolves } from "../placeholders.ts";
import { listDirs, readSurface, readVerbRoster, stageRoster, stripFrontmatter } from "../sources.ts";
import type { Side } from "../types.ts";
import { blockIn } from "./lookup.ts";
import type { ManifestBindings, Plugin, Workspace } from "./workspace.ts";

/**
 * A plugin that compiles verbs: the pack its engines' pack.path and verb.path markers resolve against.
 * `compiled` holds output folders of verbs the workspace has no entry for (a stage named only in a
 * manifest outside the workspace), with the side they sit on now, which compile may not keep.
 */
export type Pack = { plugin: Plugin; verbSides: Record<string, Side>; engines: Set<string>; compiled: Map<string, Side> };

/** `compiled`: the target is compile output, which pack.path cannot name and a recompile replaces. */
export type PathTarget = { rel: string; file: string; exists: boolean; compiled: boolean };

const SIDES = ["attachments", "skills"] as const;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The verb set compile's `verbSides` holds: the roster, then the stages of the pipelines in the pack's
 * own manifests. A plugin with no roster compiles nothing, so it is no pack.
 */
export function readPack(plugin: Plugin, manifests: { text: string; bindings: ManifestBindings }[]): Pack | null {
  let roster;
  try {
    roster = readVerbRoster(plugin.dir);
  } catch {
    return null;
  }
  if (roster.length === 0) return null;
  let surface = null;
  try {
    surface = readSurface(plugin.dir);
  } catch {
    surface = null;
  }
  const verbSides: Record<string, Side> = {};
  const engines = new Set<string>();
  for (const verb of roster) {
    verbSides[verb.name] = !surface || surface.public.includes(verb.name) ? "skills" : "attachments";
    engines.add(verb.engine);
  }
  for (const { text, bindings } of manifests) {
    try {
      const { stages } = normalizePipelines((JSON.parse(stripJsonc(text)) as { pipelines?: unknown }).pipelines);
      for (const stage of stageRoster(stages, bindings.pipelineLayered, bindings.layered)) {
        verbSides[stage.name] ??= surface?.public.includes(stage.name) ? "skills" : "attachments";
        engines.add(stage.engine);
      }
    } catch {
      continue;
    }
  }
  return { plugin, verbSides, engines, compiled: compiledFolders(plugin.dir, verbSides) };
}

/** Compile writes `metadata.compiled` into every SKILL.md it emits (`buildFrontmatter`), so the marker names its output. */
function compiledFolders(dir: string, verbSides: Record<string, Side>): Map<string, Side> {
  const out = new Map<string, Side>();
  for (const side of SIDES) {
    for (const name of listDirs(join(dir, side))) {
      if (Object.hasOwn(verbSides, name) || out.has(name)) continue;
      try {
        const { frontmatter } = stripFrontmatter(readFileSync(join(dir, side, name, "SKILL.md"), "utf8"));
        const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object" ? (frontmatter.metadata as Record<string, unknown>) : {};
        if (typeof metadata.compiled === "string") out.set(name, side);
      } catch {
        continue;
      }
    }
  }
  return out;
}

const isCompiled = (pack: Pack, name: string) => Object.hasOwn(pack.verbSides, name) || pack.compiled.has(name);

/**
 * The options compile hands `handPathDiagnostics` for this pack. An output folder of unknown side counts as
 * a verb for pack.path, which then refuses it, but is no verb.path fix, since its side may be wrong.
 */
export function fixView(pack: Pack): { verbs: ReadonlySet<string>; packSource: (arg: string) => boolean } {
  const verbSides = { ...pack.verbSides, ...Object.fromEntries(pack.compiled) };
  const view = { verbSides, packRoot: pack.plugin.dir };
  return { verbs: new Set(Object.keys(pack.verbSides)), packSource: (arg) => packPathResolves(view, arg) };
}

/** The packs whose compile reads `file`: those compiling the engine that holds it, else the pack holding it. */
export function packsFor(ws: Workspace, file: string): Pack[] {
  const analysis = ws.analysis();
  const held = blockIn(ws, file);
  if (held) return analysis.enginePacks.get(held.tree.dir) ?? [];
  const plugin = ws.pluginAt(file);
  const own = plugin && analysis.packs.find((p) => p.plugin.dir === plugin.dir);
  return own ? [own] : [];
}

/** The pack's own value for a team param, read from `pack/params.jsonc` as the workspace holds it; null when unset or unreadable. */
export function teamValue(ws: Workspace, pack: Pack, key: string): string | null {
  try {
    const params = (JSON.parse(stripJsonc(ws.text(join(pack.plugin.dir, "pack", "params.jsonc")))) as { params?: Record<string, unknown> } | null)?.params;
    const value = params && typeof params === "object" && Object.hasOwn(params, key) ? params[key] : undefined;
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Where `{{pack.path:<attachment>/<file>}}` points from the pack's root, on whichever side holds the folder. */
export function packTarget(pack: Pack, attachment: string, file: string): PathTarget | null {
  if (attachment === "" || file === "") return null;
  const side = SIDES.find((s) => isDirectory(join(pack.plugin.dir, s, attachment))) ?? "attachments";
  const rel = `${side}/${attachment}/${file}`;
  const path = join(pack.plugin.dir, side, attachment, ...file.split("/"));
  const compiled = isCompiled(pack, attachment);
  return { rel, file: path, exists: !compiled && isFile(path), compiled };
}

/**
 * A compiled verb's SKILL.md, on the side compile writes it to. An output folder of unknown side comes back
 * `compiled`, where it sits now; null for a name the pack does not compile.
 */
export function verbTarget(pack: Pack, verb: string): PathTarget | null {
  const known = Object.hasOwn(pack.verbSides, verb);
  const side = known ? pack.verbSides[verb]! : pack.compiled.get(verb);
  if (side === undefined) return null;
  const rel = `${side}/${verb}/SKILL.md`;
  const path = join(pack.plugin.dir, side, verb, "SKILL.md");
  return { rel, file: path, exists: isFile(path), compiled: !known };
}

/** The folders pack.path may name: source under attachments/ and skills/, never a compiled verb's output. */
export function unitNames(pack: Pack): string[] {
  const names = new Set(SIDES.flatMap((s) => listDirs(join(pack.plugin.dir, s))));
  return [...names].filter((n) => !isCompiled(pack, n)).sort();
}

/** Every file under a folder pack.path may name, relative to it. */
export function unitFiles(pack: Pack, unit: string): string[] {
  if (isCompiled(pack, unit)) return [];
  const side = SIDES.find((s) => isDirectory(join(pack.plugin.dir, s, unit)));
  if (!side) return [];
  const root = join(pack.plugin.dir, side, unit);
  return filesUnder(root).map((f) => relative(root, f).split(sep).join("/")).sort();
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(path));
    else if (e.isFile()) out.push(path);
  }
  return out;
}

/** The Markdown files under a pack a compile can read as a fill, block files aside. */
export function fillFiles(pack: Pack): string[] {
  return SIDES.flatMap((s) => filesUnder(join(pack.plugin.dir, s))).filter((f) => f.endsWith(".md") && !f.endsWith(".block.md"));
}

/** `path` as pack.path's argument (`<attachment>/<file>`, or the folder alone), or null when outside the pack's sides. */
export function packArg(pack: Pack, path: string): string | null {
  for (const side of SIDES) {
    const base = join(pack.plugin.dir, side);
    if (!path.startsWith(base + sep)) continue;
    return relative(base, path).split(sep).join("/");
  }
  return null;
}
