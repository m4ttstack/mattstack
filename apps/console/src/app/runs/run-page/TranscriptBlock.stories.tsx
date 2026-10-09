import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TranscriptBlock } from './TranscriptBlock';

const LONG = Array.from(
  { length: 60 },
  (_, i) => `GET /api/tracking?order=${i + 1}  200  ${80 + i}ms`
).join('\n');

const queryClient = new QueryClient();

/** A story answers the transcript route itself, so it needs no server. */
function transcriptReply(body: string | null, type: string) {
  return (Story: () => React.ReactNode) => {
    window.fetch = (async () =>
      body === null
        ? new Response('{"error":"no evidence"}', { status: 404 })
        : new Response(body, {
            headers: { 'content-type': type },
          })) as unknown as typeof fetch;
    return <Story />;
  };
}

const meta = {
  title: 'Runs/Run page/TranscriptBlock',
  component: TranscriptBlock,
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 520 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
  args: { repo: 'remote:acme%2Fweb' },
} satisfies Meta<typeof TranscriptBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Markdown: Story = {
  args: { runId: 'markdown' },
  decorators: [
    transcriptReply(
      '**console transcript** after\n\n```\nGET /api/tracking?order=1  200  84ms\n0 warnings, 0 errors\n```\n',
      'text/markdown; charset=utf-8'
    ),
  ],
};

export const PlainShort: Story = {
  args: { runId: 'plain-short' },
  decorators: [
    transcriptReply(
      'GET /api/tracking?order=1  200  84ms\n0 warnings, 0 errors\n',
      'text/plain; charset=utf-8'
    ),
  ],
};

export const PlainLong: Story = {
  args: { runId: 'plain-long' },
  decorators: [transcriptReply(LONG, 'text/plain; charset=utf-8')],
};

export const NoTranscript: Story = {
  args: { runId: 'none' },
  decorators: [transcriptReply(null, 'application/json')],
};
