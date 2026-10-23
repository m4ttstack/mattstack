import type { ReactNode } from 'react';
import { UnstyledButton } from '@mattstack/app-kit/core';

import { BlockGlyph, BlockRow } from './BlockRow';
import classes from './blocks.module.css';
import type { SectionBand as Band } from './model/sections';

const blocks = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`;

/** A section's band (glyph, title, block count, how many have props) over
    its blocks in one bordered list. A band named for a block opens it. */
export function SectionBand({
  band,
  onOpen,
  opensBlock,
  bare = false,
  graph = null,
  bodyOf,
}: {
  band: Band;
  /** The band's block's graph, as a one-line card under the header. */
  graph?: ReactNode;
  /** A row's text, when the rows are expanded. */
  bodyOf?: (blockId: string) => ReactNode;
  /** The band of the block in view: its rows alone, the header names it. */
  bare?: boolean;
  onOpen: (blockId: string) => void;
  /** False for a band that gathers loose blocks under a name of its own. */
  opensBlock: boolean;
}) {
  const title = (
    <>
      <BlockGlyph glyph={band.glyph} size={15} />
      <span className={classes.bandTitle}>{band.title}</span>
    </>
  );
  return (
    <section
      className={classes.band}
      aria-label={band.title}
      data-testid="section-band"
    >
      {!bare && (
        <div className={classes.bandHead}>
          {opensBlock ? (
            <UnstyledButton
              className={classes.bandOpen}
              onClick={() => onOpen(band.id)}
            >
              {title}
            </UnstyledButton>
          ) : (
            <span className={classes.bandOpen}>{title}</span>
          )}
          <span className={classes.bandMeta}>
            {`${blocks(band.blockCount)} · ${band.propsCount} with props`}
          </span>
        </div>
      )}
      {graph}
      <ul className={classes.rows}>
        {band.rows.map(row => (
          <BlockRow
            key={row.id}
            row={row}
            onOpen={onOpen}
            body={bodyOf?.(row.id)}
          />
        ))}
      </ul>
    </section>
  );
}
