import { AgentName } from './AgentName';
import type { DmPair } from './display-name';

/** An open DM's title: each end with its avatar, as the sidebar's DM rows have. */
export function DmPairTitle({ pair }: { pair: DmPair }) {
  return (
    <>
      <AgentName handle={pair.a} name={pair.aName} withCard={false} />
      {' ↔ '}
      <AgentName handle={pair.b} name={pair.bName} withCard={false} />
    </>
  );
}
