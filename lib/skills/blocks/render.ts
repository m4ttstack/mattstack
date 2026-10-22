import { fillReference, inlineFillText, spanOf, substituteLine, type Used } from "../placeholders.ts";
import type { PlaceholderContext } from "../types.ts";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import { toDot } from "./dot.ts";
import type { PropValue } from "./props.ts";
import { FENCE_RE, walk } from "./tree.ts";
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
  including: string[];
};

export function headingLevel(depth: number): number {
  return Math.min(depth + 1, 6);
}

function propText(b: Block, name: string, st: State): string {
  const value = st.values.get(b.id)?.get(name);
  if (!value) throw new Error(`${b.relPath}: prop "${name}" has no resolved value`);
  const key = `prop:${b.id}.${name}`;
  return value.sources
    .map(({ fill, mode }) =>
      mode === "reference"
        ? `${SEAM_START}${key} binding=${fill.binding} version=${fill.version} ${spanOf(fill)} -->\n${fillReference("Prop", name, fill)}`
        : inlineFillText(key, name, fill, st.ctx, st.used.packPaths))
    .join("\n\n");
}

function dotFence(b: Block): string {
  const titles = new Map<string, string>();
  for (const c of b.children) if (c.node !== null && c.title !== null) titles.set(c.node, c.title);
  return "```dot\n" + toDot(b.graph!, titles) + "```";
}

function includeBody(src: SourcedTree, at: IncludeAt, st: State): string {
  const root = src.tree.root;
  const chunks: string[] = [];
  renderBlock(root, src, { title: at.includingTitle, level: at.depth }, root.title !== null && root.title === at.includingTitle, st, chunks);
  return chunks.join("\n\n");
}

/**
 * A line after a multi-line substitution would map to the wrong file line
 * through the seam above it, so the block's seam is repeated before the next
 * text line, naming where that text starts.
 */
function renderText(b: Block, own: Heading, st: State, seam: (from: number) => string): string {
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
    const tree = inc ? includeTree(inc[1]!, b, fileLine, st) : null;
    if (prop) rendered = propText(b, prop[1]!, st);
    else if (line.includes("{{props.")) rendered = line.replace(PROP_ANY_RE, "");
    else if (tree) {
      rendered = includeBody(tree, { depth: nearest.level, includingTitle: nearest.title }, st);
      st.including.pop();
      st.used.includes.push(inc![1]!);
      if (walk(tree.tree).some((x) => x.title !== null)) headedInclude = inc![1]!;
    } else {
      const h = fenced ? null : HEADING_RE.exec(line);
      let text = line;
      if (h) {
        const level = Math.max(1, Math.min(own.level + h[1]!.length - 1, 6));
        text = "#".repeat(level) + h[2]!;
        nearest = { title: h[2]!.trim(), level };
      }
      rendered = substituteLine(text, fileLine - 1, st.ctx, b.relPath, st.used);
    }

    if (rendered.startsWith(SEAM_START)) resume = true;
    else if (resume && rendered.trim() !== "") {
      out.push(seam(fileLine));
      resume = false;
    }
    out.push(rendered);
    if (!rendered.startsWith(SEAM_START) && rendered.includes("\n")) resume = true;
  });
  return out.join("\n").trimEnd();
}

function includeTree(name: string, b: Block, line: number, st: State): SourcedTree | null {
  const tree = st.includes(name, { file: b.relPath, line });
  if (tree === null) return null;
  if (st.including.includes(name)) throw new Error(`${b.relPath}: include "${name}" includes itself (line ${line})`);
  st.including.push(name);
  return tree;
}

function renderBlock(b: Block, src: SourcedTree, parent: Heading, dropTitle: boolean, st: State, chunks: string[]): void {
  const titled = b.title !== null && !dropTitle;
  const own: Heading = titled ? { title: b.title, level: headingLevel(parent.level) } : parent;
  const textEnd = b.textStartLine + (b.text === "" ? 0 : b.text.split("\n").length) - 1;
  const seam = (from: number) =>
    `${SEAM_START}block:${b.id} source=${src.plugin}:${src.tree.root.id} version=${src.version} path=${b.relPath} lines=${from}-${Math.max(from, textEnd)} -->`;
  const body = renderText(b, own, st, seam);

  if (!titled) chunks.push(body === "" ? seam(b.textStartLine) : `${seam(b.textStartLine)}\n${body}`);
  else if (body.trim() === "" && b.children.length === 0) chunks.push(seam(b.bodyStartLine));
  else {
    // The source's blank lines between title and text are kept, so the seam's line offsets hold.
    const gap = Array<string>(Math.max(0, b.textStartLine - b.bodyStartLine - 1)).fill("");
    const heading = `${"#".repeat(own.level)} ${b.title}`;
    chunks.push([seam(b.bodyStartLine), heading, ...(body === "" ? [] : [...gap, body])].join("\n"));
  }
  for (const child of b.children) renderBlock(child, src, own, false, st, chunks);
}

function run(input: Omit<RenderInput, "tree" | "source">, draw: (st: State) => string): RenderResult {
  const used: Used = { slots: [], includes: [], packPaths: [] };
  const st: State = { values: input.values, includes: input.includes, ctx: input.ctx, used, diagnostics: [], including: [] };
  const body = draw(st);
  if (st.diagnostics.length > 0) throw new BlockError(st.diagnostics);
  return { body, used, packPaths: used.packPaths };
}

export function renderTree(input: RenderInput): RenderResult {
  const src: SourcedTree = { tree: input.tree, ...input.source };
  return run(input, (st) => {
    const chunks: string[] = [];
    renderBlock(input.tree.root, src, { title: null, level: 0 }, false, st, chunks);
    return chunks.join("\n\n");
  });
}

/** The repeated-title rule lives here so compile and `rt skills expand` place an include the same way. */
export function renderInclude(src: SourcedTree, at: IncludeAt, input: Omit<RenderInput, "tree" | "source">): RenderResult {
  return run(input, (st) => includeBody(src, at, st));
}
