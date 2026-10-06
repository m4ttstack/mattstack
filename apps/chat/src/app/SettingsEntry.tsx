import { useState } from 'react';
import { SettingsEmbedModal, useShellRail } from '@mattstack/app-kit/app';
import { RailEntry } from '@mattstack/app-kit/core';

/** chat's settings live in console: the rail entry opens console's chat
    group in a modal. */
export function SettingsEntry() {
  const rail = useShellRail();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <RailEntry
        icon="settings"
        label="Settings"
        expanded={rail.expanded}
        onClick={() => {
          rail.close();
          setOpened(true);
        }}
      />
      <SettingsEmbedModal
        opened={opened}
        onClose={() => setOpened(false)}
        group="chat"
        title="chat settings"
      />
    </>
  );
}
