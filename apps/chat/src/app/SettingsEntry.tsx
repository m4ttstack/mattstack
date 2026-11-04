import { useState } from 'react';
import { SettingsEmbedModal } from '@mattstack/app-kit/app';
import { ActionIcon } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

/** chat's settings live in console: the top bar's gear opens console's chat
    group in a modal. */
export function SettingsButton() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={26}
        aria-label="Settings"
        onClick={() => setOpened(true)}
      >
        <Icon name="settings" size={16} />
      </ActionIcon>
      <SettingsEmbedModal
        opened={opened}
        onClose={() => setOpened(false)}
        group="chat"
        title="chat settings"
      />
    </>
  );
}
