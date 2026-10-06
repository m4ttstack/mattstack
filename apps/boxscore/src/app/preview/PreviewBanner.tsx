import { Alert, Button, Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from '@mattstack/app-kit/router';
import { teamPersonHref } from './preview';

export function PreviewBanner({
  username,
  name,
}: {
  username: string;
  name: string;
}) {
  return (
    <Alert
      color="accent"
      variant="light"
      icon={<Icon name="eye" size={16} />}
      data-parity="Preview Banner"
    >
      <Group justify="flex-start" gap="xs">
        <Text size="md">{`Previewing ${name}'s Self view`}</Text>
        <Button
          component={Link}
          href={teamPersonHref(username)}
          variant="subtle"
          color="accent"
          size="compact-sm"
        >
          Exit preview
        </Button>
      </Group>
    </Alert>
  );
}
