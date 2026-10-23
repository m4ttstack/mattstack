import { UnstyledButton } from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';

import classes from './blocks.module.css';
import type { Dot, Glyph } from './model/blockFacts';
import type { FoldedRow } from './model/sections';

const GLYPH_ICON: Record<Glyph, IconName> = {
  step: 'circle',
  question: 'diamond',
  gate: 'flag',
  note: 'fileText',
  shared: 'package',
};

export function BlockGlyph({
  glyph,
  size = 13,
}: {
  glyph: Glyph;
  size?: number;
}) {
  return (
    <Icon
      name={GLYPH_ICON[glyph]}
      size={size}
      className={classes.glyph}
      aria-label={glyph}
      data-glyph={glyph}
    />
  );
}

export function LayerDots({ dots }: { dots: Dot[] }) {
  if (dots.length === 0) return null;
  return (
    <span className={classes.dots} data-testid="layer-dots">
      {dots.map(dot => (
        <span
          key={dot}
          className={classes.dot}
          data-layer={dot}
          title={
            dot === 'org'
              ? 'The org base passes a value'
              : 'The team passes a value'
          }
        />
      ))}
    </span>
  );
}

/** One folded block: glyph, short label, first sentence, layer dots and a
    plug when the block has props. A click opens the block. */
export function BlockRow({
  row,
  onOpen,
}: {
  row: FoldedRow;
  onOpen: (blockId: string) => void;
}) {
  return (
    <li className={classes.rowItem}>
      <UnstyledButton
        className={classes.row}
        data-selected={row.selected || undefined}
        data-testid="block-row"
        onClick={() => onOpen(row.id)}
      >
        <Icon name="chevronRight" size={12} className={classes.chevron} />
        <BlockGlyph glyph={row.glyph} />
        <span className={classes.rowText}>
          <span className={classes.rowLabel}>{row.label}</span>
          {row.summary && (
            <span className={classes.rowSummary}>{row.summary}</span>
          )}
        </span>
        <span className={classes.rowMarks}>
          <LayerDots dots={row.dots} />
          {row.hasProps && (
            <Icon
              name="plug"
              size={13}
              className={classes.glyph}
              aria-label="has props"
              data-testid="row-has-props"
            />
          )}
        </span>
      </UnstyledButton>
    </li>
  );
}
