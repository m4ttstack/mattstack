import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { BlockDiagnostic } from "./blocks/diagnostics.ts";
import { HEADER_COMMENT } from "./compile.ts";
import { FRONTMATTER_RE } from "./frontmatter-re.ts";
import { closeMap, ID_RE, isKey, KEY_TOKEN_RE, keyBody, leftoverTokens, openingLine, unitId, type PointerMap, type Target, type UnitTable } from "./pointers.ts";
import type { CompiledFile, PlannedAttachments, Side, StageEntry } from "./types.ts";

export const MAP_FILE = "compiled.json";

/** One compiled unit before its closure is known: its own keys, and the leaf of every unit it reads by path. */
export type UnitPointers = { leaf: string; dir: string; keys: Record<string, Target>; reads: string[] };

/** Where a unit's files are keyed from: its id, its plugin-relative folder and the pack's unit table. */
export type PointerSite = { id: string; dir: string; units: UnitTable };

export type Identity = { name: string; version: string };

/** A pack's plugin identity, or the one fault that keeps its units from carrying an id. */
export type PackIdentity = ({ ok: true } & Identity) | { ok: false; file: string; fault: string };

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

/** A planned unit with nothing in it is one the compile removes. */
export function emittedUnits(planned: PlannedAttachments | undefined): string[] {
  return planned ? [...planned].filter(([, files]) => files.size > 0).map(([rel]) => rel) : [];
}

/** The stages an orchestrator reads by path: its pipeline's, or every pipeline's for `{{pipeline.stages}}`. */
export function stageReadsOf(entries: Record<string, StageEntry[]>, pipeline: string | null, everyPipeline: boolean): string[] {
  const lists = everyPipeline ? Object.values(entries) : pipeline !== null && Object.hasOwn(entries, pipeline) ? [entries[pipeline]!] : [];
  return [...new Set(lists.flat().map((e) => e.name))];
}

