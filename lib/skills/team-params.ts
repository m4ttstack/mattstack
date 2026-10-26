import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { jsoncSites, stripJsonc } from "../jsonc.ts";

export type TeamValues = {
  plugin: string;
  version: string;
  params: Record<string, string>;
  sections: Record<string, string>;
};

export type MissingMarker = { kind: "param" | "section"; name: string; file: string; askedBy: string[] };

export type TeamContext = {
  values: TeamValues;
  basePlugins: ReadonlySet<string>;
  /** Keyed `kind:name`. */
  missing: Map<string, MissingMarker>;
  /** Param keys any emitted marker named. */
  used: Set<string>;
  sawMarker: boolean;
};

export const TEAM_MARKERS_MIN_ENGINE = "0.32.15";
/** The first release whose MCP server answers `skills_resolve`, which a build carrying `@keys` tells its reader to call. */
export const POINTER_KEYS_MIN_ENGINE = "0.32.28";

const PARAMS_FILE = "pack/params.jsonc";
const TEAM_MARKER_RE = /\{\{team\.(section:)?([^}\s?]*)(\?)?\}\}/g;
/** Crosses lines on purpose, so a marker split after its braces is still caught. */
const FIRST_MARKER_RE = /\{\{\s*team\.[^}\n]*(?:\}\}?)?/;
const SPLIT_MARKER_RE = /\{\{[^\S\n]*\r?\n\s*team\.[^}\n]*(?:\}\}?)?/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
/** The one nesting allowed: a value marker as pack.path's whole attachment segment. */
const PACK_PATH_TEAM_RE = /\{\{pack\.path:(\{\{team\.([^}\s?:]*)(\?)?\}\})(\/[^{}\s]*)\}\}/g;
/** What spliced team text may carry: the host text resolves these after the splice, as it does its own. */
const SKILL_PATH_RE = /\{\{(?:pack|verb)\.path:[^{}\s]+\}\}/g;

const bracesBeyondSkillPaths = (text: string) => text.replace(SKILL_PATH_RE, "").includes("{{");

export function newTeamContext(values: TeamValues, basePlugins: ReadonlySet<string>): TeamContext {
  return { values, basePlugins, missing: new Map(), used: new Set(), sawMarker: false };
}

export function hasTeamMarker(text: string): boolean {
  return FIRST_MARKER_RE.test(text);
}

export type MarkerHit = { raw: string; lineIndex: number };

function hitOf(text: string, m: RegExpExecArray | null): MarkerHit | null {
  if (!m) return null;
  return { raw: m[0].replace(/\s*\n\s*/g, " "), lineIndex: text.slice(0, m.index).split("\n").length - 1 };
}

/** The first team marker opening in `text`, whole or broken, with the 0-based index of the line its braces sit on. */
export function firstTeamMarker(text: string): MarkerHit | null {
  return hitOf(text, FIRST_MARKER_RE.exec(text));
}

