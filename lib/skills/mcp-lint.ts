import { lstatSync, readdirSync, readFileSync } from "fs";
import { join, sep } from "path";
import type { ShellForms } from "../mcp/shared.ts";
import { HEADER_COMMENT } from "./compile.ts";

export interface LintRule { id: string; pattern: RegExp; tool: string | null; note?: string; example: string; source: "tool" | "leaf" | "script" }
export interface LintHit { file: string; line: number; text: string; rule: string; tool: string | null; note?: string }

// Written in one bare form by the skills; each stays on Bash on purpose.
export const KEPT_ON_BASH: RegExp[] = [
  /\brt gate answer\b.*--by shepherd\b/,
  /\brt gate wait\b/,
  /\brt events wait\b/,
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The trailing guard stops `rt herd wrap` from matching `rt herd wrap-up`. */
export function commandPattern(command: string): RegExp {
  return new RegExp(`\\b${command.trim().split(/\s+/).map(escape).join("\\s+")}(?![\\w-])`);
}

export function deriveRules(tools: ReadonlyArray<{ name: string; shellForms: ShellForms }>, leafPaths: ReadonlyArray<readonly string[]>): LintRule[] {
  const rules: LintRule[] = [];
  for (const t of tools) {
    if (!Array.isArray(t.shellForms)) continue;
    for (const f of t.shellForms) {
      rules.push(typeof f === "string"
        ? { id: f, pattern: commandPattern(f), tool: t.name, example: f, source: "tool" }
        : { id: f.id, pattern: f.pattern, tool: t.name, note: f.note, example: f.example, source: "tool" });
    }
  }
  const named = new Set(rules.map((r) => r.id));
  for (const path of leafPaths) {
    const id = `rt ${path.join(" ")}`;
    if (named.has(id)) continue;
    rules.push({ id, pattern: commandPattern(id), tool: "rt_verb", note: `args: ${JSON.stringify(path).replace(/,/g, ", ")}`, example: id, source: "leaf" });
  }
  return rules;
}

/** Earliest match, then longest, then rule order: precedence never depends
    on where a tool sits in the roster. */
export function pickRule(code: string, rules: readonly LintRule[]): LintRule | null {
  let best: { rule: LintRule; start: number; len: number } | null = null;
  for (const rule of rules) {
    const m = rule.pattern.exec(code);
    if (!m) continue;
    if (!best || m.index < best.start || (m.index === best.start && m[0].length > best.len)) best = { rule, start: m.index, len: m[0].length };
  }
  return best?.rule ?? null;
}

const FENCE = /^\s*(```|~~~)/;
const INLINE = /`([^`\n]+)`/g;
export const ALLOW_MARKER = /<!--\s*mcp-lint:\s*allow\s*-->/;

/** Code-shaped text per line: whole lines inside a fence, inline spans outside
    one. A line carrying the allow marker, or sitting under a marker-only line,
    is dropped here so no rule sees it. */
function codeOn(lines: string[]): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let fenced = false;
  lines.forEach((raw, i) => {
    if (FENCE.test(raw)) { fenced = !fenced; return; }
    if (ALLOW_MARKER.test(raw)) return;
    const prev = lines[i - 1] ?? "";
    if (ALLOW_MARKER.test(prev) && prev.replace(ALLOW_MARKER, "").trim() === "") return;
    if (fenced) { out.push({ line: i + 1, text: raw }); return; }
    for (const m of raw.matchAll(INLINE)) out.push({ line: i + 1, text: m[1]! });
  });
  return out;
}

export function lintSkillText(text: string, file: string, rules: readonly LintRule[]): LintHit[] {
  const hits: LintHit[] = [];
  for (const { line, text: code } of codeOn(text.split("\n"))) {
    if (KEPT_ON_BASH.some((k) => k.test(code))) continue;
    const rule = pickRule(code, rules);
    if (rule) hits.push({ file, line, text: code.trim(), rule: rule.id, tool: rule.tool, ...(rule.note ? { note: rule.note } : {}) });
  }
  return hits;
}

const LINTED_ROOTS = ["skills", "attachments", join("plugin", "skills")];

function walkLintedRoots(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const p = join(d, name);
      let isDir = false;
      try { isDir = lstatSync(p).isDirectory(); } catch { continue; }
      if (isDir) { if (name !== "node_modules" && name !== ".git") visit(p); } else out.push(p);
    }
  };
  for (const root of LINTED_ROOTS) {
    const p = join(dir, root);
    try { if (lstatSync(p).isDirectory()) visit(p); } catch { /* root absent */ }
  }
  return out;
}

function readOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

export type LintDeps = { list: (dir: string) => string[]; read: (path: string) => string | null };
const DISK: LintDeps = { list: walkLintedRoots, read: readOrNull };

/** Compiled output is skipped: its sources are linted already, and a hit there
    would point the author at a generated file the next compile rewrites. A
    compiled verb dir also holds vendored files that carry no header, so the
    header on its SKILL.md marks the whole subtree as output. */
function lintedSources(dir: string, deps: LintDeps, exts: readonly string[]): Array<{ path: string; text: string }> {
  const roots = LINTED_ROOTS.map((r) => join(dir, r) + sep);
  const texts = new Map<string, string | null>();
  const read = (path: string): string | null => {
    if (!texts.has(path)) texts.set(path, deps.read(path));
    return texts.get(path)!;
  };
  const compiledVerbDir = (path: string): boolean => {
    const root = roots.find((r) => path.startsWith(r))!;
    const segments = path.slice(root.length).split(sep);
    if (segments.length < 2) return false;
    return read(join(root, segments[0]!, "SKILL.md"))?.includes(HEADER_COMMENT) ?? false;
  };
  const out: Array<{ path: string; text: string }> = [];
  for (const path of deps.list(dir).filter((p) => exts.some((e) => p.endsWith(e)) && roots.some((r) => p.startsWith(r))).sort()) {
    if (compiledVerbDir(path)) continue;
    const text = read(path);
    if (text !== null && !text.includes(HEADER_COMMENT)) out.push({ path, text });
  }
  return out;
}

export function lintedMarkdownFiles(dir: string, deps: LintDeps = DISK): string[] {
  return lintedSources(dir, deps, [".md"]).map((s) => s.path);
}

export function lintPackDir(dir: string, rules: readonly LintRule[], deps: LintDeps = DISK): LintHit[] {
  return lintedSources(dir, deps, [".md"]).flatMap((s) => lintSkillText(s.text, s.path, rules));
}

export const SCRIPT_ONLY_RULES: LintRule[] = [
  { id: "gh", pattern: /\bgh\s+(pr|api)\b/, tool: null, note: "GitHub has no MCP tool yet; listed so a script's forge calls stay visible", example: "gh pr view 3", source: "script" },
];

const SCRIPT_EXTS = [".sh", ".py", ".ts"];
const SCRIPT_ALLOW = /mcp-lint:\s*allow/;
const COMMENT = /^\s*(#|\/\/)/;

export function lintScriptText(text: string, file: string, rules: readonly LintRule[]): LintHit[] {
  const hits: LintHit[] = [];
  text.split("\n").forEach((raw, i) => {
    const code = raw.replace(/\r$/, "");
    if (COMMENT.test(code) || SCRIPT_ALLOW.test(code)) return;
    if (KEPT_ON_BASH.some((k) => k.test(code))) return;
    const rule = pickRule(code, rules);
    if (rule) hits.push({ file, line: i + 1, text: code.trim(), rule: rule.id, tool: rule.tool, ...(rule.note ? { note: rule.note } : {}) });
  });
  return hits;
}

/** Advisory by contract: packs ship domain scripts on purpose, so these hits
    never reach --strict, strictLint or the sync refusal. */
export function lintPackScripts(dir: string, rules: readonly LintRule[], deps: LintDeps = DISK): LintHit[] {
  const all = [...rules, ...SCRIPT_ONLY_RULES];
  return lintedSources(dir, deps, SCRIPT_EXTS).flatMap((s) => lintScriptText(s.text, s.path, all));
}

export function formatHit(h: LintHit): string {
  const use = h.tool ? `use the ${h.tool} tool` : "no MCP tool covers it yet";
  return `${h.file}:${h.line}: \`${h.text}\` shells out for ${h.rule}; ${use}${h.note ? ` (${h.note})` : ""}`;
}
