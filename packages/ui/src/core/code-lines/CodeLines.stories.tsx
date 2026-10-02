import { Box, Paper, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CodeLines } from './CodeLines';

const meta = {
  title: 'Core/CodeLines',
  component: CodeLines,
  decorators: [
    Story => (
      <Box p="lg" maw={720}>
        <Paper withBorder>
          <Story />
        </Paper>
      </Box>
    ),
  ],
} satisfies Meta<typeof CodeLines>;

export default meta;

type Story = StoryObj<typeof meta>;

const sample = [
  '---',
  'name: acme-release',
  'type: pipeline-step',
  '---',
  '',
  '# acme-release',
  '',
  'Cut a release for one package. Read the checklist, then follow it in order.',
  '',
  '{{include:release-checklist}}',
  '',
  '## Steps',
  '',
  '1. Bump the version in `package.json`.',
  '2. Run `{{verb.path:build}}` and wait for it to finish.',
  '3. Tag the commit and push the tag.',
  '4. Run `{{verb.path:publish}}` with the one-time code.',
  '',
  '## Notes',
  '',
  'A release that fails to publish is retried from step 4, never from step 1.',
];

export const Plain: Story = {
  args: { lines: sample, height: 240 },
};

export const Highlighted: Story = {
  args: {
    lines: sample,
    height: 240,
    highlight: [12, 17],
    tintPattern: /\{\{[^}]+\}\}/,
  },
};

export const Banded: Story = {
  args: {
    lines: sample,
    height: 240,
    highlight: [10, 10],
    tintPattern: /\{\{[^}]+\}\}/,
    bands: [
      { from: 1, to: 9, label: 'acme-release', tone: 'muted' },
      { from: 10, to: 10, label: 'release-checklist', tone: 'accent' },
      { from: 11, to: 20, label: 'acme-release', tone: 'muted' },
    ],
  },
};

export const Wash: Story = {
  args: {
    lines: [
      '## Notes',
      '',
      '<!-- part: include:release-checklist source=acme:release-checklist -->',
      '# Release checklist',
      '',
      'Confirm the changelog names every package that changed.',
      'Run `{{verb.path:build}}` once more on a clean tree.',
      '',
      '## Steps',
    ],
    firstLine: 40,
    height: 200,
    variant: 'wash',
    highlight: [42, 47],
    tintPattern: /\{\{[^}]+\}\}/,
    mutedPattern: /^<!--/,
    bands: [
      { from: 30, to: 41, label: 'acme-release', tone: 'muted' },
      { from: 42, to: 47, label: 'release-checklist', tone: 'accent' },
    ],
  },
};

export const OffsetNumbers: Story = {
  args: { lines: sample.slice(11), firstLine: 412, height: 240 },
};

const longFile = Array.from(
  { length: 2000 },
  (_, i) => `line ${i + 1}: the quick brown fox jumps over the lazy dog`
);

export const TwoThousandLines: Story = {
  render: args => (
    <>
      <Text size="sm" p="sm">
        2,000 lines, scrolled to line 1,980 on mount. Only the rows near the
        viewport are in the DOM.
      </Text>
      <CodeLines {...args} />
    </>
  ),
  args: {
    lines: longFile,
    height: 320,
    highlight: [1980, 1984],
    scrollTo: 1980,
  },
};
