import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import {
  NOW,
  stage,
  storyCtx,
  storyMr,
} from './row-stories.fixtures.tsx';
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

export const Today: Story = {
  name: 'Today: +3 more open',
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
