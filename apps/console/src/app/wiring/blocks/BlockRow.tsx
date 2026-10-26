import type { ReactNode } from 'react';
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
  selected = false,
}: {
  glyph: Glyph;
  size?: number;
  /** Drawn in the selection's accent, as its row's label is. */
  selected?: boolean;
}) {
  return (
    <Icon
      name={GLYPH_ICON[glyph]}
      size={size}
      className={classes.glyph}
      aria-label={glyph}
      data-glyph={glyph}
      data-hue={glyph}
      data-selected={selected || undefined}
    />
  );
}

/** A block's glyph on a wash of its kind's hue, for a row or a card. */
export function KindBadge({ glyph, size = 13 }: { glyph: Glyph; size?: number }) {
  return (
    <span className={classes.kindBadge} data-hue={glyph}>
      <BlockGlyph glyph={glyph} size={size} />
    </span>
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
  body,
  usedBy = null,
}: {
  row: FoldedRow;
  onOpen: (blockId: string) => void;
  /** The block's text, shown under the row when it is expanded. */
  body?: ReactNode;
  /** On a Shared row, how many skills paste the tree in. */
  usedBy?: number | null;
}) {
  const expanded = body !== undefined && body !== null;
  if (row.shared) {
    const facts = [
      ...(row.shared.name ? [row.shared.name] : []),
      `${row.shared.lines} lines`,
      ...(usedBy !== null
        ? [`in ${usedBy} ${usedBy === 1 ? 'skill' : 'skills'}`]
        : []),
    ].join(' · ');
    return (
      <li className={classes.rowItem}>
        <UnstyledButton
          className={classes.sharedRow}
          data-selected={row.selected || undefined}
          data-testid="block-row"
          onClick={() => onOpen(row.id)}
        >
          <span className={classes.rowLabel}>{row.label}</span>
          <span className={classes.sharedFacts}>{facts}</span>
          <Icon name="chevronRight" size={12} className={classes.rowGo} />
        </UnstyledButton>
        {expanded && (
          <div className={classes.rowBody} data-testid="block-row-body">
            {body}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className={classes.rowItem}>
      <UnstyledButton
        className={classes.row}
        data-selected={row.selected || undefined}
        data-testid="block-row"
        onClick={() => onOpen(row.id)}
      >
        {row.glyph === 'shared' ? (
          <span aria-hidden />
        ) : (
          <KindBadge glyph={row.glyph} />
        )}
        <span className={classes.rowText}>
          <span className={classes.rowLabel}>{row.label}</span>
          {row.summary && !expanded && (
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
          <Icon name="chevronRight" size={12} className={classes.rowGo} />
        </span>
      </UnstyledButton>
      {expanded && (
        <div className={classes.rowBody} data-testid="block-row-body">
          {body}
        </div>
      )}
    </li>
  );
}
