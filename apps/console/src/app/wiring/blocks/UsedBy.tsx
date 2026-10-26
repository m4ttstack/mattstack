import { useMemo } from 'react';
import { Box, Group, NavLink, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import type { SkillsComposition } from '../outline';
import classes from './history.module.css';
import { USED_BY_GROUPS, usedBySites, type UsedBySite } from './model/usedBy';
import { TabHeading } from './TabHeading';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';

const ROW = { root: classes.siteRow, section: classes.siteSection };

const siteAt = (site: UsedBySite) =>
  site.file !== null && site.line !== null
    ? `pastes it at ${site.file} L${site.line}`
    : 'pastes it in';

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
  here,
  onFocus,
}: {
  site: UsedBySite;
  here: boolean;
  onFocus: (focus: string) => void;
}) {
  const at = siteAt(site);
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
 * Every skill in the pack that pastes a shared block in, grouped as the
 * focus list groups them, each row focusing its skill.
 */
export function UsedBy({
  skill,
  name,
  composition,
  groups,
  pipeline,
  onFocus,
}: {
  /** The skill the block view shows. */
  skill: string;
  /** The shared block's include name. */
  name: string;
  composition: SkillsComposition;
  groups: FocusGroups;
  /** The pipeline the open skill runs in; a step it runs opens as its step. */
  pipeline: FocusItem | null;
  onFocus: (focus: string) => void;
}) {
  const sites = useMemo(
    () => usedBySites(composition, groups, name, pipeline),
    [composition, groups, name, pipeline]
  );
  const grouped = USED_BY_GROUPS.map(
    group => [group, sites.filter(site => site.group === group)] as const
  ).filter(([, list]) => list.length > 0);

  return (
    <Box data-parity="used by" data-testid="block-used-by">
      <Stack gap={16}>
        {grouped.map(([group, list]) => (
          <Stack key={group} gap={4}>
            <TabHeading parity={`g · ${group}`} testId="used-by-group">
              {group}
            </TabHeading>
            {list.map(site => (
              <SiteRow
                key={site.skill}
                site={site}
                here={site.skill === skill}
                onFocus={onFocus}
              />
            ))}
          </Stack>
        ))}
        {sites.length === 0 ? (
          <Text fz={12} lh="normal" c={MUTED}>
            No skill in this pack pastes {name} in directly.
          </Text>
        ) : (
          <Text fz={11} lh="normal" c={MUTED} data-parity="note">
            One copy for every skill above: a change to it reaches each of them
            on its next compile.
          </Text>
        )}
      </Stack>
    </Box>
  );
}