/** The id `<plugin>@<version>:<unit>` has to pass `ID_RE`, so a name or version it cannot carry refuses here, not at resolve. */
export function readPackIdentity(packDir: string): PackIdentity {
  const file = join(packDir, ".claude-plugin", "plugin.json");
  if (!existsSync(file)) return { ok: false, file, fault: "is missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, file, fault: "cannot be read as JSON" };
  }
  const { name, version } = (parsed && typeof parsed === "object" ? parsed : {}) as { name?: unknown; version?: unknown };
  if (typeof name !== "string" || name === "") return { ok: false, file, fault: "has no name" };
  if (typeof version !== "string" || version === "") return { ok: false, file, fault: "has no version" };
  if (!ID_RE.test(unitId(name, "0", "unit"))) return { ok: false, file, fault: `has the name "${name}", which a skill id cannot carry: use lowercase letters, digits and dashes` };
  if (!ID_RE.test(unitId(name, version, "unit"))) return { ok: false, file, fault: `has the version "${version}", which a skill id cannot carry: use numbers and dots only` };
  return { ok: true, name, version };
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

/**
 * Keys every `.md` the unit writes, a copied one included. A file that holds
 * a key opens with the unit's line; the unit's own SKILL.md waits for its
 * closure, since a key it reaches only through another unit still needs one.
 */
export function keyFiles(files: CompiledFile[], site: PointerSite): { files: CompiledFile[]; keys: Record<string, Target> } {
  const keys: Record<string, Target> = {};
  const keyed = files.map((file): CompiledFile => {
    if (!file.path.endsWith(".md")) return file;
    const text = "content" in file ? file.content : readFileSync(file.copyFrom, "utf8");
    const out = keyBody(text, { dir: site.dir, fileRel: file.path, units: site.units });
    Object.assign(keys, out.targets);
    const opens = file.path !== UNIT_SKILL_MD && Object.keys(out.targets).length > 0;
    return { path: file.path, content: opens ? withOpeningLine(out.text, site.id) : out.text };
  });
  return { files: keyed, keys };
}

const UNIT_SKILL_MD = "SKILL.md";

/** The unit's SKILL.md opens with its line once its closed map holds a key. */
function withSkillMdLine(files: CompiledFile[], map: PointerMap): CompiledFile[] {
  if (Object.keys(map.keys).length === 0) return files;
  return files.map((f) => (f.path === UNIT_SKILL_MD ? { path: f.path, content: withOpeningLine("content" in f ? f.content : readFileSync(f.copyFrom, "utf8"), map.id) } : f));
}

/** Two units in one closure claim one key for different files; a full compile of the pack writes them from one table again. */
export class PointerConflictError extends Error {}

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
        throw new PointerConflictError(`pointer key @${key} has two targets in ${leaf}'s closure: ${first.id} names ${JSON.stringify(first.target)} and ${map.id} names ${JSON.stringify(target)}`);
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

/** A base copy's provenance keys come first, so its masked `version` stays the first one. Keys are sorted so rewording a body never reorders the file. */
export function mapFileText(map: PointerMap, provenance: Record<string, unknown> = {}): string {
  const keys = Object.fromEntries(Object.entries(map.keys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({ ...provenance, ...map, keys }, null, 2) + "\n";
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return parseObject(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
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

type Compiled = { files: CompiledFile[]; pointers?: { keys: Record<string, Target>; reads: string[] } };

/**
 * Closes every unit's pointer map once all of them have compiled. Each
 * compiled target gets its closed map back in `maps`, by leaf, for
 * `withMapFile`; each base copy comes back with its compiled.json carrying the
 * map after its provenance. A unit this run did not compile lends the map its last compile wrote.
 */
export function attachMaps<E extends { name: string } & Compiled>(input: {
  packDir: string;
  identity: Identity;
  units: UnitTable;
  compiled: ({ leaf: string } & Compiled)[];
  emits: E[];
}): { maps: Map<string, PointerMap>; emits: E[] } {
  const { packDir, identity, units } = input;
  const idOf = (leaf: string) => unitId(identity.name, identity.version, leaf);
  const pointers: UnitPointers[] = [
    ...input.compiled.flatMap((c) => (c.pointers ? [{ leaf: c.leaf, dir: units[c.leaf]!, ...c.pointers }] : [])),
    ...input.emits.flatMap((e) => (e.pointers ? [{ leaf: leafOf(e.name), dir: `attachments/${e.name}`, ...e.pointers }] : [])),
  ];
  const closed = closeUnits(pointers, idOf, (leaf) => (Object.hasOwn(units, leaf) ? readUnitMap(packDir, units[leaf]!, idOf(leaf)) : null));
  const maps = new Map<string, PointerMap>();
  for (const c of input.compiled) {
    const map = closed.get(c.leaf);
    if (map) maps.set(c.leaf, map);
  }
  const emits = input.emits.map((e) => {
    const map = closed.get(leafOf(e.name));
    if (!map) return e;
    const files = e.files.map((f): CompiledFile => (f.path === MAP_FILE && "content" in f ? { path: f.path, content: mapFileText(map, parseObject(f.content) ?? {}) } : f));
    return { ...e, files: withSkillMdLine(files, map) };
  });
  return { maps, emits };
}

/** A compiled target's files with its compiled.json and SKILL.md line, when the closure gave it a map. */
export function withMapFile(files: CompiledFile[], map: PointerMap | undefined): CompiledFile[] {
  return map ? [...withSkillMdLine(files, map), { path: MAP_FILE, content: mapFileText(map) }] : files;
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

/** A compiled unit as the pointer scan reads it: its folder, its `.md` files and its compiled.json text. */
export type ScannedUnit = { dir: string; mds: { rel: string; text: string }[]; mapText: string | null };

/** Each unit as it sits on disk; a folder that is not there is left out. */
export function unitsOnDisk(packDir: string, dirs: string[]): ScannedUnit[] {
  return dirs.flatMap((dir) => {
    const abs = join(packDir, dir);
    if (!isDir(abs)) return [];
    const rels = (readdirSync(abs, { recursive: true }) as string[]).filter((rel) => rel.endsWith(".md") && isFile(join(abs, rel))).sort();
    const mapPath = join(abs, MAP_FILE);
    return [{ dir, mds: rels.map((rel) => ({ rel, text: readFileSync(join(abs, rel), "utf8") })), mapText: isFile(mapPath) ? readFileSync(mapPath, "utf8") : null }];
  });
}

/** Each unit as this run's compile would write it. */
export function unitsInMemory(units: { dir: string; files: CompiledFile[] }[]): ScannedUnit[] {
  return units.map(({ dir, files }) => {
    const text = (f: CompiledFile) => ("content" in f ? f.content : readFileSync(f.copyFrom, "utf8"));
    const map = files.find((f) => f.path === MAP_FILE);
    return { dir, mds: files.filter((f) => f.path.endsWith(".md")).map((f) => ({ rel: f.path, text: text(f) })).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)), mapText: map ? text(map) : null };
  });
}

/** A file `isFile` is asked about is pack-relative; one under a unit this run compiled exists only if the run writes it. */
export function fileCheckFor(packDir: string, units: { dir: string; files: CompiledFile[] }[]): (target: string) => boolean {
  const written = new Set(units.flatMap(({ dir, files }) => files.map((f) => `${dir}/${f.path}`)));
  const dirs = units.map((u) => `${u.dir}/`);
  return (target) => (dirs.some((d) => target.startsWith(d)) ? written.has(target) : isFile(join(packDir, target)));
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

function entrySite(mapText: string, key: string): { line: number; col: number } {
  const lines = mapText.split("\n");
  const i = lines.findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(key)}:`));
  return i < 0 ? { line: 1, col: 1 } : { line: i + 1, col: lines[i]!.length - lines[i]!.trimStart().length + 1 };
}

const missing = (token: string, target: string) => `${token} points at ${target}, which is not a file`;

/**
 * Reads every `.md` of each unit against the map beside it: a key the map
 * lacks dangles, an entry that names no file (a folder included) is missing,
 * and a `${CLAUDE_SKILL_DIR}` outside frontmatter is left over. An entry no
 * body uses is reported once, at the compiled.json of the first unit holding it.
 */
export function pointerErrorsIn(units: ScannedUnit[], table: UnitTable, fileExists: (target: string) => boolean): BlockDiagnostic[] {
  const out: BlockDiagnostic[] = [];
  const reported = new Set<string>();
  const keysOf = (u: ScannedUnit) => ((u.mapText === null ? null : parseObject(u.mapText))?.keys ?? {}) as Record<string, Target>;
  for (const unit of units) {
    const keys = keysOf(unit);
    for (const { rel, text } of unit.mds) {
      const file = `${unit.dir}/${rel}`;
      const rows: BlockDiagnostic[] = leftoverTokens(text).map((at) => ({
        file, ...at, code: "leftover-token", message: "${CLAUDE_SKILL_DIR} is left in a compiled body; compile writes each pointer there as an @key",
      }));
      for (const { token, line, col } of keyTokens(text)) {
        if (!isKey(token, table)) continue;
        const key = token.slice(1);
        const target = Object.hasOwn(keys, key) ? keys[key]! : undefined;
        if (target === undefined) rows.push({ file, line, col, code: "dangling-key", message: `${token} is not in this skill's pointer map` });
        else if (typeof target === "string" && !fileExists(target)) {
          reported.add(key);
          rows.push({ file, line, col, code: "missing-target", message: missing(token, target) });
        }
      }
      out.push(...rows.sort((a, b) => a.line - b.line || a.col - b.col));
    }
  }
  for (const unit of units) {
    for (const [key, target] of Object.entries(keysOf(unit))) {
      if (reported.has(key) || typeof target !== "string" || fileExists(target)) continue;
      reported.add(key);
      out.push({ file: `${unit.dir}/${MAP_FILE}`, ...entrySite(unit.mapText!, key), code: "missing-target", message: missing(`@${key}`, target) });
    }
  }
  return out;
}
