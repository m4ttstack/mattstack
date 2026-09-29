import { MATTSTACK_HEADER_ICON_SIZE } from '@mattstack/app-kit/app';
import { ActionIcon, Stack, Text, Tooltip } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { useLinks } from './useLinks';

/** boxscore has no settings page: its settings live in console. */
export function SettingsLink() {
  const { console: consoleUrl } = useLinks();
  return (
    <Tooltip
      label={
        <Stack gap={2}>
          <Text size="xs" fw={500}>
            Settings ↗
          </Text>
          <Text size="xs">Opens console › boxscore</Text>
        </Stack>
      }
    >
      <ActionIcon
        component="a"
        href={`${consoleUrl}/settings#boxscore`}
        target="_blank"
        rel="noreferrer"
        variant="subtle"
        size={MATTSTACK_HEADER_ICON_SIZE}
        aria-label="Settings, opens console in a new tab"
      >
        <Icon name="settings" size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
