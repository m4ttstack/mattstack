import { useMemo, useState } from 'react';
import { Anchor, Badge, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import type { SkillsComposition } from '../outline';
import classes from './blocks.module.css';
import {
  USED_BY_GROUPS,
  usedBySites,
  type UsedByGroup,
  type UsedBySite,
} from './model/usedBy';

/** Rows shown before Show all. */
const SHOWN = 6;

const GROUP_LABEL: Record<UsedByGroup, string> = {
  'PIPELINE STEPS': 'pipeline step',
  STANDALONE: 'standalone',
  BOARD: 'board',
  'NOT WIRED INTO ANYTHING': 'not wired',
};

/** The sites in the focus list's group order, the open skill's among them. */
export function useUsedBySites(
  composition: SkillsComposition,
  groups: FocusGroups,
  name: string,
  pipeline: FocusItem | null
): UsedBySite[] {
  return useMemo(() => {
    const sites = usedBySites(composition, groups, name, pipeline);
    return USED_BY_GROUPS.flatMap(group =>
      sites.filter(site => site.group === group)
    );
  }, [composition, groups, name, pipeline]);
}

function SiteRow({
  site,
  here,
  onFocus,
}: {
  site: UsedBySite;
  here: boolean;
  onFocus: (focus: string) => void;
}) {
  const body = (
    <>
      <Icon name="fileText" size={13} className={classes.glyph} />
      <span className={classes.siteName}>{site.skill}</span>
      <span className={classes.siteGroup}>{GROUP_LABEL[site.group]}</span>
      {here && (
        <Badge size="xs" variant="filled" color="accent" radius="xl">
          You are here
        </Badge>
      )}
    </>
  );
  const { focus } = site;
  if (here || focus === null) {
    return (
      <li className={classes.rowItem}>
        <div
          className={classes.siteRow}
          data-here={here || undefined}
          data-testid="used-by-row"
        >
          {body}
        </div>
      </li>
    );
  }
  return (
    <li className={classes.rowItem}>
      <UnstyledButton
        className={classes.siteRow}
        data-testid="used-by-row"
        onClick={() => onFocus(focus)}
      >
        {body}
        <Icon name="chevronRight" size={12} className={classes.rowGo} />
      </UnstyledButton>
    </li>
  );
}

/**
 * Every skill in the pack that pastes a shared block in, in the focus list's
 * order, each row focusing its skill.
 */
export function UsedBy({
  skill,
  sites,
  name,
  onFocus,
}: {
  /** The skill the block view shows. */
  skill: string;
  sites: UsedBySite[];
  /** The shared block's include name. */
  name: string;
  onFocus: (focus: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (sites.length === 0) {
    return (
      <Text fz={13} c="dimmed" data-testid="block-used-by">
        {`No skill in this pack pastes ${name} in directly.`}
      </Text>
    );
  }
  const shown = all ? sites : sites.slice(0, SHOWN);
  return (
    <div className={classes.listBlock} data-testid="block-used-by">
      <ul className={classes.rows}>
        {shown.map(site => (
          <SiteRow
            key={site.skill}
            site={site}
            here={site.skill === skill}
            onFocus={onFocus}
          />
        ))}
      </ul>
      {sites.length > SHOWN && (
        <Anchor
          component="button"
          type="button"
          fz={13}
          className={classes.showAll}
          onClick={() => setAll(open => !open)}
        >
          {all ? 'Show fewer' : `Show all ${sites.length}`}
        </Anchor>
      )}
    </div>
  );
}
