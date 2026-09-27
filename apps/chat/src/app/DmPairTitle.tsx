import { AgentName } from './AgentName';
import { dmPairLabel, type DmPair } from './display-name';

/**
 * An open DM's title. Plain `aName ↔ bName` text unless `withAvatars`, set
 * when another listed DM reads the same pair: then each end carries its
 * id-seeded avatar, as the sidebar's DM rows do.
 */
export function DmPairTitle({
  pair,
  withAvatars,
}: {
  pair: DmPair;
  withAvatars: boolean;
}) {
  if (!withAvatars) return dmPairLabel(pair);
  return (
    <>
      <AgentName handle={pair.a} name={pair.aName} withCard={false} />
      {' ↔ '}
      <AgentName handle={pair.b} name={pair.bName} withCard={false} />
    </>
  );
}
