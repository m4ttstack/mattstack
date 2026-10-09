import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { OutcomeBadge } from './OutcomeBadge';

const meta = {
  title: 'Runs/Run page/OutcomeBadge',
  component: OutcomeBadge,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem' }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OutcomeBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MergedCiPassed: Story = {
  args: {
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'merged', url: null },
      ci: 'success',
    },
  },
};

export const MergedCiFailed: Story = {
  args: {
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'merged', url: null },
      ci: 'failed',
    },
  },
};

export const Abandoned: Story = {
  args: { outcome: { status: 'abandoned' } },
};

export const Failed: Story = { args: { outcome: { status: 'failed' } } };

export const Reviewed: Story = {
  args: {
    outcome: {
      status: 'done',
      reviewed: { iid: 412, url: null, posted: 'request changes' },
    },
  },
};

export const OpenMr: Story = {
  args: {
    outcome: { status: 'done', mr: { iid: 409, state: 'opened', url: null } },
  },
};

export const UnknownMrDrawsNothing: Story = {
  args: {
    outcome: {
      status: 'done',
      mr: { iid: 405, state: 'unknown', url: null },
    },
  },
};
