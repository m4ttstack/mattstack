import { useMemo } from 'react';
import { Box, Group, NavLink, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { SkillsComposition } from '../../outline';
import type { DrawerUsedBy } from '../model/drawerContent';
import type { FocusGroups } from '../model/focusModel';
import classes from './drawer.module.css';
import { TabHeading } from './TabHeading';
import { USED_BY_GROUPS, usedBySites, type UsedBySite } from './usedBy';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';

const ROW = { root: classes.siteRow, section: classes.siteSection };

function siteAt(site: UsedBySite, kind: DrawerUsedBy['kind']): string {
  if (site.line !== null) return `pastes it at L${site.line}`;
  return kind === 'include' ? 'pastes it in' : 'binds it';
}

function editNote(usedBy: DrawerUsedBy, pack: string): string {
  return usedBy.plugin === pack
    ? 'Edit it in this pack. Every skill above picks up the change when you sync.'
    : `Edit it in the ${usedBy.plugin} plugin. Every skill above picks up the change on its next compile.`;
}

function SiteFile({ site, here }: { site: UsedBySite; here: boolean }) {
  return (
    <Text
      span
      ff="monospace"
      fz={12}
      lh="normal"
      c={here ? undefined : BODY}
      className={classes.rowLabel}
      data-parity="f"
    >
      {site.label}
    </Text>
  );
}

/** Only the open skill's row paints, so it alone is a layer of its own; a
    resting row's icon, file and line sit straight under the list. */
function SiteRow({
  site,
  kind,
  here,
  onFocus,
}: {
  site: UsedBySite;
  kind: DrawerUsedBy['kind'];
  here: boolean;
  onFocus: (focus: string) => void;
}) {
  const at = siteAt(site, kind);
  const icon = <Icon name="fileText" size={13} color={MUTED} data-parity="i" />;
  const where = (
    <Text span fz={11} lh="normal" c={MUTED} data-parity="at">
      {here ? `you are here · ${at}` : at}
    </Text>
  );
  const { focus } = site;
  if (focus === null)
    return (
      <Group gap={10} className={classes.siteRow} data-testid="used-by-row">
        {icon}
        <SiteFile site={site} here={false} />
        <span className={classes.spacer} />
        {where}
      </Group>
    );
  return (
    <NavLink
      component="button"
      type="button"
      variant="wash"
      color="accent"
      active={here}
      label={<SiteFile site={site} here={here} />}
      leftSection={icon}
      rightSection={
        <Group gap={10}>
          {where}
          <Icon name="chevronRight" size={12} color={MUTED} data-parity="go" />
        </Group>
      }
      classNames={ROW}
      data-parity={here ? `row · ${site.skill}` : undefined}
      data-testid="used-by-row"
      onClick={() => onFocus(focus)}
    />
  );
}

/**
 * Every skill in the pack that pastes this partial in or binds this fill,
 * grouped as the focus list groups them, each row focusing its skill.
 */
export function UsedByTab({
  pack,
  skill,
  slot,
  usedBy,
  composition,
  groups,
  onFocus,
}: {
  pack: string;
  /** The skill the drawer was opened from. */
  skill: string;
  /** The slot the drawer was opened from, for a fill. */
  slot: string | null;
  usedBy: DrawerUsedBy;
  composition: SkillsComposition;
  groups: FocusGroups;
  onFocus: (focus: string) => void;
}) {
  const sites = useMemo(
    () => usedBySites(composition, groups, usedBy),
    [composition, groups, usedBy]
  );
  const grouped = USED_BY_GROUPS.map(
    group => [group, sites.filter(site => site.group === group)] as const
  ).filter(([, list]) => list.length > 0);
  const isHere = (site: UsedBySite) =>
    site.skill === skill && (site.slot === null || site.slot === slot);

  return (
    <Box
      className={`${classes.tabBody} ${classes.usedBy}`}
      data-parity="used by"
      data-testid="drawer-used-by"
    >
      <Stack gap={16}>
        {grouped.map(([group, list]) => (
          <Stack key={group} gap={4}>
            <TabHeading parity={`g · ${group}`} testId="used-by-group">
              {group}
            </TabHeading>
            {list.map(site => (
              <SiteRow
                key={`${site.skill}:${site.slot ?? ''}`}
                site={site}
                kind={usedBy.kind}
                here={isHere(site)}
                onFocus={onFocus}
              />
            ))}
          </Stack>
        ))}
        <Text fz={11} lh="normal" c={MUTED} data-parity="note">
          {editNote(usedBy, pack)}
        </Text>
      </Stack>
    </Box>
  );
}
