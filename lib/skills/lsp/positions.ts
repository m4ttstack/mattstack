import { basename } from "node:path";
import { jsoncSites, type JsoncPos } from "../../jsonc.ts";
import type { BlockDiagnostic } from "../blocks/diagnostics.ts";
import { FENCE_RE } from "../blocks/tree.ts";
import { findHandPaths } from "../hand-paths.ts";

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };

export type Token =
  | { kind: "marker"; prop: string; range: Range }
  | { kind: "include"; name: string; range: Range }
  | { kind: "prop-decl"; prop: string; range: Range }
  | { kind: "node-decl"; node: string; range: Range }
  | { kind: "binding-key"; engineRef: string; blockPath: string | null; range: Range }
  | { kind: "binding-prop"; key: string; prop: string; range: Range }
  | { kind: "binding-value"; key: string; prop: string; value: string; range: Range }
  | { kind: "pack-path"; attachment: string; file: string; range: Range }
  | { kind: "verb-path"; verb: string; range: Range };

export type SkillPathToken = Extract<Token, { kind: "pack-path" | "verb-path" }>;

const MARKER_RE = /\{\{props\.([a-z][a-z0-9-]*)\}\}/g;
const SKILL_PATH_RE = /\{\{(pack|verb)\.path:([^}\s]*)\}\}/g;
const INCLUDE_LINE_RE = /^\{\{include:([^}\s]+)\}\}$/;
const FRONTMATTER_FENCE_RE = /^---\s*$/;
const YAML_KEY_RE = /^(\s*)([A-Za-z0-9_][\w-]*)\s*:/;
const NODE_VALUE_RE = /^node:\s*(\w+)/;
const MERMAID_SKIP_RE = /^\s*(?:%%|(?:flowchart|graph|classDef|class|style|linkStyle|direction|subgraph|end)\b)/;

const span = (line: number, start: number, end: number): Range => ({ start: { line, character: start }, end: { line, character: end } });

function fileKind(file: string): "block" | "manifest" | null {
  if (file.endsWith(".block.md")) return "block";
  if (basename(file) === "skills.jsonc") return "manifest";
  return null;
}

export function tokensIn(text: string, file: string): Token[] {
  const kind = fileKind(file);
  if (kind === "block") return blockTokens(text);
  if (kind === "manifest") return manifestTokens(text);
  return [];
}

export function tokenAt(text: string, file: string, pos: Position): Token | null {
  return tokensIn(text, file).find((t) => contains(t.range, pos)) ?? null;
}

function contains(r: Range, p: Position): boolean {
  return p.line === r.start.line && p.character >= r.start.character && p.character <= r.end.character;
}

export function rangeOf(d: BlockDiagnostic, text: string): Range {
  const line = d.line - 1;
  const character = d.col - 1;
  const row = text.split("\n")[line] ?? "";
  if (d.code === "hand-typed-path") {
    const length = d.fix?.length ?? findHandPaths(row).find((p) => p.col === d.col)?.path.length;
    if (length !== undefined) return span(line, character, character + length);
  }
  const token = tokensIn(text, d.file).find((t) => t.range.start.line === line && t.range.start.character === character);
  if (token) return { start: token.range.start, end: token.range.end };
  return span(line, character, character + lexemeLength(row.slice(character)));
}

/** Length of the `{{…}}` marker, JSON string or YAML key that opens `rest`; else the rest of the line. */
function lexemeLength(rest: string): number {
  if (rest.startsWith("{{")) {
    const close = rest.indexOf("}}");
    return close < 0 ? rest.length : close + 2;
  }
  if (rest.startsWith('"')) return stringLength(rest, 0) ?? rest.length;
  const key = /^[\w-]+(?=\s*:)/.exec(rest);
  return key ? key[0].length : rest.length;
}

/** Length of the JSON string opening at `start`, quotes included, or null when it does not close on its line. */
function stringLength(row: string, start: number): number | null {
  for (let i = start + 1; i < row.length; i++) {
    if (row[i] === "\\") i++;
    else if (row[i] === '"') return i - start + 1;
  }
  return null;
}

