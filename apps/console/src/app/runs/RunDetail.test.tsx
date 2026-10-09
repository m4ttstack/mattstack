import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  GateRow,
  RunDetail as RunDetailData,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detailGet = vi.fn();
const inputsGet = vi.fn();
const stageDocGet = vi.fn();
const artifactGet = vi.fn();
const resumePost = vi.fn();
const abandonPost = vi.fn();
const enrichPost = vi.fn();
const settingsGet = vi.fn();
const focusPost = vi.fn();
const gatesGet = vi.fn();
const answerPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            $get: (...args: unknown[]) => detailGet(...args),
            'effective-inputs': {
              $get: (...args: unknown[]) => inputsGet(...args),
            },
            'stage-doc': { $get: (...args: unknown[]) => stageDocGet(...args) },
            artifact: { $get: (...args: unknown[]) => artifactGet(...args) },
            resume: { $post: (...args: unknown[]) => resumePost(...args) },
            abandon: { $post: (...args: unknown[]) => abandonPost(...args) },
          },
        },
        enrich: { $post: (...args: unknown[]) => enrichPost(...args) },
      },
      settings: {
        'linear-workspace': { $get: () => settingsGet('linear-workspace') },
        'default-editor': { $get: () => settingsGet('default-editor') },
      },
      panes: {
        ':id': { focus: { $post: (...args: unknown[]) => focusPost(...args) } },
      },
      gates: {
        $get: (...args: unknown[]) => gatesGet(...args),
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
        },
      },
    },
  },
}));

await import('../icons');
const { RunDetail } = await import('./RunDetail');

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 8, 18, 38);
const at = (minutes: number) => T0 + minutes * MIN;

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const stage = (
  name: string,
  status: string,
  from: number,
  to: number | null,
  attempt = 1
): RunStageRow => ({
  name,
  status,
  attempt,
  started_at: at(from),
  ended_at: to == null ? null : at(to),
  reason: null,
  detail_path: null,
});

const field = (key: string, value: string, minute: number): RunFieldRow => ({
  key,
  value,
  produced_by: 'x',
  at: at(minute),
});

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-412',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: 'implement',
  spawned_by: null,
  started_at: at(0),
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: at(60),
  ticket: 'WEB-412',
  branch: 'web-412-linked-parcels',
  agent: { status: 'working', pane: 'pane-7' },
  ...over,
});

const workRun = (
  over: Partial<RunDetailData & { asOf: number }> = {}
): RunDetailData & { asOf: number } => ({
  run: summary(),
  stages: [
    stage('provision', 'done', 0, 1),
    stage('plan', 'done', 1, 2),
    stage('implement', 'running', 30, null),
  ],
  fields: [
    field('pipeline-stages', 'provision plan implement ship', 0),
    field('ticket', 'WEB-412', 0),
    field('branch', 'web-412-linked-parcels', 0),
    field('worktree', '/Users/acme/worktrees/acme-web/molly', 0),
    field('claude-session', 'session-412', 0),
    field('approach', 'Backend gap-fill', 1.5),
    field(
      'evidence',
      '{"v":1,"before":"/e/before.png","beforeAnnotated":"/e/before-annotated.png"}',
      1.6
    ),
    field('extra.task', '3 of 5', 31),
    field('strategy', 'subagent-driven, 5 tasks', 31),
  ],
  decisions: [],
  schemaAhead: false,
  asOf: at(63),
  ...over,
});

const gate = (over: Partial<GateRow> = {}): GateRow =>
  ({
    id: 'g-approach',
    subject: 'run:run-412',
    kind: 'plan',
    meta: { stage: 'plan' },
    owner: 'human',
    status: 'answered',
    openedAt: at(1.7),
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    questions: [
      {
        id: 'approach',
        label: 'Which approach?',
        options: [{ value: 'gap-fill', label: 'Backend gap-fill' }],
      },
    ],
    answer: {
      answers: { approach: 'gap-fill' },
      by: 'console',
      answeredAt: at(1.8),
    },
    ...over,
  }) as unknown as GateRow;

