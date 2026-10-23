import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import {
  childrenOf,
  insideSharedTop,
  isIncludedTree,
  labelOf,
} from './blockFacts';
import { plain } from './headingTree';

type Graph = BlocksPayload['graphs'][number];

const TITLE_LINE = /^#{1,6}\s[^\n]*\n*/;

/** The block with its own title line dropped from its text: the view's
    header already shows the title. */
export function bodyOf(block: PayloadBlock): PayloadBlock {
  const [first, ...rest] = block.segments;
  if (block.title === null || !first || first.prop !== null) return block;
  const text = first.text.replace(TITLE_LINE, '');
  return {
    ...block,
    segments: text.trim() === '' ? rest : [{ ...first, text }, ...rest],
  };
}

const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
const NOT_PROSE = /^\s*(#|[-*+]\s|\d+\.\s|>|\||<!--)/;

type Paragraph = { from: number; to: number; plain: string };

/** The prose paragraphs of a text, as line spans: fences, headings, lists,
    tables, quotes and comments are not prose. */
function proseParagraphs(lines: string[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let fence: string | null = null;
  let from = -1;
  const close = (to: number) => {
    if (from < 0) return;
    const body = lines.slice(from, to + 1);
    if (!NOT_PROSE.test(body[0])) {
      paragraphs.push({ from, to, plain: plain(body.join(' ')) });
    }
    from = -1;
  };
  lines.forEach((line, index) => {
    const mark = FENCE_LINE.exec(line)?.[1];
    if (fence !== null) {
      if (mark && mark[0] === fence[0]) fence = null;
      return;
    }
    if (mark) {
      close(index - 1);
      fence = mark;
      return;
    }
    if (line.trim() === '') close(index - 1);
    else if (from < 0) from = index;
  });
  close(lines.length - 1);
  return paragraphs;
}

/** The block's first paragraph of prose, as plain text: the line the header
    shows under the title. */
export function leadOf(block: PayloadBlock): string | null {
  const [first] = block.segments;
  if (!first || first.prop !== null) return null;
  return proseParagraphs(first.text.split('\n'))[0]?.plain ?? null;
}

/** The block with the paragraph that says `lead` dropped, wherever it sits:
    the header already shows it. */
export function withoutLead(
  block: PayloadBlock,
  lead: string | null
): PayloadBlock {
  const [first, ...rest] = block.segments;
  if (!lead || !first || first.prop !== null) return block;
  const lines = first.text.split('\n');
  const para = proseParagraphs(lines).find(p => p.plain === plain(lead));
  if (!para) return block;
  const text = [...lines.slice(0, para.from), ...lines.slice(para.to + 1)]
    .join('\n')
    .replace(/^\s*\n/, '')
    .replace(/\n{3,}/g, '\n\n');
  return {
    ...block,
    segments: text.trim() === '' ? rest : [{ ...first, text }, ...rest],
  };
}

export type ScopeStats = {
  blocks: number;
  withProps: number;
  /** Values the layers pass to the props in scope. */
  values: number;
  graphs: number;
  /** Includes in scope. */
  shared: number;
};

/** What the header's counts line says of the skill (`scope` null) or a
    parent block: the blocks under it, an include's tree counted once. */
export function scopeStats(
  payload: BlocksPayload,
  scope: PayloadBlock | null
): ScopeStats {
  const top = scope ?? payload.blocks.find(block => block.parentId === null);
  if (!top) return { blocks: 0, withProps: 0, values: 0, graphs: 0, shared: 0 };
  const hidden = insideSharedTop(payload);
  const under: PayloadBlock[] = [];
  const seen = new Set<string>([top.id]);
  const visit = (id: string) => {
    for (const child of childrenOf(payload, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (scope === null && hidden(child)) continue;
      if (!isIncludedTree(payload, child)) under.push(child);
      visit(child.id);
    }
  };
  visit(top.id);
  const inScope = [top, ...under];
  const ids = new Set(inScope.map(block => block.id));
  return {
    blocks: under.length,
    withProps: under.filter(block => block.props.length > 0).length,
    values: inScope.reduce(
      (sum, block) =>
        sum +
        block.props.reduce(
          (n, prop) =>
            n + prop.values.filter(value => value.color !== 'mattstack').length,
          0
        ),
      0
    ),
    graphs: payload.graphs.filter(graph => ids.has(graph.blockId)).length,
    shared: payload.includes.filter(include => ids.has(include.blockId)).length,
  };
}

/** The top of the shared tree a shared block sits in; null for a block of
    the skill's own. */
export function sharedRootOf(
  payload: BlocksPayload,
  block: PayloadBlock
): PayloadBlock | null {
  if (block.kind !== 'shared') return null;
  let at = block;
  for (;;) {
    const parent = payload.blocks.find(
      candidate => candidate.id === at.parentId
    );
    if (!parent || parent.kind !== 'shared') return at;
    at = parent;
  }
}

/** rt lists a block's includes in order and draws each included tree ahead
    of the block's own children, so the n-th include is its n-th included
    child: its n-th shared child, or under a shared block, where every child
    is shared, its n-th child. */
export function includeNameOf(
  payload: BlocksPayload,
  root: PayloadBlock
): string | null {
  const includer = payload.blocks.find(block => block.id === root.parentId);
  if (!includer) return null;
  const names = payload.includes
    .filter(include => include.blockId === includer.id)
    .map(include => include.name);
  const children = childrenOf(payload, includer.id);
  const included =
    includer.kind === 'shared'
      ? children
      : children.filter(child => child.kind === 'shared');
  const index = included.indexOf(root);
  return index >= 0 ? (names[index] ?? null) : null;
}

/** The compiled lines a block and everything under it render to. */
export function renderedRangeOf(
  payload: BlocksPayload,
  block: PayloadBlock
): [number, number] | null {
  let range = block.renderedLines;
  const visit = (id: string) => {
    for (const child of childrenOf(payload, id)) {
      const lines = child.renderedLines;
      if (lines) {
        range = range
          ? [Math.min(range[0], lines[0]), Math.max(range[1], lines[1])]
          : lines;
      }
      visit(child.id);
    }
  };
  visit(block.id);
  return range;
}

/** The graph a block's own node sits in, with that node's id. */
export function graphOfBlock(
  payload: BlocksPayload,
  block: PayloadBlock
): { graph: Graph; node: string } | null {
  for (const graph of payload.graphs) {
    const node = graph.nodes.find(candidate => candidate.blockId === block.id);
    if (node) return { graph, node: node.id };
  }
  return null;
}

/** A node that opens a block reads as that block's short label, not the
    graph's own wording. */
export function labelledGraph(payload: BlocksPayload, graph: Graph): Graph {
  const byId = new Map(payload.blocks.map(block => [block.id, block]));
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const block = node.blockId ? byId.get(node.blockId) : undefined;
      return block ? { ...node, label: labelOf(block) } : node;
    }),
  };
}

/** Every block under the root, an include's shared tree counted once by
    its heading: what the switcher counts. */
export function blockCount(payload: BlocksPayload): number {
  const hidden = insideSharedTop(payload);
  return payload.blocks.filter(
    block =>
      block.parentId !== null &&
      !hidden(block) &&
      !isIncludedTree(payload, block)
  ).length;
}
