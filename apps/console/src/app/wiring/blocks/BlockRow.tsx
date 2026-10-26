import { useState } from 'react';
import type { ReactNode } from 'react';
import { Anchor, UnstyledButton } from '@mattstack/app-kit/core';
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
    plug when the block has props. A click on the row shows its text in
    place; Open goes into the block. */
export function BlockRow({
  row,
  onOpen,
  body,
  allOpen = false,
  usedBy = null,
}: {
  row: FoldedRow;
  onOpen: (blockId: string) => void;
  /** The block's text, shown under the row when it is open. */
  body?: ReactNode;
  /** Expand all is on. */
  allOpen?: boolean;
  /** On an include's row, how many skills include the tree. */
  usedBy?: number | null;
}) {
  const [own, setOwn] = useState<{ all: boolean; open: boolean } | null>(
    null
  );
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
        {expanded && allOpen && (
          <div className={classes.rowBody} data-testid="block-row-body">
            {body}
          </div>
        )}
      </li>
    );
  }
  // Expand all sets every row; a click on one row overrides it until Expand
  // all changes again.
  const open = own !== null && own.all === allOpen ? own.open : allOpen;
  const shown = open && expanded;
  const toggle = () =>
    expanded ? setOwn({ all: allOpen, open: !open }) : onOpen(row.id);
  return (
    <li className={classes.rowItem}>
      <div className={classes.row} data-selected={row.selected || undefined}>
        <UnstyledButton
          className={classes.rowToggle}
          aria-expanded={expanded ? shown : undefined}
          data-testid="block-row"
          onClick={toggle}
        >
          <Icon
            name={shown ? 'chevronDown' : 'chevronRight'}
            size={12}
            className={classes.rowCaret}
            data-hidden={!expanded || undefined}
          />
          {row.glyph === 'shared' ? (
            <span aria-hidden />
          ) : (
            <KindBadge glyph={row.glyph} />
          )}
          <span className={classes.rowText}>
            <span className={classes.rowLabel}>{row.label}</span>
          </span>
        </UnstyledButton>
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
          <Anchor
            component="button"
            type="button"
            fz={13}
            fw={500}
            className={classes.rowOpen}
            onClick={() => onOpen(row.id)}
            data-testid="block-row-open"
          >
            Open
            <Icon name="chevronRight" size={12} />
          </Anchor>
        </span>
      </div>
      {shown && (
        <div className={classes.rowBody} data-testid="block-row-body">
          {body}
        </div>
      )}
    </li>
  );
}
