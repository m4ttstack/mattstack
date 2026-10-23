import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';

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
  const block = payload.blocks.find(candidate => candidate.id === blockId);
  if (!block) return { zoom: { level: 'skill' }, missing: blockId };
  if (block.parentId === null) {
    return { zoom: { level: 'skill' }, missing: null };
  }
  const hasChildren = payload.blocks.some(
    candidate => candidate.parentId === block.id
  );
  return {
    zoom: { level: hasChildren ? 'parent' : 'block', block },
    missing: null,
  };
}

/** The skill's name stands for the root block, so the chain below it starts
    at the root's children. */
export function crumbsOf(
  payload: BlocksPayload,
  block: PayloadBlock | null
): Crumb[] {
  const chain: Crumb[] = [];
  let at = block;
  while (at && at.parentId !== null) {
    chain.unshift({ id: at.id, label: at.label });
    const parentId: string = at.parentId;
    at = payload.blocks.find(candidate => candidate.id === parentId) ?? null;
  }
  return [{ id: null, label: payload.skill }, ...chain];
}
