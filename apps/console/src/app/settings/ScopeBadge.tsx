import { Badge, Box } from '@mattstack/app-kit/core';

import { useSettingsTeam } from './useConsoleSettings';
import { layerLabel, rungBase, type LayerScope, type StoreScope } from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  team: 'purple',
  user: 'cyan',
  machine: 'accent',
};

export function ScopeDot({ scope }: { scope: StoreScope }) {
  return (
    <Box
      component="span"
      w={6}
      h={6}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${SCOPE_COLOR[scope]}-filled)`,
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
  scope: LayerScope;
  bare?: boolean;
}) {
  const base = rungBase(scope)!;
  const named = useSettingsTeam();
  const team = bare ? null : named;
  return (
    <Badge
      variant="light"
      color={SCOPE_COLOR[base]}
      radius="sm"
      tt="none"
      fw={500}
      lts={0}
      c={`var(--tk-text-${SCOPE_COLOR[base]}-small)`}
      leftSection={<ScopeDot scope={base} />}
      style={{
        '--badge-height': '17px',
        '--badge-fz': '12px',
        '--badge-padding-x': '6px',
        paddingInlineStart: 5,
      }}
      styles={{ section: { marginInlineEnd: 4 } }}
    >
      {layerLabel(scope, team)}
    </Badge>
  );
}
