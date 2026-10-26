import { parseDot, type DotNode } from "../../../lib/skills/blocks/dot.ts";

const WRAP: Record<string, [string, string]> = {
  ellipse: ["([", "])"],
  diamond: ["{", "}"],
  box: ["[", "]"],
  plaintext: ["[/", "/]"],
  doublecircle: ["(((", ")))"],
};

const NEEDS_QUOTES_RE = /[|[\]{}()"]|^\/|\/$/;
// parseMermaid cuts a node's shape token at the first of these, so a label holding one cannot be read back.
const EDGE_START_RE = /\s(?:-->|-\.->|--\s|-\.\s)/;
const QUOTED_RE = /"(?:[^"\\]|\\.)*"/g;

function quoted(label: string): string {
  return NEEDS_QUOTES_RE.test(label) ? `"${label}"` : label;
}

function classOf(n: DotNode): "stop" | "done" | null {
  if (n.shape === "octagon") return "stop";
  if (n.shape === "doublecircle" && n.fillcolor === "lightgreen") return "done";
  return null;
}

function nodeStatement(n: DotNode, omitLabel: boolean): string {
  const cls = classOf(n);
  const suffix = cls ? `:::${cls}` : "";
  // A label-less Mermaid node reads back as a box, so only a box or a classed node can drop its label.
  if (omitLabel && (cls !== null || n.shape === "box")) return `${n.id}${suffix}`;
  if (EDGE_START_RE.test(` ${n.label} `)) {
    throw new Error(`node ${n.id}: its label "${n.label}" holds an arrow-like "--" or "-." that Mermaid would read as an edge; reword it first`);
  }
  const shape = cls === "stop" ? "box" : n.shape;
  const wrap = WRAP[shape];
  if (!wrap) throw new Error(`node ${n.id}: dot shape "${n.shape}" has no Mermaid shape; use box, diamond, ellipse, plaintext, doublecircle or octagon`);
  return `${n.id}${wrap[0]}${quoted(n.label)}${wrap[1]}${suffix}`;
}

/** `omitLabels` names nodes whose label a block title supplies. */
export function dotToMermaid(dot: string, opts: { omitLabels?: Set<string> } = {}): { mermaid: string; nodeIds: string[] } {
  for (const m of dot.matchAll(QUOTED_RE)) {
    if (/\\[nlr]/.test(m[0])) throw new Error(`the dot label ${m[0]} holds a \\n, \\l or \\r line break, which a Mermaid label cannot carry; reword it onto one line first`);
  }
  const name = /\b(?:di)?graph\s+(\w+)/.exec(dot)?.[1] ?? "flow";
  const { nodes, edges } = parseDot(dot);
  const omit = opts.omitLabels ?? new Set<string>();
  const lines = ["flowchart TB", `%% name: ${name}`];
  for (const n of nodes) lines.push(`    ${nodeStatement(n, omit.has(n.id))}`);
  for (const e of edges) {
    const arrow = e.style === "dashed" ? "-.->" : "-->";
    if (e.label?.includes("|")) throw new Error(`edge ${e.from} -> ${e.to}: its label "${e.label}" holds a "|", which a Mermaid edge label cannot carry; reword it first`);
    const label = e.label === null ? "" : `|${quoted(e.label)}|`;
    lines.push(`    ${e.from} ${arrow}${label} ${e.to}`);
  }
  return { mermaid: lines.join("\n"), nodeIds: nodes.map((n) => n.id) };
}
