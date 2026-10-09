import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { DecisionStage } from '../derive/record';
import {
  answeredWith,
  AT,
  FINDINGS_CONTEXT,
  gateOf,
  PROSE_CONTEXT,
  reviewQuestion,
} from './decisionFixtures';
import { DecisionsTab } from './DecisionsTab';
import { RecordHeader } from './RecordHeader';

/** The record view's parts in the states the record boards draw. The whole
    page reads the run's routes, so it is checked against the design fixture
    (see the parity runbook) rather than here. */
const MIN = 60_000;
const queryClient = new QueryClient();

const meta = {
  title: 'Runs/Run page/Record parts',
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 1300 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type S = StoryObj<typeof meta>;

export const HeaderMerged: S = {
  render: () => (
    <RecordHeader
      ticket="WEB-409"
      ticketUrl="https://linear.app/acme/issue/WEB-409"
      meta="work pipeline · Oct 8, 11:42 AM → 2:14 PM"
      title="Add a tracking summary to the shipping panel"
      outcome={{
        status: 'done',
        mr: { iid: 405, state: 'merged', url: null },
        ci: 'success',
      }}
      stats={[
        { id: 'duration', value: '2h 32m', label: 'start to merge' },
        { id: 'decisions', value: '8', label: 'decisions' },
        { id: 'took', value: '6 of 8', label: 'took the recommendation' },
        { id: 'evidence', value: '3', label: 'evidence' },
        { id: 'commits', value: '4', label: 'commits' },
        { id: 'waiting', value: '25m', label: 'waiting on you' },
      ]}
    />
  ),
};

export const HeaderAbandoned: S = {
  render: () => (
    <RecordHeader
      ticket="WEB-366"
      ticketUrl="https://linear.app/acme/issue/WEB-366"
      meta="work pipeline · Oct 8, 11:42 AM → 2:14 PM"
      title="Show the author on imported notes"
      outcome={{ status: 'abandoned' }}
      stats={[
        { id: 'duration', value: '2h 32m', label: 'start to end' },
        { id: 'decisions', value: '3', label: 'decisions' },
        { id: 'evidence', value: '2 links', label: 'evidence' },
        { id: 'commits', value: '2', label: 'commits' },
        { id: 'waiting', value: '40m', label: 'waiting on you' },
      ]}
    />
  ),
};

export const HeaderReview: S = {
  render: () => (
    <RecordHeader
      ticket="!412"
      ticketUrl={null}
      meta="review pipeline · Oct 8, 9:40 AM → 10:03 AM"
      title="dedupe-contacts"
      outcome={{
        status: 'done',
        reviewed: { iid: 412, url: null, posted: 'request changes' },
      }}
      stats={[
        { id: 'duration', value: '23m', label: 'start to end' },
        { id: 'decisions', value: '1', label: 'decisions' },
        { id: 'waiting', value: '6m', label: 'waiting on you' },
      ]}
    />
  ),
};

const plan: DecisionStage = {
  stage: 'plan',
  gates: [
    gateOf({ id: 'g-1', context: PROSE_CONTEXT }),
    gateOf({
      id: 'g-2',
      answer: answeredWith({
        approach: { value: 'panel', note: 'The backend can wait a sprint.' },
      }),
    }),
  ],
  answered: 2,
  durationMs: 12 * MIN,
  overrode: true,
};

const ship: DecisionStage = {
  stage: 'ship',
  gates: [
    gateOf({
      id: 'g-3',
      status: 'closed',
      closedReason: 'superseded',
      answer: null,
      closedAt: AT,
    }),
  ],
  answered: 0,
  durationMs: 8 * MIN,
  overrode: false,
};

export const DecisionsWorkRun: S = {
  render: () => <DecisionsTab groups={[plan, ship]} byStage evidence={null} />,
};

export const DecisionsReviewRun: S = {
  render: () => (
    <DecisionsTab
      groups={[
        {
          stage: 'review',
          gates: [
            gateOf({
              id: 'g-post',
              kind: 'review-post',
              questions: [reviewQuestion],
              context: FINDINGS_CONTEXT,
              answer: answeredWith(
                {
                  outcome: {
                    value: 'changes',
                    text: 'Two must-fix items before this merges.',
                  },
                },
                'board'
              ),
            }),
          ],
          answered: 1,
          durationMs: 23 * MIN,
          overrode: false,
        },
      ]}
      byStage={false}
      evidence={null}
    />
  ),
};
