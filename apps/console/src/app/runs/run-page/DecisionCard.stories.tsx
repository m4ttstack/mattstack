import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { DecisionCard } from './DecisionCard';
import {
  answeredWith,
  approachQuestion,
  FINDINGS_CONTEXT,
  gateOf,
  PROSE_CONTEXT,
  reviewQuestion,
} from './decisionFixtures';

const meta = {
  title: 'Runs/Run page/DecisionCard',
  component: DecisionCard,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DecisionCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const TookTheRecommendation: Story = {
  args: { gate: gateOf({ context: PROSE_CONTEXT }) },
};

export const OverrodeWithANote: Story = {
  args: {
    gate: gateOf({
      answer: answeredWith({
        approach: {
          value: 'panel',
          note: 'Hourly matters for rush orders. Worth the new key.',
        },
      }),
      context: PROSE_CONTEXT,
    }),
  },
};

export const StructuredContext: Story = {
  args: {
    gate: gateOf({
      subject: 'mr:acme/web!412',
      kind: 'review-post',
      questions: [reviewQuestion],
      answer: answeredWith({ outcome: 'changes' }, 'board'),
      context: FINDINGS_CONTEXT,
    }),
  },
};

export const EditedReply: Story = {
  args: {
    gate: gateOf({
      subject: 'mr:acme/web!412',
      kind: 'respond-post',
      questions: [reviewQuestion],
      answer: answeredWith(
        {
          outcome: {
            value: 'comment',
            text: 'Thanks, fixed in the next push.',
          },
        },
        'board'
      ),
    }),
  },
};

export const TwoQuestionsWithQuestionContext: Story = {
  args: {
    gate: gateOf({
      questions: [
        { ...approachQuestion, context: PROSE_CONTEXT },
        {
          id: 'scope',
          label: 'Scope',
          multi: false,
          options: ['Both linked parcels and recipients', 'Parcels only'],
        },
      ],
      answer: answeredWith(
        {
          approach: 'backend',
          scope: 'Both linked parcels and recipients',
        },
        'shepherd'
      ),
    }),
  },
};

export const Closed: Story = {
  args: {
    gate: gateOf({ status: 'closed', closedReason: 'abandoned', answer: null }),
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
  },
};
