import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { CloudSpinner } from './icons.tsx';

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
      padding: 32,
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/CloudSpinner',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

/** A peer's review in flight, at row size and enlarged. */
export const Reviewing: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.8125rem',
          color: 'var(--text-2)',
        }}
      >
        <CloudSpinner />
        nia is reviewing
      </div>
      <div style={{ transform: 'scale(6)', transformOrigin: 'top left' }}>
        <CloudSpinner />
      </div>
    </div>
  ),
};
