import { Badge, Box } from '@mattstack/app-kit/core';

import { useSettingsTeam } from './useConsoleSettings';
import { layerLabel, rungBase, type LayerScope, type StoreScope } from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  team: 'purple',
  user: 'cyan',
  machine: 'accent',
};

type BadgeBase = StoreScope | 'default';

export function ScopeDot({ scope }: { scope: BadgeBase }) {
  return (
    <Box
      component="span"
      w={6}
      h={6}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${scope === 'default' ? 'gray' : SCOPE_COLOR[scope]}-filled)`,
      }}
    />
  );
}

/** `bare` leaves the team's name off, for a fixed-width column a long slug
    would truncate. */
export function ScopeBadge({
  scope,
  bare = false,
}: {
  scope: LayerScope | 'default';
  bare?: boolean;
}) {
  const base: BadgeBase = scope === 'default' ? 'default' : rungBase(scope)!;
  const named = useSettingsTeam();
  const team = bare ? null : named;
  const hue = base === 'default' ? null : SCOPE_COLOR[base];
  return (
    <Badge
      variant="light"
      color={hue ?? 'gray'}
      radius="sm"
      tt="none"
      fw={500}
      lts={0}
      c={hue ? `var(--tk-text-${hue}-small)` : undefined}
      leftSection={<ScopeDot scope={base} />}
      style={{
        '--badge-height': '17px',
        '--badge-fz': '12px',
        '--badge-padding-x': '6px',
        paddingInlineStart: 5,
      }}
      styles={{ section: { marginInlineEnd: 4 } }}
    >
      {scope === 'default' ? 'default' : layerLabel(scope, team)}
    </Badge>
  );
}
