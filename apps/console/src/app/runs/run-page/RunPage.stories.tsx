import '../../icons';

import type { RunFieldRow } from '@mattstack/rt-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StoryEntry } from '../derive/story';
import { NowCard } from './NowCard';
import { RunHeader } from './RunHeader';
import { SideCards } from './SideCards';
import { Story } from './Story';

/** The live run page's parts in the states the boards draw. Data reads (the
    failure log, stage docs) answer only with the design fixture server behind
    `/api` (see the parity runbook). */
const REPO = 'remote:acme%2Fweb';
const RUN = '20261008-0900';
const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 8, 21, 21);
const queryClient = new QueryClient();

const field = (key: string, value: string): RunFieldRow => ({
  key,
  value,
  produced_by: 'x',
  at: NOW,
});

const entry = (over: Partial<StoryEntry>): StoryEntry => ({
  key: 'plan#1',
  attempt: {
    stage: 'plan',
    attempt: 1,
    status: 'done',
    startedAt: NOW - 60 * MIN,
    endedAt: NOW - 59 * MIN,
  },
  label: 'plan',
  durationMs: MIN,
  fields: [],
  gates: [],
  holds: [],
  failure: null,
  redirect: null,
  evidence: null,
  ...over,
});

const meta = {
  title: 'Runs/Run page/Live page parts',
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 1000 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type S = StoryObj<typeof meta>;

export const HeaderWorkRun: S = {
  render: () => (
    <RunHeader
      repo={REPO}
      runId={RUN}
      ticket="WEB-412"
      ticketUrl="https://linear.app/acme/issue/WEB-412"
      ticketHotkey
      meta="work pipeline · started 1:38 PM · 2h 43m"
      title="Show linked parcels and recipients on the order overview"
      liveness={{ tone: 'ok', label: 'agent working' }}
      rail={{
        stages: [
          { name: 'provision', status: 'done', durationMs: MIN, attempts: 1 },
          { name: 'plan', status: 'done', durationMs: MIN, attempts: 1 },
          {
            name: 'implement',
            status: 'running',
            durationMs: 33 * MIN,
            attempts: 1,
          },
          {
            name: 'ship',
            status: 'not-started',
            durationMs: null,
            attempts: 0,
          },
        ],
        gateCounts: { plan: 3 },
      }}
      finished={false}
      focusPane="pane-1"
      canResume={false}
      canAbandon={false}
      onViewInputs={() => {}}
    />
  ),
};

export const HeaderReviewRun: S = {
  render: () => (
    <RunHeader
      repo={REPO}
      runId={RUN}
      ticket="!412"
      ticketUrl="https://gitlab.com/acme/web/-/merge_requests/412"
      ticketHotkey={false}
      meta="review pipeline · started 3:02 PM · 9m"
      title="dedupe-contacts"
      liveness={{ tone: 'warn', label: 'waiting in the board · 2m' }}
      rail={null}
      finished={false}
      focusPane={null}
      canResume={false}
      canAbandon
      onViewInputs={() => {}}
    />
  ),
};

export const NowWithFields: S = {
  render: () => (
    <NowCard
      label="implement"
      startedAt={NOW - 33 * MIN}
      lastEventAt={NOW - 2 * MIN}
      now={NOW}
      fields={[
        field('strategy', 'subagent-driven, 5 tasks'),
        field('plan', 'docs/superpowers/plans/2026-10-08-linked-parcels.md'),
      ]}
    />
  ),
};

export const NowNothingYet: S = {
  render: () => (
    <NowCard
      label="implement · attempt 3"
      startedAt={NOW - MIN}
      lastEventAt={NOW - MIN}
      now={NOW}
      fields={[]}
    />
  ),
};

const legacy = field(
  'evidence',
  '/Users/acme/.mattstack/evidence/web-412/before.png http://localhost:4001/orders/4821'
);

export const StoryEdges: S = {
  render: () => (
    <Story
      repo={REPO}
      runId={RUN}
      label="Story so far"
      evidenceField={legacy}
      entries={[
        entry({
          key: 'evidence#1',
          label: 'evidence',
          attempt: { ...entry({}).attempt, stage: 'evidence' },
          durationMs: 12 * MIN,
          fields: [
            field('case', 'An order with one linked parcel, tracking unknown'),
          ],
          evidence: 'legacy',
        }),
        entry({
          key: 'implement#1',
          label: 'implement · attempt 1',
          attempt: {
            ...entry({}).attempt,
            stage: 'implement',
            status: 'failed',
          },
          durationMs: 41 * MIN,
          failure: {
            reason: 'Typecheck failed after task 4',
            detailPath: '/fixture/runs/20261008-0900/implement-1.txt',
          },
        }),
        entry({
          key: 'self-review#1',
          label: 'self-review',
          attempt: {
            ...entry({}).attempt,
            stage: 'self-review',
            status: 'redirected',
          },
          durationMs: 6 * MIN,
          redirect:
            'back to implement: the empty state for no parcels is missing',
          holds: [
            {
              from: NOW - 30 * MIN,
              to: NOW - 10 * MIN,
              reason: 'waiting on design',
            },
          ],
        }),
      ]}
    />
  ),
};

export const ReviewBlock: S = {
  render: () => (
    <Story
      repo={REPO}
      runId={RUN}
      label="review"
      evidenceField={null}
      block
      entries={[
        entry({
          key: 'review#1',
          label: 'review',
          attempt: { ...entry({}).attempt, stage: 'review', status: 'running' },
          durationMs: 7 * MIN,
          fields: [
            field('findings', '4 (2 must fix, 2 suggestions)'),
            field('tiers', 'correctness, tests'),
          ],
        }),
      ]}
    />
  ),
};

export const SideWorkRun: S = {
  render: () => (
    <SideCards
      facts={[
        {
          name: 'MR',
          label: 'MR · CI',
          icon: 'gitPullRequest',
          iconLayer: 'git-pull-request',
          value: null,
          empty: 'not opened yet',
          hotkey: 'm',
          sub: 'opens at ship',
        },
        {
          name: 'Branch',
          label: 'Branch',
          icon: 'gitBranch',
          iconLayer: 'git-branch',
          value: 'web-412-linked-parcels',
          empty: 'not recorded',
          hotkey: 'b',
          sub: '4 commits @ 9f2c1a7',
        },
      ]}
      decisions={[
        {
          gateId: 'g1',
          questionId: 'q',
          stage: 'plan',
          pick: 'Backend gap-fill',
        },
      ]}
      onOpenDecision={() => {}}
      noDecisions="None yet."
      inputs={{
        state: 'ready',
        pack: 'acme pack 4c1d9e2 · in sync',
        counts: '3 settings · 5 stage docs',
      }}
      onViewInputs={() => {}}
    />
  ),
};
