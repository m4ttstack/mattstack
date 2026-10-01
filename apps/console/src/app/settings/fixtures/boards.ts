import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';

import { TEST_SCHEMAS } from '../testSchemas';

const USER = '~/.mattstack/user/settings.user.jsonc';
const LOCAL = '~/.mattstack/user/local/studio-mac/settings.local.jsonc';

const base = {
  type: 'string',
  scopes: ['user', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  hasDefault: false,
  defaultValue: null,
  storeVersion: 1,
} as const;

const GITQ_BOARD_SCHEMA = {
  type: 'object',
  properties: {
    repos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, name: { type: 'string' } },
        required: ['path', 'name'],
      },
    },
    port: { type: 'number' },
  },
} as NonNullable<SettingDefWire['schema']>;

const BOARD_VALUE = {
  repos: [
    { path: '~/code/acme/storefront', name: 'storefront' },
    { path: '~/code/mattstack', name: 'gitq' },
  ],
  port: 11008,
};

export const BOARD_DEFS: SettingDefWire[] = [
  {
    ...base,
    scopes: [...base.scopes],
    key: 'agent.claude.model',
    description:
      'Default --model for claude rt agent launches; unset omits the flag.',
    effective: { scope: 'user', file: USER, value: 'claude-opus-5-5[1m]' },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'agent.claude.yolo',
    type: 'boolean',
    description:
      'Default --yolo (--dangerously-skip-permissions) for claude rt agent launches; unset behaves as false.',
    effective: { scope: null, file: null },
  },
  {
    ...base,
    scopes: ['team', 'user', 'machine'],
    key: 'rt.worktreeApp',
    type: 'object',
    merge: 'deep',
    description:
      'Worktree pool on/off switch (enabled, killProcesses, claudeHook), merged per field.',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        killProcesses: { type: 'boolean' },
        claudeHook: { type: 'boolean' },
      },
    } as NonNullable<SettingDefWire['schema']>,
    effective: {
      scope: 'machine',
      file: LOCAL,
      value: { enabled: true, killProcesses: true, claudeHook: true },
      authored: { enabled: true, killProcesses: true, claudeHook: true },
    },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'gitq.forges',
    type: 'object',
    description:
      "gitq's host-keyed forge config, tokenEnv names only, never a live token.",
    schema: TEST_SCHEMAS['gitq.forges'],
    effective: { scope: null, file: null },
  },
  {
    ...base,
    scopes: ['machine'],
    key: 'gitq.board',
    type: 'object',
    merge: 'deep',
    description:
      'gitq checkout-board config: tracked repos, local port, and the herdr workspace it launches into.',
    schema: GITQ_BOARD_SCHEMA,
    effective: { scope: 'machine', file: LOCAL, value: BOARD_VALUE },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'gitq.workspace',
    description: "Herdr workspace gitq's board launches agent panes into.",
    hasDefault: true,
    defaultValue: 'gitq',
    effective: { scope: 'default', file: null, value: 'gitq' },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'rt.daemonPath',
    description:
      'Absolute colon-separated PATH the daemon uses for every child it spawns.',
    effective: { scope: null, file: null },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'rt.logLevel',
    description: 'Daemon log level (trace | debug | info | warn | error).',
    hasDefault: true,
    defaultValue: 'info',
    schema: {
      type: 'string',
      enum: ['trace', 'debug', 'info', 'warn', 'error'],
    } as NonNullable<SettingDefWire['schema']>,
    effective: { scope: 'machine', file: LOCAL, value: 'warn' },
  },
  {
    ...base,
    scopes: [...base.scopes],
    key: 'rt.runsPruneDays',
    type: 'number',
    description:
      'Age floor in days for pruning finished pipeline run directories (default 30).',
    hasDefault: true,
    defaultValue: 30,
    effective: { scope: 'default', file: null, value: 30 },
  },
];

export const BOARD_ROWS: Record<string, ExplainRowWire[]> = {
  'rt.logLevel': [
    { scope: 'default', file: null, present: true, value: 'info' },
    { scope: 'user', file: USER, present: true, value: 'debug' },
    { scope: 'machine', file: LOCAL, present: true, value: 'warn' },
  ],
  'gitq.board': [
    { scope: 'default', file: null, present: false },
    { scope: 'machine', file: LOCAL, present: true, value: BOARD_VALUE },
  ],
};
