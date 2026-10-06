import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview, RowContext, SentNudgeInfo } from '../types.ts';
import { AskBand } from './AskBand.tsx';

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <div
    className={context.globals.scheme === 'dark' ? 'dark' : undefined}
    style={{
      background: 'var(--page)',
      color: 'var(--text-1)',
      minHeight: '100vh',
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/AskBand',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const NOW = Date.now();
const MIN = 60_000;
const reviewer = {
  reviewer: 'mira-fixture',
  reviewerName: 'Mira',
  kind: 'review',
} as const;
const states: Array<[string, SentNudgeInfo]> = [
  ['pending', { ...reviewer, display: 'pending', sentAt: NOW - 4 * MIN }],
  ['requested', { ...reviewer, display: 'requested', sentAt: NOW - 2 * MIN }],
  [
    'reviewing',
    {
      ...reviewer,
      display: 'launched',
      sentAt: NOW - 5 * MIN,
      resolvedAt: NOW - 5 * MIN,
    },
  ],
  [
    'no update',
    {
      ...reviewer,
      display: 'no-update',
      sentAt: NOW - 45 * MIN,
      resolvedAt: NOW - 45 * MIN,
    },
  ],
  [
    'stopped',
    {
      ...reviewer,
      display: 'failed',
      reason: 'pane closed',
      sentAt: NOW - 20 * MIN,
      resolvedAt: NOW - 3 * MIN,
      finishedAt: NOW - 3 * MIN,
    },
  ],
  [
    'declined',
    {
      ...reviewer,
      display: 'rejected',
      declined: true,
      reason: 'busy right now',
      declineNote: 'after standup',
      sentAt: NOW - 20 * MIN,
      resolvedAt: NOW - 3 * MIN,
    },
  ],
  [
    'asks off',
    {
      ...reviewer,
      display: 'rejected',
      reason: 'asks-off',
      sentAt: NOW - 20 * MIN,
    },
  ],
  [
    'done',
    {
      ...reviewer,
      display: 'done',
      outcome: 'comment',
      sentAt: NOW - 30 * MIN,
      resolvedAt: NOW - 2 * MIN,
      finishedAt: NOW - 2 * MIN,
    },
  ],
];
const ctx = {
  local: true,
  onAskRetry: () => {},
  onAskDismiss: () => {},
} as unknown as RowContext;

export const AllStates: Story = {
  play: async ({ canvasElement }) => {
    await canvasElement.ownerDocument.fonts.ready;
    const bands = canvasElement.querySelectorAll<HTMLElement>('.tui-ask');
    expect(bands).toHaveLength(8);
    for (const band of bands) {
      const label = band.querySelector<HTMLElement>('.tui-ask-label')!;
      expect(label.scrollWidth, label.textContent ?? '').toBeLessThanOrEqual(
        label.clientWidth
      );
      const bounds = band.getBoundingClientRect();
      for (const action of band.querySelectorAll<HTMLElement>(
        '[data-action]'
      )) {
        const box = action.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(bounds.left);
        expect(box.right).toBeLessThanOrEqual(bounds.right);
      }
    }
  },
  render: () => (
    <div style={{ display: 'grid', gap: 12, padding: 24, maxWidth: 680 }}>
      {states.map(([label, sentNudge]) => (
        <AskBand
          key={label}
          mr={
            {
              webUrl: `https://example.invalid/${encodeURIComponent(label)}`,
              sentNudge,
            } as unknown as BoardMRWithReview
          }
          ctx={ctx}
        />
      ))}
    </div>
  ),
};