export function readTeamValues(packDir: string, plugin: string, version: string): TeamValues {
  const params: Record<string, string> = Object.create(null);
  const paramsPath = join(packDir, PARAMS_FILE);
  if (existsSync(paramsPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonc(readFileSync(paramsPath, "utf8")));
    } catch (e) {
      throw new Error(`${PARAMS_FILE}: not valid JSON (${(e as Error).message})`);
    }
    const raw = (parsed as { params?: unknown } | null)?.params;
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${PARAMS_FILE}: "params" must be an object`);
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== "string") throw new Error(`${PARAMS_FILE}: "${key}" must be a string`);
        if (/[\r\n]/.test(value)) throw new Error(`${PARAMS_FILE}: "${key}" has a newline; use a section for multi-line text`);
        params[key] = value;
      }
    }
  }

  const sections: Record<string, string> = Object.create(null);
  const sectionsDir = join(packDir, "pack", "sections");
  if (existsSync(sectionsDir)) {
    for (const file of readdirSync(sectionsDir).sort()) {
      if (file.endsWith(".md")) sections[basename(file, ".md")] = readFileSync(join(sectionsDir, file), "utf8");
    }
  }
  return { plugin, version, params, sections };
}

function recordMissing(team: TeamContext, kind: "param" | "section", name: string, where: string): void {
  const key = `${kind}:${name}`;
  const file = kind === "param" ? PARAMS_FILE : `pack/sections/${name}.md`;
  const entry = team.missing.get(key) ?? { kind, name, file, askedBy: [] };
  if (!entry.askedBy.includes(where)) entry.askedBy.push(where);
  team.missing.set(key, entry);
}

/**
 * `dropped` counts the lines an absent optional section removes, which a prop seam's source-line count must leave out.
 * `lineMap` gets, for each output line in order, the 0-based body line it came from.
 */
export function resolveTeamMarkers(
  body: string,
  team: TeamContext,
  opts: { where: string; sectionSeams: boolean; startLine?: number; dropped?: { lines: number }; lineMap?: number[] },
): string {
  const { where, sectionSeams, startLine = 1, dropped, lineMap } = opts;
  const { values } = team;
  const out: string[] = [];
  let collapseBlanks = false;

  const split = hitOf(body, SPLIT_MARKER_RE.exec(body));
  if (split) throw new Error(`${where}: ${split.raw} breaks across lines; a team marker sits on one line (line ${split.lineIndex + startLine})`);

  body.split("\n").forEach((source, i) => {
    const fail = (raw: string, why: string): never => {
      throw new Error(`${where}: ${raw} ${why} (line ${i + startLine})`);
    };
    const stray = source.replace(TEAM_MARKER_RE, "").match(/\{\{[^\S\n]*team\.[^}]*(\}\}?|$)/);
    if (stray) fail(stray[0], "is not a well-formed team marker");
    const line = source.replace(PACK_PATH_TEAM_RE, (_whole, raw: string, name: string, optional: string | undefined, file: string) => {
      if (name === "section") fail(raw, "uses the reserved name section as a key");
      if (!NAME_RE.test(name)) fail(raw, "has a name that is not lowercase letters, digits and hyphens");
      if (optional) fail(raw, "is optional, but pack.path needs a value");
      team.sawMarker = true;
      team.used.add(name);
      const value = Object.hasOwn(values.params, name) ? values.params[name] : undefined;
      // The missing list refuses the compile, so the dropped placeholder never ships; leaving it would let pack.path fail first and hide that list.
      if (!value) {
        recordMissing(team, "param", name, where);
        return "";
      }
      if (value.includes("{{")) fail(raw, "has a value containing {{");
      if (/[\s{}]/.test(value)) fail(raw, "has a value pack.path cannot take");
      return `{{pack.path:${value}${file}}}`;
    });
    let removeLine = false;
    let sectionText: string | null = null;

    const resolved = line.replace(TEAM_MARKER_RE, (raw, sectionPrefix: string | undefined, name: string, optional: string | undefined, offset: number) => {
      const before = line.slice(0, offset);
      if (before.lastIndexOf("{{") > before.lastIndexOf("}}")) fail(raw, "sits inside another marker; markers do not nest");
      if (!sectionPrefix && name === "section") fail(raw, "uses the reserved name section as a key");
      if (!NAME_RE.test(name)) fail(raw, "has a name that is not lowercase letters, digits and hyphens");
      team.sawMarker = true;

      if (!sectionPrefix) {
        team.used.add(name);
        const value = Object.hasOwn(values.params, name) ? values.params[name] : undefined;
        if (!value) {
          if (!optional) recordMissing(team, "param", name, where);
          return "";
        }
        if (bracesBeyondSkillPaths(value)) fail(raw, "has a value containing {{");
        return value;
      }

      if (line.trim() !== raw) fail(raw, "must be alone on its line");
      const text = (Object.hasOwn(values.sections, name) ? values.sections[name] : undefined)?.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
      if (!text || !text.trim()) {
        if (!optional) recordMissing(team, "section", name, where);
        removeLine = true;
        return "";
      }
      if (bracesBeyondSkillPaths(text)) fail(raw, `has a section pack/sections/${name}.md containing {{`);
      const lines = text.split("\n").length;
      const indent = line.slice(0, line.length - line.trimStart().length);
      const indented = text.split("\n").map((l) => (l === "" ? l : indent + l)).join("\n");
      // Every seam parser anchors a marker at column 0, so only the section's own lines take the indent.
      sectionText = sectionSeams
        ? `<!-- part: section:${name} source=${values.plugin}:pack/sections/${name}.md version=${values.version} path=pack/sections/${name}.md lines=1-${lines} -->\n${indented}`
        : indented;
      return "";
    });

    // A removed line's surrounding blanks would otherwise stack into a run, so blanks after it go while a blank already precedes them.
    const blankAfterRemoval = collapseBlanks && sectionText === null && resolved.trim() === "" && (out.length === 0 || out[out.length - 1]!.trim() === "");
    if (removeLine || blankAfterRemoval) {
      if (dropped) dropped.lines++;
      collapseBlanks = true;
      return;
    }
    collapseBlanks = collapseBlanks && sectionText === null && resolved.trim() === "";
    const text = sectionText ?? resolved;
    if (lineMap) for (let n = text.split("\n").length; n > 0; n--) lineMap.push(i);
    out.push(text);
  });

  return out.join("\n");
}

/** Team text compile splices into base text, with where it starts in its own file: `indent` is the 0-based column of its first character. */
export type TeamInput = { file: string; text: string; startLine: number; indent: number; noFix?: true };

/** `list` names a folder's files; an editor adds the open files not yet saved. */
export type TeamInputIO = { read: (abs: string) => string | null; list?: (dir: string) => string[] };

const readIfPresent = (abs: string) => (existsSync(abs) ? readFileSync(abs, "utf8") : null);
const listIfPresent = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

/** Every section and every param value, for the checks that run on them as compile input; params that do not parse are readTeamValues's to report. */
export function teamInputs(packDir: string, io: TeamInputIO = { read: readIfPresent }): TeamInput[] {
  const out: TeamInput[] = [];
  const sectionsDir = join(packDir, "pack", "sections");
  const names = [...new Set((io.list ?? listIfPresent)(sectionsDir))].filter((f) => f.endsWith(".md")).sort();
  for (const name of names) {
    const text = io.read(join(sectionsDir, name));
    if (text !== null) out.push({ file: `pack/sections/${name}`, text, startLine: 1, indent: 0 });
  }
  const raw = io.read(join(packDir, PARAMS_FILE));
  if (raw === null) return out;
  let params: unknown;
  try {
    params = (JSON.parse(stripJsonc(raw)) as { params?: unknown } | null)?.params;
  } catch {
    return out;
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) return out;
  const sites = jsoncSites(raw);
  const lines = raw.split("\n");
  for (const [key, value] of Object.entries(params)) {
    const at = sites.get(JSON.stringify(["params", key]))?.value;
    if (typeof value !== "string" || !at) continue;
    const input: TeamInput = { file: PARAMS_FILE, text: value, startLine: at.line, indent: at.col };
    // An escape makes the parsed value shorter than its source, so a fix at the parsed column would edit the wrong span.
    const literal = /^"(?:[^"\\]|\\.)*"/.exec((lines[at.line - 1] ?? "").slice(at.col - 1))?.[0] ?? "";
    if (literal.includes("\\")) input.noFix = true;
    out.push(input);
  }
  return out;
}
