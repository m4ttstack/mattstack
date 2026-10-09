import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import type { RailStage } from '../derive/stages';
import { StageRail } from './StageRail';

const MIN = 60_000;

const stage = (
  name: string,
  status: RailStage['status'],
  durationMs: number | null = null,
  attempts = status === 'not-started' ? 0 : 1
): RailStage => ({ name, status, durationMs, attempts });

const pipeline = (
  upTo: number,
  current: RailStage['status'],
  gates?: Record<string, number>
) => ({
  stages: [
    'provision',
    'plan',
    'gates',
    'evidence',
    'implement',
    'self-review',
    'ship',
    'watch-ci',
  ].map((name, i): RailStage => {
    if (i < upTo) return stage(name, 'done', (i % 3 ? 44 : 1) * MIN);
    if (i === upTo)
      return stage(name, current, current === 'running' ? null : 4 * MIN);
    return stage(name, 'not-started');
  }),
  gateCounts: gates ?? {},
});

const meta = {
  title: 'Runs/Run page/StageRail',
  component: StageRail,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 1180 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof StageRail>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Live: Story = {
  args: pipeline(4, 'running', { plan: 3, evidence: 2 }),
};

export const WaitingOnYou: Story = {
  args: pipeline(1, 'waiting', { plan: 3 }),
};

export const Held: Story = { args: pipeline(2, 'held') };

export const Failed: Story = { args: pipeline(4, 'failed') };

export const Redirected: Story = {
  args: {
    stages: [
      stage('plan', 'redirected', 6 * MIN, 2),
      stage('implement', 'running'),
      stage('ship', 'not-started'),
    ],
    gateCounts: {},
  },
};

export const FinishedRunWithStaleRunningStage: Story = {
  args: { ...pipeline(4, 'running'), finished: true },
};

export const Compact: Story = {
  args: { ...pipeline(4, 'running', { plan: 3 }), compact: true },
};
