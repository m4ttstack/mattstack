import type { CSSProperties } from 'react';

import { HandleAvatar } from './AgentName';
import { useBuddies } from './buddies-context';
import type { DmPair } from './display-name';
import classes from './dm-pair.module.css';

type StackStyle = CSSProperties & { '--stack-size': string };

/** The pair's two sprites, each on a tile, offset corner to corner. */
export function DmStack({ pair, size }: { pair: DmPair; size: number }) {
  const sprite = Math.round(size * 0.66);
  const style: StackStyle = { '--stack-size': `${size}px` };
  return (
    <span className={classes.stack} style={style} aria-hidden>
      {[pair.a, pair.b].map((handle, i) => (
        <span key={i} className={classes.tile}>
          <HandleAvatar handle={handle} variant="name" size={sprite} />
        </span>
      ))}
    </span>
  );
}

/** The pair by name, on one line that truncates at its end. */
export function DmNames({ pair }: { pair: DmPair }) {
  const ctx = useBuddies();
  const name = (handle: string, shown: string | undefined) =>
    shown ?? ctx?.nameOf(handle) ?? handle;
  return (
    <span className={classes.names}>
      {name(pair.a, pair.aName)}, {name(pair.b, pair.bName)}
    </span>
  );
}

/** An open DM's title. */
export function DmPairTitle({ pair }: { pair: DmPair }) {
  return (
    <span className={classes.title}>
      <DmStack pair={pair} size={30} />
      <DmNames pair={pair} />
    </span>
  );
}
