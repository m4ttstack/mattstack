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

/** A headless block has no title and an empty label, so its id stands in:
    the last segment, dashes and underscores as spaces. */
export function labelOf(block: PayloadBlock): string {
  if (block.label) return block.label;
  const last = block.id.split('/').pop() ?? block.id;
  const words = last.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
