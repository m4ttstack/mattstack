import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoxscoreRolesBody } from './BoxscoreRoles';

const def = (value: unknown): SettingDefWire => ({
  key: 'boxscore.roles',
  type: 'object',
  scopes: ['team'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'Who sees the whole team in boxscore.',
  hasDefault: false,
  defaultValue: null,
  effective:
    value === undefined
      ? { scope: null, file: null, value: undefined }
      : { scope: 'team', file: '/t/settings.team.jsonc', value },
  storeVersion: 1,
});

const row = () => ({
  status: 'idle' as const,
  error: null,
  target: { scope: 'team' },
  save: vi.fn(async () => true),
  setAt: vi.fn(),
  clear: vi.fn(),
  move: vi.fn(),
});

function serve(access: 'owner' | 'member' | 'no-team') {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            members: [
              { username: 'ada', name: 'Ada L' },
              { username: 'bob', name: null },
            ],
            access,
          })
        )
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('BoxscoreRolesBody', () => {
  it('shows every roster member, unlisted as Self', async () => {
    serve('owner');
    renderWithProviders(
      <BoxscoreRolesBody def={def({ ada: 'team' })} row={row() as never} />
    );
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    const ada = screen.getByRole('radiogroup', { name: 'Role for ada' });
    expect(within(ada).getByRole('radio', { name: 'Team' })).toBeChecked();
    const bob = screen.getByRole('radiogroup', { name: 'Role for bob' });
    expect(within(bob).getByRole('radio', { name: 'Self' })).toBeChecked();
  });

  it('saves a grant for the owner', async () => {
    serve('owner');
    const r = row();
    renderWithProviders(
      <BoxscoreRolesBody def={def(undefined)} row={r as never} />
    );
    const bob = await screen.findByRole('radiogroup', { name: 'Role for bob' });
    await userEvent.click(within(bob).getByRole('radio', { name: 'Team' }));
    await waitFor(() => expect(r.save).toHaveBeenCalledWith({ bob: 'team' }));
  });

  it('is read-only on a member Mac, saying who can change it', async () => {
    serve('member');
    renderWithProviders(
      <BoxscoreRolesBody def={def({})} row={row() as never} />
    );
    expect(
      await screen.findByText('Only the team owner can change roles.')
    ).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio'))
      expect(radio).toBeDisabled();
  });

  it('says this is a courtesy boundary', async () => {
    serve('owner');
    renderWithProviders(
      <BoxscoreRolesBody def={def({})} row={row() as never} />
    );
    expect(
      await screen.findByText(/each member's boxscore runs on their own Mac/)
    ).toBeInTheDocument();
  });
});
