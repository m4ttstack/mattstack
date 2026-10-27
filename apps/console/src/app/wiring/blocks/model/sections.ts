import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import {
  childrenOf,
  dotsOf,
  glyphOf,
  includedTree,
  isSharedTop,
  labelOf,
  rootOf,
} from './blockFacts';
import type { Dot, Glyph } from './blockFacts';
import type { Zoom } from './zoom';

export type FoldedRow = {
  id: string;
  glyph: Glyph;
  label: string;
  summary: string;
  dots: Dot[];
  hasProps: boolean;
  selected: boolean;
  /** On a Shared row: the include's name and its tree's length. */
  shared: { name: string | null; lines: number } | null;
};

/** `entry` marks the band whose graph a run of the skill enters by,
    `graph` any other band with a graph of its own. */
export type BandIcon = Glyph | 'entry' | 'graph';

export type SectionBand = {
  id: string;
  title: string;
  glyph: Glyph;
  icon: BandIcon;
  /** The band's block's first sentence; null for a band of loose blocks. */
  intro: string | null;
  blockCount: number;
  propsCount: number;
  rows: FoldedRow[];
};

function rowOf(
  payload: BlocksPayload,
  block: PayloadBlock,
  selectedId: string | null,
  summary = block.summary
): FoldedRow {
  return {
    id: block.id,
    glyph: glyphOf(payload, block),
    label: labelOf(block),
    summary,
    dots: dotsOf(block),
    hasProps: block.props.length > 0,
    selected: block.id === selectedId,
    shared: null,
  };
}

function spanOf(block: PayloadBlock): number {
  const [from, to] = block.lines;
  return to - from + 1;
}

/** Every line of a shared tree's files, its top included. */
function treeLines(payload: BlocksPayload, top: PayloadBlock): number {
  const seen = new Set<string>();
  const count = (block: PayloadBlock): number => {
    if (seen.has(block.id)) return 0;
    seen.add(block.id);
    return childrenOf(payload, block.id).reduce(
      (sum, child) => sum + count(child),
      spanOf(block)
    );
  };
  return count(top);
}

function sharedRowOf(
  payload: BlocksPayload,
  block: PayloadBlock,
  selectedId: string | null
): FoldedRow {
  const tree = includedTree(payload, block) ?? block;
  const name =
    payload.includes.find(include => include.blockId === block.id)?.name ??
    null;
  return {
    ...rowOf(
      payload,
      block,
      selectedId,
      block.summary || (childrenOf(payload, block.id)[0]?.summary ?? '')
    ),
    shared: { name, lines: treeLines(payload, tree) },
  };
}

function bandOf(
  payload: BlocksPayload,
  id: string,
  title: string,
  glyph: Glyph,
  blocks: PayloadBlock[],
  selectedId: string | null,
  icon: BandIcon = glyph,
  intro: string | null = null
): SectionBand {
  const rows = blocks.map(block => rowOf(payload, block, selectedId));
  return {
    id,
    title,
    glyph,
    icon,
    intro,
    blockCount: rows.length,
    propsCount: rows.filter(row => row.hasProps).length,
    rows,
  };
}

/** The skill's first graph is where a run enters, unless the root draws it. */
function bandIconOf(payload: BlocksPayload, block: PayloadBlock): BandIcon {
  if (!payload.graphs.some(graph => graph.blockId === block.id)) {
    return block.kind;
  }
  return payload.graphs[0]?.blockId === block.id ? 'entry' : 'graph';
}

function skillBands(
  payload: BlocksPayload,
  selectedId: string | null
): SectionBand[] {
  const root = rootOf(payload);
  if (!root) return [];
  const all = childrenOf(payload, root.id);
  const top = all.filter(block => !isSharedTop(payload, block));
  const shared = all.filter(block => isSharedTop(payload, block));
  const folders = top.filter(block => childrenOf(payload, block.id).length > 0);
  const leaves = top.filter(block => !folders.includes(block));
  const bands = folders.map(block =>
    bandOf(
      payload,
      block.id,
      labelOf(block),
      block.kind,
      childrenOf(payload, block.id),
      selectedId,
      bandIconOf(payload, block),
      block.summary || null
    )
  );
  if (leaves.length > 0) {
    // "Other" only reads right after sections of their own; a flat skill's
    // blocks are all it has.
    const title = folders.length > 0 ? 'Other blocks' : 'Blocks';
    bands.push(bandOf(payload, 'notes', title, 'note', leaves, selectedId));
  }
  if (shared.length > 0) {
    const rows = shared.map(block => sharedRowOf(payload, block, selectedId));
    bands.push({
      id: 'shared',
      title: 'Includes',
      glyph: 'shared',
      icon: 'shared',
      intro: null,
      blockCount: rows.length,
      propsCount: rows.filter(row => row.hasProps).length,
      rows,
    });
  }
  return bands;
}

/** At a block, its siblings stay in view so the selection has a band to sit in. */
export function sectionsAt(payload: BlocksPayload, zoom: Zoom): SectionBand[] {
  if (zoom.level === 'skill') return skillBands(payload, null);
  if (zoom.level === 'parent') {
    const { block } = zoom;
    return [
      bandOf(
        payload,
        block.id,
        labelOf(block),
        block.kind,
        childrenOf(payload, block.id),
        null
      ),
    ];
  }
  const parent = payload.blocks.find(
    candidate => candidate.id === zoom.block.parentId
  );
  if (!parent || parent.parentId === null) {
    return skillBands(payload, zoom.block.id);
  }
  return [
    bandOf(
      payload,
      parent.id,
      labelOf(parent),
      parent.kind,
      childrenOf(payload, parent.id),
      zoom.block.id
    ),
  ];
}
