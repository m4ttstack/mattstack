import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { logCliEvent } from "../../cli-logger.ts";
import { walk } from "../blocks/tree.ts";
import type { Block } from "../blocks/types.ts";
import { listDirs, stripFrontmatter, VALUE_FILE_RE } from "../sources.ts";
import { blockIn } from "./lookup.ts";
import { lineRegions, tokensIn, type Position, type Range } from "./positions.ts";
import type { Workspace } from "./workspace.ts";

/** `range` is the partial the item replaces; `insertText` defaults to the label. */
export type Completion = {
  label: string;
  kind: "prop" | "include" | "contract" | "block" | "value";
  detail?: string;
  range?: Range;
  insertText?: string;
};

const MODULE = "skills-lsp";
const PROPS_OPEN_RE = /^props\.[a-z0-9-]*$/;
const INCLUDE_OPEN_RE = /^include:[^}\s]*$/;
const CONTRACT_RE = /^(\s+)contract:(\s*)("?)([^"]*)$/;
const YAML_KEY_RE = /^(\s*)[A-Za-z0-9_][\w-]*\s*:/;

export function completionsAt(ws: Workspace, file: string, pos: Position): Completion[] {
  try {
    if (file.endsWith(".block.md")) return blockCompletions(ws, file, pos);
    if (basename(file) === "skills.jsonc") return manifestCompletions(ws, file, pos);
    return [];
  } catch (err) {
    logCliEvent("error", MODULE, "completion failed", { file, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function blockCompletions(ws: Workspace, file: string, pos: Position): Completion[] {
  const lines = ws.text(file).split("\n");
  const row = lines[pos.line];
  if (row === undefined) return [];
  const prefix = row.slice(0, pos.character);
  const region = lineRegions(lines)[pos.line];
  if (region === "frontmatter") return contractCompletions(ws, file, pos, row);
  if (region !== "body") return [];
  const open = prefix.lastIndexOf("{{");
  if (open < 0 || prefix.indexOf("}}", open) >= 0) return [];
  const inside = prefix.slice(open + 2);
  const after = (word: string): Range => ({ start: { line: pos.line, character: open + 2 + word.length }, end: pos });
  if (PROPS_OPEN_RE.test(inside)) {
    const range = after("props.");
    return (blockIn(ws, file)?.block.props ?? []).map((p) => ({ label: p.name, kind: "prop", detail: propDetail(p), range }));
  }
  if (INCLUDE_OPEN_RE.test(inside) && prefix.slice(0, open).trim() === "") {
    const range = after("include:");
    return includes(ws, file).map((c) => ({ ...c, range }));
  }
  return [];
}

/**
 * Right after the colon the value needs its own space and quotes, or YAML reads `contract:x` as one
 * plain scalar; inside an open quote only the partial is replaced.
 */
function contractCompletions(ws: Workspace, file: string, pos: Position, row: string): Completion[] {
  const prefix = row.slice(0, pos.character);
  const m = CONTRACT_RE.exec(prefix);
  if (!m || !inPropEntry(ws.text(file), file, pos.line, m[1]!.length)) return [];
  const [, , space, quote, partial] = m as unknown as [string, string, string, string, string];
  const range: Range = { start: { line: pos.line, character: pos.character - partial.length }, end: pos };
  const closed = row[pos.character] === '"';
  const insert = (v: string) => (quote ? `${v}${closed ? "" : '"'}` : `${space === "" ? " " : ""}"${v}"`);
  return contracts(ws).map((c) => ({ ...c, range, insertText: insert(c.label) }));
}

const propDetail = (p: Block["props"][number]) => (p.contract === null ? p.merge : `${p.merge} · ${p.contract}`);

/** A `contract:` line nested under one of the frontmatter `props:` entries. */
function inPropEntry(text: string, file: string, line: number, indent: number): boolean {
  const lines = text.split("\n");
  const decl = tokensIn(text, file)
    .filter((t) => t.kind === "prop-decl" && t.range.start.line < line && t.range.start.character < indent)
    .pop();
  if (!decl) return false;
  for (let i = decl.range.start.line + 1; i < line; i++) {
    const key = YAML_KEY_RE.exec(lines[i]!);
    if (key && key[1]!.length <= decl.range.start.character) return false;
  }
  return true;
}

/** The include names the compiler accepts: the dirs under mattstack's attachments holding a block tree or a SKILL.md. */
function includes(ws: Workspace, file: string): Completion[] {
  const mattstack = ws.rootsFor([file]).byName.mattstack;
  if (!mattstack) return [];
  const attachments = join(mattstack.dir, "attachments");
  const out: Completion[] = [];
  for (const name of listDirs(attachments)) {
    const tree = ws.analysis().trees.get(join(attachments, name));
    if (tree) out.push({ label: name, kind: "include", detail: tree.root.title ?? "block include" });
    else if (ws.text(join(attachments, name, "SKILL.md")) !== "") out.push({ label: name, kind: "include", detail: "flat include" });
  }
  return out;
}

type Fill = { binding: string; provides: string };

/** Every fill a plugin offers, in loadAttachment's lookup order; a frontmatter-only SKILL.md offers its `.md` files. */
function fillsOf(ws: Workspace, plugin: string, dir: string): Fill[] {
  const skills = join(dir, "skills");
  const candidates = [
    ...listDirs(skills).map((name) => ({ name, dir: join(skills, name) })),
    ...listDirs(skills).flatMap((group) => listDirs(join(skills, group)).map((name) => ({ name, dir: join(skills, group, name) }))),
    ...listDirs(join(dir, "attachments")).map((name) => ({ name, dir: join(dir, "attachments", name) })),
  ];
  const seen = new Set<string>();
  const out: Fill[] = [];
  for (const c of candidates) {
    if (seen.has(c.name)) continue;
    const raw = ws.text(join(c.dir, "SKILL.md"));
    if (raw === "") continue;
    seen.add(c.name);
    const { body, frontmatter } = stripFrontmatter(raw);
    const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object" ? (frontmatter.metadata as Record<string, unknown>) : {};
    const provides = typeof metadata.provides === "string" ? metadata.provides : "";
    if (provides === "") continue;
    const files = body === "" ? valueFiles(c.dir) : [];
    if (files.length === 0) out.push({ binding: `${plugin}:${c.name}`, provides });
    for (const f of files) out.push({ binding: `${plugin}:${c.name}/${f}`, provides });
  }
  return out;
}

function valueFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const stem = e.name.slice(0, -".md".length);
      if (e.isFile() && e.name.endsWith(".md") && e.name !== "SKILL.md" && VALUE_FILE_RE.test(stem)) out.push(stem);
    }
  } catch {
    return [];
  }
  return out.sort();
}

function contracts(ws: Workspace): Completion[] {
  const values = new Set(ws.plugins().flatMap((p) => fillsOf(ws, p.name, p.dir).map((f) => f.provides)));
  return [...values].sort().map((label) => ({ label, kind: "contract" }));
}

type JsonCursor = { path: (string | number)[]; role: "key" | "value"; partial: string };

/**
 * Where the cursor sits in a manifest that may be half typed: the container path, whether the string
 * under the cursor is a key or a value, and its text up to the cursor. Null outside a string.
 */
function jsonCursor(text: string, offset: number): JsonCursor | null {
  type Frame = { open: "{" | "["; segment: string | number | null; key: string | null; expect: "key" | "colon" | "value"; index: number };
  const frames: Frame[] = [];
  const pathOf = () => frames.slice(1).map((f) => f.segment!);
  const top = () => frames[frames.length - 1];
  let i = 0;
  while (i < offset) {
    const ch = text[i]!;
    if (text.startsWith("//", i)) {
      while (i < offset && text[i] !== "\n") i++;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0 || end + 2 > offset) return null;
      i = end + 2;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < offset && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      const frame = top();
      if (j >= offset || text[j] === "\n") {
        if (j < offset) return null;
        const raw = text.slice(i + 1, offset);
        if (!frame) return null;
        const isKey = frame.open === "{" && frame.expect === "key";
        const path = pathOf();
        if (!isKey) path.push(frame.open === "{" ? frame.key ?? "" : frame.index);
        return { path, role: isKey ? "key" : "value", partial: raw };
      }
      const str = text.slice(i + 1, j);
      if (frame?.open === "{" && frame.expect === "key") {
        frame.key = str;
        frame.expect = "colon";
      }
      i = j + 1;
      continue;
    }
    const frame = top();
    if (ch === ":" && frame?.open === "{") frame.expect = "value";
    else if (ch === ",") {
      if (frame?.open === "{") frame.expect = "key";
      else if (frame) frame.index++;
    } else if (ch === "{" || ch === "[") {
      const segment = frame ? (frame.open === "{" ? frame.key : frame.index) : null;
      frames.push({ open: ch, segment, key: null, expect: "key", index: 0 });
    } else if (ch === "}" || ch === "]") frames.pop();
    i++;
  }
  return null;
}

