import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { childrenOf, insideSharedTop, labelOf } from './blockFacts';

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

/** The block with its first paragraph dropped when it says `lead`, the line
    the header already shows under the title. */
export function withoutLead(
  block: PayloadBlock,
  lead: string | null
): PayloadBlock {
  const [first, ...rest] = block.segments;
  if (!lead || !first || first.prop !== null) return block;
  const [para, ...after] = first.text.replace(/^\s+/, '').split(/\n\s*\n/);
  if (para.trim() !== lead.trim()) return block;
  const text = after.join('\n\n');
  return {
    ...block,
    segments: text.trim() === '' ? rest : [{ ...first, text }, ...rest],
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
    block => block.parentId !== null && !hidden(block)
  ).length;
}
