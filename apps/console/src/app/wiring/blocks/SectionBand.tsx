import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActionIcon,
  Anchor,
  Button,
  Collapse,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { BlockGlyph, BlockRow } from './BlockRow';
import classes from './blocks.module.css';
import type { SectionBand as Band, BandIcon } from './model/sections';

/** A list folds only when more than this many rows would hide past its
    limit: hiding one or two saves less than the Show all line costs. */
const FOLD_SLACK = 2;

const blocks = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`;

function BandMark({ icon }: { icon: BandIcon }) {
  if (icon === 'entry' || icon === 'graph') {
    return (
      <Icon
        name={icon === 'entry' ? 'play' : 'workflow'}
        size={15}
        className={classes.glyph}
        data-glyph={icon}
      />
    );
  }
  return <BlockGlyph glyph={icon} size={15} />;
}

/** A section as one card: a head strip (fold, mark, title, block count,
    then its diagram and Open together), its block's first sentence, and its
    blocks, which the fold hides. A band named for a block opens it. */
export function SectionBand({
  band,
  onOpen,
  opensBlock,
  bare = false,
  graph = null,
  introText = null,
  bodyOf,
  allOpen = false,
  usedByCount,
  limit,
}: {
  band: Band;
  /** Rows shown before Show all; every row when unset. */
  limit?: number;
  /** The band's block's graph, as a button in the head beside Open. */
  graph?: ReactNode;
  /** The band's block's whole text, which Show more opens. */
  introText?: ReactNode;
  /** A row's text, when the rows are expanded. */
  bodyOf?: (blockId: string) => ReactNode;
  /** Expand all is on: every row shows its text. */
  allOpen?: boolean;
  /** The band of the block in view: its rows alone, the header names it. */
  bare?: boolean;
  onOpen: (blockId: string) => void;
  /** False for a band that gathers loose blocks under a name of its own. */
  opensBlock: boolean;
  /** How many skills paste a shared tree in; null when that is unknown. */
  usedByCount?: (name: string) => number | null;
}) {
  const [more, setMore] = useState(false);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(true);
  const folds = limit !== undefined && band.rows.length - limit > FOLD_SLACK;
  const cut = folds && !all;
  const rows = cut ? band.rows.slice(0, limit) : band.rows;
  const title = (
    <>
      {band.id !== 'notes' && <BandMark icon={band.icon} />}
      <span className={classes.bandTitle}>{band.title}</span>
    </>
  );
  const meta =
    band.id === 'shared'
      ? `${band.blockCount} ${band.blockCount === 1 ? 'attachment' : 'attachments'}`
      : `${blocks(band.blockCount)} · ${band.propsCount} with props`;
  return (
    <section
      className={bare ? classes.band : classes.bandCard}
      data-folded={(!bare && !open) || undefined}
      aria-label={band.title}
      data-testid="section-band"
    >
      {!bare && (
        <div className={classes.bandHead}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={open ? `Fold ${band.title}` : `Unfold ${band.title}`}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
            data-testid="band-fold"
          >
            <Icon
              name="chevronRight"
              size={14}
              className={classes.docChevron}
              data-open={open || undefined}
            />
          </ActionIcon>
          <span className={classes.bandOpen}>{title}</span>
          <span className={classes.bandMeta}>{meta}</span>
          {(graph || opensBlock) && (
            <span className={classes.bandActions}>
              {graph}
              {opensBlock && (
                <Button
                  variant="light"
                  size="compact-sm"
                  rightSection={<Icon name="chevronRight" size={13} />}
                  onClick={() => onOpen(band.id)}
                >
                  {`Open ${band.title}`}
                </Button>
              )}
            </span>
          )}
        </div>
      )}
      <Collapse expanded={bare || open}>
        {!bare && band.intro && (
          <div className={classes.bandIntro} data-testid="band-intro">
            {more && introText ? (
              introText
            ) : (
              <span className={classes.bandIntroText}>{band.intro}</span>
            )}
            {introText && (
              <UnstyledButton
                className={classes.bandMore}
                onClick={() => setMore(open => !open)}
              >
                {more ? 'Show less' : 'Show more'}
              </UnstyledButton>
            )}
          </div>
        )}
        <ul className={classes.rows}>
          {rows.map(row => (
            <BlockRow
              key={row.id}
              row={row}
              onOpen={onOpen}
              body={bodyOf?.(row.id)}
              allOpen={allOpen}
              usedBy={
                row.shared?.name
                  ? (usedByCount?.(row.shared.name) ?? null)
                  : null
              }
            />
          ))}
        </ul>
        {folds && (
          <Anchor
            component="button"
            type="button"
            fz={13}
            className={classes.showAll}
            onClick={() => setAll(open => !open)}
          >
            {all ? 'Show fewer' : `Show all ${band.rows.length}`}
          </Anchor>
        )}
      </Collapse>
    </section>
  );
}
