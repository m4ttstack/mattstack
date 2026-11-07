import { Center, Loader, Stack, Text } from '@mattstack/app-kit/core';

/** The transcript of a Slack chat whose agent has not said hello yet. */
export function SlackOpeningNote() {
  return (
    <Center mih="40dvh" data-testid="slack-opening-note">
      <Stack align="center" gap={4}>
        <Loader size={22} aria-label="Opening" />
        <Text fw={500} size="lg">
          Opening the chat
        </Text>
        <Text size="md" c="dimmed">
          Waiting for the first message
        </Text>
      </Stack>
    </Center>
  );
}
