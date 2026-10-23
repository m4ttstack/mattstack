import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';

export type Glyph = 'step' | 'question' | 'gate' | 'note' | 'shared';
export type Dot = 'org' | 'team';

export function childrenOf(
  payload: BlocksPayload,
  parentId: string
): PayloadBlock[] {
  return payload.blocks.filter(block => block.parentId === parentId);
}

export function rootOf(payload: BlocksPayload): PayloadBlock | undefined {
  return payload.blocks.find(block => block.parentId === null);
}

/** A top-level block that stands for a shared tree: a shared block itself,
    or the heading block an include sits under, which `includes` names. */
export function isSharedTop(
  payload: BlocksPayload,
  block: PayloadBlock
): boolean {
  const root = rootOf(payload);
  if (!root || block.parentId !== root.id) return false;
  if (block.kind === 'shared') return true;
  if (!payload.includes.some(include => include.blockId === block.id)) {
    return false;
  }
  const children = childrenOf(payload, block.id);
  return (
    children.length > 0 && children.every(child => child.kind === 'shared')
  );
}

export function sharedTopIds(payload: BlocksPayload): Set<string> {
  return new Set(
    payload.blocks
      .filter(block => isSharedTop(payload, block))
      .map(block => block.id)
  );
}

/** Under a top-level include, at the skill: its square stands for the tree. */
export function insideSharedTop(
  payload: BlocksPayload
): (block: PayloadBlock) => boolean {
  const tops = sharedTopIds(payload);
  const parentOf = new Map(
    payload.blocks.map(block => [block.id, block.parentId])
  );
  return block => {
    const seen = new Set<string>();
    for (let at = parentOf.get(block.id); at; at = parentOf.get(at)) {
      if (seen.has(at)) return false;
      seen.add(at);
      if (tops.has(at)) return true;
    }
    return false;
  };
}

/** A segment's layer by its pack's name (`widgets`, `acme-base`), as the
    boards name them; mattstack's own value stays `default`. */
export function layerName(payload: BlocksPayload, label: string): string {
  if (label === 'default') return label;
  return payload.layers.find(layer => layer.label === label)?.name ?? label;
}

/** A headless block has no title and an empty label, so its id stands in:
    the last segment, dashes and underscores as spaces. */
export function labelOf(block: PayloadBlock): string {
  if (block.label) return block.label;
  const last = block.id.split('/').pop() ?? block.id;
  const words = last.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** rt draws an include as a heading block whose one child is the shared
    tree; the view reads the two as one, so it opens as that tree. */
export function includedTree(
  payload: BlocksPayload,
  block: PayloadBlock
): PayloadBlock | null {
  if (block.kind === 'shared') return null;
  if (!payload.includes.some(include => include.blockId === block.id)) {
    return null;
  }
  const children = childrenOf(payload, block.id);
  const [only] = children;
  return children.length === 1 && only.kind === 'shared' ? only : null;
}

function includeHeadingOf(
  payload: BlocksPayload,
  block: PayloadBlock
): PayloadBlock | null {
  const parent = payload.blocks.find(
    candidate => candidate.id === block.parentId
  );
  return parent && includedTree(payload, parent)?.id === block.id
    ? parent
    : null;
}

/** The tree under an include heading: the heading stands for it in a
    count or a map, so it is not counted again. */
export function isIncludedTree(
  payload: BlocksPayload,
  block: PayloadBlock
): boolean {
  return includeHeadingOf(payload, block) !== null;
}

/** A shared tree goes by the name its include heading gives it here. */
export function shownLabel(
  payload: BlocksPayload,
  block: PayloadBlock
): string {
  return labelOf(includeHeadingOf(payload, block) ?? block);
}

/** The layer's role colour, not its label: `mattstack` draws no dot. */
export function dotsOf(block: PayloadBlock): Dot[] {
  const colors = new Set(
    block.props.flatMap(prop => prop.values.map(value => value.color))
  );
  const dots: Dot[] = [];
  if (colors.has('org')) dots.push('org');
  if (colors.has('team')) dots.push('team');
  return dots;
}
