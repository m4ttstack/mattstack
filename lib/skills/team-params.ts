import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { stripJsonc } from "./sources.ts";

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

const PARAMS_FILE = "pack/params.jsonc";
const TEAM_MARKER_RE = /\{\{team\.(section:)?([^}\s?]*)(\?)?\}\}/g;
/** Crosses lines on purpose, so a marker split after its braces is still caught. */
const FIRST_MARKER_RE = /\{\{\s*team\.[^}\n]*(?:\}\}?)?/;
const SPLIT_MARKER_RE = /\{\{[ \t]*\r?\n\s*team\.[^}\n]*(?:\}\}?)?/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;

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

export function resolveTeamMarkers(body: string, team: TeamContext, opts: { where: string; sectionSeams: boolean; startLine?: number }): string {
  const { where, sectionSeams, startLine = 1 } = opts;
  const { values } = team;
  const out: string[] = [];

  const split = hitOf(body, SPLIT_MARKER_RE.exec(body));
  if (split) throw new Error(`${where}: ${split.raw} breaks across lines; a team marker sits on one line (line ${split.lineIndex + startLine})`);

  body.split("\n").forEach((line, i) => {
    const fail = (raw: string, why: string): never => {
      throw new Error(`${where}: ${raw} ${why} (line ${i + startLine})`);
    };
    const stray = line.replace(TEAM_MARKER_RE, "").match(/\{\{[ \t]*team\.[^}]*(\}\}?|$)/);
    if (stray) fail(stray[0], "is not a well-formed team marker");
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
        if (value.includes("{{")) fail(raw, "has a value containing {{");
        return value;
      }

      if (line.trim() !== raw) fail(raw, "must be alone on its line");
      const text = (Object.hasOwn(values.sections, name) ? values.sections[name] : undefined)?.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
      if (!text || !text.trim()) {
        if (!optional) recordMissing(team, "section", name, where);
        removeLine = true;
        return "";
      }
      if (text.includes("{{")) fail(raw, `has a section pack/sections/${name}.md containing {{`);
      const lines = text.split("\n").length;
      const indent = line.slice(0, line.length - line.trimStart().length);
      const indented = text.split("\n").map((l) => (l === "" ? l : indent + l)).join("\n");
      // Every seam parser anchors a marker at column 0, so only the section's own lines take the indent.
      sectionText = sectionSeams
        ? `<!-- part: section:${name} source=${values.plugin}:pack/sections/${name}.md version=${values.version} path=pack/sections/${name}.md lines=1-${lines} -->\n${indented}`
        : indented;
      return "";
    });

    if (removeLine) return;
    out.push(sectionText ?? resolved);
  });

  return out.join("\n");
}
