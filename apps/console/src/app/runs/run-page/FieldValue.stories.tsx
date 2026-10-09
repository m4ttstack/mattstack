import type { Meta, StoryObj } from '@storybook/react-vite';

import { FieldValue } from './FieldValue';

const meta = {
  title: 'Runs/Run page/FieldValue',
  component: FieldValue,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FieldValue>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Text: Story = {
  args: {
    fieldKey: 'approach',
    value: 'Superpowers: spec, plan, then subagent tasks',
  },
};

export const Url: Story = {
  args: {
    fieldKey: 'mr',
    value: 'https://git.acme.test/acme/web/-/merge_requests/405',
  },
};

export const ShaList: Story = {
  args: {
    fieldKey: 'commits',
    value: '9f2c1a7e3b5d4c6a8b0e1f2a3b4c5d6e7f8a9b0c 1a2b3c4d5e6f708192a3b4c5',
  },
};

export const Json: Story = {
  args: {
    fieldKey: 'strategy',
    value:
      '{"mode":"subagent-driven","tasks":5,"files":["apps/web/src/orders/Overview.tsx","apps/web/src/orders/Parcels.tsx"],"flags":{"dryRun":false}}',
  },
};

export const GateRef: Story = {
  args: { fieldKey: 'waiting-gate', value: 'g-20261008-0412' },
};

export const Cleared: Story = {
  args: { fieldKey: 'mr', value: '-' },
};
