import { useShellRail } from '@mattstack/app-kit/app';
import { Indicator } from '@mattstack/app-kit/core';
import { Link, RailLink } from '@mattstack/app-kit/router';

import classes from './SlackRailEntry.module.css';
import { useSlackGates } from './useSlackGates';

export const SLACK_GATES_HREF = '/slack-gates';

/** The Slack chats rail entry plus the count of requests waiting on me. The
    count rides an `Indicator` whose label links to the same page, closing
    the rail the way the Runs entry's does. */
export function SlackRailEntry({ active }: { active: boolean }) {
  const count = useSlackGates().gates.length;
  const { close } = useShellRail();

  const entry = (
    <RailLink
      icon="messageSquareMore"
      label="Slack chats"
      href={SLACK_GATES_HREF}
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
          href={SLACK_GATES_HREF}
          onClick={close}
          aria-label={`${count} Slack chat requests waiting`}
          data-testid="slack-badge"
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
