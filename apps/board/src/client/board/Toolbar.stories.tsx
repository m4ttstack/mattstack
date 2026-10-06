import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { DEFAULT_VIEW, type ShowItem, type ViewState } from '../../view.ts';
import type { ThemeMode } from '../types.ts';
import { Controls, type ShowMenuModel } from './Controls.tsx';
import { ShowChips } from './ShowChips.tsx';
import { TurnSummary } from './TurnSummary.tsx';

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
      padding: 24,
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/Toolbar',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const OFFERED: ShowItem[] = ['posted', 'notPosted', 'authorTurn', 'myDrafts'];
const COUNTS: Record<ShowItem, number> = {
  posted: 9,
  notPosted: 6,
  authorTurn: 7,
  myDrafts: 1,
};
const SYNCED = { text: 'data as of 9:41', clock: '9:41', stale: false };

function model(
  off: ShowItem[],
  setOff: (off: ShowItem[]) => void
): ShowMenuModel {
  return {
    offered: OFFERED,
    off,
    counts: COUNTS,
    channel: 'example-reviews',
    toggle: item =>
      setOff(off.includes(item) ? off.filter(i => i !== item) : [...off, item]),
  };
}

function Header({ initialOff }: { initialOff: ShowItem[] }) {
  const [state, setState] = useState<ViewState>(DEFAULT_VIEW);
  const [off, setOff] = useState(initialOff);
  const [theme, setTheme] = useState<ThemeMode>('system');
  const show = model(off, setOff);
  return (
    <header className="tui-header" style={{ maxWidth: 760 }}>
      <div className="tui-header-title">
        <h1>
          <span>example board</span>
        </h1>
        <TurnSummary
          counts={{
            needYou: 2,
            needReviewer: 4,
            waitingOnAuthor: 7,
            readyToMerge: 2,
          }}
          synced={SYNCED}
          onNeedsMe={() => {}}
        />
      </div>
      <div className="tui-controls tui-controls-header">
        <Controls
          state={state}
          update={patch => setState(s => ({ ...s, ...patch }))}
          theme={theme}
          pickTheme={setTheme}
          onRefresh={() => {}}
          refreshing={false}
          show={show}
          onOpenTurnSettings={() => {}}
        />
      </div>
      <ShowChips show={show} onOpenTurnSettings={() => {}} />
    </header>
  );
}

export const EverythingShown: Story = {
  play: async ({ canvasElement }) => {
    const chips = canvasElement.querySelectorAll('.tui-show-chip');
    expect(chips).toHaveLength(4);
    expect(
      canvasElement.querySelectorAll('.tui-show-chip[data-on]')
    ).toHaveLength(4);
  },
  render: () => <Header initialOff={[]} />,
};

export const SomeHidden: Story = {
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelectorAll('.tui-show-chip[data-on]')
    ).toHaveLength(2);
  },
  render: () => <Header initialOff={['notPosted', 'authorTurn']} />,
};

export const SummaryWithStaleSync: Story = {
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).not.toContain('ready to merge');
    expect(
      canvasElement.querySelector('.tui-turn-synced[data-stale]')
    ).not.toBeNull();
  },
  render: () => (
    <TurnSummary
      counts={{
        needYou: 1,
        needReviewer: 3,
        waitingOnAuthor: 5,
        readyToMerge: 0,
      }}
      synced={{ text: 'data as of 8:05', clock: '8:05', stale: true }}
      onNeedsMe={null}
    />
  ),
};
