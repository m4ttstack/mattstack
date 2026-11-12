import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import { CommentsDrawer } from './CommentsDrawer.tsx';
import {
  storyCtx as ctx,
  NOW,
  stage,
  storyMr,
} from './row-stories.fixtures.tsx';
import { RowSpotlight } from './RowSpotlight.tsx';
import { RowView } from './RowView.tsx';
import { pushSyncLine, startSyncLines } from './sync-lines.ts';
import { useLingering } from './use-lingering.ts';

const meta = {
  title: 'Board/Rebase locally',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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

function mr(
  doctor: BoardMRWithReview['doctor'] | undefined,
  over: Partial<BoardMRWithReview> = {}
): BoardMRWithReview {
  return storyMr({ ...(doctor ? { doctor } : {}), ...over });
}

const doctor = (
  status: string,
  syncLog: string[],
  message?: string,
  forge?: NonNullable<BoardMRWithReview['doctor']>['forge']
): BoardMRWithReview['doctor'] =>
  ({
    status,
    syncLog,
    updatedAt: NOW - 60_000,
    ...(message ? { message } : {}),
    ...(forge ? { forge } : {}),
  }) as unknown as BoardMRWithReview['doctor'];

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

export const ForgeWaiting: Story = {
  name: 'Forge rebase: waiting on GitLab',
  render: () => (
    <OpenRow
      row={mr(
        doctor('forge-rebasing', [], undefined, {
          forge: 'gitlab',
          state: 'running',
        })
      )}
    />
  ),
};

export const ForgeDone: Story = {
  name: 'Forge rebase: done, no local sync',
  render: () => (
    <OpenRow
      row={mr(
        doctor('synced', [], 'rebased on GitLab', {
          forge: 'gitlab',
          state: 'done',
          detail: 'rebased',
        }),
        { behindTarget: null }
      )}
    />
  ),
};

export const ForgeFailed: Story = {
  name: 'Forge rebase failed, local sync runs',
  render: () => (
    <OpenRow
      row={mr(
        doctor(
          'syncing',
          [L.tree, L.fetched, L.backup, L.rebasing],
          undefined,
          {
            forge: 'gitlab',
            state: 'failed',
            detail: 'Rebase failed: conflict',
          }
        )
      )}
    />
  ),
};

export const ForgeCancelled: Story = {
  name: 'Forge rebase cancelled',
  render: () => (
    <OpenRow
      row={mr(
        doctor(
          'sync-stopped',
          [],
          'cancelled; the forge may still be rebasing',
          { forge: 'gitlab', state: 'failed', detail: 'cancelled' }
        )
      )}
    />
  ),
};

export const NoDoctorPaused: Story = {
  name: 'Paused, no doctor on this tab',
  render: () => (
    <OpenRow
      row={mr(
        doctor(
          'sync-stopped',
          [L.tree, L.fetched, L.backup, L.rebasing, L.conflicts],
          'paused in george; no doctor on this tab',
          {
            forge: 'gitlab',
            state: 'failed',
            detail: 'Rebase failed: conflict',
          }
        )
      )}
    />
  ),
};

export const ForgeWaitingGitHub: Story = {
  name: 'Forge rebase: waiting on GitHub',
  render: () => (
    <OpenRow
      row={mr(
        doctor('forge-rebasing', [], undefined, {
          forge: 'github',
          state: 'running',
        })
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
  const drawer = useLingering(open ? row : null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open threads
      </button>
      <RowSpotlight mrUrl={row.webUrl} open={open} />
      {drawer.shown && (
        <CommentsDrawer
          mr={drawer.shown}
          local={false}
          self="pat"
          closing={drawer.leaving}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
