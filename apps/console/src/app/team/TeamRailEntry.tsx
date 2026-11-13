import { useShellRail } from '@mattstack/app-kit/app';
import { Indicator } from '@mattstack/app-kit/core';
import { Link, RailLink } from '@mattstack/app-kit/router';

import classes from './TeamRailEntry.module.css';
import { useTeam } from './useTeam';

export const TEAM_HREF = '/team';

/** The Team page opened on one team. */
export function teamHref(slug: string): string {
  return `${TEAM_HREF}?team=${encodeURIComponent(slug)}`;
}

/** The Team rail entry, for org owners and admins only, with the count of
    teammates waiting for approval. */
export function TeamRailEntry({ active }: { active: boolean }) {
  const { teams, waiting } = useTeam();
  const { close } = useShellRail();

  if (teams.length === 0) return null;

  const entry = (
    <RailLink icon="users" label="Team" href={TEAM_HREF} active={active} />
  );

  if (waiting === 0) return entry;

  return (
    <Indicator
      color="bad"
      size={16}
      offset={6}
      position="top-end"
      label={
        <Link
          href={TEAM_HREF}
          onClick={close}
          aria-label={`${waiting} waiting for approval`}
          data-testid="team-badge"
          className={classes.count}
        >
          {waiting}
        </Link>
      }
    >
      {entry}
    </Indicator>
  );
}