/** What each line of a block file is: frontmatter, prose, a fence delimiter, or a line inside a code or mermaid fence. */
export type LineRegion = "frontmatter" | "delimiter" | "body" | "code" | "mermaid";

export function lineRegions(lines: string[]): LineRegion[] {
  const regions: LineRegion[] = [];
  let body = 0;
  if (FRONTMATTER_FENCE_RE.test(lines[0] ?? "")) {
    const close = lines.findIndex((l, i) => i > 0 && FRONTMATTER_FENCE_RE.test(l));
    body = close < 0 ? lines.length : close + 1;
    for (let i = 0; i < body; i++) regions.push(i === 0 || i === close ? "delimiter" : "frontmatter");
  }
  let fence: { marker: string; mermaid: boolean } | null = null;
  for (let i = body; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]!);
    if (fence === null) {
      if (m) {
        fence = { marker: m[1]!, mermaid: m[2] === "mermaid" };
        regions.push("delimiter");
      } else regions.push("body");
      continue;
    }
    if (m && m[1]![0] === fence.marker[0] && m[1]!.length >= fence.marker.length && m[2] === "") {
      fence = null;
      regions.push("delimiter");
      continue;
    }
    regions.push(fence.mermaid ? "mermaid" : "code");
  }
  return regions;
}

function blockTokens(text: string): Token[] {
  const lines = text.split("\n");
  const tokens: Token[] = [];
  const regions = lineRegions(lines);
  const frontmatter = regions.flatMap((r, i) => (r === "frontmatter" ? [i] : []));
  if (frontmatter.length > 0) frontmatterTokens(lines.slice(frontmatter[0], frontmatter[frontmatter.length - 1]! + 1), frontmatter[0]!, tokens);
  regions.forEach((region, i) => {
    if (region === "body" || region === "code") markerTokens(lines[i]!, i, tokens);
    else if (region === "mermaid") mermaidTokens(lines[i]!, i, tokens);
  });
  return tokens;
}

/** Plan 1 substitutes props markers inside non-mermaid fences too, and reads an include only as a whole line. */
function markerTokens(row: string, line: number, tokens: Token[]): void {
  pathTokens(row, line, tokens);
  for (const m of row.matchAll(MARKER_RE)) tokens.push({ kind: "marker", prop: m[1]!, range: span(line, m.index, m.index + m[0].length) });
  const trimmed = row.trim();
  const include = INCLUDE_LINE_RE.exec(trimmed);
  if (!include) return;
  const start = row.indexOf(trimmed);
  tokens.push({ kind: "include", name: include[1]!, range: span(line, start, start + trimmed.length) });
}

function pathTokens(row: string, line: number, tokens: Token[]): void {
  for (const m of row.matchAll(SKILL_PATH_RE)) {
    const range = span(line, m.index, m.index + m[0].length);
    const arg = m[2]!;
    if (m[1] === "verb") {
      tokens.push({ kind: "verb-path", verb: arg, range });
      continue;
    }
    const slash = arg.indexOf("/");
    tokens.push({ kind: "pack-path", attachment: slash < 0 ? arg : arg.slice(0, slash), file: slash < 0 ? "" : arg.slice(slash + 1), range });
  }
}

/** The pack.path and verb.path markers in a block file's body, or on every line of a fill, all of which compile in. */
export function skillPathTokens(text: string, file: string): SkillPathToken[] {
  const all = file.endsWith(".block.md")
    ? tokensIn(text, file)
    : text.split("\n").flatMap((row, line) => {
        const found: Token[] = [];
        pathTokens(row, line, found);
        return found;
      });
  return all.filter((t): t is SkillPathToken => t.kind === "pack-path" || t.kind === "verb-path");
}

