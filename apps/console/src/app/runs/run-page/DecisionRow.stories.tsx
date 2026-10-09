import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { answeredWith, approachQuestion, gateOf } from './decisionFixtures';
import { DecisionRow } from './DecisionRow';

const meta = {
  title: 'Runs/Run page/DecisionRow',
  component: DecisionRow,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DecisionRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AnsweredByYou: Story = {
  args: { gate: gateOf(), question: approachQuestion },
};

export const AnsweredByShepherd: Story = {
  args: {
    gate: gateOf({
      answer: answeredWith({ approach: 'backend' }, 'shepherd'),
    }),
    question: approachQuestion,
  },
};

export const NoAnswerer: Story = {
  args: {
    gate: gateOf({ answer: answeredWith({ approach: 'backend' }, null) }),
    question: approachQuestion,
  },
};

export const WentAgainstTheRecommendation: Story = {
  args: {
    gate: gateOf({
      answer: answeredWith({
        approach: { value: 'panel', note: 'The service is not ready yet' },
      }),
    }),
    question: approachQuestion,
  },
};

export const Closed: Story = {
  args: {
    gate: gateOf({ status: 'closed', closedReason: 'abandoned', answer: null }),
    question: approachQuestion,
  },
};

export const Superseded: Story = {
  args: {
    gate: gateOf({
      status: 'closed',
      closedReason: 'superseded',
      supersededBy: 'g-20261008-0413',
      answer: null,
    }),
    question: approachQuestion,
  },
};
