import { Group, Text, Tooltip } from '@mattstack/app-kit/core';
import type { UsageKind } from '@mattstack/rt-client';

import { KIND_LABEL, KIND_ORDER, usd } from './format';
import classes from './KindBar.module.css';

/** One full-width bar split by kind. */
export function KindBar({ cost }: { cost: Record<UsageKind, number> }) {
  const kinds = KIND_ORDER.filter(k => cost[k] > 0);
  const total = kinds.reduce((sum, k) => sum + cost[k], 0);
  return (
    <div
      className={classes.track}
      role="img"
      aria-label={kinds.map(k => `${KIND_LABEL[k]} ${usd(cost[k])}`).join(', ')}
    >
      {kinds.map(k => (
        <Tooltip key={k} label={`${KIND_LABEL[k]} ${usd(cost[k])}`}>
          <span
            className={classes.segment}
            data-kind={k}
            style={{ '--share': cost[k] / total } as React.CSSProperties}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** A bar's fill over a quiet track. */
export function ShareBar({ share, kind }: { share: number; kind?: UsageKind }) {
  return (
    <div className={classes.shareTrack}>
      <span
        className={classes.fill}
        data-kind={kind ?? 'work'}
        style={{ '--share': share } as React.CSSProperties}
      />
    </div>
  );
}

export function KindLegend({ kinds }: { kinds: UsageKind[] }) {
  return (
    <Group gap={10} wrap="nowrap">
      {kinds.map(k => (
        <Group key={k} gap={4} wrap="nowrap">
          <span className={classes.swatch} data-kind={k} />
          <Text fz="sm" c="dimmed" lh="normal">
            {KIND_LABEL[k]}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
