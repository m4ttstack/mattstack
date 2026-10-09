import { Alert, Button, Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './GatesUnreadable.module.css';

/** The run's gates could not be read: its decisions are unknown, not none. */
export function GatesUnreadable({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert
      color="warn"
      variant="light"
      icon={<Icon name="unplug" size={16} />}
      classNames={{ wrapper: classes.wrapper, icon: classes.icon }}
      data-testid="gates-unreadable"
    >
      <Group justify="space-between" wrap="wrap" gap={12}>
        <Text fz={13} lh="normal" c="warn">
          Can&apos;t read this run&apos;s decisions right now, so none are shown
          here.
        </Text>
        <Button variant="default" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </Group>
    </Alert>
  );
}
