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
    },
  },
  {
    slug: 'beta',
    ok: false,
    error: 'rt team status failed: the beta org clone is unreachable',
  },
];
