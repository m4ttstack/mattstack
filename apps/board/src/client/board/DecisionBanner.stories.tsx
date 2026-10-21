import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { DecisionBanner } from './DecisionBanner.tsx';

/** The board's decision queue banner, in every copy state it renders. */
function BoardStage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{
        background: 'var(--page)',
        color: 'var(--text-1)',
        padding: '1.5rem',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const meta = {
  title: 'Board/DecisionBanner',
  component: DecisionBanner,
  decorators: [
    (Story, context) => (
      <BoardStage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
        <div style={{ maxWidth: 818 }}>
          <Story />
        </div>
      </BoardStage>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  args: { onStart: () => {} },
} satisfies Meta<typeof DecisionBanner>;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

export const Several: Story = {
  args: {
    copy: {
      title: '6 decisions are waiting on you',
      detail: 'Next: !1374 · attribute panel summaries · waiting 2h',
    },
  },
};

export const One: Story = {
  args: {
    copy: {
      title: '1 decision is waiting on you',
      detail: '!1374 · attribute panel summaries · waiting 2h',
    },
  },
};

export const AgentAsking: Story = {
  args: {
    copy: {
      title: '3 decisions are waiting on you',
      detail: 'Next: api-lane wants to run migrations on staging · waiting 1m',
    },
  },
};
