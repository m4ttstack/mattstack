import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../../style.css';

import type { BoardData } from '../../types.ts';
import { AsksButton } from './AsksButton.tsx';
import {
  NOTHING_WAITING,
  RAE_ASK,
  ROSTER_NAMES,
  THREE_WAITING,
} from './asks.fixtures.ts';

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
  title: 'Board/Asks',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const resolved = async () => {};

/** The header's top-right corner, with the inbox open under its button. */
function Header({
  asks,
  flashId = null,
  confirmMs,
}: {
  asks: NonNullable<BoardData['asks']>;
  flashId?: string | null;
  confirmMs?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
      <div
        className="tui-header"
        style={{
          position: 'relative',
          width: 720,
          height: 96,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <div className="tui-header-corner">
          <AsksButton
            asks={asks}
            open={open}
            onOpenChange={setOpen}
            flashId={flashId}
            names={ROSTER_NAMES}
            onAccept={resolved}
            onDecline={resolved}
            onAllow={resolved}
            onFocus={() => {}}
            {...(confirmMs ? { confirmMs } : {})}
          />
        </div>
      </div>
    </div>
  );
}

const popup = (canvasElement: HTMLElement) =>
  within(
    canvasElement.ownerDocument.querySelector<HTMLElement>(
      '[data-part="popover-popup"]'
    )!
  );

export const ThreeWaiting: Story = {
  render: () => <Header asks={THREE_WAITING} />,
  play: async ({ canvasElement }) => {
    const ui = popup(canvasElement);
    await expect(ui.getByText('3 waiting')).toBeVisible();
    await expect(
      canvasElement.ownerDocument.querySelectorAll('.tui-ask-card')
    ).toHaveLength(3);
  },
};

export const DeclineOpen: Story = {
  render: () => <Header asks={THREE_WAITING} />,
  play: async ({ canvasElement }) => {
    const ui = popup(canvasElement);
    const [decline] = ui.getAllByRole('button', { name: 'Decline' });
    await userEvent.click(decline!);
    await userEvent.click(ui.getByRole('button', { name: 'busy right now' }));
    await expect(
      ui.getByText("Decline Rae's ask. Tell Rae why? (optional)")
    ).toBeVisible();
  },
};

export const BriefConfirm: Story = {
  render: () => <Header asks={THREE_WAITING} confirmMs={600_000} />,
  play: async ({ canvasElement }) => {
    const ui = popup(canvasElement);
    await userEvent.click(ui.getByRole('button', { name: 'Review' }));
    await expect(
      await ui.findByText('Your agent is reviewing !1388')
    ).toBeVisible();
    await expect(ui.getByText('2 waiting')).toBeVisible();
  },
};

export const NothingWaiting: Story = {
  render: () => <Header asks={NOTHING_WAITING} />,
  play: async ({ canvasElement }) => {
    const ui = popup(canvasElement);
    await expect(ui.getByText('nothing waiting')).toBeVisible();
    await expect(
      ui.getByText('No one has asked for your agent.')
    ).toBeVisible();
  },
};

export const History: Story = {
  render: () => <Header asks={THREE_WAITING} />,
  play: async ({ canvasElement }) => {
    const ui = popup(canvasElement);
    await userEvent.click(ui.getByRole('button', { name: 'history' }));
    await expect(ui.getByText('last two weeks')).toBeVisible();
    await expect(ui.getByText('Dani Oliveira')).toBeVisible();
    await expect(ui.getByText('expired, no answer in 48h')).toBeVisible();
  },
};

/** Paused at the pulse's peak so the still shows what the motion reaches. */
export const MidFlash: Story = {
  render: () => (
    <>
      <style>
        {
          '.tui-ask-flash { animation-delay: -0.6s; animation-play-state: paused; }'
        }
      </style>
      <Header asks={THREE_WAITING} flashId={RAE_ASK.id} />
    </>
  ),
};
