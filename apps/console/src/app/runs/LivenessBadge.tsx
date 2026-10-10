import { Badge, type BadgeProps } from '@mattstack/app-kit/core';
import { notifications } from '@mattstack/app-kit/notifications';

import { client } from '../api';
import type { HeroLiveness } from './derive/liveness';
import { Dot } from './run-page/Dot';

/** Brings the run's agent pane to the front, or says it couldn't. */
export async function focusPane(pane: string) {
  try {
    const res = await client.api.panes[':id'].focus.$post({
      param: { id: pane },
    });
    if (!res.ok) notifications.error("couldn't focus the pane");
  } catch {
    notifications.error("couldn't focus the pane");
  }
}

type DataAttributes = { [key: `data-${string}`]: string | undefined };

/** Whether a run is driven, idle, waiting or done, as a tinted chip with a
    dot in the same tone. */
export function LivenessBadge({
  liveness,
  size,
  ...data
}: { liveness: HeroLiveness; size?: BadgeProps['size'] } & DataAttributes) {
  return (
    <Badge
      size={size}
      radius="xl"
      variant="light"
      color={liveness.tone}
      tt="none"
      leftSection={<Dot tone={liveness.tone} data-parity="dot" />}
      data-parity="Chip liveness"
      {...data}
    >
      <span data-parity="label">{liveness.label}</span>
    </Badge>
  );
}
