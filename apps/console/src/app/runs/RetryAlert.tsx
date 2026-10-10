import type { ReactNode } from 'react';
import { Alert, Button, Text } from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';

import classes from './RetryAlert.module.css';

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface RetryAlertProps extends DataAttributes {
  color: 'warn' | 'bad';
  icon: IconName;
  children: ReactNode;
  onRetry: () => void;
  retryLabel?: string;
  /** The retry is running. */
  busy?: boolean;
}

/** Something could not be read or written, with the one button that tries
    again beside the sentence that says so. */
export function RetryAlert({
  color,
  icon,
  children,
  onRetry,
  retryLabel = 'Retry',
  busy,
  ...data
}: RetryAlertProps) {
  return (
    <Alert
      color={color}
      variant="light"
      icon={<Icon name={icon} size={16} data-parity="i" />}
      classNames={{
        wrapper: classes.wrapper,
        icon: classes.icon,
        message: classes.message,
      }}
      {...data}
    >
      {/* Alert draws a light variant's message in body text, so the hue is
          set on the sentence. */}
      <Text fz="lg" lh="normal" c={color} data-parity="t">
        {children}
      </Text>
      <Button
        variant="default"
        loading={busy}
        onClick={onRetry}
        className={classes.retry}
        data-parity={`btn ${retryLabel}`}
      >
        <span data-parity="l">{retryLabel}</span>
      </Button>
    </Alert>
  );
}
