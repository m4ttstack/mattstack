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

type FixView = { verbs: ReadonlySet<string>; packSource?: (arg: string) => boolean };

/**
 * A compiled verb, or a sibling folder's SKILL.md that names no pack source,
 * takes verb.path; pack.path only for a target the pack holds as source. With
 * no way to tell, no fix: a wrong one is worse than none.
 */
function replacementFor(p: HandPath, view: FixView): string | null {
  if (isPlaceholderLike(p.path)) return null;
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
  if (view.packSource?.(`${name}/${file}`)) return `{{pack.path:${name}/${file}}}`;
  return sibling && segs.length === 2 && file === "SKILL.md" ? verbFix : null;
}

/**
 * Compile's rule over its own input text. A plugin-root path counts only into
 * attachments/ or skills/; the stage-dir and vendoring rewrites emit
 * `${CLAUDE_SKILL_DIR}/../../attachments/...` into the output on purpose, so
 * this must never run on compiled text.
 */
export function handPathDiagnostics(
  text: string,
  file: string,
  opts: { startLine?: number; indent?: number; verbs: ReadonlySet<string>; packSource?: (arg: string) => boolean; noFix?: boolean },
): BlockDiagnostic[] {
  return findHandPaths(text, opts)
    .filter((p) => p.anchor !== "plugin-root" || /^(attachments|skills)\//.test(p.rest))
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
