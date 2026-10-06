import { Badge, Box, Text, Tooltip } from '@mattstack/app-kit/core';
import { useHasOverflowX } from '@mattstack/app-kit/hooks';

import { useSettingsOrg, useSettingsTeam } from './useConsoleSettings';
import {
  isRung,
  layerLabel,
  rungBase,
  scopeLabel,
  type LayerScope,
  type StoreScope,
} from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  org: 'gold',
  team: 'purple',
  user: 'cyan',
  machine: 'warn',
};

export function scopeTextColor(scope: StoreScope): string {
  return `var(--tk-text-${SCOPE_COLOR[scope]}-small)`;
}

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

/** A label that does not fit its column ends in an ellipsis and shows whole
    in a tooltip. Only the store's name shortens: a repo rung's `· repo`
    always shows, so a cut-off rung never reads as its global layer. */
export function ScopeBadge({ scope }: { scope: LayerScope | 'default' }) {
  const base: BadgeBase = scope === 'default' ? 'default' : rungBase(scope)!;
  const team = useSettingsTeam();
  const org = useSettingsOrg();
  const hue = base === 'default' ? null : SCOPE_COLOR[base];
  const label = scope === 'default' ? 'default' : layerLabel(scope, team, org);
  const name = base === 'default' ? 'default' : scopeLabel(base, team, org);
  const { ref, hasOverflow } = useHasOverflowX<HTMLParagraphElement>();
  return (
    <Tooltip label={label} disabled={!hasOverflow}>
      <Badge
        variant="light"
        color={hue ?? 'gray'}
        radius="sm"
        tt="none"
        fw={500}
        lts={0}
        c={base === 'default' ? undefined : scopeTextColor(base)}
        leftSection={<ScopeDot scope={base} />}
        style={{
          '--badge-height': '17px',
          '--badge-fz': '12px',
          '--badge-padding-x': '6px',
          paddingInlineStart: 5,
        }}
        styles={{ section: { marginInlineEnd: 4 } }}
      >
        <Box component="span" style={{ display: 'flex', minWidth: 0 }}>
          <Text ref={ref} span inherit truncate display="block">
            {name}
          </Text>
          {isRung(scope) && (
            <Text span inherit style={{ flex: 'none', whiteSpace: 'pre' }}>
              {' · repo'}
            </Text>
          )}
        </Box>
      </Badge>
    </Tooltip>
  );
}
