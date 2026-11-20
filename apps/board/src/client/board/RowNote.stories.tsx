import type { Meta, StoryObj } from '@storybook/react-vite';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import { NOW, stage, storyCtx, storyMr } from './row-stories.fixtures.tsx';
import { RowView } from './RowView.tsx';

const meta = {
  title: 'Board/Row note',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600_000).toISOString();

const withNote = (note: string, noteAt?: string, title?: string) =>
  storyMr({
    title: title ?? 'WEB-418 Show refund reasons on the order panel',
    note,
    ...(noteAt ? { noteAt } : {}),
  } as Partial<BoardMRWithReview>);

const rest = withNote(
  'Current state: rolled out to dev, test, staging https://claude.ai/artifact/example-rollout-plan',
  daysAgo(2)
);
const long = withNote(
  'Current state: rolled out to dev, test, staging; waiting on QA sign-off from the design team before prod, then ping Dana about the copy https://claude.ai/artifact/example-rollout-plan https://gitlab.example.com/acme/webapp/-/issues/88',
  daysAgo(1),
  'WEB-421 Batch the refund webhooks'
);
const stale = withNote(
  'waiting on the design review https://claude.ai/artifact/example-design-review',
  daysAgo(15),
  'WEB-402 Retire the legacy cart total'
);
const older = withNote(
  'rebase after !1290 lands',
  undefined,
  'WEB-399 Move the order panel to the new grid'
);

export const States: Story = {
  name: 'At rest: short, long, stale, no time',
  render: () => (
    <RowView
      mrs={[rest, long, stale, older]}
      now={NOW}
      showAuthor={false}
      ctx={storyCtx}
    />
  ),
};

export const Editing: Story = {
  name: 'Editing',
  render: () => (
    <RowView
      mrs={[rest]}
      now={NOW}
      showAuthor={false}
      ctx={{ ...storyCtx, noteEditing: rest.webUrl ?? null }}
    />
  ),
};
