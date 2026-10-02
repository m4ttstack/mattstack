import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Combobox,
  Group,
  NavLink,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  useCombobox,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

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
          <Paper withBorder variant="ground" p="xs" data-selected>
            selected
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
        <Group gap="sm">
          <ActionIcon variant="soft-outline" radius={6} aria-label="More">
            <Icon name="moreHorizontal" size={15} />
          </ActionIcon>
          <Text size="sm">soft-outline control</Text>
        </Group>
        <SegmentedControl
          variant="quiet"
          data={['Template', 'Rendered']}
          defaultValue="Template"
        />
      </Stack>
    </Box>
  );
}

function WashOptions() {
  const store = useCombobox();
  return (
    <Combobox store={store}>
      <Paper variant="ground" withBorder p={6}>
        <Combobox.Options>
          {['plan-policy', 'plan-policy-strict', 'plan-policy-lite'].map(
            name => (
              <Combobox.Option
                key={name}
                value={name}
                variant="wash"
                active={name === 'plan-policy-strict'}
              >
                {name}
              </Combobox.Option>
            )
          )}
        </Combobox.Options>
      </Paper>
    </Combobox>
  );
}

function CardTones() {
  return (
    <Box bg="var(--tk-card)" p="lg" w={420}>
      <Stack gap="sm">
        <Text size="sm">Inside a card (--tk-card)</Text>
        <Paper withBorder p="xs">
          Paper withBorder (Mantine)
        </Paper>
        <Paper variant="soft-outline" p="xs">
          Paper soft-outline: the card shows through
        </Paper>
        <Paper variant="panel-outline" p="xs">
          Paper panel-outline: a note on the panel
        </Paper>
        <Group>
          <Button variant="default">Cancel (Mantine default)</Button>
          <Button variant="card-outline">Cancel (card-outline)</Button>
        </Group>
        <Text size="sm">Combobox.Option wash, the picked one active</Text>
        <WashOptions />
      </Stack>
    </Box>
  );
}

function AttentionTones() {
  return (
    <Box bg="var(--tk-bg)" w={560}>
      <Alert
        variant="tint-outline"
        color="warn"
        radius={0}
        icon={<Icon name="info" size={16} />}
      >
        tint-outline: a banner, ruled in the hue
      </Alert>
      <Stack gap="sm" p="lg">
        <Group gap="sm">
          <Badge variant="tint" color="warn">
            tint
          </Badge>
          <Badge variant="tint" color="bad">
            tint bad
          </Badge>
          <Badge variant="hue-outline" color="warn">
            hue-outline
          </Badge>
          <Badge variant="quiet-outline">quiet-outline</Badge>
        </Group>
        <Group gap="sm">
          <Paper withBorder variant="ground" p="xs" data-attention>
            needs attention
          </Paper>
          <Paper
            withBorder
            variant="ground"
            p="xs"
            data-attention
            data-selected
          >
            needs attention, selected
          </Paper>
        </Group>
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
  name: 'Panel tones: wash row, contrast switch, soft-outline control, quiet segmented',
  render: () => <PanelTones />,
};

export const CardTonesStory: Story = {
  name: 'Card tones: outline papers, card-outline button, wash options',
  render: () => <CardTones />,
};

export const AttentionTonesStory: Story = {
  name: 'Attention tones: tint tag, tint-outline banner, hue-outline chip, ground card attention',
  render: () => <AttentionTones />,
};
