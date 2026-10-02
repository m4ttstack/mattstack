import {
  Badge,
  Box,
  Group,
  NavLink,
  Paper,
  Progress,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { useSchemeColors } from '@mattstack/app-kit/hooks';

const meta = {
  title: 'Design System/Theme',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function BackgroundLevels() {
  const { bg } = useSchemeColors();

  return (
    <Stack gap={0} w={320}>
      {(['level1', 'level2', 'level3', 'level4'] as const).map(level => (
        <Paper
          key={level}
          bg={bg[level]}
          p="lg"
          radius={0}
          withBorder={false}
          shadow="none"
        >
          <Text fw={600}>{level}</Text>
          <Text size="sm" c="dimmed">
            {bg[level]}
          </Text>
        </Paper>
      ))}
    </Stack>
  );
}

function TextTokens() {
  const { text } = useSchemeColors();

  return (
    <Stack gap="xs" w={320}>
      {(['normal', 'muted', 'dimmed'] as const).map(token => (
        <Text key={token} c={text[token]}>
          text.{token} -- {text[token]}
        </Text>
      ))}
    </Stack>
  );
}

function QuietBadges() {
  return (
    <Box bg="var(--tk-bg)" p="lg" w={420}>
      <Stack gap="sm">
        <Text size="sm">On the page ground (--tk-bg)</Text>
        <Group gap="sm">
          <Badge variant="light" color="gray">
            gray light
          </Badge>
          <Badge variant="quiet">quiet</Badge>
          <Badge variant="quiet-outline">quiet-outline</Badge>
        </Group>
      </Stack>
    </Box>
  );
}

function CanvasSurfaces() {
  return (
    <Box bg="var(--tk-bg)" p="lg" w={420}>
      <Stack gap="sm">
        <Text size="sm">Cards on the page ground (--tk-bg)</Text>
        <Group gap="sm">
          <Paper withBorder p="xs">
            Paper withBorder
          </Paper>
          <Paper withBorder variant="ground" p="xs">
            Paper ground
          </Paper>
        </Group>
        <Paper withBorder variant="ground" p="sm">
          <Stack gap="sm">
            <Text size="sm">Inside a ground card</Text>
            <Badge variant="panel-outline">panel-outline</Badge>
            <Progress.Root variant="segmented" size={8}>
              <Progress.Section value={20} color="accent" />
              <Progress.Section value={30} color="gray" />
              <Progress.Section value={35} color="gray" data-active />
              <Progress.Section value={15} color="gray" />
            </Progress.Root>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}

function PanelTones() {
  return (
    <Box bg="var(--tk-panel)" p="lg" w={260}>
      <Stack gap="sm">
        <Text size="sm">On a panel surface (--tk-panel)</Text>
        <NavLink label="wash, active" variant="wash" color="accent" active />
        <NavLink label="light, active (Mantine)" color="accent" active />
        <Switch variant="contrast" label="contrast switch, off" />
        <Switch label="default switch, off" />
      </Stack>
    </Box>
  );
}

export const BgLevels: Story = {
  render: () => <BackgroundLevels />,
};

export const TextTokensStory: Story = {
  name: 'Text tokens',
  render: () => <TextTokens />,
};

export const QuietBadgeTones: Story = {
  name: 'Quiet badge tones',
  render: () => <QuietBadges />,
};

export const CanvasSurfacesStory: Story = {
  name: 'Canvas surfaces: ground paper, panel chip, segmented bar',
  render: () => <CanvasSurfaces />,
};

export const PanelTonesStory: Story = {
  name: 'Wash row and contrast switch',
  render: () => <PanelTones />,
};
