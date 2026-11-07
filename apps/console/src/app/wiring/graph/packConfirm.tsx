import type { ReactNode } from 'react';
import { Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { ButtonLabel } from './ButtonLabel';
import classes from './graph.module.css';

export const MUTED = 'var(--tk-text-3)';
export const BODY = 'var(--tk-text-1)';
export const BUTTON = {
  root: classes.boardButton,
  section: classes.boardButtonSection,
};

/** The title line every pack write's confirm opens with. */
export function ConfirmTitle({ children }: { children: ReactNode }) {
  return (
    <Text
      span
      display="block"
      fz={15}
      fw={700}
      lh="normal"
      c={BODY}
      data-parity="t"
    >
      {children}
    </Text>
  );
}

/** The frame a pack write's confirm shares (Publish, Compile): its size,
    padding, header and close, and small buttons with the confirm in `color`
    led by `icon`. */
export function packConfirmFrame({
  confirm,
  color,
  icon,
}: {
  confirm: string;
  color: string;
  icon: ReactNode;
}) {
  return {
    labels: {
      confirm: <ButtonLabel>{confirm}</ButtonLabel>,
      cancel: <ButtonLabel>Cancel</ButtonLabel>,
    },
    confirmProps: {
      color,
      size: 'xs',
      radius: 6,
      classNames: BUTTON,
      leftSection: icon,
      'data-parity': `button · ${confirm}`,
    },
    cancelProps: {
      variant: 'card-outline',
      size: 'xs',
      radius: 6,
      classNames: BUTTON,
      'data-parity': 'button · Cancel',
    },
    groupProps: { gap: 8, mt: 14 },
    size: 480,
    radius: 10,
    padding: 20,
    classNames: {
      header: classes.confirmHeader,
      close: classes.confirmClose,
    },
    closeButtonProps: {
      icon: <Icon name="close" size={16} data-parity="close" />,
    },
  };
}