function manifestCompletions(ws: Workspace, file: string, pos: Position): Completion[] {
  const text = ws.text(file);
  const lines = text.split("\n");
  if (pos.line >= lines.length) return [];
  const character = Math.min(pos.character, lines[pos.line]!.length);
  const offset = lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + character;
  const cursor = jsonCursor(text, offset);
  if (!cursor) return [];
  const range: Range = { start: { line: pos.line, character: character - cursor.partial.length }, end: { line: pos.line, character } };
  return manifestItems(ws, file, cursor).map((c) => ({ ...c, range }));
}

function manifestItems(ws: Workspace, file: string, cursor: JsonCursor): Completion[] {
  const { path, role } = cursor;
  const base = path[0] === "bindings" ? 1 : path[0] === "pipelines" && typeof path[1] === "string" && path[2] === "bindings" ? 3 : null;
  if (base === null) return [];
  const rel = path.slice(base);
  if (role === "key" && rel.length === 0) return bindingKeys(ws, cursor.partial);
  const key = rel[0];
  if (typeof key !== "string") return [];
  const held = ws.analysis().byBlockId.get(key);
  if (role === "key" && rel.length === 1) return (held?.block.props ?? []).map((p) => ({ label: p.name, kind: "prop", detail: propDetail(p) }));
  const prop = rel[1];
  const isValue = role === "value" && typeof prop === "string" && (rel.length === 2 || (rel.length === 4 && typeof rel[2] === "number" && rel[3] === "value"));
  if (!isValue) return [];
  const contract = held?.block.props.find((p) => p.name === prop)?.contract ?? null;
  return values(ws, held ? [file, held.block.path] : [file], contract);
}

function bindingKeys(ws: Workspace, partial: string): Completion[] {
  const engines = [...ws.analysis().byBlockId].filter(([, { tree, block }]) => block === tree.root);
  const slash = partial.indexOf("/");
  if (slash < 0) return engines.map(([ref, { block }]) => ({ label: ref, kind: "block", detail: block.label }));
  const ref = partial.slice(0, slash);
  const engine = engines.find(([r]) => r === ref);
  if (!engine) return [];
  const { tree } = engine[1];
  return walk(tree)
    .filter((b) => b !== tree.root)
    .map((b) => ({ label: `${ref}${b.id.slice(tree.root.id.length)}`, kind: "block", detail: b.kind === "gate" ? `${b.label} · gate` : b.label }));
}

/** Fills providing the prop's contract; every fill when the prop names no contract. */
function values(ws: Workspace, from: string[], contract: string | null): Completion[] {
  const roots = ws.rootsFor(from);
  const fills = Object.entries(roots.byName).flatMap(([name, root]) => fillsOf(ws, name, root.dir));
  return (contract === null ? fills : fills.filter((f) => f.provides === contract)).map((f) => ({ label: f.binding, kind: "value", detail: f.provides }));
}
