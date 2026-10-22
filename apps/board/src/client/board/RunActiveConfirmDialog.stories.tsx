import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { ActiveRun, BoardMRWithReview, RowContext } from '../types.ts';
import { RowView } from './RowView.tsx';
import { RunActiveConfirmDialog } from './RunActiveConfirmDialog.tsx';

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <div
    className={context.globals.scheme === 'dark' ? 'dark' : undefined}
    style={{
      background: 'var(--page)',
      color: 'var(--text-1)',
      minHeight: '100vh',
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/LiveRun',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const noop = () => {};

const dialog = (run: ActiveRun) => (
  <RunActiveConfirmDialog
    pending={{ run, iid: 1418, ring: noop, launch: noop }}
    onDone={noop}
  />
);

/** A manual doctor on an MR whose own branch has a named worker. */
export const ConfirmNamedWorker: Story = {
  render: () => dialog({ runId: 'run-7', stage: 'implement', name: 'Pip' }),
};

/** The run carries no name: the title names the MR instead. */
export const ConfirmUnnamedWorker: Story = {
  render: () => dialog({ runId: 'run-8', stage: 'self-review' }),
};

/** The owner is the parent MR's worker, one level up the stack. */
export const ConfirmParentWorker: Story = {
  render: () =>
    dialog({ runId: 'run-9', stage: 'implement', name: 'Wren', viaIid: 1400 }),
};

const URL_1418 = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';

const mr = (over: Record<string, unknown> = {}): BoardMRWithReview =>
  ({
    iid: 1418,
    title: 'ACME-2214 Port the v2 quiet-mode flows',
    webUrl: URL_1418,
    sourceBranch: 'feature/acme-2214',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    createdAt: '2026-10-20T09:00:00Z',
    updatedAt: '2026-10-22T09:00:00Z',
    reviews: {
      isApproved: false,
      required: 1,
      given: 0,
      remaining: 1,
      reviewers: [],
    },
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    reviewerComments: 0,
    behindTarget: 0,
    isDraft: false,
    isStacked: false,
    gates: [],
    ...over,
  }) as unknown as BoardMRWithReview;

const handoff = (viaMr: string | null) => ({
  'pipeline-red': {
    runId: 'run-7',
    session: 'sess-7',
    stage: 'implement',
    pipelineId: 7310,
    viaMr,
    viaBranch: 'feature/acme-2214',
    at: Date.now() - 60_000,
  },
});

const ctx = new Proxy(
  {
    local: true,
    self: 'pat',
    slackTemplates: { single: '', multiHeader: '', multiItem: '' },
    slackEnabled: false,
    draftResolved: new Map(),
    selected: new Set(),
  } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : noop) }
) as unknown as RowContext;

/** A failing pipeline handed to this MR's own worker, and a stacked child
    handed to its parent's worker: the doctor lane says so instead. */
export const HandedToWorkerRow: Story = {
  render: () => (
    <div style={{ padding: 16 }}>
      <RowView
        mrs={[
          mr({ handoffs: handoff(URL_1418) }),
          mr({
            iid: 1419,
            title: 'ACME-2215 Quiet-mode settings page',
            webUrl:
              'https://gitlab.example.com/acme/webapp/-/merge_requests/1419',
            sourceBranch: 'feature/acme-2215',
            handoffs: handoff(URL_1418),
          }),
        ]}
        now={Date.now()}
        showAuthor
        ctx={ctx}
      />
    </div>
  ),
};
