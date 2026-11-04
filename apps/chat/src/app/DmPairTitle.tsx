import { HandleAvatar } from './AgentName';
import { useBuddies } from './buddies-context';
import type { DmPair } from './display-name';
import classes from './dm-pair.module.css';

function End({ handle, name }: { handle: string; name: string | undefined }) {
  const ctx = useBuddies();
  return (
    <span className={classes.end}>
      <HandleAvatar handle={handle} variant="name" size={14} />
      <span className={classes.name}>
        {name ?? ctx?.nameOf(handle) ?? handle}
      </span>
    </span>
  );
}

/** A DM's name: each end with its sprite, on one line that truncates at its
    end. */
export function DmPairTitle({ pair }: { pair: DmPair }) {
  return (
    <span className={classes.pair}>
      <End handle={pair.a} name={pair.aName} />
      <span className={classes.and}>and</span>
      <End handle={pair.b} name={pair.bName} />
    </span>
  );
}
