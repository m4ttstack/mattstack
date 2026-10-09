import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { runTitle } from '../derive/kind';
import {
  dayGroups,
  laneFacts,
  runsStats,
  statCards,
  type LaneFacts,
} from '../derive/lanes';
import { EarlierList } from './EarlierList';
import { LiveLane } from './LiveLane';
import { StatLine } from './StatLine';
import { at, STORY_NOW, storyGate, storyRun } from './storyData';
import { WaitingBanner } from './WaitingBanner';

const live = storyRun({
  ticket: 'WEB-412',
  current_stage: 'implement',
  started_at: at(13, 38),
  agent: { status: 'working', pane: 'molly' },
  stages: [{ name: 'implement', status: 'running', started_at: at(15, 48) }],
});

const merged = storyRun({
  id: '20261008-1142',
  ticket: 'WEB-409',
  status: 'done',
  started_at: at(11, 42),
  ended_at: at(14, 12),
  evidence_count: 3,
  outcome: {
    status: 'done',
    mr: { iid: 405, state: 'merged', url: null, mergedAt: at(14, 14) },
  },
});

const review = storyRun({
  id: '20261008-0917',
  ticket: 'WEB-388',
  work_type: 'review',
  pipeline: 'review',
  status: 'done',
  started_at: at(9, 17),
  ended_at: at(9, 40),
  outcome: {
    status: 'done',
    reviewed: { iid: 412, url: null, posted: 'request changes' },
  },
});

const stale = storyRun({
  id: '20261007-1046',
  ticket: 'WEB-366',
  started_at: at(10, 46, 7),
  last_event_at: at(13, 18, 7),
  attention: { needs: true, reason: 'stale', evidence: 'quiet' },
});

const meta = {
  title: 'Runs/Runs page',
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

export const Stats: Story = {
  render: () => (
    <StatLine
      cards={statCards(
        runsStats({
          runs: [live, merged, review],
          gates: [storyGate],
          lanes: [live],
          now: STORY_NOW,
        })
      )}
    />
  ),
};

export const StatsEmpty: Story = {
  render: () => (
    <StatLine
      cards={statCards(
        runsStats({ runs: [], gates: [], lanes: [], now: STORY_NOW })
      )}
    />
  ),
};

export const StatsLoading: Story = {
  render: () => (
    <StatLine
      cards={statCards(
        runsStats({ runs: [], gates: [], lanes: [], now: STORY_NOW })
      )}
      state="loading"
    />
  ),
};

export const StatsUnknown: Story = {
  render: () => (
    <StatLine
      cards={statCards(
        runsStats({ runs: [], gates: [], lanes: [], now: STORY_NOW })
      )}
      state="unknown"
    />
  ),
};

export const Banner: Story = {
  render: () => (
    <WaitingBanner
      gate={storyGate}
      ticket="WEB-418"
      title="Let admins filter the tickets list by assignee"
      href="/runs/remote:acme%2Fweb/20261008-1340#gate-g-418-plan"
      now={STORY_NOW}
    />
  ),
};

const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  ...laneFacts({ run: live, detail: undefined, gates: [], now: STORY_NOW }),
  ...over,
});

export const Lane: Story = {
  render: () => (
    <LiveLane
      runId={live.id}
      ticket="WEB-412"
      title="Show linked parcels and recipients on the order overview"
      href="/runs/remote:acme%2Fweb/20261008-1338"
      facts={facts({
        field: 'Strategy: subagent-driven, 5 tasks',
        rail: ['provision', 'plan', 'implement', 'ship'].map((name, i) => ({
          name,
          status: i < 2 ? 'done' : i === 2 ? 'running' : 'not-started',
          durationMs: null,
          attempts: i < 3 ? 1 : 0,
        })),
      })}
    />
  ),
};

export const LaneWaitingInBoard: Story = {
  render: () => (
    <LiveLane
      runId="20261008-1502"
      ticket={null}
      title="Review of !412"
      href="/runs/remote:acme%2Fweb/20261008-1502"
      facts={facts({
        kind: 'review',
        liveness: { tone: 'warn', label: 'waiting in the board · 12m' },
        stage: 'review',
        field: null,
        mr: 'reviewing !412',
        focusPane: null,
      })}
    />
  ),
};

export const Earlier: Story = {
  render: () => (
    <EarlierList
      groups={dayGroups([merged, review, stale], STORY_NOW)}
      now={STORY_NOW}
      paged
      info={run => ({
        ticket: run.ticket,
        title: runTitle(run, {}),
        href: `/runs/${run.repo}/${run.id}`,
        inBoard: run === review,
        aging: run === stale ? 'ages out in 2 days' : null,
      })}
    />
  ),
};

/** Nine days of finished runs: 7 show, then "Show earlier days". */
const nineDays = Array.from({ length: 9 }, (_, i) =>
  storyRun({
    id: `202610${String(8 - i).padStart(2, '0')}-0900`,
    ticket: `WEB-${360 - i}`,
    status: 'done',
    started_at: at(9, 0, 8 - i),
    ended_at: at(10, 12, 8 - i),
  })
);

export const EarlierPaged: Story = {
  render: () => (
    <EarlierList
      groups={dayGroups(nineDays, STORY_NOW)}
      now={STORY_NOW}
      paged
      info={run => ({
        ticket: run.ticket,
        title: 'Add a tracking summary to the shipping panel',
        href: `/runs/${run.repo}/${run.id}`,
        inBoard: false,
        aging: null,
      })}
    />
  ),
};
