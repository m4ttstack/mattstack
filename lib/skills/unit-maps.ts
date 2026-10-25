import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { BlockDiagnostic } from "./blocks/diagnostics.ts";
import { HEADER_COMMENT } from "./compile.ts";
import { FRONTMATTER_RE } from "./frontmatter-re.ts";
import { closeMap, isKey, KEY_TOKEN_RE, keyBody, leftoverTokens, openingLine, type PointerMap, type Target, type UnitTable } from "./pointers.ts";
import type { CompiledFile, Side } from "./types.ts";

export const MAP_FILE = "compiled.json";

/** One compiled unit before its closure is known: its own keys, and the leaf of every unit it reads by path. */
export type UnitPointers = { leaf: string; dir: string; keys: Record<string, Target>; reads: string[] };

/** Where a unit's files are keyed from: its id, its plugin-relative folder and the pack's unit table. */
export type PointerSite = { id: string; dir: string; units: UnitTable };

export function leafOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/** Every unit a compile writes: each target at `<side>/<name>`, each emitted base copy at `attachments/<rel>`. */
export function unitTableOf(verbSides: Record<string, Side>, emitted: Iterable<string>): UnitTable {
  const units: UnitTable = {};
  for (const [name, side] of Object.entries(verbSides)) units[name] = `${side}/${name}`;
  for (const rel of emitted) units[leafOf(rel)] = `attachments/${rel}`;
  return units;
}

/** The line goes right under the compiler header, or opens the body of a file that has none. */
export function withOpeningLine(text: string, id: string): string {
  const head = text.match(FRONTMATTER_RE)?.[0] ?? "";
  const body = text.slice(head.length);
  const lead = body.match(/^\s*/)![0];
  if (body.startsWith(HEADER_COMMENT, lead.length)) {
    const at = head.length + lead.length + HEADER_COMMENT.length;
    return `${text.slice(0, at)}\n${openingLine(id)}${text.slice(at)}`;
  }
  return `${head}${openingLine(id)}\n\n${body.replace(/^\n+/, "")}`;
}

/** Keys every `.md` the unit writes, a copied one included, and opens each with the unit's line. */
export function keyFiles(files: CompiledFile[], site: PointerSite): { files: CompiledFile[]; keys: Record<string, Target> } {
  const keys: Record<string, Target> = {};
  const keyed = files.map((file): CompiledFile => {
    if (!file.path.endsWith(".md")) return file;
    const text = "content" in file ? file.content : readFileSync(file.copyFrom, "utf8");
    const out = keyBody(text, { dir: site.dir, fileRel: file.path, units: site.units });
    Object.assign(keys, out.targets);
    return { path: file.path, content: withOpeningLine(out.text, site.id) };
  });
  return { files: keyed, keys };
}

function sameTarget(a: Target, b: Target): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** closeMap would refuse the same key, but only this pass knows which two units claimed it. */
function assertOneTarget(leaf: string, maps: PointerMap[]): void {
  const held = new Map<string, { target: Target; id: string }>();
  for (const map of maps) {
    for (const [key, target] of Object.entries(map.keys)) {
      const first = held.get(key);
      if (!first) held.set(key, { target, id: map.id });
      else if (!sameTarget(first.target, target)) {
        throw new Error(`pointer key @${key} has two targets in ${leaf}'s closure: ${first.id} names ${JSON.stringify(first.target)} and ${map.id} names ${JSON.stringify(target)}`);
      }
    }
  }
}

/**
 * Each unit's map is its own keys plus every unit it reaches by reading,
 * carried transitively. A unit this run did not compile comes from `outside`,
 * whose map is already closed, so the walk stops there.
 */
