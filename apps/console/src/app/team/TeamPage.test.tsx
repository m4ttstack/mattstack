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

const newClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { networkMode: 'always' },
    },
  });

function renderPage(teams?: TeamRead[], queryClient = newClient()) {
  if (teams) serveTeams(teams);
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <TeamPage />
    </QueryClientProvider>
  );
}

/** As rt reads it: each invitee is on the roster too. */
const acme = () =>
  team('acme', {
    name: 'acme',
    members: [
      member('priya'),
      member('matt', { role: 'org-owner' }),
      member('dana', { peered: false }),
      member('marsh', { role: 'member', peered: false }),
      member('carol', { role: 'member', peered: false }),
      member('old', { role: 'member', peered: false }),
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

  it('shows each invitee once, and counts only those rows', async () => {
    renderPage([acme()]);
    expect(await screen.findAllByText('marsh')).toHaveLength(1);
    expect(screen.queryByText('carol')).toBeNull();
    expect(screen.queryByText('old')).toBeNull();
    expect(screen.getByRole('tab', { name: /Members/ })).toHaveTextContent(
      'Members4'
    );
  });

  it('names each role in words and puts owners and admins first', async () => {
    renderPage([
      team('acme', {
        members: [
          member('mo', { role: 'member' }),
          member('tess', { role: 'owner' }),
          member('ada', { role: 'admin' }),
          member('olga', { role: 'org-owner' }),
        ],
      }),
    ]);
    await screen.findByText('olga');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('olgaOrg owner'),
      expect.stringContaining('adaOrg admin'),
      expect.stringContaining('tessTeam owner'),
      expect.stringContaining('moMember'),
    ]);
  });

  it('names the team the members list belongs to', async () => {
    renderPage([team('acme', { activeTeam: 'web' })]);
    expect(await screen.findByText('web team')).toBeInTheDocument();
    expect(screen.getByText('in acme')).toBeInTheDocument();
  });

  it('says when the switchboard did not answer', async () => {
    renderPage([team('acme', { relayFailed: true })]);
    const note = await screen.findByTestId('relay-notice');
    expect(note).toHaveTextContent("Switchboard didn't answer");
    expect(note).toHaveTextContent('Replies may be waiting');
  });

  it('opens on the first team that read with no link', async () => {
    renderPage([failed('beta', 'offline'), team('acme')]);
    expect(await screen.findByText('acme members')).toBeInTheDocument();
    expect(screen.queryByText('offline')).toBeNull();
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
    await userEvent.click(await screen.findByText('beta'));
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

  it('reports a warning beside a sync that added someone', async () => {
    confirmPost.mockResolvedValue(
      ok({
        added: ['marsh'],
        pending: [],
        warnings: ['The board for marsh could not be connected'],
      })
    );
    renderPage([acme()]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' })
    );
    expect(await screen.findByText('Added marsh')).toBeInTheDocument();
    expect(
      screen.getByText('The board for marsh could not be connected')
    ).toBeInTheDocument();
  });

  it('keeps Approve off while an access update runs on the same org', async () => {
    let finish: (value: unknown) => void = () => {};
    adminSecretsPost.mockReturnValue(new Promise(r => (finish = r)));
    renderPage([
      team('acme', {
        invites: [invite('alice', 'replied')],
        adminSecrets: { state: 'needs-sync', detail: null },
      }),
    ]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update access' })
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    await userEvent.click(approve);
    expect(confirmPost).not.toHaveBeenCalled();
    await act(async () =>
      finish(
        ok({
          state: 'updated',
          holders: [],
          withoutKey: [],
          removed: 0,
          token: 'kept',
        })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    );
  });

  it('keeps Update access off while an approve runs on the same org', async () => {
    let finish: (value: unknown) => void = () => {};
    confirmPost.mockReturnValue(new Promise(r => (finish = r)));
    renderPage([
      team('acme', {
        invites: [invite('alice', 'replied')],
        adminSecrets: { state: 'needs-sync', detail: null },
      }),
    ]);
    const update = await screen.findByRole('button', {
      name: 'Update access',
    });
    expect(update).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(update).toBeDisabled());
    await act(async () =>
      finish(ok({ added: ['alice'], pending: [], warnings: [] }))
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Update access' })
      ).toBeEnabled()
    );
    expect(adminSecretsPost).not.toHaveBeenCalled();
  });

  it('keeps Approve off after leaving and coming back mid-sync', async () => {
    let finish: (value: unknown) => void = () => {};
    confirmPost.mockReturnValue(new Promise(r => (finish = r)));
    const queryClient = newClient();
    const teams = [team('acme', { invites: [invite('alice', 'replied')] })];
    const first = renderPage(teams, queryClient);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' })
    );
    first.unmount();
    renderPage(teams, queryClient);
    expect(
      await screen.findByRole('button', { name: 'Approve' })
    ).toBeDisabled();
    await act(async () =>
      finish(ok({ added: ['alice'], pending: [], warnings: [] }))
    );
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
      expect(notice).toHaveTextContent('Admin access out of date');
      expect(notice).toHaveTextContent('The admins changed');
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
            removed: 0,
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

    it('falls back to its own words when rt gives no detail', async () => {
      renderPage([
        team('acme', { adminSecrets: { state: 'needs-sync', detail: null } }),
      ]);
      expect(
        await screen.findByTestId('admin-secrets-notice')
      ).toHaveTextContent('Admin-only secrets still open for the old set');
    });

    it("carries rt's notes on who cannot open them and who was taken off", async () => {
      adminSecretsPost.mockResolvedValue(
        ok({
          state: 'updated',
          holders: ['matt'],
          withoutKey: ['priya', 'lee'],
          removed: 1,
          token: 'kept',
        })
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(
        await screen.findByText('Admin access updated')
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'priya, lee cannot open them yet: no age key on the roster'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText('Anyone taken off keeps what they already opened')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Change the switchboard admin token')
      ).toBeInTheDocument();
    });

    it("says when the org's token differs, never that it was current", async () => {
      adminSecretsPost.mockResolvedValue(
        ok({
          state: 'current',
          holders: ['matt'],
          withoutKey: [],
          removed: 0,
          token: 'differs',
        })
      );
      renderPage([drifted()]);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update access' })
      );
      expect(
        await screen.findByText("The org's admin token differs from this Mac's")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Keep theirs unless yours is newer: rt team admin-secrets --team acme --replace-token'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText('Admin access was already current')).toBeNull();
    });

    it('says nothing changed when the access was already current', async () => {
      adminSecretsPost.mockResolvedValue(
        ok({
          state: 'current',
          holders: ['matt'],
          withoutKey: [],
          removed: 0,
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
          removed: 0,
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
        ok({
          state: 'unused',
          holders: [],
          withoutKey: [],
          removed: 0,
          token: 'none',
        })
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
