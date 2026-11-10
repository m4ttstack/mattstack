/** Shared pieces for stories that render real board rows: the stage, a
    fixed clock, an MR builder and a row context whose actions do nothing.
    Invented names only (the repo is public). */
import type { ReactNode } from 'react';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import type { BoardMRWithReview, RowContext } from '../types.ts';

registerTheme(tuiTheme);

export const stage = (
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

export const NOW = Date.parse('2026-11-10T15:30:00Z');

let iid = 1287;
export function storyMr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  const n = iid++;
  return {
    iid: n,
    title: 'WEB-412 Show and hide ternaries in the lint backlog',
    webUrl: `https://gitlab.example.com/acme/webapp/-/merge_requests/${n}`,
    sourceBranch: 'web-412-show-hide-ternaries',
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
    ...over,
  } as unknown as BoardMRWithReview;
}

export const noop = () => {};

export const storyCtx = {
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
