import { BlockError } from "./diagnostics.ts";
import type { BlockGraph } from "./types.ts";

export type DotNode = { id: string; label: string; shape: string; style?: string; fillcolor?: string };
export type DotEdge = { from: string; to: string; label: string | null };

const CLASS_ATTRS = {
  stop: "shape=octagon style=filled fillcolor=red fontcolor=white",
  done: "shape=doublecircle style=filled fillcolor=lightgreen",
};

function escapeLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toDot(graph: BlockGraph, titles: Map<string, string>): string {
  const refuse = (line: number, code: string, message: string): never => {
    throw new BlockError([{ file: graph.file, line, col: 1, message, code }]);
  };
  const out = [`digraph ${graph.name} {`, "    rankdir=TB;", ""];
  for (const n of graph.nodes) {
    const title = titles.get(n.id);
    if (n.label !== null && title !== undefined && n.label !== title) {
      refuse(n.line, "label-disagrees", `node ${n.id} label disagrees with its block: the graph says "${n.label}", the block title is "${title}"`);
    }
    const label = n.label ?? title;
    if (label === undefined) {
      refuse(n.line, "label-missing", `node ${n.id} has no label in the graph and no block title to take one from`);
    }
    const attrs = n.cls ? CLASS_ATTRS[n.cls] : `shape=${n.shape}`;
    out.push(`    ${n.id} [label="${escapeLabel(label!)}" ${attrs}];`);
  }
  out.push("");
  for (const e of graph.edges) {
    out.push(`    ${e.from} -> ${e.to}${e.label === null ? "" : ` [label="${escapeLabel(e.label)}"]`};`);
  }
  out.push("}", "");
  return out.join("\n");
}

function splitStatements(body: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inQuote) {
      cur += ch;
      if (ch === "\\") cur += body[++i] ?? "";
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth === 0 && (ch === ";" || ch === "\n" || ch === "{" || ch === "}")) {
      if (ch !== "{" && cur.trim()) stmts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function readId(s: string, pos: number): { id: string; end: number } | null {
  if (s[pos] === '"') {
    let i = pos + 1;
    let id = "";
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\" && i + 1 < s.length) i++;
      id += s[i];
      i++;
    }
    return { id, end: i + 1 };
  }
  const m = /^[\w.]+/.exec(s.slice(pos));
  return m ? { id: m[0], end: pos + m[0].length } : null;
}

function readAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,;]/.test(inner[i]!)) i++;
    const key = /^[\w-]+/.exec(inner.slice(i));
    if (!key) break;
    i += key[0].length;
    while (inner[i] === " ") i++;
    if (inner[i] !== "=") {
      attrs[key[0]] = "true";
      continue;
    }
    i++;
    while (inner[i] === " ") i++;
    const v = readId(inner, i);
    if (!v) break;
    attrs[key[0]] = v.id;
    i = v.end;
  }
  return attrs;
}

export function parseDot(source: string): { nodes: DotNode[]; edges: DotEdge[] } {
  const nodes = new Map<string, DotNode>();
  const edges: DotEdge[] = [];
  const ensure = (id: string): DotNode => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: id, shape: "ellipse" };
      nodes.set(id, n);
    }
    return n;
  };
  for (const stmt of splitStatements(source)) {
    if (/^(?:strict\s+)?(?:di)?graph\b/.test(stmt) || /^(?:graph|node|edge)\s*\[/.test(stmt) || /^[\w-]+\s*=/.test(stmt)) continue;
    const chain: string[] = [];
    let pos = 0;
    for (;;) {
      const id = readId(stmt, pos);
      if (!id) break;
      chain.push(id.id);
      pos = id.end;
      while (stmt[pos] === " ") pos++;
      if (!stmt.startsWith("->", pos)) break;
      pos += 2;
      while (stmt[pos] === " ") pos++;
    }
    if (chain.length === 0) continue;
    const attrs = readAttrs(stmt.slice(pos));
    if (chain.length === 1) {
      const n = ensure(chain[0]!);
      if (attrs.label !== undefined) n.label = attrs.label;
      if (attrs.shape !== undefined) n.shape = attrs.shape;
      if (attrs.style !== undefined) n.style = attrs.style;
      if (attrs.fillcolor !== undefined) n.fillcolor = attrs.fillcolor;
    } else {
      for (let i = 0; i + 1 < chain.length; i++) {
        ensure(chain[i]!);
        ensure(chain[i + 1]!);
        edges.push({ from: chain[i]!, to: chain[i + 1]!, label: attrs.label ?? null });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}
