import { fillReference, inlineFillText, PLACEHOLDER_RE, spanOf, substituteLine, type Used } from "../placeholders.ts";
import type { PlaceholderContext } from "../types.ts";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import { toDot } from "./dot.ts";
import type { PropValue } from "./props.ts";
import { FENCE_RE } from "./tree.ts";
import type { Block, BlockTree } from "./types.ts";

/** A block tree with the plugin and version its `block:` seams name. */
export type SourcedTree = { tree: BlockTree; plugin: string; version: string };

/** Returns null for an include that is not a block tree, which then renders as today's flat `include:` part. */
export type IncludeResolver = (name: string, where: { file: string; line: number }) => SourcedTree | null;

export type RenderInput = {
  tree: BlockTree;
  source: { plugin: string; version: string };
  values: Map<string /* block id */, Map<string /* prop */, PropValue>>;
  includes: IncludeResolver;
  ctx: PlaceholderContext;
};

export type RenderResult = { body: string; used: Used; packPaths: string[] };

/** `depth` sets the include root's heading at `headingLevel(depth)`; `includingTitle` is the heading it sits under. */
export type IncludeAt = { depth: number; includingTitle: string | null };

const HEADING_RE = /^(#{1,6})(\s.*)$/;
const PROP_LINE_RE = /^\{\{props\.([a-z][a-z0-9-]*)\}\}$/;
const PROP_ANY_RE = /\{\{props\.[a-z][a-z0-9-]*\}\}/g;
const INCLUDE_LINE_RE = /^\{\{include:([^}\s]+)\}\}$/;
const SEAM_START = "<!-- part: ";

type Heading = { title: string | null; level: number };

type State = {
  values: RenderInput["values"];
  includes: IncludeResolver;
  ctx: PlaceholderContext;
  used: Used;
  diagnostics: BlockDiagnostic[];
  /** Root ids of the include trees being drawn, outermost first. */
  including: string[];
  /** The engine's tree; null when only an include is drawn. */
  engine: BlockTree | null;
};

export function headingLevel(depth: number): number {
  return Math.min(depth + 1, 6);
}

/**
 * The engine root's props vendor under `parts/<prop>`, other engine blocks'
 * under `parts/<block path>/<prop>`, and included blocks' under `parts/+<id>/<prop>`;
 * tree.ts refuses a `+` name, so no block path can reach the include namespace.
 */
export function propPartsDir(b: Block, prop: string, tree: BlockTree, engine: BlockTree | null): string {
  if (tree !== engine) return `+${b.id}/${prop}`;
  if (b === tree.root) return prop;
  return `${b.id.slice(tree.root.id.length + 1)}/${prop}`;
}

function propText(b: Block, name: string, src: SourcedTree, st: State): string {
  const value = st.values.get(b.id)?.get(name);
  if (!value) throw new Error(`${b.relPath}: prop "${name}" has no resolved value`);
  const key = `prop:${b.id}.${name}`;
  return value.sources
    .map(({ fill, mode }) =>
      mode === "reference"
        ? `${SEAM_START}${key} binding=${fill.binding} version=${fill.version} ${spanOf(fill)} -->\n${fillReference("Prop", name, fill)}`
        : inlineFillText(key, propPartsDir(b, name, src.tree, st.engine), fill, st.ctx, st.used.packPaths))
    .join("\n\n");
}

/** substituteLine's message names the placeholder it refused, by its text or by its quoted argument. */
function failingPlaceholderCol(line: string, message: string): number {
  const found = [...line.matchAll(PLACEHOLDER_RE)];
  const hit = found.find((m) => message.includes(m[0])) ?? found.find((m) => m[2] !== undefined && message.includes(`"${m[2]}"`)) ?? found[0];
  return (hit?.index ?? Math.max(0, line.indexOf("{{"))) + 1;
}

