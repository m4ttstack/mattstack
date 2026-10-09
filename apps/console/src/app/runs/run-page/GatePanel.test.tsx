import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const answerPost = vi.fn();
const focusPost = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      gates: {
        ':id': {
          answer: { $post: (...args: unknown[]) => answerPost(...args) },
          focus: { $post: (...args: unknown[]) => focusPost(...args) },
        },
      },
    },
  },
}));

const { GatePanel, GatePanels } = await import('./GatePanel');
const { gateDraftKey, usePruneGateDrafts } = await import('./useGateDraft');

const MIN = 60_000;
const NOW = 100 * MIN;

function gateRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'run:run-1',
    kind: 'plan',
    context: 'The orders list already loads every order.',
    questions: [
      {
        id: 'approach',
        label: 'Which approach should the plan take?',
        multi: false,
        options: [
          {
            value: 'server',
            label: 'Server-side filter (Recommended)',
            description: 'Add an assignee param to the query',
          },
          { value: 'client', label: 'Client-side filter' },
          { value: 'both', label: 'Both, behind a flag' },
        ],
      },
      {
        id: 'scope',
        label: 'Who should the filter list?',
        multi: false,
        options: ['store', 'team'],
      },
      {
        id: 'delivery',
        label: 'How should it ship?',
        multi: false,
        options: ['one', 'two'],
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
    ...overrides,
  } as GateRow;
}

const ok = () => ({
  ok: true,
  status: 200,
  json: async () => ({ row: gateRow({ status: 'answered' }) }),
});

function renderPanel(gate: GateRow) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <GatePanel gate={gate} stage="plan" now={NOW} />
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

