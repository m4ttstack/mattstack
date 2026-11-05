import { Group, Text, Tooltip } from '@mattstack/app-kit/core';
import type { UsageKind } from '@mattstack/rt-client';

import { KIND_LABEL, KIND_ORDER, usd } from './format';
import classes from './KindBar.module.css';

/** One bar split by kind. `scale` is the bar's share of the row's width, so
    rows in a list compare by length. */
export function KindBar({
  cost,
  scale = 1,
}: {
  cost: Record<UsageKind, number>;
  scale?: number;
}) {
  const total = KIND_ORDER.reduce((sum, k) => sum + cost[k], 0);
  return (
    <div
      className={classes.track}
      style={{ '--bar-scale': scale } as React.CSSProperties}
      role="img"
      aria-label={KIND_ORDER.filter(k => cost[k] > 0)
        .map(k => `${KIND_LABEL[k]} ${usd(cost[k])}`)
        .join(', ')}
    >
      {KIND_ORDER.filter(k => cost[k] > 0).map(k => (
        <Tooltip key={k} label={`${KIND_LABEL[k]} ${usd(cost[k])}`}>
          <span
            className={classes.segment}
            data-kind={k}
            style={
              {
                '--share': total > 0 ? cost[k] / total : 0,
              } as React.CSSProperties
            }
          />
        </Tooltip>
      ))}
    </div>
  );
}

export function KindLegend({ kinds }: { kinds: UsageKind[] }) {
  return (
    <Group gap={14}>
      {kinds.map(k => (
        <Group key={k} gap={6} wrap="nowrap">
          <span className={classes.swatch} data-kind={k} />
          <Text fz="sm" c="dimmed" lh="normal">
            {KIND_LABEL[k]}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
