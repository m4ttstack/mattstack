import '../../icons';

import type { GateRow, RunStageRow } from '@mattstack/rt-client';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { dayDecisions, dayTimeline } from '../derive/day';
import { DayTimeline, TimelineLegend } from './DayTimeline';
import { DecisionsToday } from './DecisionsToday';
import { at, STORY_NOW, storyRun } from './storyData';
import { TimeSpent } from './TimeSpent';

const stage = (
  name: string,
  status: string,
  started_at: number,
  ended_at: number | null
): RunStageRow => ({
  name,
  status,
  attempt: 1,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});

const waiting = storyRun({
  id: '20261008-1340',
  ticket: 'WEB-418',
  current_stage: 'plan',
  started_at: at(13, 38),
});
const live = storyRun({
  id: '20261008-1338',
  ticket: 'WEB-412',
  current_stage: 'implement',
  started_at: at(13, 38),
  stages: [{ name: 'implement', status: 'running', started_at: at(15, 48) }],
});
const ci = storyRun({
  id: '20260930-1323',
  ticket: 'WEB-397',
  current_stage: 'watch-ci',
  started_at: at(13, 23, 7),
  stages: [{ name: 'watch-ci', status: 'running', started_at: at(16, 6) }],
});
const merged = storyRun({
  id: '20261008-1142',
  ticket: 'WEB-409',
  status: 'done',
  started_at: at(11, 42),
  ended_at: at(14, 12),
  outcome: {
    status: 'done',
    mr: { iid: 405, state: 'merged', url: null, mergedAt: at(14, 14) },
  },
});

const details = new Map([
  [
    waiting.id,
    {
      stages: [
        stage('provision', 'done', at(13, 38), at(13, 39)),
        stage('plan', 'running', at(15, 12), null),
      ],
      decisions: [],
    },
  ],
  [
    live.id,
    {
      stages: [
        stage('plan', 'done', at(13, 38), at(14, 4)),
        stage('evidence', 'done', at(15, 4), at(15, 48)),
        stage('implement', 'running', at(15, 48), null),
      ],
      decisions: [],
    },
  ],
  [
    ci.id,
    {
      stages: [
        stage('implement', 'done', at(9, 0, 7), at(18, 10, 7)),
        stage('self-review', 'done', at(15, 36), at(15, 53)),
        stage('ship', 'done', at(15, 54), at(16, 6)),
        stage('watch-ci', 'running', at(16, 6), null),
      ],
      decisions: [],
    },
  ],
  [
    merged.id,
    {
      stages: [
        stage('plan', 'done', at(11, 42), at(12, 40)),
        stage('implement', 'done', at(12, 40), at(13, 36)),
        stage('watch-ci', 'done', at(13, 36), at(14, 12)),
      ],
      decisions: [],
    },
  ],
]);

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    kind: 'plan',
    owner: 'human',
    origin: null,
    status: 'answered',
    questions: [
      {
        id: 'q',
        label: 'How should it ship?',
        multi: false,
        options: [
          { value: 'ready', label: 'Ready for review (Recommended)' },
          { value: 'draft', label: 'Ship as draft, preview environment on' },
        ],
      },
    ],
    ...over,
  }) as GateRow;

const gates: GateRow[] = [
  gate({
    id: 'g-418-plan',
    subject: `run:${waiting.id}`,
    status: 'open',
    openedAt: at(15, 54),
    answer: null,
  }),
  gate({
    id: 'g-409-ship',
    subject: `run:${merged.id}`,
    openedAt: at(12, 6),
    answer: {
      answers: { q: 'draft' },
      by: 'console',
      answeredAt: at(12, 34),
    } as GateRow['answer'],
  }),
];

const runs = [waiting, live, ci, merged];
const gatesByRun = new Map<string, GateRow[]>();
for (const g of gates) {
  const id = g.subject.slice('run:'.length);
  gatesByRun.set(id, [...(gatesByRun.get(id) ?? []), g]);
}

const today = dayTimeline({
  runs,
  details,
  gatesByRun,
  key: '2026-10-08',
  now: STORY_NOW,
});
const empty = dayTimeline({
  runs,
  details,
  gatesByRun,
  key: '2026-10-01',
  now: STORY_NOW,
});

const meta = {
  title: 'Runs/Day timeline',
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 1384 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Legend: Story = { render: () => <TimelineLegend /> };

export const Today: Story = {
  render: () => (
    <DayTimeline
      rows={today.rows}
      axis={today.axis}
      youMs={today.totals.you}
      isToday
      loading={false}
      titleOf={row => row.run.ticket ?? row.run.id}
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <DayTimeline
      rows={[]}
      axis={empty.axis}
      youMs={0}
      isToday
      loading
      titleOf={row => row.run.id}
    />
  ),
};

export const NoRuns: Story = {
  render: () => (
    <DayTimeline
      rows={empty.rows}
      axis={empty.axis}
      youMs={0}
      isToday={false}
      loading={false}
      titleOf={row => row.run.id}
    />
  ),
};

export const TimeWent: Story = {
  render: () => <TimeSpent totals={today.totals} isToday loading={false} />,
};

export const Decisions: Story = {
  render: () => (
    <DecisionsToday
      decisions={dayDecisions(runs, gates, at(0), at(0, 0, 9))}
      isToday
      loading={false}
    />
  ),
};

export const NoDecisions: Story = {
  render: () => (
    <DecisionsToday decisions={[]} isToday={false} loading={false} />
  ),
};
