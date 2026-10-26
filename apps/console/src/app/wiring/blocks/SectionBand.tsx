import { useState } from 'react';
import type { ReactNode } from 'react';
import { Anchor, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { BlockGlyph, BlockRow } from './BlockRow';
import classes from './blocks.module.css';
import type { SectionBand as Band, BandIcon } from './model/sections';

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

/** A section's band (mark, title, block count, how many have props), its
    block's first sentence, and its blocks in one bordered list. A band named
    for a block opens it. */
export function SectionBand({
  band,
  onOpen,
  opensBlock,
  bare = false,
  graph = null,
  introText = null,
  bodyOf,
  usedByCount,
  limit,
}: {
  band: Band;
  /** Rows shown before Show all; every row when unset. */
  limit?: number;
  /** The band's block's graph, as a one-line card under the header. */
  graph?: ReactNode;
  /** The band's block's whole text, which Show more opens. */
  introText?: ReactNode;
  /** A row's text, when the rows are expanded. */
  bodyOf?: (blockId: string) => ReactNode;
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
  const cut = limit !== undefined && band.rows.length > limit && !all;
  const rows = cut ? band.rows.slice(0, limit) : band.rows;
  const title = (
    <>
      {band.id !== 'notes' && <BandMark icon={band.icon} />}
      <span className={classes.bandTitle}>{band.title}</span>
    </>
  );
  const meta =
    band.id === 'shared'
      ? `${blocks(band.blockCount)} · same for everyone`
      : `${blocks(band.blockCount)} · ${band.propsCount} with props`;
  return (
    <section
      className={classes.band}
      aria-label={band.title}
      data-testid="section-band"
    >
      {!bare && (
        <div className={classes.bandHead}>
          <span className={classes.bandOpen}>{title}</span>
          <span className={classes.bandMeta}>{meta}</span>
          {opensBlock && (
            <Anchor
              component="button"
              type="button"
              fz={13}
              fw={500}
              className={classes.bandLink}
              onClick={() => onOpen(band.id)}
            >
              {`Open ${band.title}`}
              <Icon name="chevronRight" size={13} />
            </Anchor>
          )}
        </div>
      )}
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
      {graph}
      <ul className={classes.rows}>
        {rows.map(row => (
          <BlockRow
            key={row.id}
            row={row}
            onOpen={onOpen}
            body={bodyOf?.(row.id)}
            usedBy={
              row.shared?.name ? (usedByCount?.(row.shared.name) ?? null) : null
            }
          />
        ))}
      </ul>
      {limit !== undefined && band.rows.length > limit && (
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
    </section>
  );
}
