import { useEffect, useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview, RowContext } from '../types.ts';
import { CommentsDrawer } from './CommentsDrawer.tsx';
import { RowSpotlight } from './RowSpotlight.tsx';
import { RowView } from './RowView.tsx';
import { pushSyncLine, startSyncLines } from './sync-lines.ts';

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
      padding: 32,
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Story />
      </div>
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/Rebase locally',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const NOW = Date.parse('2026-11-10T15:30:00Z');
const BRANCH = 'web-412-show-hide-ternaries';

/** rt sync's plain lines, as the daemon streams them. */
const L = {
  tree: '[ok] Syncing in worktree george',
  fetched: '[ok] Fetched from origin',
  backup: `[ok] Saved a backup  rt-backup/rebase/${BRANCH}/2026-11-10T04-31-54`,
  rebasing: `[running] Rebasing ${BRANCH} onto origin/main  110 commits behind`,
  rebased: `[ok] Rebased ${BRANCH} onto origin/main`,
  pushing: '[running] Pushing…',
  pushed: '[ok] Pushed',
  upToDate: `[ok] ${BRANCH} is up to date with origin/main`,
  conflicts:
    '[needs you] 3 files have conflicts rt cannot resolve  the rebase is paused',
  pushFailed: `[failed] Could not push ${BRANCH}`,
};

let iid = 1287;
function mr(
  doctor: BoardMRWithReview['doctor'] | undefined,
  over: Partial<BoardMRWithReview> = {}
): BoardMRWithReview {
  const n = iid++;
  return {
    iid: n,
    title: 'WEB-412 Show and hide ternaries in the lint backlog',
    webUrl: `https://gitlab.example.com/acme/webapp/-/merge_requests/${n}`,
    sourceBranch: BRANCH,
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: {
      isApproved: false,
      required: 1,
      given: 0,
      remaining: 1,
      reviewers: [],
    },
    reviewerComments: 0,
    diff: { additions: 307, deletions: 126, filesChanged: 9 },
    updatedAt: new Date(NOW - 21 * 3600_000).toISOString(),
    threadSummary: { awaiting: 0, replied: 0, resolved: 4 },
    generalComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 110,
    isDraft: false,
    codeownerSections: [],
    gates: [],
    ...(doctor ? { doctor } : {}),
    ...over,
  } as unknown as BoardMRWithReview;
}

const doctor = (
  status: string,
  syncLog: string[],
  message?: string
): BoardMRWithReview['doctor'] =>
  ({
    status,
    syncLog,
    updatedAt: NOW - 60_000,
    ...(message ? { message } : {}),
  }) as unknown as BoardMRWithReview['doctor'];

const noop = () => {};
const ctx = {
  local: true,
  self: 'pat',
  slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
  slackEnabled: false,
  onContext: noop,
  onOpenReview: noop,
  onOpenRespond: noop,
  onOpenDraft: noop,
  onOpenComments: noop,
  draftResolved: new Map(),
  onResumeRespond: noop,
  onResumeReview: noop,
  onRedo: noop,
  onFocusPane: noop,
  onOpenGate: noop,
  selected: new Set(),
  onToggleSelect: noop,
  onClearOrphan: noop,
  onDismissLane: noop,
  noteEditing: null,
  onEditNote: noop,
  onSaveNote: noop,
  onLaunch: noop,
  onReReview: noop,
  onRespond: noop,
  onDoctor: noop,
} as unknown as RowContext;

/** A row with its sync popover open, the way a click on "rebase locally"
    leaves it for whoever clicked. */
function OpenRow({ row }: { row: BoardMRWithReview }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startSyncLines(row.webUrl!);
    setReady(true);
  }, [row.webUrl]);
  if (!ready) return null;
  return (
    <div style={{ minHeight: 360 }}>
      <RowView
        mrs={[neighbours[0]!, row, neighbours[1]!]}
        now={NOW}
        showAuthor={false}
        ctx={ctx}
      />
    </div>
  );
}

/** Rows around the synced one, so the spotlight has something to dim. */
const neighbours = [
  mr(undefined, {
    title: 'WEB-398 Split the settings page into tabs',
    behindTarget: null,
  }),
  mr(undefined, {
    title: 'WEB-405 Retry flaky uploads with backoff',
    behindTarget: 12,
  }),
];

export const Running: Story = {
  render: () => (
    <OpenRow
      row={mr(doctor('syncing', [L.tree, L.fetched, L.backup, L.rebasing]))}
    />
  ),
};