const panel = () => screen.getByTestId('gate-panel');
const options = () => screen.getByRole('radiogroup', { name: /\?$/ });
const radio = (name: RegExp) => within(options()).getByRole('radio', { name });
const step = (name: RegExp) =>
  within(screen.getByTestId('gate-stepper')).getByRole('radio', { name });
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(panel(), { key, ...init });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('GatePanel', () => {
  it('heads a gate that is mine with its stage, answer count and age', () => {
    renderPanel(gateRow());
    expect(
      screen.getByText('The plan stage needs three answers')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Opened 4m ago · the agent waits until you submit')
    ).toBeInTheDocument();
    expect(panel()).toHaveAttribute('data-tone', 'mine');
  });

  it('moves between questions through the step strip', async () => {
    renderPanel(gateRow());
    expect(step(/Approach/)).toBeChecked();
    await userEvent.click(step(/Scope/));
    expect(screen.getByText('Who should the filter list?')).toBeInTheDocument();
    expect(step(/Scope/)).toBeChecked();
  });

  it('marks an answered step that is not current with a check', async () => {
    renderPanel(gateRow());
    press('1');
    await userEvent.click(step(/Scope/));
    const steps = within(screen.getByTestId('gate-stepper'));
    expect(steps.queryByText('1')).not.toBeInTheDocument();
    expect(steps.getByText('2')).toBeInTheDocument();
  });

  it('hides the step strip for a one-question gate', () => {
    renderPanel(gateRow({ questions: [gateRow().questions[0]!] }));
    expect(screen.queryByTestId('gate-stepper')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/ })).toBeInTheDocument();
  });

  it('picks an option with its number key while the panel holds focus', () => {
    renderPanel(gateRow());
    press('2');
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores number keys typed into the note', () => {
    renderPanel(gateRow());
    fireEvent.keyDown(screen.getByRole('textbox', { name: /note/i }), {
      key: '2',
    });
    expect(radio(/Client-side filter/)).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('shows the recommended badge and strips the marker from the label', () => {
    renderPanel(gateRow());
    const server = radio(/Server-side filter/);
    expect(within(server).getByText('Recommended')).toBeInTheDocument();
    expect(within(server).queryByText(/\(Recommended\)/)).toBeNull();
  });

  it('advances with ⌘↵, then submits on the last question', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(gateRow());
    press('1');
    press('Enter', { metaKey: true });
    expect(step(/Scope/)).toBeChecked();
    press('2');
    press('Enter', { metaKey: true });
    press('1');
    press('Enter', { metaKey: true });
    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: {
          answers: { approach: 'server', scope: 'team', delivery: 'one' },
        },
      })
    );
  });

  it('keeps Next shut until the question is answered', async () => {
    renderPanel(gateRow());
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    await userEvent.click(radio(/Client-side filter/));
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('restores a draft after a remount and clears it after a submit', async () => {
    answerPost.mockResolvedValue(ok());
    const gate = gateRow({ questions: [gateRow().questions[0]!] });
    const first = renderPanel(gate);
    await userEvent.click(radio(/Both, behind a flag/));
    await userEvent.type(
      screen.getByRole('textbox', { name: /note/i }),
      'flag it'
    );
    expect(screen.getByText('Draft saved')).toBeInTheDocument();
    first.unmount();

    renderPanel(gate);
    expect(radio(/Both, behind a flag/)).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue(
      'flag it'
    );
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { approach: { value: 'both', note: 'flag it' } } },
      })
    );
    await waitFor(() =>
      expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull()
    );
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderPanel(gateRow());
    await userEvent.click(radio(/Client-side filter/));
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
  });

  it('asks before overriding a shepherd and posts only once confirmed', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(
      gateRow({
        owner: 'herd:acme-web',
        questions: [gateRow().questions[0]!],
      })
    );
    expect(panel()).toHaveAttribute('data-tone', 'herd');
    expect(
      screen.getByText(
        'Opened 4m ago. A shepherd owns this gate; answering here overrides it.'
      )
    ).toBeInTheDocument();
    await userEvent.click(radio(/Client-side filter/));
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(answerPost).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Override and submit' })
    );
    await waitFor(() => expect(answerPost).toHaveBeenCalledTimes(1));
  });

  it('submits a skipped multi-select as an explicit none', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(
      gateRow({
        questions: [
          {
            id: 'flags',
            label: 'Any flags?',
            multi: true,
            options: ['lint', 'types'],
          },
        ],
      })
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await userEvent.click(
      screen.getByRole('button', { name: /Submit · none/ })
    );
    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { flags: [] } },
      })
    );
  });

  it('toggles a multi-select option with its number key', () => {
    renderPanel(
      gateRow({
        questions: [
          {
            id: 'flags',
            label: 'Any flags?',
            multi: true,
            options: ['a', 'b'],
          },
        ],
      })
    );
    press('2');
    expect(screen.getByRole('checkbox', { name: /b/ })).toBeChecked();
    press('2');
    expect(screen.getByRole('checkbox', { name: /b/ })).not.toBeChecked();
  });

  it('keeps both of two multi-select number presses inside one render', () => {
    renderPanel(
      gateRow({
        questions: [
          {
            id: 'flags',
            label: 'Any flags?',
            multi: true,
            options: ['a', 'b'],
          },
        ],
      })
    );
    act(() => {
      press('1');
      press('2');
    });
    expect(screen.getByRole('checkbox', { name: /a/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /b/ })).toBeChecked();
  });

  it('gives key caps 1 to 9 to the first nine options only', () => {
    const many = Array.from({ length: 11 }, (_, i) => `option ${i + 1}`);
    renderPanel(
      gateRow({
        questions: [
          { id: 'many', label: 'Pick one?', multi: false, options: many },
        ],
      })
    );
    expect(
      screen.getAllByTestId('gate-option-key').map(k => k.textContent)
    ).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    for (const name of [/^option 10/, /^option 11/]) {
      expect(
        within(radio(name)).queryByTestId('gate-option-key')
      ).not.toBeInTheDocument();
    }
  });

  it('splits a command out of a description onto its own line', () => {
    const gate = gateRow();
    gate.questions[0] = {
      ...gate.questions[0]!,
      options: [
        {
          value: 'server',
          label: 'Server-side filter',
          description: 'From apps/backend: jest -t orders, red then green.',
        },
        'client',
      ],
    };
    renderPanel(gate);
    const server = radio(/Server-side filter/);
    expect(within(server).getByText('From apps/backend, red then green.'));
    expect(
      within(server).getByText('jest -t orders').closest('code')
    ).not.toBeNull();
  });

  it('keys the lead paragraph and draws a fenced block line by line', () => {
    renderPanel(
      gateRow({
        context: 'Two ways.\n\n```\na.ts:42\nconst x = 1\n```',
      })
    );
    const context = screen.getByTestId('gate-findings');
    expect(context.querySelector('[data-parity="lead"]')).toHaveTextContent(
      'Two ways.'
    );
    const code = context.querySelector('[data-parity="code"]')!;
    expect(
      [...code.children].map(l => [
        l.getAttribute('data-parity'),
        l.textContent,
      ])
    ).toEqual([
      ['path', 'a.ts:42'],
      ['line', 'const x = 1'],
    ]);
  });

  it('draws labelled context points as a label column', () => {
    renderPanel(
      gateRow({
        context:
          'Two ways.\n\n- Server-side: fast on big stores.\n- Risk: big stores.',
      })
    );
    const context = screen.getByTestId('gate-findings');
    expect(within(context).getByText('Server-side')).toBeInTheDocument();
    expect(
      within(context).getByText('fast on big stores.')
    ).toBeInTheDocument();
  });

  it('shows the parked badge and keeps the resume note on the pane button', () => {
    renderPanel(gateRow({ status: 'parked' }));
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open the pane/ })
    ).toHaveAttribute('title', 'parked; resume is board-owned');
  });

  it('shows the active question context over the gate context', async () => {
    const gate = gateRow();
    gate.questions[1] = { ...gate.questions[1]!, context: 'Scope **notes**' };
    renderPanel(gate);
    expect(
      screen.getByText('The orders list already loads every order.')
    ).toBeInTheDocument();
    await userEvent.click(step(/Scope/));
    expect(screen.getByText('notes')).toBeInTheDocument();
  });

  it('drops the context column when there is no context', () => {
    const { container } = renderPanel(gateRow({ context: undefined }));
    expect(screen.queryByText('What the agent found')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-parity="context"]')
    ).not.toBeInTheDocument();
  });
});

