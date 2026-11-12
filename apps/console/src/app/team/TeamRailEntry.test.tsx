import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamRead } from '../../shared/team';
import { failed, invite, serveTeams, team, teamGet } from './teamTestData';

vi.mock('../api', async () => (await import('./teamTestData')).apiMock());

const { TeamRailEntry } = await import('./TeamRailEntry');

function renderEntry(teams: TeamRead[]) {
  serveTeams(teams);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <TeamRailEntry active={false} />
    </QueryClientProvider>
  );
}

afterEach(() => vi.clearAllMocks());

describe('TeamRailEntry', () => {
  it('is hidden when no team is one I administer', async () => {
    renderEntry([team('a', { role: 'member' })]);
    await waitFor(() => expect(teamGet).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: /team/i })).toBeNull();
  });

  it('is hidden when the only other team failed to read', async () => {
    renderEntry([team('a', { role: 'member' }), failed('b', 'offline')]);
    await waitFor(() => expect(teamGet).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: /team/i })).toBeNull();
  });

  it('shows the entry with no badge when nobody is waiting', async () => {
    renderEntry([team('a', { invites: [invite('carol', 'invited')] })]);
    expect(
      await screen.findByRole('link', { name: /team/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('team-badge')).toBeNull();
  });

  it('counts who is waiting for approval', async () => {
    renderEntry([team('a', { invites: [invite('alice', 'replied')] })]);
    expect(await screen.findByTestId('team-badge')).toHaveTextContent('1');
  });
});
