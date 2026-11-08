import type { ReactNode } from 'react';
import { closeAllModals, closeModal, openModal } from '@mantine/modals';

import { confirm } from './confirm';
import { prompt } from './prompt';

type ModalSettings = Parameters<typeof openModal>[0];

export type OpenModalOptions = Omit<ModalSettings, 'title' | 'children'> & {
  title: ReactNode;
  children: ReactNode;
};

function open({ title, closeButtonProps, ...options }: OpenModalOptions) {
  return openModal({
    ...options,
    title,
    closeButtonProps: { 'aria-label': 'Close modal', ...closeButtonProps },
  });
}

// The kit's modals facade: same shape as @mantine/modals' own `modals`
// object, but `confirm`/`prompt` are the kit's higher-level helpers instead
// of the raw mantine primitives.
export const modals = {
  open,
  close: closeModal,
  closeAll: closeAllModals,
  confirm,
  prompt,
};
