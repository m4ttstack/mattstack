import { Badge, Button, Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { RailLink } from '../router/RailLink';
import { MattstackShell } from './MattstackShell';

const meta = {
  title: 'App/MattstackShell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: '/' });
  return <Router hook={hook}>{children}</Router>;
}

const Mark = () => (
  <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
    <rect width={30} height={30} rx={7} fill="currentColor" />
  </svg>
);

export const Default: Story = {
  render: () => (
    <Frame>
      <MattstackShell name="demo" mark={<Mark />}>
        <MattstackShell.Rail>
          <RailLink icon="layers" label="Runs" href="/" />
        </MattstackShell.Rail>
        <Text p="xl">Page content</Text>
      </MattstackShell>
    </Frame>
  ),
};

export const WithHeader: Story = {
  render: () => (
    <Frame>
      <MattstackShell name="demo" mark={<Mark />}>
        <MattstackShell.Header
          actions={
            <Group gap="sm" wrap="nowrap">
              <Badge variant="default">acme/web-app</Badge>
              <Button variant="default" size="xs">
                Refresh
              </Button>
            </Group>
          }
        >
          <Group gap={8} wrap="nowrap">
            <Text fw={700}>demo</Text>
            <Text c="dimmed">/</Text>
            <Text>Runs</Text>
          </Group>
        </MattstackShell.Header>
        <MattstackShell.Rail>
          <RailLink icon="layers" label="Runs" href="/" />
        </MattstackShell.Rail>
        <Text p="xl">Page content</Text>
      </MattstackShell>
    </Frame>
  ),
};
