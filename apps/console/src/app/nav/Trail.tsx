import { Anchor, Breadcrumbs, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './nav.module.css';

export type TrailItem = {
  key: string;
  label: string;
  /** Unset on the page itself, the trail's last item. */
  onClick?: () => void;
  /** A command, set in monospace as Claude Code shows it. */
  mono?: boolean;
};

/** Where a page sits, above its title: each place above it a link, the page
    itself plain. A page that shows a Trail never shows a BackPill too. */
export function Trail({
  items,
  testId,
}: {
  items: TrailItem[];
  testId?: string;
}) {
  return (
    <Breadcrumbs
      separator={
        <Icon name="chevronRight" size={12} className={classes.separator} />
      }
      separatorMargin={6}
      className={classes.trail}
      data-testid={testId}
    >
      {items.map((item, index) =>
        index === items.length - 1 || !item.onClick ? (
          <Text
            key={item.key}
            span
            fz={13}
            ff={item.mono ? 'monospace' : undefined}
            className={classes.here}
          >
            {item.label}
          </Text>
        ) : (
          <Anchor
            key={item.key}
            component="button"
            type="button"
            fz={13}
            fw={500}
            ff={item.mono ? 'monospace' : undefined}
            onClick={item.onClick}
          >
            {item.label}
          </Anchor>
        )
      )}
    </Breadcrumbs>
  );
}