/** The last `#` heading line in rendered text, outside code fences, or null. */
function lastHeading(text: string): string | null {
  let fence: string | null = null;
  let found: string | null = null;
  for (const line of text.split("\n")) {
    const fm = FENCE_RE.exec(line);
    if (fence !== null) {
      if (fm && fm[1]![0] === fence[0] && fm[1]!.length >= fence.length && fm[2] === "") fence = null;
      continue;
    }
    if (fm) fence = fm[1]!;
    else if (HEADING_RE.test(line)) found = line.trimEnd();
  }
  return found;
}

function dotFence(b: Block): string {
  const titles = new Map<string, string>();
  for (const c of b.children) if (c.node !== null && c.title !== null) titles.set(c.node, c.title);
  return "```dot\n" + toDot(b.graph!, titles) + "```";
}

function includeBody(src: SourcedTree, at: IncludeAt, st: State): string {
  const root = src.tree.root;
  const chunks: string[] = [];
  st.including.push(root.id);
  renderBlock(root, src, { title: at.includingTitle, level: at.depth }, root.title !== null && root.title === at.includingTitle, st, chunks);
  st.including.pop();
  return chunks.join("\n\n");
}

/**
 * A line after a multi-line substitution would map to the wrong file line
 * through the seam above it, so the block's seam is repeated before the next
 * text line, naming where that text starts.
 */
function renderText(b: Block, src: SourcedTree, own: Heading, st: State, seam: (from: number) => string): string {
  const lines = b.text === "" ? [] : b.text.split("\n");
  for (const m of b.markers) {
    if (lines[m.line - b.textStartLine]?.trim() !== `{{props.${m.prop}}}`) {
      st.diagnostics.push({ file: b.relPath, line: m.line, col: m.col, message: `{{props.${m.prop}}} must sit alone on its line`, code: "bad-marker" });
    }
  }
  const out: string[] = [];
  let nearest = own;
  let resume = false;
  let fence: { marker: string; mermaid: boolean } | null = null;
  let headedInclude: string | null = null;

  lines.forEach((line, i) => {
    const fileLine = b.textStartLine + i;
    const indent = i === 0 ? b.textIndent : 0;
    const trimmed = line.trim();
    if (headedInclude !== null && trimmed !== "") {
      st.diagnostics.push({
        file: b.relPath,
        line: fileLine,
        col: line.search(/\S/) + 1,
        message: `text after {{include:${headedInclude}}}: an include that carries headings must be the last thing in its block`,
        code: "text-after-include",
      });
      headedInclude = null;
    }
    const fm = FENCE_RE.exec(line);
    const closes = fence !== null && fm !== null && fm[1]![0] === fence.marker[0] && fm[1]!.length >= fence.marker.length && fm[2] === "";
    if (fence?.mermaid) {
      if (closes) {
        out.push(dotFence(b));
        resume = true;
        fence = null;
      }
      return;
    }
    const fenced = fence !== null || fm !== null;
    if (closes) fence = null;
    else if (fence === null && fm !== null) {
      fence = { marker: fm[1]!, mermaid: fm[2] === "mermaid" };
      if (fence.mermaid) return;
    }

    let rendered: string;
    const prop = PROP_LINE_RE.exec(trimmed);
    const inc = INCLUDE_LINE_RE.exec(trimmed);
    const tree = inc ? st.includes(inc[1]!, { file: b.relPath, line: fileLine }) : null;
    if (prop) rendered = propText(b, prop[1]!, src, st);
    else if (line.includes("{{props.")) rendered = line.replace(PROP_ANY_RE, "");
    else if (tree && st.including.includes(tree.tree.root.id)) {
      const chain = [...st.including.slice(st.including.indexOf(tree.tree.root.id)), tree.tree.root.id].join(" -> ");
      st.diagnostics.push({
        file: b.relPath,
        line: fileLine,
        col: line.indexOf("{{") + 1 + indent,
        message: `{{include:${inc![1]!}}} would include itself: ${chain}`,
        code: "bad-value",
      });
      rendered = "";
    } else if (tree) {
      rendered = includeBody(tree, { depth: nearest.level, includingTitle: nearest.title }, st);
      st.used.includes.push(inc![1]!);
      if (lastHeading(rendered) !== null) headedInclude = inc![1]!;
    } else {
      const h = fenced ? null : HEADING_RE.exec(line);
      let text = line;
      if (h) {
        const level = Math.max(1, Math.min(own.level + h[1]!.length - 1, 6));
        text = "#".repeat(level) + h[2]!;
        nearest = { title: h[2]!.trim(), level };
      }
      try {
        rendered = substituteLine(text, fileLine - 1, st.ctx, b.relPath, st.used);
      } catch (err) {
        const message = (err as Error).message.replace(`${b.relPath}: `, "");
        st.diagnostics.push({ file: b.relPath, line: fileLine, col: failingPlaceholderCol(text, message) + indent, message, code: "bad-value" });
        rendered = "";
      }
    }

    if (rendered.startsWith(SEAM_START)) resume = true;
    else if (resume && rendered.trim() !== "") {
      out.push(seam(fileLine));
      resume = false;
    }
    out.push(rendered);
    // A blank line under a seam reads as a separator to the seam walker, so text that renders blank also resumes.
    if (!rendered.startsWith(SEAM_START) && (rendered.includes("\n") || (trimmed !== "" && rendered.trim() === ""))) resume = true;
  });
  return out.join("\n").trimEnd();
}

