import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import type { TeamRead } from '../../shared/team';
import { invite, serveTeams, team, teamGet } from './teamTestData';

vi.mock('../api', async () => (await import('./teamTestData')).apiMock());

const { WaitingToast } = await import('./WaitingToast');

function Where() {
  const [path] = useLocation();
  return <span data-testid="where">{path}</span>;
}

function renderToast(teams: TeamRead[]) {
  serveTeams(teams);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { hook } = memoryLocation({ path: '/' });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <WaitingToast />
        <Where />
      </Router>
    </QueryClientProvider>
  );
}

const toast = () => screen.findByTestId('waiting-toast');

async function settled() {
  await waitFor(() => expect(teamGet).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 50));
}

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('WaitingToast', () => {
  it('renders nothing when nobody is waiting', async () => {
    renderToast([team('acme', { invites: [invite('carol', 'invited')] })]);
    await settled();
    expect(screen.queryByTestId('waiting-toast')).toBeNull();
  });

  it('names the one person waiting and their team', async () => {
    renderToast([
      team('acme', { name: 'Acme', invites: [invite('alice', 'replied')] }),
    ]);
    const root = await toast();
    expect(root).toHaveTextContent('alice is waiting for approval');
    expect(root).toHaveTextContent('Acme');
  });

  it('counts several people waiting', async () => {
    renderToast([
      team('acme', {
        invites: [invite('alice', 'replied'), invite('bob', 'replied')],
      }),
    ]);
    expect(await toast()).toHaveTextContent(
      '2 people are waiting for approval'
    );
  });

  it('opens the Team page from Review', async () => {
    renderToast([team('acme', { invites: [invite('alice', 'replied')] })]);
    const root = await toast();
    await userEvent.click(within(root).getByText('Review'));
    expect(screen.getByTestId('where')).toHaveTextContent('/team');
  });

  it('has no approve button', async () => {
    renderToast([team('acme', { invites: [invite('alice', 'replied')] })]);
    const root = await toast();
    expect(within(root).queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('does not show again for the same people after dismissal', async () => {
    const teams = [team('acme', { invites: [invite('alice', 'replied')] })];
    const first = renderToast(teams);
    const root = await toast();
    await userEvent.click(
      within(root).getByRole('button', { name: 'Dismiss' })
    );
    await waitFor(() =>
      expect(screen.queryByTestId('waiting-toast')).toBeNull()
    );
    first.unmount();

    renderToast(teams);
    await settled();
    expect(screen.queryByTestId('waiting-toast')).toBeNull();
  });

  it('shows again when someone new is waiting', async () => {
    const first = renderToast([
      team('acme', { invites: [invite('alice', 'replied')] }),
    ]);
    await toast();
    first.unmount();

    renderToast([
      team('acme', {
        invites: [invite('alice', 'replied'), invite('bob', 'replied')],
      }),
    ]);
    expect(await toast()).toBeInTheDocument();
  });
});
