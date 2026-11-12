import '../icons';

import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamRead } from '../../shared/team';
import {
  adminSecretsPost,
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

  it('shows the empty state when the only team failed to read', async () => {
    renderPage([failed('beta', 'offline')]);
    expect(await screen.findByText('No teams to manage')).toBeInTheDocument();
    expect(screen.queryByText('offline')).toBeNull();
  });

  it('keeps Approve disabled until the refetch after a confirm lands', async () => {
    confirmPost.mockResolvedValue(
      ok({ added: ['marsh'], pending: [], warnings: [] })
    );
    renderPage([acme()]);
    const approve = await screen.findByRole('button', { name: 'Approve' });
    let land: (value: unknown) => void = () => {};
    teamGet.mockReturnValue(new Promise(r => (land = r)));
    await userEvent.click(approve);

    expect(await screen.findByText('Added marsh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();

    const joined = acme();
    joined.team.members.push(member('marsh'));
    joined.team.invites = joined.team.invites.filter(i => i.handle !== 'marsh');
    await act(async () => land(ok({ teams: [joined] })));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    );
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

  describe('admin secrets', () => {
    const drifted = () =>
      team('acme', {
        adminSecrets: { state: 'needs-sync', detail: 'The admins changed' },
      });

    it('offers Update access in the panel when the admins changed', async () => {
      renderPage([drifted()]);
      const notice = await screen.findByTestId('admin-secrets-notice');
      expect(notice).toHaveTextContent('Admins changed');
      expect(notice).toHaveTextContent(
        'Admin-only secrets still open for the old set'
      );
      expect(
        within(notice).getByRole('button', { name: 'Update access' })
      ).toBeInTheDocument();
    });

    it('posts once and refetches the team after an update', async () => {
      let finish: (value: unknown) => void = () => {};
      adminSecretsPost.mockReturnValue(new Promise(r => (finish = r)));
      renderPage([drifted()]);
      const button = await screen.findByRole('button', {
        name: 'Update access',
      });
      await userEvent.dblClick(button);
      expect(adminSecretsPost).toHaveBeenCalledTimes(1);
      expect(adminSecretsPost).toHaveBeenCalledWith({
        json: { slug: 'acme' },
      });

      const reads = teamGet.mock.calls.length;
      serveTeams([
        team('acme', { adminSecrets: { state: 'current', detail: null } }),
      ]);
      await act(async () =>
        finish(
          ok({
            state: 'updated',
            holders: ['matt'],
            withoutKey: [],
            token: 'kept',
          })
        )
      );
      expect(
        await screen.findByText('Admin access updated')
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(teamGet.mock.calls.length).toBeGreaterThan(reads)
      );
      await waitFor(() =>
        expect(screen.queryByTestId('admin-secrets-notice')).toBeNull()
      );
    });

    it('shows the server message when the update fails', async () => {
      adminSecretsPost.mockResolvedValue(
        ok({ error: 'No admin has a key' }, 502)
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(await screen.findByText('No admin has a key')).toBeInTheDocument();
    });

    it('shows the detail and the command, with no button, when it needs you', async () => {
      renderPage([
        team('acme', {
          adminSecrets: {
            state: 'needs-you',
            detail:
              "The org shares a different switchboard admin token from this Mac's",
          },
        }),
      ]);
      const notice = await screen.findByTestId('admin-secrets-notice');
      expect(notice).toHaveTextContent(
        "The org shares a different switchboard admin token from this Mac's"
      );
      expect(notice).toHaveTextContent('rt team admin-secrets --replace-token');
      expect(within(notice).queryByRole('button')).toBeNull();
    });

    it('marks a team whose access needs updating or needs you in the switch', async () => {
      renderPage([
        team('acme'),
        team('north', {
          adminSecrets: { state: 'needs-sync', detail: null },
        }),
        team('south', {
          adminSecrets: { state: 'needs-you', detail: 'x' },
        }),
      ]);
      expect(
        await screen.findAllByLabelText('Admin access needs updating')
      ).toHaveLength(2);
    });

    it('opens the team the link names', async () => {
      window.history.pushState(null, '', '/team?team=north');
      try {
        renderPage([
          team('acme'),
          team('north', {
            adminSecrets: { state: 'needs-sync', detail: null },
          }),
        ]);
        expect(
          await screen.findByTestId('admin-secrets-notice')
        ).toBeInTheDocument();
        expect(screen.getByText('north members')).toBeInTheDocument();
      } finally {
        window.history.pushState(null, '', '/');
      }
    });

    it('says nothing changed when the access was already current', async () => {
      adminSecretsPost.mockResolvedValue(
        ok({
          state: 'current',
          holders: ['matt'],
          withoutKey: [],
          token: 'kept',
        })
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(
        await screen.findByText('Admin access was already current')
      ).toBeInTheDocument();
      expect(screen.queryByText('Admin access updated')).toBeNull();
    });

    it('counts sharing this Mac’s token as an update', async () => {
      adminSecretsPost.mockResolvedValue(
        ok({
          state: 'current',
          holders: ['matt'],
          withoutKey: [],
          token: 'seeded',
        })
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(
        await screen.findByText('Admin access updated')
      ).toBeInTheDocument();
    });

    it('says when the org keeps no admin-only secrets', async () => {
      adminSecretsPost.mockResolvedValue(
        ok({ state: 'unused', holders: [], withoutKey: [], token: 'none' })
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(
        await screen.findByText('No admin-only secrets to update')
      ).toBeInTheDocument();
    });

    it('shows nothing when access is current', async () => {
      renderPage([
        team('acme', { adminSecrets: { state: 'current', detail: null } }),
      ]);
      await screen.findByTestId('team-panel');
      expect(screen.queryByTestId('admin-secrets-notice')).toBeNull();
    });
  });
});
