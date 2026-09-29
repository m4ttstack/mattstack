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
        size="lg"
        aria-label="Settings"
      >
        <Icon name="settings" size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
