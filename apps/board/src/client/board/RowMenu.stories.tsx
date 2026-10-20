import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, waitFor, within } from 'storybook/test';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview } from '../types.ts';
import type { ActionEnv } from './row-actions.ts';
import { rowStatus } from './row-status.ts';
import { RowMenu } from './RowMenu.tsx';

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
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/RowMenu/Respond',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const env: ActionEnv = {
  local: true,
  slackEnabled: false,
  self: 'pat',
  roster: ['pat', 'john', 'darryl', 'priya'],
  ownerSlackRepos: [],
  allMrs: [],
};

const john = {
  username: 'john',
  name: 'John',
  openThreads: 2,
  openComments: 1,
};
const darryl = {
  username: 'darryl',
  name: 'Darryl',
  openThreads: 3,
  openComments: 0,
};
const priya = {
  username: 'priya',
  name: 'Priya',
  openThreads: 0,
  openComments: 0,
};

const mr = (over: Record<string, unknown> = {}): BoardMRWithReview =>
  ({
    iid: 1418,
    title: 'Port the flows',
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    sourceBranch: 'f-1418',
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 0, given: 0, reviewers: [] },
    reviewerComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 0,
    isDraft: false,
    isStacked: false,
    gates: [],
    ...over,
  }) as never;

const menu = (row: BoardMRWithReview) => (
  <RowMenu
    menu={{ x: 24, y: 24, mr: row }}
    env={env}
    onRun={() => undefined}
    onClose={() => {}}
  />
);

/** One person with feedback open, already answered once: the item names the
    second round. */
export const OnePerson: Story = {
  render: () =>
    menu(mr({ respondTargets: [john], respondRounds: { john: 1 } })),
};

/** Several people: "respond to…" opens a picker with round and open counts. */
export const SeveralPeoplePicker: Story = {
  render: () =>
    menu(
      mr({
        respondTargets: [john, darryl, priya],
        respondRounds: { john: 1, darryl: 0, priya: 1 },
      })
    ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await body.findByRole('menuitem', { name: /respond to…/ })
    );
    await waitFor(() => body.getByText(/nothing open/));
  },
};

/** Nothing open for the one person: the item offers a redo. */
export const NothingOpenRedo: Story = {
  render: () =>
    menu(mr({ respondTargets: [priya], respondRounds: { priya: 1 } })),
};

const running = mr({
  respondTargets: [darryl],
  respondRounds: { darryl: 1 },
  respond: {
    status: 'triaging',
    sessionId: 'resp-2',
    person: 'darryl',
    responseRound: 2,
  },
});

/** A response is running: the menu offers focus and resume, and the lane
    line names the person and round. */
export const RunningFocus: Story = {
  render: () => {
    const { line } = rowStatus(running, Date.now(), new Map(), 'pat');
    return (
      <>
        <p style={{ margin: '0 16px', paddingTop: 520 }}>
          lane line: {line.word}
          {line.detail ? ` · ${line.detail}` : ''}
        </p>
        {menu(running)}
      </>
    );
  },
};

/** A response from before respond took a person: the labels stay unchanged. */
export const LegacyNoPerson: Story = {
  render: () =>
    menu(mr({ respond: { status: 'implementing', sessionId: 'resp-1' } })),
};