function renderBlock(b: Block, src: SourcedTree, parent: Heading, dropTitle: boolean, st: State, chunks: string[]): void {
  const titled = b.title !== null && !dropTitle;
  const own: Heading = titled ? { title: b.title, level: headingLevel(parent.level) } : parent;
  const textEnd = b.textStartLine + (b.text === "" ? 0 : b.text.split("\n").length) - 1;
  const seam = (from: number) =>
    `${SEAM_START}block:${b.id} source=${src.plugin}:${src.tree.root.id} version=${src.version} path=${b.relPath} lines=${from}-${Math.max(from, textEnd)} -->`;
  const body = renderText(b, src, own, st, seam);

  if (!titled) chunks.push(body === "" ? seam(b.textStartLine) : `${seam(b.textStartLine)}\n${body}`);
  else if (body.trim() === "" && b.children.length === 0) chunks.push(seam(b.bodyStartLine));
  else {
    // The source's blank lines between title and text are kept, so the seam's line offsets hold.
    const gap = Array<string>(Math.max(0, b.textStartLine - b.bodyStartLine - 1)).fill("");
    const heading = `${"#".repeat(own.level)} ${b.title}`;
    chunks.push([seam(b.bodyStartLine), heading, ...(body === "" ? [] : [...gap, body])].join("\n"));
  }
  // A headless child past a titled sibling never gets here: the tree refuses it as headless-after-heading.
  const under = lastHeading(body);
  for (const child of b.children) {
    if (child.title !== null) break;
    if (under === null) continue;
    st.diagnostics.push({
      file: child.relPath,
      line: 1,
      col: 1,
      message: `a headless block placed after "${under}" in ${b.relPath} would render under that heading; give it a # title line`,
      code: "text-after-include",
    });
  }
  for (const child of b.children) renderBlock(child, src, own, false, st, chunks);
}

function run(input: Omit<RenderInput, "tree" | "source">, engine: BlockTree | null, draw: (st: State) => string): RenderResult {
  const used: Used = { slots: [], includes: [], packPaths: [] };
  const st: State = { values: input.values, includes: input.includes, ctx: input.ctx, used, diagnostics: [], including: [], engine };
  const body = draw(st);
  if (st.diagnostics.length > 0) throw new BlockError(st.diagnostics);
  return { body, used, packPaths: used.packPaths };
}

export function renderTree(input: RenderInput): RenderResult {
  const src: SourcedTree = { tree: input.tree, ...input.source };
  return run(input, input.tree, (st) => {
    const chunks: string[] = [];
    renderBlock(input.tree.root, src, { title: null, level: 0 }, false, st, chunks);
    return chunks.join("\n\n");
  });
}

/** The repeated-title rule lives here so compile and `rt skills expand` place an include the same way. */
export function renderInclude(src: SourcedTree, at: IncludeAt, input: Omit<RenderInput, "tree" | "source">): RenderResult {
  return run(input, null, (st) => includeBody(src, at, st));
}
