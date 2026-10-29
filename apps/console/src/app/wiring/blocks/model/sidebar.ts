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

export type { Glyph } from './blockFacts';

export type SidebarRow = {
  id: string;
  depth: number;
  label: string;
  glyph: Glyph;
  dots: Dot[];
  /** Children, on a folder row. */
  count: number | null;
  open: boolean;
  selected: boolean;
};

function holdsSelection(
  payload: BlocksPayload,
  block: PayloadBlock,
  selectedId: string | null
): boolean {
  let at = payload.blocks.find(candidate => candidate.id === selectedId);
  while (at) {
    if (at.id === block.id) return true;
    const parentId: string | null = at.parentId;
    at = payload.blocks.find(candidate => candidate.id === parentId);
  }
  return false;
}

/** Depth 0 is the root's children: the skill's name stands for the root.
    A row starts open when it holds the selection; `toggled` names the rows
    folded or unfolded by hand against that, the Shared fold by `shared`.
    An include heading is one row for its shared tree. */
export function sidebarRows(
  payload: BlocksPayload,
  linkedId: string | null,
  toggled: ReadonlySet<string> = new Set()
): SidebarRow[] {
  const root = rootOf(payload);
  if (!root) return [];
  const linked = payload.blocks.find(block => block.id === linkedId);
  const selectedId = (linked && includedTree(payload, linked)?.id) ?? linkedId;
  const rows: SidebarRow[] = [];

  const walk = (heading: PayloadBlock, depth: number) => {
    const block = includedTree(payload, heading) ?? heading;
    const children = childrenOf(payload, block.id);
    const open =
      children.length > 0 &&
      holdsSelection(payload, block, selectedId) !== toggled.has(block.id);
    rows.push({
      id: block.id,
      depth,
      label: labelOf(heading),
      glyph: glyphOf(payload, heading),
      dots: dotsOf(block),
      count: children.length > 0 ? children.length : null,
      open,
      selected: block.id === selectedId,
    });
    if (open) children.forEach(child => walk(child, depth + 1));
  };

  const top = childrenOf(payload, root.id);
  top
    .filter(block => !isSharedTop(payload, block))
    .forEach(block => walk(block, 0));

  const shared = top.filter(block => isSharedTop(payload, block));
  if (shared.length > 0) {
    const open =
      shared.some(block => holdsSelection(payload, block, selectedId)) !==
      toggled.has('shared');
    rows.push({
      id: 'shared',
      depth: 0,
      label: 'Includes',
      glyph: 'shared',
      dots: [],
      count: shared.length,
      open,
      selected: selectedId === 'shared',
    });
    if (open) shared.forEach(block => walk(block, 1));
  }
  return rows;
}
