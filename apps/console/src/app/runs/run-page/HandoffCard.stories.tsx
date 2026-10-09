import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  AT,
  FINDINGS_CONTEXT,
  gateOf,
  reviewQuestion,
} from './decisionFixtures';
import { HandoffCard } from './HandoffCard';

const waiting = gateOf({
  subject: 'mr:acme/web!412',
  kind: 'review-post',
  questions: [reviewQuestion],
  meta: null,
  status: 'open',
  answer: null,
  openedAt: AT - 2 * 60_000,
  context: FINDINGS_CONTEXT,
});

const meta = {
  title: 'Runs/Run page/HandoffCard',
  component: HandoffCard,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 780 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
  args: {
    gate: waiting,
    boardUrl: 'http://localhost:11006/?gate=g-1',
    now: AT,
  },
} satisfies Meta<typeof HandoffCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithBoardLink: Story = {};

export const NoBoardLink: Story = { args: { boardUrl: null } };

export const ManyQuestions: Story = {
  args: {
    gate: {
      ...waiting,
      kind: 'respond-post',
      questions: Array.from({ length: 6 }, (_, i) => ({
        id: `thread-${i}`,
        label: `Thread ${i + 1}: how should the reply go?`,
        multi: false,
        options: ['reply', 'fix', 'skip'],
      })),
    },
  },
};