export const Synced: Story = {
  render: () => (
    <OpenRow
      row={mr(
        doctor(
          'synced',
          [L.tree, L.fetched, L.backup, L.rebasing, L.rebased, L.pushed],
          'rebased and pushed'
        )
      )}
    />
  ),
};

export const UpToDate: Story = {
  name: 'Already up to date',
  render: () => (
    <OpenRow
      row={mr(
        doctor('synced', [L.tree, L.fetched, L.upToDate], 'already up to date'),
        { behindTarget: null }
      )}
    />
  ),
};

export const PushRejected: Story = {
  name: 'Stopped: push rejected',
  render: () => (
    <OpenRow
      row={mr(
        doctor(
          'sync-stopped',
          [
            L.tree,
            L.fetched,
            L.backup,
            L.rebasing,
            L.rebased,
            L.pushing,
            L.pushFailed,
          ],
          'rebased locally, but the push failed'
        )
      )}
    />
  ),
};

export const Conflict: Story = {
  name: 'Conflict: doctor takes over',
  render: () => (
    <OpenRow
      row={mr(
        doctor('rebasing', [
          L.tree,
          L.fetched,
          L.backup,
          L.rebasing,
          L.conflicts,
        ])
      )}
    />
  ),
};

/** The row's word at each step, popovers closed. */
export const Phases: Story = {
  name: 'The word follows each step',
  render: () => (
    <RowView
      mrs={[
        mr(doctor('syncing', [])),
        mr(doctor('syncing', [L.tree])),
        mr(doctor('syncing', [L.tree, L.fetched])),
        mr(doctor('syncing', [L.tree, L.fetched, L.backup, L.rebasing])),
        mr(
          doctor('syncing', [
            L.tree,
            L.fetched,
            L.backup,
            L.rebasing,
            L.rebased,
            L.pushing,
          ])
        ),
      ]}
      now={NOW}
      showAuthor={false}
      ctx={ctx}
    />
  ),
};

const SCRIPT = [
  L.tree,
  '[running] Fetching from origin…',
  L.fetched,
  L.backup,
  L.rebasing,
  L.rebased,
  L.pushing,
  L.pushed,
];

/** One sync played through, a step every 1.2s, then the finished row. */
function LiveRow() {
  const [row] = useState(() => mr(doctor('syncing', [])));
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    startSyncLines(row.webUrl!);
  }, [row.webUrl]);
  useEffect(() => {
    if (step >= SCRIPT.length) {
      const t = setTimeout(() => setDone(true), 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      pushSyncLine(row.webUrl!, SCRIPT[step]!);
      setStep(s => s + 1);
    }, 1200);
    return () => clearTimeout(t);
  }, [step, row.webUrl]);
  const shown = done
    ? {
        ...row,
        doctor: doctor('synced', SCRIPT, 'rebased and pushed'),
      }
    : {
        ...row,
        doctor: doctor('syncing', SCRIPT.slice(0, step)),
      };
  return (
    <div style={{ minHeight: 360 }}>
      <button
        type="button"
        style={{ marginBottom: 16 }}
        onClick={() => {
          startSyncLines(row.webUrl!);
          setDone(false);
          setStep(0);
        }}
      >
        replay
      </button>
      <RowView
        mrs={[shown as BoardMRWithReview]}
        now={NOW}
        showAuthor={false}
        ctx={ctx}
      />
    </div>
  );
}

export const Live: Story = {
  name: 'Live: one sync played through',
  render: () => <LiveRow />,
};

/** The comment threads drawer takes the same spotlight. */
export const ThreadsSpotlight: Story = {
  name: 'Comment threads drawer, same spotlight',
  render: () => (
    <div style={{ minHeight: 360 }}>
      <RowView
        mrs={[neighbours[0]!, neighbours[1]!]}
        now={NOW}
        showAuthor={false}
        ctx={ctx}
      />
      <ThreadsDrawerToggle />
    </div>
  ),
};

/** Board's own wiring: the spotlight beside the drawer's condition, so it
    fades out after the drawer closes. */
function ThreadsDrawerToggle() {
  const [open, setOpen] = useState(true);
  const row = neighbours[0]!;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open threads
      </button>
      <RowSpotlight mrUrl={row.webUrl} open={open} />
      {open && (
        <CommentsDrawer
          mr={row}
          local={false}
          self="pat"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
