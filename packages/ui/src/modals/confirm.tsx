import type { ReactNode } from 'react';
import { openConfirmModal } from '@mantine/modals';
import type { OpenConfirmModal } from '@mantine/modals';

import { Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

export interface ConfirmLabels {
  confirm?: ReactNode;
  cancel?: ReactNode;
}

export interface ConfirmOptions extends Omit<
  OpenConfirmModal,
  'title' | 'children' | 'labels' | 'onConfirm' | 'onCancel'
> {
  title: ReactNode;
  message: ReactNode;
  /** Renders a warning icon next to the title and a red confirm button. */
  destructive?: boolean;
  /** Hides the cancel button entirely (not just disables it). */
  hideCancelButton?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  labels?: ConfirmLabels;
}

// Thin wrapper around @mantine/modals' openConfirmModal: fixed title/message
// rendering, plus the kit's `destructive` and `hideCancelButton`
// conveniences. Any other openConfirmModal option (size, modalId,
// closeOnConfirm, ...) passes through.
export function confirm(options: ConfirmOptions): void {
  const {
    title,
    message,
    destructive = false,
    hideCancelButton = false,
    onConfirm,
    onCancel,
    labels,
    confirmProps,
    cancelProps,
    ...rest
  } = options;

  openConfirmModal({
    ...rest,
    title: destructive ? (
      <Group gap="xs" wrap="nowrap">
        <Icon name="warning" size={18} color="var(--mantine-color-red-6)" />
        <span>{title}</span>
      </Group>
    ) : (
      title
    ),
    children:
      typeof message === 'string' ? (
        <Text size="md" lh={1.5} c="var(--ui-text-2)">
          {message}
        </Text>
      ) : (
        message
      ),
    labels: {
      confirm: labels?.confirm ?? 'Confirm',
      cancel: labels?.cancel ?? 'Cancel',
    },
    confirmProps: destructive
      ? { color: 'red', ...confirmProps }
      : confirmProps,
    cancelProps: hideCancelButton
      ? { display: 'none' }
      : { variant: 'default', ...cancelProps },
    groupProps: { mt: 'xxl', ...rest.groupProps },
    onConfirm,
    onCancel,
  });
}
