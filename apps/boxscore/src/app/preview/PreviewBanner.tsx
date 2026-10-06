import { Alert, Anchor, Group, Text } from '@mattstack/app-kit/core';
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
      <Group justify="space-between" gap="md">
        <Text size="sm">{`Previewing ${name}'s Self view`}</Text>
        <Anchor
          component={Link}
          href={teamPersonHref(username)}
          size="sm"
          fw={500}
        >
          Exit preview
        </Anchor>
      </Group>
    </Alert>
  );
}
