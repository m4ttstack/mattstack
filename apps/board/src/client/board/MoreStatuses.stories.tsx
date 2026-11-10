import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import { NOW, stage, storyCtx, storyMr } from './row-stories.fixtures.tsx';
import { RowView } from './RowView.tsx';

const meta = {
  title: 'Board/More statuses',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A busy row, built from lane states a real run passes through: a held
    doctor draft wins the line, and three more sit behind "+3 more". */
const busy = storyMr({
  title: 'WEB-420 Cache the plan preview',
  behindTarget: null,
  threadSummary: { awaiting: 2, replied: 0, resolved: 1 },
  respond: { status: 'implementing' },
  doctor: { status: 'watching', origin: 'auto' },
  review: { status: 'done', updatedAt: NOW - 600_000 },
  drafts: [{ kind: 'reply' }],
} as unknown as Partial<BoardMRWithReview>);

/** Nothing running on the MR, so the lines that start an agent may: their
    action runs only from a click on the action itself. */
const quiet = storyMr({
  title: 'WEB-431 Retry flaky uploads with backoff',
  behindTarget: null,
  threadSummary: { awaiting: 2, replied: 0, resolved: 1 },
  review: { status: 'done', updatedAt: NOW - 600_000 },
  doctor: { status: 'error', message: 'the pane exited' },
  drafts: [{ kind: 'reply' }],
} as unknown as Partial<BoardMRWithReview>);

export const QuietLaunches: Story = {
  name: 'Nothing running: launches from the action',
  render: () => (
    <div style={{ minHeight: 360 }}>
      <RowView mrs={[quiet]} now={NOW} showAuthor={false} ctx={storyCtx} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /more/ })
    );
  },
};

export const Today: Story = {
  name: 'Busy: +3 more open',
  render: () => (
    <div style={{ minHeight: 360 }}>
      <RowView mrs={[busy]} now={NOW} showAuthor={false} ctx={storyCtx} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /more/ })
    );
  },
};
