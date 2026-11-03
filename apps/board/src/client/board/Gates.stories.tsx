import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { ToastHost, useToasts } from '@mattstack/tui-kit';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { ActionResult } from '../api.ts';
import type { ExecutorState } from '../types.ts';
import { DecisionQueueModal } from './DecisionQueueModal.tsx';
import { DiffSourceContext, noDiffSource } from './diff-source.ts';
import * as G from './gate-stories.fixtures.ts';
import { assignMemberLooks } from './invadr-colors.ts';
import {
  FINDING_QUESTION,
  findingQuestionFields,
  runLaunchFlow,
} from './launch-flow.ts';
import { MemberLooksProvider } from './MemberInvadr.tsx';
import { boardPeople, PeopleProvider } from './people.ts';
import type { AskQuestion } from './ReviewGateSheet.tsx';

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

/** The story roster's looks, assigned as the board assigns its own, so no
    two people share a creature or colour. */
const STORY_LOOKS = assignMemberLooks(
  [...G.PEOPLE].map(([username]) => username)
);

/** A story gate, optionally with the reconciler's view of its pane. */
type FaceEntry = G.StoryGate & {
  gate: G.StoryGate['gate'] & { executor?: ExecutorState };
};

function Face({
  entry,
  onAskQuestion,
}: {
  entry: FaceEntry;
  onAskQuestion?: AskQuestion;
}) {
  const people = boardPeople({
    allMembers: [...G.PEOPLE].map(([username, name]) => ({ username, name })),
    mrs: [entry.mr],
  });
  return (
    <MemberLooksProvider value={STORY_LOOKS}>
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
            self="renee"
            onAskQuestion={onAskQuestion}
          />
        </DiffSourceContext.Provider>
      </PeopleProvider>
    </MemberLooksProvider>
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

/** The first round while its diffs are still on the way: each finding's
    code holds its space with the loading placeholder. The fetch never
    settles, so the placeholder stays put. */
export const ReviewCodeLoading: Story = {
  name: 'Review: code loading',
  decorators: [ReviewReport],
  render: () => (
    <Face
      entry={{
        ...G.reviewFirstRound,
        diffs: {
          ...G.reviewFirstRound.diffs!,
          fetchFileDiff: () => new Promise(() => {}),
        },
      }}
    />
  ),
};

/** The review sheet's questions to the review pane, sent through the
    board's own launch flow (`runLaunchFlow` with `FINDING_QUESTION`), so the
    toasts read as they do on the board. `reply` stands in for the route:
    a promise that never settles leaves the question sending. */
function QuestionFace({
  entry,
  reply,
}: {
  entry: FaceEntry;
  reply: () => Promise<ActionResult>;
}) {
  const { toasts, addToast, startToast } = useToasts();
  const ask: AskQuestion = async (mr, gateId, findingId, question) => {
    const result = await runLaunchFlow(
      {
        ...FINDING_QUESTION,
        post: reply,
        setQueued: noop,
        rollback: noop,
        addToast,
        startToast,
        reload: noop,
      },
      mr,
      findingQuestionFields(gateId, findingId, question)
    );
    return Boolean(result?.ok);
  };
  return (
    <>
      <Face entry={entry} onAskQuestion={ask} />
      <ToastHost toasts={toasts} />
    </>
  );
}

const answered =
  (status: number, text = ''): (() => Promise<ActionResult>) =>
  async () => ({
    ok: status === 200,
    status,
    body: status === 200 ? {} : null,
    text,
  });
const pending = () => new Promise<ActionResult>(() => {});

/** The first round with the review pane holding at its gate. */
const live: FaceEntry = G.reviewFirstRound;
/** The same gate with its pane gone, as the reconciler reports it. */
const paneGone: FaceEntry = {
  ...live,
  gate: { ...live.gate, executor: 'gone' },
};
/** The same gate parked after a long wait: the board closed its pane. */
const parked: FaceEntry = {
  ...live,
  gate: { ...live.gate, status: 'parked', executor: 'gone' },
};

const QUESTION =
  'Is a stale tile really worse than none here? The map shows the last good forecast on purpose.';

/** Opens the first finding's question box and types `QUESTION` into it. */
async function openQuestion(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  const [link] = await body.findAllByRole('button', {
    name: /: ask a question$/,
  });
  await userEvent.click(link!);
  const box = await body.findByRole('textbox', { name: /: your question$/ });
  await userEvent.type(box, QUESTION);
  return body;
}

async function sendQuestion(canvasElement: HTMLElement) {
  const body = await openQuestion(canvasElement);
  await userEvent.click(
    body.getByRole('button', { name: 'send to the review pane' })
  );
  return body;
}

/** Every drafted finding, ticked or not, offers "ask a question" at the
    end of its card head. */
export const QuestionAskLink: Story = {
  name: 'Review question: ask link',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={live} reply={answered(200)} />,
};

/** The question box under the first finding's head, with a question in
    it. Cmd/Ctrl+Enter sends it, Escape cancels it. */
export const QuestionBoxOpen: Story = {
  name: 'Review question: box open',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={live} reply={answered(200)} />,
  play: async ({ canvasElement }) => {
    await openQuestion(canvasElement);
  },
};

/** The question on its way: the box holds, the board toasts "asking in
    the review pane", and every other finding's link waits. The route never
    answers here, so it stays sending. */
export const QuestionSending: Story = {
  name: 'Review question: sending',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={live} reply={pending} />,
  play: async ({ canvasElement }) => {
    const body = await sendQuestion(canvasElement);
    await waitFor(() =>
      expect(
        body.getByRole('textbox', { name: /: your question$/ })
      ).toBeDisabled()
    );
  },
};

/** The review pane took the question: the area says so and offers the
    pane. */
export const QuestionAsked: Story = {
  name: 'Review question: asked',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={live} reply={answered(200)} />,
  play: async ({ canvasElement }) => {
    const body = await sendQuestion(canvasElement);
    await body.findByText('asked in the review pane');
  },
};

/** The route refused (409): the toast names its reason, and the box keeps
    the question to try again. */
export const QuestionRefused: Story = {
  name: 'Review question: 409 refused',
  decorators: [ReviewReport],
  render: () => (
    <QuestionFace
      entry={live}
      reply={answered(
        409,
        'the review pane is waiting on a prompt; answer it there first'
      )}
    />
  ),
  play: async ({ canvasElement }) => {
    const body = await sendQuestion(canvasElement);
    await body.findByText(/question failed for !826 \(409\)/);
    await waitFor(() =>
      expect(
        body.getByRole('textbox', { name: /: your question$/ })
      ).toBeEnabled()
    );
  },
};

/** An open gate whose review pane is gone: every link stays, disabled,
    with the reason as its tooltip ("the review pane isn't running; resume
    the review from its row first"). */
export const QuestionPaneGone: Story = {
  name: 'Review question: pane gone',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={paneGone} reply={answered(200)} />,
};

/** A parked gate: its pane was closed on park, but the link stays live,
    since asking resumes the review's session with the question. */
export const QuestionParked: Story = {
  name: 'Review question: parked gate',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={parked} reply={answered(200)} />,
  play: async ({ canvasElement }) => {
    await openQuestion(canvasElement);
  },
};

/** The gate the reviewer re-raised after narrowing f2: its card carries
    the revised strip, with the original behind "show original". */
export const QuestionRevised: Story = {
  name: 'Review question: revised strip',
  decorators: [ReviewReport],
  render: () => <QuestionFace entry={G.reviewRevised} reply={answered(200)} />,
};
