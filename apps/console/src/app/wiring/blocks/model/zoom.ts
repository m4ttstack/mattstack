import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { includedTree, shownLabel } from './blockFacts';

export type Zoom =
  | { level: 'skill' }
  | { level: 'parent'; block: PayloadBlock }
  | { level: 'block'; block: PayloadBlock };

type Crumb = { id: string | null; label: string };

/** `missing` carries an unknown id back so the view can say the link is stale. */
export function zoomOf(
  payload: BlocksPayload,
  blockId: string | null
): { zoom: Zoom; missing: string | null } {
  if (blockId === null) return { zoom: { level: 'skill' }, missing: null };
  const found = payload.blocks.find(candidate => candidate.id === blockId);
  if (!found) return { zoom: { level: 'skill' }, missing: blockId };
  if (found.parentId === null) {
    return { zoom: { level: 'skill' }, missing: null };
  }
  const block = includedTree(payload, found) ?? found;
  const hasChildren = payload.blocks.some(
    candidate => candidate.parentId === block.id
  );
  return {
    zoom: { level: hasChildren ? 'parent' : 'block', block },
    missing: null,
  };
}

/** The skill's name stands for the root block, so the chain below it starts
    at the root's children. An include heading and its tree are one crumb. */
export function crumbsOf(
  payload: BlocksPayload,
  block: PayloadBlock | null
): Crumb[] {
  const chain: Crumb[] = [];
  let at = block;
  while (at && at.parentId !== null) {
    const folded =
      chain.length > 0 && includedTree(payload, at)?.id === chain[0].id;
    if (!folded) chain.unshift({ id: at.id, label: shownLabel(payload, at) });
    const parentId: string = at.parentId;
    at = payload.blocks.find(candidate => candidate.id === parentId) ?? null;
  }
  return [{ id: null, label: payload.skill }, ...chain];
}
