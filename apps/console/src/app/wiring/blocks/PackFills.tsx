import { Anchor, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';

import type { BlocksPayload } from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import { labelOf } from './model/blockFacts';

export type PackFill = {
  blockId: string;
  blockLabel: string;
  skill: string;
  lines: number;
};

/** Every value the pack itself passes into this skill, one per block and
    binding, in block order. */
export function packFillsOf(payload: BlocksPayload): PackFill[] {
  const seen = new Set<string>();
  const out: PackFill[] = [];
  for (const block of payload.blocks) {
    for (const prop of block.props) {
      for (const value of prop.values) {
        if (value.color !== 'team') continue;
        const key = `${block.id} ${value.binding}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          blockId: block.id,
          blockLabel: labelOf(block),
          skill: value.binding.slice(value.binding.indexOf(':') + 1),
          lines: value.lines,
        });
      }
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The pack's own fills for a skill, at the top of its view, so what this
    team plugged in is one click away rather than deep in the tree. */
export function PackFills({
  pack,
  fills,
  onOpen,
}: {
  pack: string;
  fills: PackFill[];
  onOpen: (blockId: string) => void;
}) {
  if (fills.length === 0) return null;
  return (
    <section className={classes.packFills} data-testid="pack-fills">
      <div className={classes.packFillsHead}>
        <span className={classes.dot} data-layer="team" aria-hidden />
        <Text span fw={500}>
          From {pack}
        </Text>
        <Text span fz="sm" c="dimmed">
          {plural(fills.length, 'fill', 'fills')} this pack plugs in
        </Text>
      </div>
      {fills.map(fill => (
        <UnstyledButton
          key={`${fill.blockId} ${fill.skill}`}
          className={classes.packFillRow}
          onClick={() => onOpen(fill.blockId)}
          data-testid={`pack-fill-${fill.blockId}`}
        >
          <span className={classes.packFillText}>
            <Text span display="block" truncate>
              {fill.skill}
            </Text>
            <Text span display="block" fz="sm" c="dimmed" truncate>
              fills {fill.blockLabel} · {plural(fill.lines, 'line', 'lines')}
            </Text>
          </span>
          <Anchor component="span" size="sm" className={classes.packFillOpen}>
            Open <Icons.chevronRight size={14} />
          </Anchor>
        </UnstyledButton>
      ))}
    </section>
  );
}
