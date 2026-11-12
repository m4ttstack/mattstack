import '../icons';

import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamRead } from '../../shared/team';
import {
  confirmPost,
  failed,
  invite,
  member,
  ok,
  serveTeams,
  team,
  teamGet,
} from './teamTestData';

vi.mock('../api', async () => (await import('./teamTestData')).apiMock());

const { TeamPage } = await import('./TeamPage');

function renderPage(teams?: TeamRead[]) {
  if (teams) serveTeams(teams);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { networkMode: 'always' },
    },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <TeamPage />
    </QueryClientProvider>
  );
}

const acme = () =>
  team('acme', {
    name: 'acme',
    members: [
      member('matt', { role: 'owner' }),
      member('priya'),
      member('dana', { peered: false }),
    ],
    invites: [
      invite('marsh', 'replied'),
      invite('carol', 'invited'),
      invite('old', 'expired'),
    ],
  });

afterEach(() => {
  act(() => notifications.clean());
  vi.clearAllMocks();
});

describe('TeamPage', () => {
  it('shows a replied invite as a members row waiting for approval', async () => {
    renderPage([acme()]);
    const row = (await screen.findByText('marsh')).closest('tr')!;
    expect(row).toHaveTextContent('Waiting for approval');
    expect(row.querySelector('button')).toHaveTextContent('Approve');
    expect(screen.getByText('Joins after you add')).toBeInTheDocument();
    expect(screen.getByText('priya')).toBeInTheDocument();
    expect(screen.queryByText('carol')).toBeNull();
  });

  it('shows a member with no role as Member', async () => {
    renderPage([acme()]);
    const row = (await screen.findByText('priya')).closest('tr')!;
    expect(row).toHaveTextContent('Member');
  });

  it('lists invited and expired invites under Invites', async () => {
    renderPage([acme()]);
    await userEvent.click(await screen.findByRole('tab', { name: /Invites/ }));
    expect(await screen.findByText('carol')).toBeInTheDocument();
    const expired = screen.getByText('old').closest('tr')!;
    expect(expired).toHaveTextContent('Expired');
  });

  it('shows no team switch with one team', async () => {
    renderPage([acme()]);
    await screen.findByText('marsh');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it("shows a failed team's error in the panel and keeps the other segment", async () => {
    renderPage([acme(), failed('beta', 'rt team status failed: offline')]);
    await screen.findByText('marsh');
    await userEvent.click(screen.getByText('beta'));
    expect(
      await screen.findByText('rt team status failed: offline')
    ).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps the whole-page banner away when only one team fails', async () => {
    renderPage([acme(), failed('beta', 'offline')]);
    await screen.findByText('marsh');
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText(/Can't read your teams/)).toBeNull();
  });

  it('shows the whole-page banner when the team read itself fails', async () => {
    teamGet.mockResolvedValue(ok({ error: 'rt is not installed' }, 503));
    renderPage();
    expect(
      await screen.findByText(/Can't read your teams/)
    ).toBeInTheDocument();
  });

  it('shows a short empty state with no team to manage', async () => {
    renderPage([team('acme', { role: 'member' })]);
    expect(await screen.findByText('No teams to manage')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('posts once on a double click and disables every approve in the team', async () => {
    let finish: (value: unknown) => void = () => {};
    confirmPost.mockReturnValue(new Promise(r => (finish = r)));
    renderPage([
      team('acme', {
        invites: [invite('alice', 'replied'), invite('bob', 'replied')],
      }),
    ]);
    const [first] = await screen.findAllByRole('button', { name: 'Approve 2' });
    await userEvent.dblClick(first!);

    expect(confirmPost).toHaveBeenCalledTimes(1);
    expect(confirmPost).toHaveBeenCalledWith({ json: { slug: 'acme' } });
    for (const button of screen.getAllByRole('button', {
      name: /Approve 2/,
    })) {
      expect(button).toBeDisabled();
    }
    await act(async () =>
      finish(ok({ added: ['alice', 'bob'], pending: [], warnings: [] }))
    );
  });

  it('keeps the row and shows the server message when confirm fails', async () => {
    confirmPost.mockResolvedValue(ok({ error: 'sync failed: offline' }, 502));
    renderPage([acme()]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' })
    );

    expect(await screen.findByText('sync failed: offline')).toBeInTheDocument();
    expect(screen.getByText('marsh')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    );
  });

  it('reports the first warning when the sync adds nobody', async () => {
    confirmPost.mockResolvedValue(
      ok({ added: [], pending: ['marsh'], warnings: ['marsh has not replied'] })
    );
    renderPage([acme()]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' })
    );

    expect(
      await screen.findByText('marsh has not replied')
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  });

  it('falls back to its own copy when an empty sync gives no warning', async () => {
    confirmPost.mockResolvedValue(ok({ added: [], pending: [], warnings: [] }));
    renderPage([acme()]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' })
    );

    expect(await screen.findByText('Nobody was added')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  });
});
