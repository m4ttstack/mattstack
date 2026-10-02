import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';

const USER = '~/.mattstack/user/settings.user.jsonc';
const TEAM = '~/.mattstack/teams/acme/settings.team.jsonc';
const STOREFRONT = 'gitlab.example.com/acme/storefront';
const BILLING = 'gitlab.example.com/acme/billing';

export const POOL_KEY = 'rt.worktreePool';

export const POOL_DEF: SettingDefWire = {
  key: POOL_KEY,
  type: 'object',
  scopes: ['team', 'user', 'machine'],
  merge: 'deep',
  secret: false,
  teamLocked: false,
  repoScoped: true,
  repoOnly: true,
  writable: true,
  description:
    'Per-repo worktree pool: how many trees wait on deck and the ready steps each new tree runs.',
  hasDefault: true,
  defaultValue: { onDeck: 0 },
  schema: {
    type: 'object',
    properties: {
      onDeck: { type: 'number' },
      ready: {
        type: 'array',
        items: {
          type: 'object',
          properties: { run: { type: 'string' } },
          required: ['run'],
        },
      },
      staleClaimDays: { type: 'number' },
    },
  } as NonNullable<SettingDefWire['schema']>,
  repos: [
    { identity: STOREFRONT, scopes: ['user'] },
    { identity: BILLING, scopes: ['team'] },
  ],
  effective: { scope: 'default', file: null, value: { onDeck: 0 } },
  storeVersion: 1,
};

const DEFAULT_ROW: ExplainRowWire = {
  scope: 'default',
  file: null,
  present: true,
  value: { onDeck: 0 },
};

/** Each repo's own layers, keyed by repo identity. */
export const POOL_REPO_ROWS: Record<string, ExplainRowWire[]> = {
  [STOREFRONT]: [
    DEFAULT_ROW,
    {
      scope: 'user.repo',
      file: USER,
      present: true,
      value: { onDeck: 2, ready: [{ run: 'pnpm install' }] },
    },
  ],
  [BILLING]: [
    DEFAULT_ROW,
    {
      scope: 'team.repo',
      file: TEAM,
      present: true,
      value: {
        onDeck: 1,
        ready: [{ run: 'bun install' }, { run: 'bun run build' }],
        staleClaimDays: 7,
      },
    },
  ],
};

export const POOL_ROWS: ExplainRowWire[] = [
  DEFAULT_ROW,
  { scope: 'team', file: TEAM, present: false },
  { scope: 'user', file: USER, present: false },
];
