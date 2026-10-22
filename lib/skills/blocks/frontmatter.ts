import { LineCounter, isMap, isScalar, parseDocument, type Node } from "yaml";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import type { Block, MarkerUse, PropSpec } from "./types.ts";

export type ParsedBlockFile = Pick<
  Block,
  "title" | "label" | "node" | "order" | "kind" | "props" | "markers" | "text" | "bodyStartLine" | "frontmatter"
>;

// An empty block (`---\n---`) has no newline between the fences, which the shared stripFrontmatter pattern does not match.
const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/;
const MARKER_RE = /\{\{props\.([A-Za-z0-9_-]+)\}\}/g;

export function labelFromId(idTail: string): string {
  const words = idTail.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function countLines(s: string): number {
  return (s.match(/\n/g) ?? []).length;
}

export function parseBlockFile(raw: string, file: string, idTail: string): ParsedBlockFile {
  const match = raw.match(FRONTMATTER_RE);
  const fmBlock = match?.[0] ?? "";
  const rest = match ? raw.slice(fmBlock.length) : raw;
  const diagnostics: BlockDiagnostic[] = [];
  const bad = (line: number, col: number, message: string, code = "bad-value") => {
    diagnostics.push({ file, line, col, message, code });
  };

  const lineCounter = new LineCounter();
  const doc = parseDocument(match?.[1] ?? "", { lineCounter });
  const posOf = (node: Node | null | undefined): { line: number; col: number } => {
    const offset = node?.range?.[0] ?? 0;
    const p = lineCounter.linePos(offset);
    return { line: p.line + 1, col: p.col };
  };

  for (const err of doc.errors) {
    const p = lineCounter.linePos(err.pos[0]);
    bad(p.line + 1, p.col, `invalid frontmatter: ${err.message.split("\n")[0]}`, "bad-frontmatter");
  }
  if (diagnostics.length > 0) throw new BlockError(diagnostics);

  const parsed = doc.toJS();
  const frontmatter: Record<string, unknown> =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};

  const valueNode = (map: unknown, key: string): Node | null => {
    if (!isMap(map)) return null;
    const v = map.get(key, true);
    return (v as Node | undefined) ?? null;
  };

  const props: PropSpec[] = [];
  const propsNode = valueNode(doc.contents, "props");
  if (propsNode !== null) {
    if (!isMap(propsNode)) {
      const p = posOf(propsNode);
      bad(p.line, p.col, "props must be a map of prop name to { merge, default?, contract? }");
    } else {
      for (const pair of propsNode.items) {
        const keyNode = pair.key as Node;
        const name = String(isScalar(keyNode) ? keyNode.value : "");
        const at = posOf(keyNode);
        const spec = pair.value;
        if (!isMap(spec)) {
          bad(at.line, at.col, `prop "${name}" must declare { merge: add | replace }`);
          continue;
        }
        const merge = spec.get("merge");
        if (merge !== "add" && merge !== "replace") {
          bad(at.line, at.col, `prop "${name}": merge must be "add" or "replace"`);
          continue;
        }
        const strField = (field: "default" | "contract"): string | null => {
          const node = valueNode(spec, field);
          if (node === null) return null;
          const value = isScalar(node) ? node.value : undefined;
          if (typeof value !== "string") {
            const p = posOf(node);
            bad(p.line, p.col, `prop "${name}": ${field} must be a string`);
            return null;
          }
          return value;
        };
        props.push({
          name,
          merge,
          default: strField("default"),
          contract: strField("contract"),
          declaredAt: at,
        });
      }
    }
  }

  const topNode = (key: string): Node | null => valueNode(doc.contents, key);

  let node: string | null = null;
  if (frontmatter.node !== undefined) {
    if (typeof frontmatter.node === "string") node = frontmatter.node;
    else {
      const p = posOf(topNode("node"));
      bad(p.line, p.col, "node must be a string");
    }
  }

  let label: string | null = null;
  if (frontmatter.label !== undefined) {
    if (typeof frontmatter.label === "string") label = frontmatter.label;
    else {
      const p = posOf(topNode("label"));
      bad(p.line, p.col, "label must be a string");
    }
  }

  let order: number | null = null;
  if (frontmatter.order !== undefined) {
    if (typeof frontmatter.order === "number") order = frontmatter.order;
    else {
      const p = posOf(topNode("order"));
      bad(p.line, p.col, "order must be a number");
    }
  }

  let kind: "gate" | null = null;
  if (frontmatter.kind !== undefined) {
    if (frontmatter.kind === "gate") kind = "gate";
    else {
      const p = posOf(topNode("kind"));
      bad(p.line, p.col, 'kind must be "gate"');
    }
  }

  const body = rest.trim();
  const lead = rest.length - rest.trimStart().length;
  const bodyStartLine = countLines(fmBlock) + countLines(rest.slice(0, lead)) + 1;
  const lines = body.split("\n");

  let title: string | null = null;
  let textStart = 0;
  if (lines[0]?.startsWith("#")) {
    title = lines[0].replace(/^#+\s*/, "").trim();
    textStart = 1;
  }
  const text = lines.slice(textStart).join("\n").trim();

  const declared = new Set(props.map((p) => p.name));
  const markers: MarkerUse[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(MARKER_RE)) {
      const use = { prop: m[1]!, line: bodyStartLine + i, col: m.index! + 1 };
      markers.push(use);
      if (!declared.has(use.prop)) {
        bad(use.line, use.col, `marker {{props.${use.prop}}} names "${use.prop}", which this block does not declare`, "unknown-prop");
      }
    }
  });

  if (diagnostics.length > 0) throw new BlockError(diagnostics);

  return {
    title,
    label: label ?? labelFromId(idTail),
    node,
    order,
    kind,
    props,
    markers,
    text,
    bodyStartLine,
    frontmatter,
  };
}
