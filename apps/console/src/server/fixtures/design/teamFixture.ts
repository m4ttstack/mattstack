import type { TeamRead } from '../../../shared/team';

export const teamFixture: TeamRead[] = [
  {
    slug: 'acme',
    ok: true,
    team: {
      slug: 'acme',
      name: 'acme',
      role: 'org-owner',
      members: [
        { username: 'matt', role: 'owner', peered: true },
        { username: 'priya', peered: true },
        { username: 'dana', peered: false },
      ],
      invites: [
        {
          handle: 'marsh',
          teams: ['web'],
          expiresAt: '2026-12-01T00:00:00.000Z',
          state: 'replied',
        },
        {
          handle: 'carol',
          teams: ['web'],
          expiresAt: '2026-12-01T00:00:00.000Z',
          state: 'invited',
        },
        {
          handle: 'ravi',
          teams: ['web'],
          expiresAt: '2026-11-01T00:00:00.000Z',
          state: 'expired',
        },
      ],
      adminSecrets: { state: 'current', detail: null },
    },
  },
  {
    slug: 'north',
    ok: true,
    team: {
      slug: 'north',
      name: 'north',
      role: 'admin',
      members: [
        { username: 'lee', role: 'owner', peered: true },
        { username: 'matt', peered: true },
      ],
      invites: [],
      adminSecrets: {
        state: 'needs-sync',
        detail:
          "The org's owners and admins changed since its admin-only secrets were last locked to them",
      },
    },
  },
  {
    slug: 'beta',
    ok: false,
    error: 'rt team status failed: the beta org clone is unreachable',
  },
];
