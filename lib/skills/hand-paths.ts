import { existsSync } from "fs";
import { join } from "path";
import type { BlockDiagnostic } from "./blocks/diagnostics.ts";

type Anchor = "relative" | "skill-dir" | "plugin-root";

export type HandPath = { path: string; anchor: Anchor; ups: number; rest: string; line: number; col: number };

type Where = { startLine?: number; indent?: number };

const PATH_RE = new RegExp(
  "(?:" + [
    String.raw`(?:\$\{CLAUDE_SKILL_DIR\}|\$CLAUDE_SKILL_DIR)\/(?<skillUps>(?:\.\.\/)+)`,
    String.raw`(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)\/(?<pluginRoot>)`,
    String.raw`(?<![\w.\/}-])(?<ups>(?:\.\.\/)+)`,
  ].join("|") + ")" + String.raw`(?<rest>(?:[\w.\/-]|\{\{[^{}]*\}\}|<[\w-]+>)*)`,
  "g",
);
const SAFE_FORM_RE = /\{\{(?:pack|verb)\.path:[^{}]*\}\}/g;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const SKILL_DIR = "${CLAUDE_SKILL_DIR}";

/** Every path in `text` that leaves its skill's folder, or starts at the plugin root; a path inside a pack.path or verb.path marker is not one. */
export function findHandPaths(text: string, where: Where = {}): HandPath[] {
  const startLine = where.startLine ?? 1;
  const found: HandPath[] = [];
  text.split("\n").forEach((lineText, i) => {
    const safe = [...lineText.matchAll(SAFE_FORM_RE)].map((m) => [m.index!, m.index! + m[0].length] as const);
    for (const m of lineText.matchAll(PATH_RE)) {
      const at = m.index!;
      if (safe.some(([from, to]) => at >= from && at < to)) continue;
      const g = m.groups!;
      const rest = g.rest!.replace(/(?<=[\w}>])\.+$/, "");
      if (/^(?:\.\.\/?)*$/.test(rest)) continue;
      const anchor: Anchor = g.skillUps !== undefined ? "skill-dir" : g.pluginRoot !== undefined ? "plugin-root" : "relative";
      const upText = g.skillUps ?? g.ups ?? "";
      const path = m[0].slice(0, m[0].length - g.rest!.length) + rest;
      found.push({ path, anchor, ups: upText.length / 3, rest, line: startLine + i, col: at + 1 + (i === 0 ? where.indent ?? 0 : 0) });
    }
  });
  return found;
}

function isPlaceholderLike(path: string): boolean {
  return path.includes("{{") || path.includes("<");
}

/** `teamValue` is the compile's value for a team param, given only where team markers resolve. */
type FixView = { verbs: ReadonlySet<string>; packSource?: (arg: string) => boolean; teamValue?: (key: string) => string | undefined };

const TEAM_VALUE_RE = /^\{\{team\.([a-z][a-z0-9-]*)\}\}$/;

/**
 * verb.path only for a compiled verb, pack.path only for a target the pack
 * holds as source: anything else would fail compile, so it gets no fix.
 */
function replacementFor(p: HandPath, view: FixView): string | null {
  if (isPlaceholderLike(p.path)) return teamReplacementFor(p, view);
  const segs = p.rest.split("/");
  const sibling = p.anchor !== "plugin-root" && p.ups === 1;
  let unit: string[];
  if (segs[0] === "attachments" || segs[0] === "skills") unit = segs.slice(1);
  else if (sibling) unit = segs;
  else return null;
  const [name, ...fileSegs] = unit;
  if (!name || !NAME_RE.test(name) || fileSegs.length === 0 || fileSegs.some((s) => s === "" || s === "." || s === "..")) return null;
  const file = fileSegs.join("/");
  const verbFix = p.anchor === "relative" ? `{{verb.path:${name}}}` : `${SKILL_DIR}/{{verb.path:${name}}}`;
  if (view.verbs.has(name)) return file === "SKILL.md" ? verbFix : null;
  return view.packSource?.(`${name}/${file}`) ? `{{pack.path:${name}/${file}}}` : null;
}

/** An attachment segment that is one team value marker, checked against the value the compile will substitute. */
function teamReplacementFor(p: HandPath, view: FixView): string | null {
  const [side, unit, ...fileSegs] = p.rest.split("/");
  if (side !== "attachments" && side !== "skills") return null;
  const key = TEAM_VALUE_RE.exec(unit ?? "")?.[1];
  const file = fileSegs.join("/");
  if (!key || fileSegs.length === 0 || isPlaceholderLike(file) || fileSegs.some((s) => s === "" || s === "." || s === "..")) return null;
  const value = view.teamValue?.(key);
  if (!value || /[\s{}]/.test(value)) return null;
  return view.packSource?.(`${value}/${file}`) ? `{{pack.path:{{team.${key}}}/${file}}}` : null;
}

/** Into attachments/ or skills/, or one level up into a sibling skill's folder; other escapes are the output lint's. */
function reachesAnotherSkill(p: HandPath): boolean {
  const segs = p.rest.split("/");
  if (segs[0] === "attachments" || segs[0] === "skills") return true;
  return p.anchor !== "plugin-root" && p.ups === 1 && segs.length >= 2;
}

/**
 * Compile's rule over its own input text. `depth` is how many folders the file sits below its unit's
 * root (0 for inlined text, which lands at the compiled verb's root): a relative path climbing no
 * higher stays inside its own unit. The stage-dir and vendoring rewrites emit
 * `${CLAUDE_SKILL_DIR}/../../attachments/...` into the output on purpose, so
 * this must never run on compiled text.
 */
export function handPathDiagnostics(
  text: string,
  file: string,
  opts: { startLine?: number; indent?: number; noFix?: boolean; depth?: number } & FixView,
): BlockDiagnostic[] {
  const depth = opts.depth ?? 0;
  return findHandPaths(text, opts)
    .map((p) => (p.anchor === "relative" ? { ...p, ups: p.ups - depth } : p))
    .filter((p) => p.anchor !== "relative" || p.ups > 0)
    .filter(reachesAnotherSkill)
    .map((p) => {
      const fix = opts.noFix ? null : replacementFor(p, opts);
      const message = fix
        ? `hand-typed path ${p.path} breaks when its target moves; write ${fix} instead`
        : `hand-typed path ${p.path} breaks when its target moves; name it with {{pack.path:<attachment>/<file>}} or {{verb.path:<verb>}}`;
      return { file, line: p.line, col: p.col, code: "hand-typed-path", message, ...(fix ? { fix: { length: p.path.length, text: fix } } : {}) };
    });
}

/** For a hand-authored skill compile never reads: each path out of its folder must name something that exists. */
export function brokenSkillPathDiagnostics(
  text: string,
  file: string,
  opts: { skillDir: string; pluginRoot: string; startLine?: number },
): BlockDiagnostic[] {
  return findHandPaths(text, opts)
    .filter((p) => !isPlaceholderLike(p.path))
    .filter((p) => {
      const ups = "../".repeat(p.ups);
      const target = p.anchor === "plugin-root" ? join(opts.pluginRoot, p.rest) : join(opts.skillDir, ups + p.rest);
      return !existsSync(target);
    })
    .map((p) => ({ file, line: p.line, col: p.col, code: "broken-skill-path", message: `${p.path} does not resolve to a file from the skill's folder` }));
}
