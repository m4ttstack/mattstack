import '../../icons';

import type { GateRow } from '@mattstack/rt-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GatePanel, GatePanels } from './GatePanel';

/** The gate panel in the states the run-gate and run-two-gates boards draw,
    plus the edges they do not. Answering posts to `/api`, which answers only
    with the design fixture server behind it. */
const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 8, 21, 21);
const queryClient = new QueryClient();

const CONTEXT = [
  'The orders list already loads every order for the store, then pages it in the browser.',
  '',
  '- Server-side: add an assignee param to the orders query.',
  '- Client-side: filter the loaded page. No backend change.',
  '',
  '```',
  'apps/orders/src/list/useOrders.ts:42',
  '```',
].join('\n');

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g-plan',
    subject: 'run:20261008-1340',
    kind: 'plan',
    context: CONTEXT,
    questions: [
      {
        id: 'approach',
        label: 'Which approach should the plan take?',
        multi: false,
        options: [
          {
            value: 'Server-side filter',
            label: 'Server-side filter (Recommended)',
            description: 'Add an assignee param to the query',
          },
          {
            value: 'Client-side filter',
            label: 'Client-side filter',
            description: 'Filter the loaded page only',
          },
        ],
      },
      {
        id: 'scope',
        label: 'Who should the filter list?',
        multi: false,
        options: ['Anyone in the store', 'My team only'],
      },
    ],
    meta: { stage: 'plan' },
    status: 'open',
    answer: null,
    openedAt: NOW - 4 * MIN,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: 'human',
    escalatedAt: null,
    consumedAt: null,
    ...over,
  }) as GateRow;

const HERD = gate({
  id: 'g-ship',
  kind: 'ship',
  meta: { stage: 'ship' },
  owner: 'herd:acme-web-1008',
  openedAt: NOW - 9 * MIN,
  context: 'Self-review passed with two minor notes. CI is green.',
  questions: [
    {
      id: 'ship',
      label: 'Ship as draft or ready?',
      multi: false,
      options: ['Ready for review (Recommended)', 'Draft', 'Hold'],
    },
  ],
});

const meta = {
  title: 'Runs/Run page/Gate panel',
  component: GatePanel,
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 1304 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
  args: { gate: gate({}), stage: 'plan', now: NOW },
} satisfies Meta<typeof GatePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mine: Story = {};

export const HerdOwned: Story = { args: { gate: HERD, stage: 'ship' } };

export const Parked: Story = {
  args: { gate: gate({ status: 'parked' }) },
};

export const SkippableMultiSelect: Story = {
  args: {
    gate: gate({
      questions: [
        {
          id: 'flags',
          label: 'Which findings should the fix cover?',
          multi: true,
          options: ['Lint', 'Types', 'Copy'],
        },
      ],
    }),
  },
};

export const ElevenOptions: Story = {
  args: {
    gate: gate({
      context: undefined,
      questions: [
        {
          id: 'pick',
          label: 'Which ticket comes next?',
          multi: false,
          options: Array.from({ length: 11 }, (_, i) => `WEB-4${10 + i}`),
        },
      ],
    }),
  },
};

export const TwoGatesStacked: Story = {
  render: () => (
    <GatePanels
      gates={[gate({}), HERD]}
      stageOf={g => (typeof g.meta?.stage === 'string' ? g.meta.stage : null)}
      now={NOW}
    />
  ),
};
