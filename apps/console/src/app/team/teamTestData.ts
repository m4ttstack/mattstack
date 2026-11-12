import { vi } from 'vitest';

import type {
  TeamInvite,
  TeamMember,
  TeamRead,
  TeamView,
} from '../../shared/team';

export const ok = (json: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => json,
});

export const invite = (
  handle: string,
  state: TeamInvite['state']
): TeamInvite => ({
  handle,
  teams: [],
  expiresAt: '2026-12-01T00:00:00.000Z',
  state,
});

export const member = (
  username: string,
  over: Partial<TeamMember> = {}
): TeamMember => ({ username, peered: true, ...over });

export function team(
  slug: string,
  over: Partial<TeamView> = {}
): Extract<TeamRead, { ok: true }> {
  return {
    slug,
    ok: true,
    team: {
      slug,
      name: slug,
      role: 'org-owner',
      activeTeam: null,
      relayFailed: false,
      members: [member('matt', { role: 'org-owner' })],
      invites: [],
      adminSecrets: null,
      ...over,
    },
  };
}

export const failed = (slug: string, error: string): TeamRead => ({
  slug,
  ok: false,
  error,
});

export const teamGet = vi.fn();
export const confirmPost = vi.fn();
export const adminSecretsPost = vi.fn();

export function serveTeams(teams: TeamRead[]) {
  teamGet.mockResolvedValue(ok({ teams }));
}

export const apiMock = () => ({
  client: {
    api: {
      team: {
        $get: (...args: unknown[]) => teamGet(...args),
        confirm: { $post: (...args: unknown[]) => confirmPost(...args) },
        'admin-secrets': {
          $post: (...args: unknown[]) => adminSecretsPost(...args),
        },
      },
    },
  },
});
