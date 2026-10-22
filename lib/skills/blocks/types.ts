export type { BlockDiagnostic } from "./diagnostics.ts";

export type PropSpec = {
  name: string;
  merge: "add" | "replace";
  default: string | null;
  contract: string | null;
  declaredAt: { line: number; col: number };
};

export type MarkerUse = { prop: string; line: number; col: number };

export type Block = {
  id: string; // "ship/flow/fast-checks"
  path: string; // absolute file path
  relPath: string; // plugin-relative, for seams
  depth: number; // root = 0
  title: string | null; // null = headless
  label: string; // frontmatter label, else id tail in plain words
  node: string | null;
  order: number | null;
  kind: "gate" | null;
  props: PropSpec[];
  markers: MarkerUse[];
  text: string; // body below the title line, frontmatter stripped
  bodyStartLine: number;
  textStartLine: number; // file line of text's first line
  graph: BlockGraph | null;
  children: Block[];
  frontmatter: Record<string, unknown>; // the root's engine fields live here
};

export type BlockTree = { root: Block; dir: string; byId: Map<string, Block> };

export type GraphNode = {
  id: string;
  label: string | null;
  shape: "ellipse" | "diamond" | "box" | "plaintext" | "doublecircle";
  cls: "stop" | "done" | null;
  line: number;
};

export type GraphEdge = { from: string; to: string; label: string | null; line: number };

export type BlockGraph = { name: string; file: string; nodes: GraphNode[]; edges: GraphEdge[]; fenceLine: number };
