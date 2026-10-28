import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { DecisionQueueModal } from './DecisionQueueModal.tsx';
import { DiffSourceContext, noDiffSource } from './diff-source.ts';
import * as G from './gate-stories.fixtures.ts';
import { boardPeople, PeopleProvider } from './people.ts';

/**
 * The review and respond gates as the board opens them, one story per gate
 * a real run asks, from `gate-stories.fixtures.ts`.
 */
function Stage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{
        background: 'var(--page)',
        color: 'var(--text-1)',
        height: '100vh',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <Stage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
    <Story />
  </Stage>
);

const meta = {
  title: 'Gates/Board',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const REPORT = JSON.stringify({
  findings: [],
  depth:
    'verify. vitest 212/212 green; the two typecheck warnings are generated code, not defects.',
  strengths: [
    {
      lead: 'The TTL and eviction read clearly',
      detail: 'tileCache.ts:29-71, one place for each rule',
    },
    {
      lead: 'Tests are red on main and green here',
      detail: 'tileCache.test.ts:101-117',
    },
  ],
  checks: [
    { tag: 'PASS', text: 'vitest suite (212/212)' },
    { tag: 'PASS', text: 'typecheck' },
    { tag: 'N/A', text: 'visual regression (no UI touched)' },
  ],
  notes: ['The radar layer could move onto this cache in a follow-up.'],
});

// Captured at module scope, before any story stubs it.
const REAL_FETCH = globalThis.fetch;

/** Answers the review sheet's `/review/report.json` for the story's mount
    only, so it never reaches the network from Storybook's iframe. */
function ReviewReport(Story: () => ReactNode) {
  // Installed during render: the sheet fetches in its own mount effect,
  // which runs before an effect here would.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response(REPORT, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    return REAL_FETCH(input as RequestInfo, init);
  }) as typeof fetch;
  useEffect(
    () => () => {
      globalThis.fetch = REAL_FETCH;
    },
    []
  );
  return <Story />;
}

const noop = () => {};

function Face({ entry }: { entry: G.StoryGate }) {
  const people = boardPeople({
    allMembers: [...G.PEOPLE].map(([username, name]) => ({ username, name })),
    mrs: [entry.mr],
  });
  return (
    <PeopleProvider value={people}>
      <DiffSourceContext.Provider value={entry.diffs ?? noDiffSource}>
        <DecisionQueueModal
          gate={entry.gate}
          mr={entry.mr}
          position={2}
          states={['done', 'active', 'todo', 'todo']}
          nextPeek="!831 · keep station pins when the map re-centers"
          onClose={noop}
          onNext={noop}
          onBack={noop}
          onFocusPane={noop}
          onAnswered={noop}
          onContinue={noop}
        />
      </DiffSourceContext.Provider>
    </PeopleProvider>
  );
}

/** Seven drafted findings over two files, three of them with no diff line,
    and the verdict leaning to Comment until the blocking one is fixed. */
export const ReviewFirstRound: Story = {
  name: 'Review: first round',
  decorators: [ReviewReport],
  render: () => <Face entry={G.reviewFirstRound} />,
};

/** Round 2 of the same review: three earlier threads (fixed, a fair
    pushback, not done) and one new finding. */
export const ReviewReReview: Story = {
  name: 'Review: re-review',
  decorators: [ReviewReport],
  render: () => <Face entry={G.reviewReReview} />,
};

/** Five reviewer threads, four to fix and one to answer, with the code
    changes to approve. */
export const RespondPlan: Story = {
  name: 'Respond: plan',
  render: () => <Face entry={G.respondPlan} />,
};

/** The replies after the fixes landed, the last on an Overview thread
    GitLab cannot resolve. */
export const RespondPost: Story = {
  name: 'Respond: post',
  render: () => <Face entry={G.respondPost} />,
};
