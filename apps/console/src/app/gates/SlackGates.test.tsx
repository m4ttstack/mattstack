import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date(2026, 10, 6, 18, 47).getTime();
const MIN = 60_000;

const listGet = vi.fn();
const answerPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      gates: {
        slack: { $get: (...args: unknown[]) => listGet(...args) },
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
        },
      },
    },
  },
}));

const { SlackGates } = await import('./SlackGates');

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { networkMode: 'always' },
    },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <SlackGates />
    </QueryClientProvider>
  );
}

function gate(id: string, overrides: Partial<GateRow> = {}): GateRow {
  return {
    id,
    subject: 'slack:U1',
    kind: 'slack-open',
    questions: [],
    meta: { action: 'open', personName: 'Priya Raman', brief: 'Need eyes.' },
    status: 'open',
    answer: null,
    openedAt: NOW - 4 * MIN,
    pane: 'refund-fix',
    owner: null,
    ...overrides,
  } as GateRow;
}

function respond(gates: GateRow[], trigger = '@Maude') {
  listGet.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ gates, trigger }),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  answerPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('SlackGates', () => {
  it('lists a request with the person, brief, origin and age', async () => {
    respond([gate('g1')]);
    renderPage();

    expect(await screen.findByText('Priya Raman')).toBeInTheDocument();
    expect(screen.getByText('New chat')).toBeInTheDocument();
    expect(screen.getByText('Need eyes.')).toBeInTheDocument();
    expect(screen.getByText('From pane refund-fix')).toBeInTheDocument();
    expect(screen.getByText('4m old')).toBeInTheDocument();
    expect(screen.getByText('26m left')).toBeInTheDocument();
    expect(screen.getByText('Waiting 1')).toBeInTheDocument();
  });

  it('names the trigger when a teammate asked', async () => {
    respond(
      [
        gate('g2', {
          pane: null,
          meta: {
            action: 'resume',
            personName: 'Dana Whitfield',
            triggerTs: '1.2',
          },
          context: 'Person: Dana\n\nMessage:\nBack on this.',
        }),
      ],
      'hey bot'
    );
    renderPage();

    expect(await screen.findByText('Resume')).toBeInTheDocument();
    expect(screen.getByText('Teammate asked with hey bot')).toBeInTheDocument();
    expect(screen.getByText('Back on this.')).toBeInTheDocument();
  });

  it('shows the empty state with nothing waiting', async () => {
    respond([]);
    renderPage();

    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
    expect(screen.getByText('Requests appear here')).toBeInTheDocument();
    expect(screen.queryByText(/^waiting/i)).toBeNull();
  });

  it('leaves out a request past its 30 minutes', async () => {
    respond([gate('old', { openedAt: NOW - 31 * MIN })]);
    renderPage();

    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
    expect(screen.queryByText('Priya Raman')).toBeNull();
  });

  it('approve posts answers to /api/gates/:id/answer', async () => {
    respond([gate('g1')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await vi.waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { decision: 'approve' } },
      })
    );
  });

  it('decline posts the decline answer', async () => {
    respond([gate('g1')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await vi.waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { decision: 'decline' } },
      })
    );
  });

  it('says so when an answer fails', async () => {
    respond([gate('g1')]);
    answerPost.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'closed' }),
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('closed')).toBeInTheDocument();
  });
});
