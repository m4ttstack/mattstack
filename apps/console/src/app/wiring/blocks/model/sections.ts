import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { childrenOf, dotsOf, labelOf, rootOf } from './blockFacts';
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
};

export type SectionBand = {
  id: string;
  title: string;
  glyph: Glyph;
  blockCount: number;
  propsCount: number;
  rows: FoldedRow[];
};

function rowOf(block: PayloadBlock, selectedId: string | null): FoldedRow {
  return {
    id: block.id,
    glyph: block.kind,
    label: labelOf(block),
    summary: block.summary,
    dots: dotsOf(block),
    hasProps: block.props.length > 0,
    selected: block.id === selectedId,
  };
}

function bandOf(
  id: string,
  title: string,
  glyph: Glyph,
  blocks: PayloadBlock[],
  selectedId: string | null
): SectionBand {
  const rows = blocks.map(block => rowOf(block, selectedId));
  return {
    id,
    title,
    glyph,
    blockCount: rows.length,
    propsCount: rows.filter(row => row.hasProps).length,
    rows,
  };
}

function skillBands(
  payload: BlocksPayload,
  selectedId: string | null
): SectionBand[] {
  const root = rootOf(payload);
  if (!root) return [];
  const top = childrenOf(payload, root.id);
  const folders = top.filter(block => childrenOf(payload, block.id).length > 0);
  const leaves = top.filter(block => !folders.includes(block));
  const bands = folders.map(block =>
    bandOf(
      block.id,
      labelOf(block),
      block.kind,
      childrenOf(payload, block.id),
      selectedId
    )
  );
  if (leaves.length > 0) {
    bands.push(bandOf('notes', 'Notes', 'note', leaves, selectedId));
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
      parent.id,
      labelOf(parent),
      parent.kind,
      childrenOf(payload, parent.id),
      zoom.block.id
    ),
  ];
}
