import { Modal, useComputedColorScheme } from '@mantine/core';

import { useSettingsEmbed } from '@mattstack/settings-kit/react';

export interface SettingsEmbedModalProps {
  opened: boolean;
  onClose: () => void;
  /** A console settings group id (`chat`, `boxscore`, `deck`, ...). */
  group: string;
  title: string;
  /** Console's origin; derived from this page's host when omitted. */
  origin?: string;
  focusKey?: string;
  onSaved?: (key: string) => void;
}

/** One group of console's settings page in a modal. Console owns every row,
    control and write; the modal only frames it. */
export function SettingsEmbedModal({
  opened,
  onClose,
  title,
  ...frame
}: SettingsEmbedModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={920}
      styles={{ body: { paddingRight: 0 } }}
    >
      {opened && <SettingsFrame {...frame} title={title} onClose={onClose} />}
    </Modal>
  );
}

function SettingsFrame({
  group,
  title,
  origin,
  focusKey,
  onSaved,
  onClose,
}: Omit<SettingsEmbedModalProps, 'opened'>) {
  const scheme = useComputedColorScheme('light');
  const frame = useSettingsEmbed({
    group,
    scheme,
    origin,
    focusKey,
    onSaved,
    onClose,
  });
  return (
    <iframe
      ref={frame.ref}
      src={frame.src}
      title={title}
      style={{
        display: 'block',
        width: '100%',
        height: frame.height,
        maxHeight: '75vh',
        border: 0,
        background: 'transparent',
      }}
    />
  );
}
