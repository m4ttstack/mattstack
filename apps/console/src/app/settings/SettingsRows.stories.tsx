import type { ReactNode } from 'react';
import type { ExplainRowWire } from '@mattstack/settings-kit/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ExplainModal } from './ExplainModal';
import { BOARD_DEFS, BOARD_ROWS } from './fixtures/boards';
import {
  POOL_DEF,
  POOL_KEY,
  POOL_REPO_ROWS,
  POOL_ROWS,
} from './fixtures/repos';
import type { PanelStore } from './KeyPanel';
import { SettingRow, type RowOpen } from './SettingRow';
import classes from './SettingsRows.module.css';

const store: PanelStore = {
  set: async () => null,
  unset: async () => null,
  move: async () => null,
  prune: async () => null,
};

const DEFS = [...BOARD_DEFS, POOL_DEF];
const ROWS: Record<string, ExplainRowWire[]> = {
  ...BOARD_ROWS,
  [POOL_KEY]: POOL_ROWS,
};
const REPO_ROWS: Record<string, Record<string, ExplainRowWire[]>> = {
  [POOL_KEY]: POOL_REPO_ROWS,
};

const def = (key: string) => DEFS.find(d => d.key === key)!;

function stubFetch(real: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.href);
    const m = /\/api\/settings\/explain\/(.+)$/.exec(url.pathname);
    if (!m) return real(input, init);
    const key = decodeURIComponent(m[1]!);
    const repo = url.searchParams.get('repo');
    const rows = repo ? REPO_ROWS[key]?.[repo] : ROWS[key];
    return new Response(JSON.stringify({ def: def(key), rows: rows ?? [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/** The settings page's content column at the boards' width. */
function Stage({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <div data-testid="stage" className={classes.stage}>
        {children}
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Console/Settings/Rows',
  parameters: { layout: 'padded' },
  beforeEach: () => {
    const real = globalThis.fetch;
    globalThis.fetch = stubFetch(real);
    return () => {
      globalThis.fetch = real;
    };
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const row = (key: string, open: RowOpen | null = null) => (
  <SettingRow
    key={key}
    def={def(key)}
    store={store}
    subhead={null}
    query=""
    defaultOpen={open}
  />
);

export const ExpandInPlace: Story = {
  render: () => (
    <Stage>
      {row('agent.claude.model')}
      {row('agent.claude.yolo')}
      {row('rt.worktreeApp')}
      {row('gitq.forges')}
      {row('gitq.board', { tab: 'value', fix: null })}
      {row('gitq.workspace')}
    </Stage>
  ),
};

export const WhereItsSet: Story = {
  render: () => (
    <Stage>
      {row('rt.daemonPath')}
      {row('rt.logLevel', { tab: 'where', fix: null })}
      {row('rt.runsPruneDays')}
      {row('gitq.board', { tab: 'value', fix: null })}
      {row('gitq.forges')}
    </Stage>
  ),
};

export const RunDetailModal: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <ExplainModal
        settingKey="rt.logLevel"
        store={{ defs: BOARD_DEFS, loading: false, error: null, ...store }}
        onClose={() => {}}
      />
    </QueryClientProvider>
  ),
};

export const RunDetailRepos: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <ExplainModal
        settingKey={POOL_KEY}
        store={{ defs: DEFS, loading: false, error: null, ...store }}
        onClose={() => {}}
      />
    </QueryClientProvider>
  ),
};
