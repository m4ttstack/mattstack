import { AgentName, HandleAvatar } from './AgentName';
import type { DmPair } from './display-name';
import classes from './dm-pair.module.css';

function End({ handle, name }: { handle: string; name: string | undefined }) {
  return (
    <span className={classes.end}>
      <HandleAvatar handle={handle} variant="name" size={14} />
      <span className={classes.name}>
        <AgentName
          handle={handle}
          name={name}
          variant="name"
          withAvatar={false}
          withCard={false}
        />
      </span>
    </span>
  );
}

/** A DM's name: each end with its sprite, and each truncating on its own so a
    long agent name never pushes the other person off the row. */
export function DmPairTitle({ pair }: { pair: DmPair }) {
  return (
    <span className={classes.pair}>
      <End handle={pair.a} name={pair.aName} />
      <span className={classes.and}>and</span>
      <End handle={pair.b} name={pair.bName} />
    </span>
  );
}