function render(data: unknown, gates: GateRow[] = []) {
  detailGet.mockResolvedValue(ok(data));
  gatesGet.mockResolvedValue(ok({ gates }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RunDetail repo="remote:acme%2Fweb" runId="run-412" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  settingsGet.mockImplementation(async (which: string) =>
    ok(which === 'linear-workspace' ? { workspace: 'acme' } : { editor: null })
  );
  enrichPost.mockResolvedValue(ok({}));
  inputsGet.mockResolvedValue(
    ok({
      pipeline: 'work',
      workType: 'feature',
      packVersions: [
        {
          pack: 'acme',
          recordedSha: '4c1d9e2b7a',
          currentSha: '4c1d9e2b7a',
          drifted: false,
        },
      ],
      packDirty: false,
      stages: ['provision', 'plan', 'implement'],
      config: [],
    })
  );
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('RunDetail: live work run', () => {
  it('draws the header with its rail, then Now, then the story in run order', async () => {
    render(workRun(), [gate()]);
    const page = await screen.findByTestId('run-page');
    await waitFor(() =>
      expect(within(page).getByTestId('story')).toHaveTextContent(
        'Which approach?'
      )
    );
    const header = within(page).getByTestId('run-header');
    expect(within(header).getByText('WEB-412')).toBeInTheDocument();
    expect(
      [...header.querySelectorAll('[data-stage]')].map(e =>
        e.getAttribute('data-stage')
      )
    ).toEqual(['provision', 'plan', 'implement', 'ship']);
    expect(
      header.querySelector('[data-stage="implement"]')?.textContent
    ).toContain('33m');

    const now = within(page).getByTestId('now-card');
    expect(now).toHaveTextContent('Now · implement');
    expect(now).toHaveTextContent('subagent-driven, 5 tasks');
    expect(now).toHaveTextContent('started 33m ago');

    const story = within(page).getByTestId('story');
    expect(
      [...story.querySelectorAll('[data-stage]')].map(e =>
        e.getAttribute('data-stage')
      )
    ).toEqual(['plan']);
    expect(story).toHaveTextContent('Backend gap-fill');
    expect(story).toHaveTextContent('Which approach?');
    expect(
      now.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('never draws plumbing keys or the evidence field as fields', async () => {
    render(workRun(), [gate()]);
    const page = await screen.findByTestId('run-page');
    const rows = [...page.querySelectorAll('[data-row]')].map(e =>
      e.getAttribute('data-row')
    );
    expect(rows).toEqual(['Strategy', 'Approach']);
    expect(page).not.toHaveTextContent('session-412');
    expect(page).not.toHaveTextContent('3 of 5');
    expect(page).not.toHaveTextContent('"v":1');
    expect(within(page).getByText('EVIDENCE')).toBeInTheDocument();
  });

  it('puts an open gate at the top of the main column instead of the Now card', async () => {
    render(workRun(), [
      gate({
        status: 'open',
        answer: null,
        id: 'g-open',
        openedAt: at(62),
      } as Partial<GateRow>),
    ]);
    const panel = await screen.findByTestId('gate-panel');
    expect(panel).toHaveAttribute('data-gate-id', 'g-open');
    const main = panel.closest('[data-parity="Story"]');
    expect(main?.firstElementChild).toContainElement(panel);
    expect(screen.queryByTestId('now-card')).toBeNull();
    expect(screen.getByTestId('liveness')).toHaveTextContent(
      'waiting on you · 1m'
    );
  });

  it('keeps decisions in the story only, with no side card for them', async () => {
    render(workRun(), [gate()]);
    const page = await screen.findByTestId('run-page');
    await waitFor(() =>
      expect(within(page).getByTestId('story')).toHaveTextContent(
        'Which approach?'
      )
    );
    expect(within(page).queryByText(/^Decisions/)).toBeNull();
    expect(within(page).queryByText('Open log →')).toBeNull();
  });

  it('draws no copy key chips on the page metadata', async () => {
    render(workRun(), [gate()]);
    const page = await screen.findByTestId('run-page');
    await waitFor(() =>
      expect(page.querySelector('[data-fact="Branch"]')).not.toBeNull()
    );
    const keys = [...page.querySelectorAll('kbd')].map(k => k.textContent);
    for (const key of ['t', 'm', 'b', 'w', 'c'])
      expect(keys).not.toContain(key);
  });

  it('copies nothing when a metadata key is pressed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(workRun(), [gate()]);
    const page = await screen.findByTestId('run-page');
    await waitFor(() =>
      expect(page.querySelector('[data-fact="Branch"]')).not.toBeNull()
    );
    await userEvent.keyboard('tbwmc');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('offers Focus pane while an agent holds the pane, and Resume when none does', async () => {
    const user = userEvent.setup();
    render(workRun());
    expect(
      await screen.findByRole('button', { name: 'focus pane' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'more run actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Mark abandoned' })
    ).toBeNull();
  });

  it('resumes a run with a session and no pane from the menu', async () => {
    const user = userEvent.setup();
    resumePost.mockResolvedValue(ok({}));
    render(workRun({ run: summary({ agent: null }) }));
    await screen.findByTestId('run-page');
    expect(screen.queryByRole('button', { name: 'focus pane' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'more run actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Resume' }));
    await waitFor(() => expect(resumePost).toHaveBeenCalled());
  });

  it('offers Mark abandoned only for a stale run', async () => {
    const user = userEvent.setup();
    render(
      workRun({
        run: summary({
          attention: { needs: true, reason: 'stale', evidence: 'no pane' },
        }),
      })
    );
    await screen.findByTestId('run-page');
    await user.click(screen.getByRole('button', { name: 'more run actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Mark abandoned' })
    ).toBeInTheDocument();
  });

  it('says so when marking a run abandoned fails', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(notifications, 'error');
    abandonPost.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'run already ended' }),
    });
    render(
      workRun({
        run: summary({
          attention: { needs: true, reason: 'stale', evidence: 'no pane' },
        }),
      })
    );
    await screen.findByTestId('run-page');
    await user.click(screen.getByRole('button', { name: 'more run actions' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Mark abandoned' })
    );
    await user.type(
      await screen.findByLabelText(/Why is this run dead/),
      'wedged'
    );
    await user.click(screen.getByRole('button', { name: 'Mark abandoned' }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('run already ended')
    );
    error.mockRestore();
  });

  it('opens the inputs drawer from ?inputs', async () => {
    window.history.pushState(null, '', '/runs/x/run-412?inputs');
    render(workRun());
    const drawer = await screen.findByRole('dialog');
    expect(
      await within(drawer).findByTestId('effective-inputs')
    ).toBeInTheDocument();
  });

  it('opens the drawer from View inputs and puts it in the URL', async () => {
    const user = userEvent.setup();
    render(workRun());
    await user.click(await screen.findByText('View inputs →'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(window.location.search).toBe('?inputs');
  });

  it('scrolls to a gate named by #gate-<id>', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, '', '/runs/x/run-412#gate-g-approach');
    render(workRun(), [gate()]);
    await screen.findByTestId('run-page');
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it('opens the folded stage and the decision a ?gate= link names', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, '', '/runs/x/run-412?gate=g-approach');
    render(
      workRun({
        stages: [
          stage('provision', 'done', 0, 1),
          stage('plan', 'done', 1, 2),
          stage('evidence', 'done', 2, 30),
          stage('implement', 'running', 30, null),
        ],
        fields: [
          ...workRun().fields,
          field('case', 'An order with one linked parcel', 3),
        ],
      }),
      [
        gate({
          questions: [
            {
              id: 'approach',
              label: 'Which approach?',
              options: [
                { value: 'gap-fill', label: 'Backend gap-fill' },
                { value: 'stub', label: 'Stub the data' },
              ],
            },
          ],
        } as Partial<GateRow>),
      ]
    );
    const page = await screen.findByTestId('run-page');
    const plan = await waitFor(() => {
      const el = page.querySelector<HTMLElement>(
        '[data-testid="story"] [data-stage="plan"]'
      );
      expect(el).not.toBeNull();
      return el!;
    });
    expect(await within(plan).findByText('Passed on')).toBeInTheDocument();
    expect(within(plan).getByText('Stub the data')).toBeInTheDocument();
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    );
  });

  const openGate = (id: string, minute: number) =>
    gate({
      id,
      status: 'open',
      answer: null,
      openedAt: at(minute),
      questions: [
        {
          id: 'approach',
          label: 'Which approach?',
          options: [
            { value: 'gap-fill', label: 'Backend gap-fill' },
            { value: 'rewrite', label: 'Rewrite the query' },
          ],
        },
      ],
    } as Partial<GateRow>);

  const panelOf = (id: string) =>
    screen
      .getAllByTestId('gate-panel')
      .find(el => el.getAttribute('data-gate-id') === id)!;

  it('leaves focus in the gate a #gate-<id> link names, so 1 picks', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, '', '/runs/x/run-412#gate-g-late');
    render(workRun(), [openGate('g-early', 60), openGate('g-late', 62)]);
    await screen.findAllByTestId('gate-panel');
    await waitFor(() =>
      expect(panelOf('g-late')).toContainElement(
        document.activeElement as HTMLElement
      )
    );
    await userEvent.keyboard('1');
    expect(
      within(panelOf('g-late')).getByRole('radio', { name: /Backend gap-fill/ })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('focuses the first open gate on arrival when no link names one', async () => {
    render(workRun(), [openGate('g-late', 62), openGate('g-early', 60)]);
    await screen.findAllByTestId('gate-panel');
    await waitFor(() =>
      expect(panelOf('g-early')).toContainElement(
        document.activeElement as HTMLElement
      )
    );
  });

  it('skips a shepherd-owned gate when it focuses one on arrival', async () => {
    render(workRun(), [
      { ...openGate('g-herd', 58), owner: 'herd:acme' },
      openGate('g-mine', 61),
    ]);
    await screen.findAllByTestId('gate-panel');
    await waitFor(() =>
      expect(panelOf('g-mine')).toContainElement(
        document.activeElement as HTMLElement
      )
    );
  });

  it('leaves focus in a text field the user is typing in', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    render(workRun(), [openGate('g-open', 62)]);
    await screen.findByTestId('gate-panel');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('RunDetail: one-stage review run', () => {
  const review = () =>
    workRun({
      run: summary({
        id: 'run-412',
        work_type: 'review',
        pipeline: 'review',
        ticket: null,
        branch: 'dedupe-contacts',
        agent: null,
        outcome: {
          status: 'running',
          reviewed: {
            iid: 412,
            url: 'https://gitlab.test/acme/web/-/merge_requests/412',
            posted: null,
          },
        },
      }),
      stages: [stage('review', 'running', 2, null)],
      fields: [
        field('branch', 'dedupe-contacts', 0),
        field('mr', '!412', 1),
        field('findings', '4 (2 must fix, 2 suggestions)', 6),
      ],
      asOf: at(9),
    });
  const post = gate({
    id: 'g-post',
    subject: 'mr:acme/web!412',
    kind: 'review-post',
    meta: null,
    status: 'open',
    answer: null,
    openedAt: at(7),
    origin: { runId: 'run-412' },
    questions: [
      {
        id: 'outcome',
        label: 'What should the review post?',
        options: ['Approve', 'Request changes (Recommended)'],
      },
    ],
  } as Partial<GateRow>);

  it('draws no rail, hands the waiting gate off to the board, and shows one block', async () => {
    render({ ...review(), boardUrl: 'https://board.test/?gate=g-post' }, [
      post,
    ]);
    const page = await screen.findByTestId('run-page');
    expect(page.querySelector('[data-stage="provision"]')).toBeNull();
    expect(
      within(page).getByTestId('run-header').querySelector('[data-part="rail"]')
    ).toBeNull();
    expect(
      within(within(page).getByTestId('run-header')).getByText('!412')
    ).toBeInTheDocument();
    expect(
      await within(page).findByRole('link', { name: /Answer in the board/ })
    ).toHaveAttribute('href', 'https://board.test/?gate=g-post');
    expect(screen.getByTestId('liveness')).toHaveTextContent(
      'waiting in the board · 2m'
    );
    expect(screen.queryByTestId('now-card')).toBeNull();
    const story = within(page).getByTestId('story');
    expect(story.querySelectorAll('[data-stage]')).toHaveLength(1);
    expect(story).toHaveTextContent('4 (2 must fix, 2 suggestions)');
    expect(within(page).getByText('Reviewed MR')).toBeInTheDocument();
  });

  it('says where to answer when no board link is known', async () => {
    render({ ...review(), boardUrl: null }, [post]);
    await screen.findByTestId('run-page');
    expect(await screen.findByText('Answer in the board')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Answer in the board/ })).toBe(
      null
    );
  });
});

describe('RunDetail: finished run', () => {
  const statsOf = (header: HTMLElement) =>
    [...header.querySelectorAll<HTMLElement>('[data-stat]')].map(e => [
      e.dataset.stat,
      e.textContent,
    ]);
  const outcomesOf = (header: HTMLElement) =>
    [...header.querySelectorAll<HTMLElement>('[data-outcome]')].map(
      e => e.textContent
    );
  const tabsOf = (record: HTMLElement) =>
    within(record)
      .getAllByRole('tab')
      .map(t => [t.textContent, t.getAttribute('aria-selected')]);

  const picked = (
    id: string,
    stageName: string,
    opened: number,
    answered: number,
    { rec = true, pick = 'a', owner = 'human' } = {}
  ) =>
    gate({
      id,
      meta: { stage: stageName },
      owner,
      openedAt: at(opened),
      questions: [
        {
          id: 'q',
          label: `Question ${id}?`,
          multi: false,
          options: [
            { value: 'a', label: rec ? 'A (Recommended)' : 'A' },
            { value: 'b', label: 'B' },
          ],
        },
      ],
      answer: { answers: { q: pick }, by: 'console', answeredAt: at(answered) },
    });

  const merged = () =>
    workRun({
      run: summary({
        status: 'done',
        ended_at: at(150),
        agent: null,
        outcome: {
          status: 'done',
          mr: { iid: 405, state: 'merged', url: null, mergedAt: at(152) },
          ci: 'success',
        },
      }),
      stages: [
        stage('provision', 'done', 0, 1),
        stage('plan', 'done', 1, 13),
        stage('evidence', 'done', 14, 58),
        stage('implement', 'done', 58, 100),
        stage('ship', 'done', 100, 150),
      ],
      fields: [
        field('pipeline-stages', 'provision plan evidence implement ship', 0),
        field('ticket', 'WEB-409', 0),
        field('branch', 'web-409-tracking', 0),
        field('approach', 'Backend data', 5),
        field(
          'evidence',
          '{"v":1,"before":"/e/before.png","after":"/e/after.png","afterAnnotated":"/e/after-annotated.png","case":"Rush order","attach":"ship"}',
          40
        ),
        field('strategy', 'subagent-driven', 60),
        field('commits', '5d6e7f8..b3a9c41 (4): a, b', 90),
      ],
      asOf: at(200),
    });
  const mergedGates = [
    picked('g1', 'plan', 7, 7),
    picked('g2', 'plan', 13, 13, { pick: 'b' }),
    picked('g3', 'evidence', 26, 51),
    picked('g4', 'ship', 107, 108, { owner: 'herd:acme' }),
  ];

  it('heads a merged work run with its badges, span and all six stats', async () => {
    render(merged(), mergedGates);
    const record = await screen.findByTestId('run-record');
    const header = within(record).getByTestId('record-header');
    await waitFor(() =>
      expect(outcomesOf(header)).toEqual(['merged !405', 'CI passed'])
    );
    expect(header).toHaveTextContent('· work pipeline · Oct 8,');
    expect(header.querySelector('[data-stage]')).toBeNull();
    await waitFor(() =>
      expect(statsOf(header)).toEqual([
        ['duration', '2h 32mstart to merge'],
        ['decisions', '4decisions'],
        ['took', '3 of 4took the recommendation'],
        ['evidence', '3evidence'],
        ['commits', '4commits'],
        ['waiting', '25mwaiting on you'],
      ])
    );
  });

  it('opens on Decisions, by stage, with the evidence beside them', async () => {
    render(merged(), mergedGates);
    const record = await screen.findByTestId('run-record');
    await waitFor(() =>
      expect(tabsOf(record)).toEqual([
        ['Story', 'false'],
        ['Decisions4', 'true'],
        ['Evidence3', 'false'],
        ['Inputs', 'false'],
      ])
    );
    const nav = within(record).getByRole('navigation', {
      name: 'Decisions by stage',
    });
    expect(
      within(nav)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['plan2', 'evidence1', 'ship1']);
    expect(
      within(nav).getAllByLabelText('an answer went against the recommendation')
    ).toHaveLength(1);
    const log = within(record).getByTestId('decision-log');
    expect(
      [...log.querySelectorAll('[data-gate-id]')].map(e =>
        e.getAttribute('data-gate-id')
      )
    ).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(log.querySelector('[data-stage-group="plan"]')).toHaveTextContent(
      'plan2 decisions · 12m'
    );
    expect(within(record).getByText('CASE USED')).toBeInTheDocument();
    expect(within(record).getByText('attached to !405')).toBeInTheDocument();
  });

  it('draws the story on its tab, with no decisions card beside it', async () => {
    const user = userEvent.setup();
    render(merged(), mergedGates);
    const record = await screen.findByTestId('run-record');
    await user.click(await within(record).findByRole('tab', { name: 'Story' }));
    const story = within(record).getByTestId('story');
    expect(story.querySelector('[data-stage="implement"]')).not.toBeNull();
    expect(within(record).queryByText('Open log →')).toBeNull();
    expect(record.querySelector('[data-parity="Decisions mini"]')).toBeNull();
  });

  it('hides took-the-recommendation when no answer had one', async () => {
    render(
      workRun({
        run: summary({
          status: 'abandoned',
          ended_at: at(152),
          agent: null,
          outcome: { status: 'abandoned' },
        }),
        fields: [
          field('pipeline-stages', 'provision plan implement', 0),
          field('evidence', '/a/before.png http://localhost:4001/notes/1', 2),
          field('commits', '3e4f5a6 7b8c9d0', 40),
        ],
      }),
      [
        picked('a', 'plan', 1.7, 16.7, { rec: false }),
        picked('b', 'implement', 31, 51, { rec: false, pick: 'b' }),
      ]
    );
    const record = await screen.findByTestId('run-record');
    const header = within(record).getByTestId('record-header');
    await waitFor(() => expect(outcomesOf(header)).toEqual(['abandoned']));
    await waitFor(() =>
      expect(statsOf(header)).toEqual([
        ['duration', '2h 32mstart to end'],
        ['decisions', '2decisions'],
        ['evidence', '2 linksevidence'],
        ['commits', '2commits'],
        ['waiting', '35mwaiting on you'],
      ])
    );
    expect(
      within(record).queryByLabelText(
        'an answer went against the recommendation'
      )
    ).toBeNull();
  });

  it('leaves evidence off a review record and says what it posted', async () => {
    render(
      workRun({
        run: summary({
          work_type: 'review',
          pipeline: 'review',
          ticket: null,
          branch: 'dedupe-contacts',
          status: 'done',
          ended_at: at(23),
          agent: null,
          outcome: {
            status: 'done',
            reviewed: {
              iid: 412,
              url: 'https://forge.test/acme/web/-/merge_requests/412',
              posted: 'request changes',
            },
          },
        }),
        stages: [stage('review', 'done', 0, 23)],
        fields: [
          field('branch', 'dedupe-contacts', 0),
          field('mr', '!412', 0.5),
          field('evidence', '{"v":1,"before":"/e/before.png"}', 5),
          field('commits', 'abc1234', 6),
        ],
      }),
      [picked('p', 'review', 15, 21, { rec: false })]
    );
    const record = await screen.findByTestId('run-record');
    const header = within(record).getByTestId('record-header');
    expect(within(header).getByText('!412')).toBeInTheDocument();
    await waitFor(() =>
      expect(outcomesOf(header)).toEqual(['reviewed !412 · Request changes'])
    );
    await waitFor(() =>
      expect(statsOf(header).map(([id]) => id)).toEqual([
        'duration',
        'decisions',
        'waiting',
      ])
    );
    expect(tabsOf(record).map(([name]) => name)).toEqual([
      'Story',
      'Decisions1',
      'Inputs',
    ]);
    expect(
      within(record).queryByRole('navigation', { name: 'Decisions by stage' })
    ).toBeNull();
  });

  it('opens on the Story when nothing was answered', async () => {
    render(
      workRun({
        run: summary({ status: 'done', ended_at: at(90), agent: null }),
      })
    );
    const record = await screen.findByTestId('run-record');
    await waitFor(() =>
      expect(
        within(record).getByRole('tab', { name: 'Story' })
      ).toHaveAttribute('aria-selected', 'true')
    );
    expect(tabsOf(record).map(([name]) => name)).toEqual([
      'Story',
      'Evidence2',
      'Inputs',
    ]);
    expect(
      record.querySelector('[data-parity="Story label"]')
    ).toHaveTextContent(/^Story$/);
    expect(within(record).queryByTestId('now-card')).toBeNull();
    const story = within(record).getByTestId('story');
    const section = story.querySelector('[data-stage="implement"]')!;
    expect(section.querySelector('[aria-label="done"]')).not.toBeNull();
    expect(story.querySelector('[aria-label="running"]')).toBeNull();
  });
});

describe('RunDetail: chrome', () => {
  it('names the run by its ticket in the breadcrumb and shows the command', async () => {
    render(workRun());
    const crumb = await screen.findByTestId('run-crumb');
    await waitFor(() => expect(crumb).toHaveTextContent('WEB-412'));
    expect(
      screen.getByText('rt runs show run-412 --repo web')
    ).toBeInTheDocument();
  });

  it('keeps the breadcrumb and an error when the run fails to load', async () => {
    detailGet.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });
    gatesGet.mockResolvedValue(ok({ gates: [] }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <RunDetail repo="remote:acme%2Fweb" runId="run-412" />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId('run-detail-error')).toBeInTheDocument();
    expect(screen.getByTestId('run-crumb')).toHaveTextContent('run-412');
  });
});
