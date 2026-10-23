import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { childrenOf, dotsOf, isSharedTop, labelOf, rootOf } from './blockFacts';
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
    A row opens when it holds the selection or `unfolded` names it; the
    Shared fold's own id there is `shared`. */
export function sidebarRows(
  payload: BlocksPayload,
  selectedId: string | null,
  unfolded: ReadonlySet<string> = new Set()
): SidebarRow[] {
  const root = rootOf(payload);
  if (!root) return [];
  const rows: SidebarRow[] = [];

  const walk = (block: PayloadBlock, depth: number) => {
    const children = childrenOf(payload, block.id);
    const open =
      children.length > 0 &&
      (unfolded.has(block.id) || holdsSelection(payload, block, selectedId));
    rows.push({
      id: block.id,
      depth,
      label: labelOf(block),
      glyph: block.kind,
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
      unfolded.has('shared') ||
      shared.some(block => holdsSelection(payload, block, selectedId));
    rows.push({
      id: 'shared',
      depth: 0,
      label: 'Shared',
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
