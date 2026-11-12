import type { TeamRead } from '../../../shared/team';

/** Shaped as `rt team status --json` reads: rt puts an invitee on the
    roster before it makes the invite, so each one is a member too. */
export const teamFixture: TeamRead[] = [
  {
    slug: 'acme',
    ok: true,
    team: {
      slug: 'acme',
      name: 'acme',
      role: 'org-owner',
      activeTeam: 'web',
      relayFailed: false,
      members: [
        { username: 'matt', role: 'org-owner', peered: true },
        { username: 'priya', role: 'owner', peered: true },
        { username: 'dana', role: 'member', peered: false },
        { username: 'marsh', role: 'member', peered: false },
        { username: 'carol', role: 'member', peered: false },
        { username: 'ravi', role: 'member', peered: false },
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
      activeTeam: 'core',
      relayFailed: false,
      members: [
        { username: 'lee', role: 'org-owner', peered: true },
        { username: 'matt', role: 'admin', peered: true },
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