export function closeUnits(units: UnitPointers[], idOf: (leaf: string) => string, outside: (leaf: string) => PointerMap | null): Map<string, PointerMap> {
  const own = new Map(units.map((u) => [u.leaf, { map: { id: idOf(u.leaf), dir: u.dir, covers: [idOf(u.leaf)], keys: u.keys }, reads: u.reads }]));
  const closed = new Map<string, PointerMap>();
  for (const unit of units) {
    const reached: PointerMap[] = [];
    const seen = new Set([unit.leaf]);
    const queue = [...unit.reads];
    while (queue.length > 0) {
      const leaf = queue.shift()!;
      if (seen.has(leaf)) continue;
      seen.add(leaf);
      const inRun = own.get(leaf);
      if (inRun) queue.push(...inRun.reads);
      const map = inRun?.map ?? outside(leaf) ?? { id: idOf(leaf), dir: "", covers: [], keys: {} };
      reached.push(map);
    }
    const start = own.get(unit.leaf)!.map;
    assertOneTarget(unit.leaf, [start, ...reached]);
    closed.set(unit.leaf, closeMap(start, reached));
  }
  return closed;
}

/** A base copy's provenance keys come first, so its masked `version` stays the first one. */
export function mapFileText(map: PointerMap, provenance: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...provenance, ...map }, null, 2) + "\n";
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The map a unit's last compile wrote, when it was written for `id`: a stamp from another version names other files. */
export function readUnitMap(packDir: string, dir: string, id: string): PointerMap | null {
  const parsed = readJson(join(packDir, dir, MAP_FILE));
  if (!parsed || parsed.id !== id || !Array.isArray(parsed.covers) || !parsed.keys || typeof parsed.keys !== "object") return null;
  return { id, dir, covers: parsed.covers as string[], keys: parsed.keys as Record<string, Target> };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function keyTokens(text: string): { token: string; line: number; col: number }[] {
  const start = text.match(FRONTMATTER_RE)?.[0].length ?? 0;
  const out: { token: string; line: number; col: number }[] = [];
  for (const m of text.slice(start).matchAll(KEY_TOKEN_RE)) {
    const at = start + m.index;
    const before = text.slice(0, at);
    out.push({ token: m[0].replace(/\.+$/, ""), line: before.split("\n").length, col: at - before.lastIndexOf("\n") });
  }
  return out;
}

/**
 * Reads every `.md` in each compiled unit folder against the map beside it:
 * a key the map lacks dangles, an entry that names no file (a folder
 * included) is missing, and a `${CLAUDE_SKILL_DIR}` outside frontmatter is left over.
 */
export function pointerErrorsIn(packDir: string, dirs: string[], units: UnitTable): BlockDiagnostic[] {
  const out: BlockDiagnostic[] = [];
  for (const dir of dirs) {
    const abs = join(packDir, dir);
    if (!isDir(abs)) continue;
    const keys = (readJson(join(abs, MAP_FILE))?.keys ?? {}) as Record<string, Target>;
    const mds = (readdirSync(abs, { recursive: true }) as string[]).filter((rel) => rel.endsWith(".md") && isFile(join(abs, rel))).sort();
    for (const rel of mds) {
      const file = `${dir}/${rel}`;
      const text = readFileSync(join(abs, rel), "utf8");
      const rows: BlockDiagnostic[] = leftoverTokens(text).map((at) => ({
        file, ...at, code: "leftover-token", message: "${CLAUDE_SKILL_DIR} is left in a compiled body; compile writes each pointer there as an @key",
      }));
      for (const { token, line, col } of keyTokens(text)) {
        if (!isKey(token, units)) continue;
        const target = Object.hasOwn(keys, token.slice(1)) ? keys[token.slice(1)]! : undefined;
        if (target === undefined) rows.push({ file, line, col, code: "dangling-key", message: `${token} is not in this skill's pointer map` });
        else if (typeof target === "string" && !isFile(join(packDir, target))) rows.push({ file, line, col, code: "missing-target", message: `${token} points at ${target}, which is not a file` });
      }
      out.push(...rows.sort((a, b) => a.line - b.line || a.col - b.col));
    }
  }
  return out;
}
