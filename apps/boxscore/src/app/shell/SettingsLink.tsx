import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  MATTSTACK_HEADER_ICON_SIZE,
  SettingsEmbedModal,
} from '@mattstack/app-kit/app';
import { ActionIcon, Tooltip } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { useLinks } from './useLinks';

/** boxscore's settings live in console: this opens console's boxscore group
    in a modal. */
export function SettingsLink() {
  const { console: consoleUrl } = useLinks();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Tooltip label="Settings">
        <ActionIcon
          variant="subtle"
          size={MATTSTACK_HEADER_ICON_SIZE}
          aria-label="Settings"
          onClick={() => setOpened(true)}
        >
          <Icon name="settings" size={16} />
        </ActionIcon>
      </Tooltip>
      <SettingsEmbedModal
        opened={opened}
        onClose={() => setOpened(false)}
        group="boxscore"
        title="boxscore settings"
        origin={new URL(consoleUrl).origin}
        onSaved={() => void queryClient.invalidateQueries()}
      />
    </>
  );
}
