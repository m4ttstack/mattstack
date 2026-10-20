import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import { slackPosts } from './slack-posts.ts';
import { SlackPostsModal } from './SlackPostsModal.tsx';

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
  title: 'Board/SlackPostsModal',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const NOW = Date.UTC(2026, 9, 19, 18);
const HOUR = 3_600_000;
const tsPath = (at: number) => `p${at / 1000}000000`;

const mr = {
  iid: 1288,
  title: 'ACME-1288: collapse duplicate address rows in the party list',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1288',
  slackChannel: 'code-review',
  slack: {
    status: 'found',
    permalink: `https://acme.slack.com/archives/C1/${tsPath(NOW - 2 * HOUR)}`,
    reactions: ['eyes'],
    posted: true,
  },
  ownerPosts: [
    {
      channel: 'pod-acme',
      permalink: 'https://acme.slack.com/archives/C2/p1',
      postedAt: NOW - 2 * HOUR,
    },
    {
      channel: 'pod-billing',
      permalink: 'https://acme.slack.com/archives/C3/p2',
      postedAt: NOW - 40 * 60_000,
    },
  ],
  ownerTeams: [
    { team: 'acme', channel: 'pod-acme', approved: false },
    { team: 'billing', channel: 'pod-billing', approved: false },
  ],
} as unknown as BoardMRWithReview;

export const ThreePosts: Story = {
  render: () => (
    <SlackPostsModal
      mr={mr}
      posts={slackPosts(mr)}
      now={NOW}
      onOpen={() => {}}
      onClose={() => {}}
    />
  ),
};
