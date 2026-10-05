import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { ContextMenu } from '@mattstack/tui-kit';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { DEFAULT_VIEW, type ShowItem, type ViewState } from '../../view.ts';
import type { ThemeMode } from '../types.ts';
import { AlsoShow } from './AlsoShow.tsx';
import { Controls, ShowMenuItems, type ShowMenuModel } from './Controls.tsx';
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
const SYNCED = { text: 'data as of 9:41', stale: false };

function model(
  off: ShowItem[],
  setOff: (off: ShowItem[]) => void
): ShowMenuModel {
  return {
    offered: OFFERED,
    off,
    counts: COUNTS,
    channel: 'example-reviews',
    shown: 15 - off.reduce((n, i) => n + COUNTS[i], 0),
    total: 15,
    toggle: item =>
      setOff(off.includes(item) ? off.filter(i => i !== item) : [...off, item]),
    showAll: () => setOff([]),
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
      <AlsoShow show={show} />
    </header>
  );
}

export const EverythingShown: Story = {
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.tui-also-show')).toBeNull();
    expect(canvasElement.textContent).toContain('15 of 15');
  },
  render: () => <Header initialOff={[]} />,
};

export const AlsoShowLine: Story = {
  play: async ({ canvasElement }) => {
    const pills = canvasElement.querySelectorAll('.tui-also-show-pill');
    expect(pills).toHaveLength(2);
  },
  render: () => <Header initialOff={['notPosted', 'authorTurn']} />,
};

function OpenMenu() {
  const [off, setOff] = useState<ShowItem[]>(['authorTurn']);
  return (
    <ContextMenu x={24} y={24} ariaLabel="show on the board" onClose={() => {}}>
      <ShowMenuItems show={model(off, setOff)} onOpenTurnSettings={() => {}} />
    </ContextMenu>
  );
}

export const ShowMenuOpen: Story = {
  play: async () => {
    const items = document.querySelectorAll('[role="menuitemcheckbox"]');
    expect(items).toHaveLength(4);
  },
  render: () => <OpenMenu />,
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
      synced={{ text: 'data as of 8:05', stale: true }}
      onNeedsMe={null}
    />
  ),
};
