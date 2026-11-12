import type { TeamRead } from '../../../shared/team';

export const teamFixture: TeamRead[] = [
  {
    slug: 'acme',
    ok: true,
    team: {
      slug: 'acme',
      name: 'Acme',
      role: 'admin',
      members: [
        { username: 'matt', role: 'owner', peered: true },
        { username: 'bo', peered: false },
      ],
      invites: [
        {
          handle: 'alice',
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
      ],
    },
  },
];