describe('GatePanels', () => {
  it('stacks the answerable gates oldest first', () => {
    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <GatePanels
          gates={[
            gateRow({
              id: 'late',
              openedAt: NOW - MIN,
              meta: { stage: 'ship' },
            }),
            gateRow({ id: 'early', openedAt: NOW - 9 * MIN }),
          ]}
          stageOf={g => (g.meta?.stage as string) ?? null}
          now={NOW}
        />
      </QueryClientProvider>
    );
    const ids = screen
      .getAllByTestId('gate-panel')
      .map(el => el.getAttribute('data-gate-id'));
    expect(ids).toEqual(['early', 'late']);
  });
});

describe('GatePanel: answering', () => {
  const mixed = () =>
    gateRow({
      questions: [
        gateRow().questions[0]!,
        { id: 'flags', label: 'Any flags?', multi: true, options: ['a', 'b'] },
        {
          id: 'delivery',
          label: 'How should it ship?',
          multi: false,
          options: ['one', 'two'],
        },
      ],
    });

  it('never posts a multi-select that was jumped over, and returns to it', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(mixed());
    press('1');
    await userEvent.click(step(/Delivery/));
    press('1');
    press('Enter', { metaKey: true });
    expect(answerPost).not.toHaveBeenCalled();
    expect(screen.getByText('Any flags?')).toBeInTheDocument();
    expect(step(/Flags/)).toBeChecked();
  });

  it('posts a multi-select skipped on purpose as none', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(mixed());
    press('1');
    press('Enter', { metaKey: true });
    press('Enter', { metaKey: true });
    press('2');
    press('Enter', { metaKey: true });
    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { approach: 'server', flags: [], delivery: 'two' } },
      })
    );
  });

  it('shows the winning answer on a 409 and refreshes the gates', async () => {
    answerPost.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        row: { answer: { answers: { approach: 'client' }, by: 'other-pane' } },
      }),
    });
    const { queryClient } = renderPanel(
      gateRow({ questions: [gateRow().questions[0]!] })
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    press('1');
    press('Enter', { metaKey: true });
    expect(await screen.findByText(/Answered elsewhere/)).toHaveTextContent(
      'Client-side filter'
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gates'] });
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
  });

  it('keeps the picks and note on a refused submit, and tries again', async () => {
    answerPost.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'the design fixture is read-only' }),
    });
    renderPanel(gateRow({ questions: [gateRow().questions[0]!] }));
    press('2');
    await userEvent.type(
      screen.getByRole('textbox', { name: /note/i }),
      'keep me'
    );
    press('Enter', { metaKey: true });
    expect(
      await screen.findByText(
        "Couldn't submit: the design fixture is read-only. Your picks and note are kept."
      )
    ).toBeInTheDocument();
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue(
      'keep me'
    );
    expect(screen.queryByText(/Answered elsewhere/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalledTimes(2));
    expect(answerPost.mock.calls[1]).toEqual(answerPost.mock.calls[0]);
  });

  it('drops Try again once a pick changes, and Submit posts the new pick', async () => {
    answerPost.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'the design fixture is read-only' }),
    });
    answerPost.mockResolvedValueOnce(ok());
    renderPanel(gateRow({ questions: [gateRow().questions[0]!] }));
    press('2');
    press('Enter', { metaKey: true });
    expect(
      await screen.findByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
    press('3');
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(answerPost).toHaveBeenCalledTimes(2));
    expect(answerPost.mock.calls[1]![0]).toEqual({
      param: { id: 'g1' },
      json: { answers: { approach: 'both' } },
    });
  });

  it('drops Try again once the note changes', async () => {
    answerPost.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'the design fixture is read-only' }),
    });
    renderPanel(gateRow({ questions: [gateRow().questions[0]!] }));
    press('2');
    press('Enter', { metaKey: true });
    await screen.findByRole('button', { name: 'Try again' });
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'x');
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
  });

  it('names the daemon when a failed submit carries no reason', async () => {
    answerPost.mockRejectedValue(new Error('offline'));
    renderPanel(gateRow({ questions: [gateRow().questions[0]!] }));
    press('2');
    press('Enter', { metaKey: true });
    expect(
      await screen.findByText(
        "Couldn't submit: the daemon refused the answer. Your picks and note are kept."
      )
    ).toBeInTheDocument();
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'true');
  });

  it('posts nothing when the override is cancelled', async () => {
    renderPanel(
      gateRow({ owner: 'herd:acme-web', questions: [gateRow().questions[0]!] })
    );
    press('1');
    press('Enter', { metaKey: true });
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(answerPost).not.toHaveBeenCalled();
  });

  it('sends one focus request for a double click', async () => {
    let resolve: (v: unknown) => void = () => {};
    focusPost.mockReturnValue(new Promise(r => (resolve = r)));
    renderPanel(gateRow({ origin: { paneId: 'p1' } } as Partial<GateRow>));
    const button = screen.getByRole('button', { name: /Open the pane/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(focusPost).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: 200, json: async () => ({ focused: true }) });
    await waitFor(() => expect(button).not.toHaveAttribute('data-loading'));
  });
});

describe('usePruneGateDrafts', () => {
  it('drops the drafts of gates that can no longer be answered', () => {
    localStorage.setItem(gateDraftKey('open'), '{}');
    localStorage.setItem(gateDraftKey('done'), '{}');
    renderHook(() =>
      usePruneGateDrafts([
        gateRow({ id: 'open' }),
        gateRow({ id: 'done', status: 'answered' }),
      ])
    );
    expect(localStorage.getItem(gateDraftKey('open'))).toBe('{}');
    expect(localStorage.getItem(gateDraftKey('done'))).toBeNull();
  });
});
