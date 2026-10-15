import { useShellRail } from '@mattstack/app-kit/app';
import { Indicator } from '@mattstack/app-kit/core';
import { Link, RailLink } from '@mattstack/app-kit/router';

import { countsForConsoleBadge } from '../../shared/gate-waiting';
import { nowOf } from './derive/clock';
import { useLinkedGates } from './runs-page/useLinkedGates';
import { runsHomeHref } from './runs-page/useRunsUrl';
import classes from './RunsRailEntry.module.css';
import { useRunList } from './useRuns';

const WAITING_HREF = '/?filter=waiting';

/** The gates waiting on me: the same count as the deck tab's badge. */
function useWaitingCount(): number {
  const now = nowOf(useRunList().data);
  return useLinkedGates().all.filter(g => countsForConsoleBadge(g, now)).length;
}

/**
 * The Runs rail entry plus the count of gates waiting on me. The count rides
 * an `Indicator` whose label links to the waiting runs, closing the rail the
 * way `WiringRailEntry`'s does.
 */
export function RunsRailEntry({ active }: { active: boolean }) {
  const count = useWaitingCount();
  const { close } = useShellRail();

  const entry = (
    <RailLink
      icon="workflow"
      label="Runs"
      href={runsHomeHref()}
      active={active}
    />
  );

  if (count === 0) return entry;

  return (
    <Indicator
      color="bad"
      size={16}
      offset={6}
      position="top-end"
      label={
        <Link
          href={WAITING_HREF}
          onClick={close}
          aria-label={`${count} waiting on you — show only those`}
          data-testid="waiting-badge"
          className={classes.count}
        >
          {count}
        </Link>
      }
    >
      {entry}
    </Indicator>
  );
}