function frontmatterTokens(lines: string[], offset: number, tokens: Token[]): void {
  let inProps = false;
  let propIndent: number | null = null;
  lines.forEach((row, k) => {
    const line = offset + k;
    const key = YAML_KEY_RE.exec(row);
    if (!key) return;
    const indent = key[1]!.length;
    if (indent === 0) {
      inProps = key[2] === "props";
      propIndent = null;
      const node = NODE_VALUE_RE.exec(row);
      if (node) {
        const start = row.indexOf(node[1]!, "node:".length);
        tokens.push({ kind: "node-decl", node: node[1]!, range: span(line, start, start + node[1]!.length) });
      }
      return;
    }
    if (!inProps) return;
    propIndent ??= indent;
    if (indent === propIndent) tokens.push({ kind: "prop-decl", prop: key[2]!, range: span(line, indent, indent + key[2]!.length) });
  });
}

const OPENERS: Record<string, string> = { "[": "]", "(": ")", "{": "}" };

/** Node ids on one mermaid statement line: words outside labels, edge texts and `:::class` suffixes. */
function mermaidTokens(row: string, line: number, tokens: Token[]): void {
  if (MERMAID_SKIP_RE.test(row)) return;
  const closers: string[] = [];
  let i = 0;
  while (i < row.length) {
    const ch = row[i]!;
    if (closers.length > 0) {
      if (ch === '"') {
        const end = row.indexOf('"', i + 1);
        i = end < 0 ? row.length : end + 1;
        continue;
      }
      if (OPENERS[ch]) closers.push(OPENERS[ch]!);
      else if (ch === closers[closers.length - 1]) closers.pop();
      i++;
      continue;
    }
    if (OPENERS[ch]) {
      closers.push(OPENERS[ch]!);
      i++;
      continue;
    }
    if (ch === "|") {
      const end = row.indexOf("|", i + 1);
      i = end < 0 ? row.length : end + 1;
      continue;
    }
    const edgeText = /^(?:--|-\.)\s/.exec(row.slice(i));
    if (edgeText) {
      const end = /-->|\.->/.exec(row.slice(i + edgeText[0].length));
      i = end ? i + edgeText[0].length + end.index + end[0].length : row.length;
      continue;
    }
    if (row.startsWith(":::", i)) {
      i += 3;
      while (i < row.length && /\w/.test(row[i]!)) i++;
      continue;
    }
    const word = /^\w+/.exec(row.slice(i));
    if (word) {
      tokens.push({ kind: "node-decl", node: word[0], range: span(line, i, i + word[0].length) });
      i += word[0].length;
      continue;
    }
    i++;
  }
}

function manifestTokens(text: string): Token[] {
  const lines = text.split("\n");
  const tokens: Token[] = [];
  const stringAt = (p: JsoncPos): Range | null => {
    const row = lines[p.line - 1] ?? "";
    const start = p.col - 1;
    if (row[start] !== '"') return null;
    const length = stringLength(row, start);
    return length === null ? null : span(p.line - 1, start, start + length);
  };
  const literal = (r: Range): string | null => {
    try {
      return JSON.parse(lines[r.start.line]!.slice(r.start.character, r.end.character)) as string;
    } catch {
      return null;
    }
  };
  for (const [pathKey, site] of jsoncSites(text)) {
    const path = JSON.parse(pathKey) as (string | number)[];
    const base = path[0] === "bindings" ? 1 : path[0] === "pipelines" && typeof path[1] === "string" && path[2] === "bindings" ? 3 : null;
    if (base === null) continue;
    const [key, prop, index, field] = path.slice(base);
    if (typeof key !== "string") continue;
    if (prop === undefined) {
      const range = site.key && stringAt(site.key);
      if (!range) continue;
      const slash = key.indexOf("/");
      tokens.push({ kind: "binding-key", engineRef: slash < 0 ? key : key.slice(0, slash), blockPath: slash < 0 ? null : key.slice(slash + 1), range });
      continue;
    }
    if (typeof prop !== "string") continue;
    if (index === undefined) {
      const range = site.key && stringAt(site.key);
      if (range) tokens.push({ kind: "binding-prop", key, prop, range });
    }
    const isValue = index === undefined || (typeof index === "number" && field === "value" && path.length === base + 4);
    if (!isValue) continue;
    const range = stringAt(site.value);
    const value = range && literal(range);
    if (range && value !== null) tokens.push({ kind: "binding-value", key, prop, value, range });
  }
  return tokens.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
}
