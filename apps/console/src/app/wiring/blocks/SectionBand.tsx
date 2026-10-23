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
}: {
  band: Band;
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
      <ul className={classes.rows}>
        {band.rows.map(row => (
          <BlockRow key={row.id} row={row} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
