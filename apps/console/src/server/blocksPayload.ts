/**
 * The `rt skills blocks --json` payload. A copy of rt's `lib/skills/blocks`
 * types: console's tsconfig covers only `src` and never imports rt's `lib/`.
 * `blocksPayload.test.ts` types the committed `blocks.mini.json` against it,
 * so the copy cannot drift silently.
 */

export type LayerColor = 'mattstack' | 'org' | 'team';

/** One run of a block's own rendered text: the engine's words (`prop: null`) or one prop value. */
export type PayloadSegment = {
  layer: string;
  color: LayerColor;
  prop: string | null;
  text: string;
};

export type GraphNode = {
  id: string;
  label: string | null;
  shape: 'ellipse' | 'diamond' | 'box' | 'plaintext' | 'doublecircle';
  cls: 'stop' | 'done' | null;
  line: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  label: string | null;
  style: 'dashed' | null;
  line: number;
};

export type PayloadBlock = {
  id: string;
  parentId: string | null;
  depth: number;
  title: string | null;
  label: string;
  kind: 'step' | 'question' | 'gate' | 'note' | 'shared';
  path: string;
  relPath: string;
  lines: [number, number];
  summary: string;
  text: string;
  segments: PayloadSegment[];
  props: {
    name: string;
    merge: 'add' | 'replace';
    default: string | null;
    contract: string | null;
    marker: { line: number; col: number } | null;
    values: {
      layer: string;
      color: LayerColor;
      binding: string;
      path: string;
      lines: number;
    }[];
    fromDefault: boolean;
  }[];
  node: string | null;
  order: number | null;
  headless: boolean;
  renderedLines: [number, number] | null;
};

export type BlocksPayload = {
  pack: string;
  skill: string;
  kind: 'verb' | 'stage';
  engineRef: string;
  dir: string;
  layers: { name: string; label: string; color: LayerColor }[];
  blocks: PayloadBlock[];
  graphs: {
    blockId: string;
    nodes: (GraphNode & { blockId: string | null })[];
    edges: GraphEdge[];
  }[];
  /** Every use of a block-tree include: its name and the block whose text includes it. */
  includes: { name: string; blockId: string }[];
  lines: { layer: string; count: number }[];
};
