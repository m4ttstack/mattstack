import { BlockError } from "./diagnostics.ts";
import type { BlockGraph, GraphEdge, GraphNode } from "./types.ts";

type Shape = GraphNode["shape"];
type Cls = "stop" | "done";

const HEADER_RE = /^(?:flowchart|graph)\s+TB\s*$/;
const ID_RE = /^\w+/;
const EDGE_START_RE = /\s(?:-->|--\s)/;
const CLASS_RE = /:::(\w+)$/;
const NAME_RE = /^%%\s*name:\s*(\S+)\s*$/;
const HEADER_MESSAGE = "a block graph starts with `flowchart TB` or `graph TB`";

// Longest delimiters first, so `[/x/]` is a plaintext node and not a box labelled "/x/".
const SHAPES: { re: RegExp; shape: Shape }[] = [
  { re: /^\(\(\((.*)\)\)\)$/, shape: "doublecircle" },
  { re: /^\(\[(.*)\]\)$/, shape: "ellipse" },
  { re: /^\[\/(.*)\/\]$/, shape: "plaintext" },
  { re: /^\{(.*)\}$/, shape: "diamond" },
  { re: /^\[(.*)\]$/, shape: "box" },
];

class Unreadable extends Error {}

type NodeRef = { id: string; shaped: { label: string; shape: Shape } | null; cls: Cls | null };

function unquote(label: string): string {
  const t = label.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function readClass(name: string): Cls {
  if (name === "stop" || name === "done") return name;
  throw new Unreadable(`unknown class :::${name}; use :::stop or :::done`);
}

function readNode(stmt: string, pos: number): { ref: NodeRef; end: number } {
  const idm = ID_RE.exec(stmt.slice(pos));
  if (!idm) throw new Unreadable(`cannot read a node here: ${stmt.slice(pos)}`);
  const id = idm[0];
  let p = pos + id.length;
  let shaped: NodeRef["shaped"] = null;
  let cls: Cls | null = null;
  const next = stmt[p];
  if (next === "(" || next === "[" || next === "{") {
    const rest = stmt.slice(p);
    const cut = EDGE_START_RE.exec(rest);
    const tokenEnd = cut ? cut.index : rest.length;
    let token = rest.slice(0, tokenEnd).trimEnd();
    const cm = CLASS_RE.exec(token);
    if (cm) {
      cls = readClass(cm[1]!);
      token = token.slice(0, cm.index);
    }
    const hit = SHAPES.map((s) => ({ s, m: s.re.exec(token) })).find((x) => x.m);
    if (!hit) throw new Unreadable(`cannot read the shape of node ${id}: ${token}`);
    shaped = { label: unquote(hit.m![1]!), shape: hit.s.shape };
    p += tokenEnd;
  } else {
    const cm = /^:::(\w+)/.exec(stmt.slice(p));
    if (cm) {
      cls = readClass(cm[1]!);
      p += cm[0].length;
    }
  }
  return { ref: { id, shaped, cls }, end: p };
}

function readEdge(stmt: string, pos: number): { label: string | null; end: number } | null {
  let p = pos;
  while (stmt[p] === " " || stmt[p] === "\t") p++;
  if (stmt.startsWith("-->", p)) {
    p += 3;
    const pipe = /^\|([^|]*)\|/.exec(stmt.slice(p));
    if (pipe) return { label: unquote(pipe[1]!), end: p + pipe[0].length };
    return { label: null, end: p };
  }
  const textual = /^--\s+(.+?)\s+-->/.exec(stmt.slice(p));
  if (textual) return { label: unquote(textual[1]!), end: p + textual[0].length };
  return null;
}

export function parseMermaid(source: string, file: string, fenceLine: number): BlockGraph {
  const lines = source.split(/\r?\n/);
  const lineOf = (i: number) => fenceLine + 1 + i;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let name = "flow";
  let headerSeen = false;

  const fail = (i: number, col: number, message: string): never => {
    throw new BlockError([{ file, line: lineOf(i), col, message, code: "bad-graph" }]);
  };

  const touch = (ref: NodeRef, i: number, col: number): void => {
    let node = nodes.get(ref.id);
    if (!node) {
      node = { id: ref.id, label: null, shape: "box", cls: null, line: lineOf(i) };
      nodes.set(ref.id, node);
    }
    if (ref.shaped) {
      if (node.label === null) {
        node.label = ref.shaped.label;
        node.shape = ref.shaped.shape;
        node.line = lineOf(i);
      } else if (node.label !== ref.shaped.label || node.shape !== ref.shaped.shape) {
        fail(i, col, `node ${ref.id} is given a second, different shape or label`);
      }
    }
    if (ref.cls) {
      if (node.cls && node.cls !== ref.cls) fail(i, col, `node ${ref.id} is given two classes`);
      node.cls = ref.cls;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const stmt = raw.trim();
    const col = raw.length - raw.trimStart().length + 1;
    if (stmt === "") continue;
    if (stmt.startsWith("%%")) {
      const nm = NAME_RE.exec(stmt);
      if (nm) name = nm[1]!;
      continue;
    }
    if (!headerSeen) {
      if (!HEADER_RE.test(stmt)) fail(0, 1, HEADER_MESSAGE);
      headerSeen = true;
      continue;
    }
    try {
      let cur = readNode(stmt, 0);
      touch(cur.ref, i, col);
      for (;;) {
        const edge = readEdge(stmt, cur.end);
        if (!edge) break;
        let pos = edge.end;
        while (stmt[pos] === " " || stmt[pos] === "\t") pos++;
        const nxt = readNode(stmt, pos);
        touch(nxt.ref, i, col);
        edges.push({ from: cur.ref.id, to: nxt.ref.id, label: edge.label, line: lineOf(i) });
        cur = nxt;
      }
      if (stmt.slice(cur.end).trim() !== "") throw new Unreadable(`cannot read this graph line: ${stmt}`);
    } catch (e) {
      if (e instanceof Unreadable) fail(i, col, e.message);
      throw e;
    }
  }
  if (!headerSeen) fail(0, 1, HEADER_MESSAGE);
  return { name, file, nodes: [...nodes.values()], edges, fenceLine };
}

export function graphOrder(graph: BlockGraph): string[] {
  return graph.nodes.map((n) => n.id);
}
