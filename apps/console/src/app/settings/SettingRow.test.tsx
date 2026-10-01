import type { ReactElement } from 'react';
import { MantineProvider } from '@mattstack/app-kit/core';
import { theme } from '@mattstack/app-kit/design-system';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';
import { SettingsRepoContext, SettingsTeamContext } from './useConsoleSettings';

const explainGet = vi.fn();
vi.stubGlobal('fetch', (url: string) =>
  url.startsWith('/api/settings/explain/')
    ? explainGet(url)
    : Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      })
);
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});
function explains(rows: ExplainRowWire[]) {
  explainGet.mockResolvedValue(ok({ def: null, rows }));
}
beforeEach(() => explains([]));
afterEach(() => explainGet.mockReset());

/** A layer line's file link reads the editor preference through a query. */
function renderRow(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

async function openRow(key: string) {
  await userEvent.click(screen.getByRole('button', { name: `open ${key}` }));
  await screen.findByRole('radiogroup', { name: `${key} panel` });
}

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'What it does. A second sentence nobody needs here.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

function store() {
  return {
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
    prune: vi.fn(async () => null as string | null),
  };
}

describe('SettingRow disclosure', () => {
  const scalar = () =>
    def('board.agent.model', {
      effective: { scope: 'user', file: '/u', value: 'm-1' },
    });

  it('a click anywhere on the row opens it; a second click closes it', async () => {
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" />
    );
    await userEvent.click(screen.getByText('What it does.'));
    expect(
      await screen.findByRole('radio', { name: "Where it's set" })
    ).toBeChecked();
    await userEvent.click(screen.getByText('What it does.'));
    expect(screen.queryByRole('radio', { name: "Where it's set" })).toBeNull();
  });

  it('a click inside the control never toggles the row', async () => {
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('textbox', { name: 'board.agent.model' })
    );
    expect(
      screen.getByRole('button', { name: 'open board.agent.model' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('picking an enum option from its dropdown does not toggle the row', async () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.provider', { effective: { scope: null, file: null } })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    const chevron = screen.getByRole('button', { name: 'open agent.provider' });
    await userEvent.click(
      screen.getByRole('combobox', { name: 'agent.provider' })
    );
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
  });

  it('a click on a portalled dropdown, off its options, does not toggle the row', async () => {
    // The shared harness sets env="test", which renders every portal in
    // place; the page's dropdowns portal out of the row.
    render(
      <MantineProvider theme={theme}>
        <SettingRow
          def={def('agent.provider', {
            effective: { scope: null, file: null },
          })}
          store={store()}
          subhead={null}
          query=""
        />
      </MantineProvider>
    );
    const chevron = screen.getByRole('button', { name: 'open agent.provider' });
    await userEvent.click(
      screen.getByRole('combobox', { name: 'agent.provider' })
    );
    const dropdown = (await screen.findByRole('listbox', { hidden: true }))
      .parentElement!;
    expect(
      document.querySelector('[data-key="agent.provider"]')!.contains(dropdown)
    ).toBe(false);
    await userEvent.click(dropdown);
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
  });

  it('the chevron is the keyboard door', async () => {
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" />
    );
    const chevron = screen.getByRole('button', {
      name: 'open board.agent.model',
    });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    chevron.focus();
    await userEvent.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: 'close board.agent.model' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('a composite row opens on Value and shows its summary as text, not a toggle', async () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: {
              enabled: true,
              debounceSec: 5,
              pushDelaySec: 1,
              janitorThresholdHours: 2,
              janitorIntervalMin: 3,
            },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    await userEvent.click(
      screen.getByRole('button', { name: 'open rt.homeSnapshot' })
    );
    expect(await screen.findByRole('radio', { name: 'Value' })).toBeChecked();
  });

  it('Escape in a field keeps the row open; Escape elsewhere in the panel closes it', async () => {
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'open board.agent.model' })
    );
    await userEvent.click(await screen.findByRole('radio', { name: 'Value' }));
    const inputs = screen.getAllByRole('textbox', {
      name: 'board.agent.model',
    });
    inputs[1]!.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('radio', { name: 'Value' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'close board.agent.model' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('radio', { name: 'Value' })).toBeNull();
  });

  it('a refused write keeps the row open and shows the refusal', async () => {
    const s = { ...store(), set: vi.fn(async () => 'store is read-only') };
    renderWithProviders(
      <SettingRow def={scalar()} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'open board.agent.model' })
    );
    const input = screen.getByRole('textbox', { name: 'board.agent.model' });
    await userEvent.clear(input);
    await userEvent.type(input, 'm-2{Enter}');
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: "Where it's set" })
    ).toBeInTheDocument();
  });

  it('has no actions menu', () => {
    renderWithProviders(
      <SettingRow def={scalar()} store={store()} subhead={null} query="" />
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
  });

  it('a controlled row follows its prop and reports the next state', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SettingRow
        def={scalar()}
        store={store()}
        subhead={null}
        query=""
        open={null}
        onOpenChange={onOpenChange}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'open board.agent.model' })
    );
    expect(onOpenChange).toHaveBeenCalledWith({ tab: 'where', fix: null });
    expect(
      screen.getByRole('button', { name: 'open board.agent.model' })
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SettingRow', () => {
  it('a repo-only key with no repo picked offers no editor, only "set per repo"', () => {
    const d = def('rt.logDir', {
      repoScoped: true,
      repoOnly: true,
      scopes: ['team', 'user', 'machine'],
    });
    renderWithProviders(
      <SettingRow def={d} store={store()} subhead={null} query="" />
    );
    expect(screen.getByText('set per repo')).toBeInTheDocument();
    expect(screen.queryByText('unset')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a repo-only key with a repo picked is edited as usual', () => {
    const d = def('rt.logDir', {
      repoScoped: true,
      repoOnly: true,
      scopes: ['team', 'user', 'machine'],
    });
    renderWithProviders(
      <SettingsRepoContext.Provider value="gitlab.example.com/acme/app">
        <SettingRow def={d} store={store()} subhead={null} query="" />
      </SettingsRepoContext.Provider>
    );
    expect(screen.queryByText('set per repo')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'rt.logDir' })
    ).toBeInTheDocument();
  });

  it('shows the key, the first sentence and the source', () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'high' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('agent.claude.')).toBeInTheDocument();
    expect(screen.getByText('effort')).toBeInTheDocument();
    expect(screen.getByText('What it does.')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('clamps the description to one line', () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort')}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('What it does.')).toHaveAttribute(
      'data-line-clamp'
    );
  });

  it('an unset scalar says so as a placeholder, never a blank box', () => {
    renderWithProviders(
      <>
        <SettingRow
          def={def('rt.daemonPath')}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('board.gateGraceMinutes', { type: 'number' })}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    expect(screen.getByLabelText('rt.daemonPath')).toHaveAttribute(
      'placeholder',
      'unset'
    );
    expect(screen.getByLabelText('board.gateGraceMinutes')).toHaveAttribute(
      'placeholder',
      'unset'
    );
  });

  it('saves a string on blur to the winning layer', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'machine', file: '/m', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    await userEvent.type(input, 'low');
    input.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'agent.claude.effort',
        'machine',
        'low'
      )
    );
    expect(await screen.findByText('saved')).toBeInTheDocument();
  });

  it('clearing a string unsets it instead of writing an empty string', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('agent.claude.effort', 'user')
    );
  });

  it('emptying a value that comes from the default restores it without a write', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('agent.claude.effort')).toHaveValue('high')
    );
    expect(s.unset).not.toHaveBeenCalled();
    expect(s.set).not.toHaveBeenCalled();
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('emptying a number that comes from the default restores it without a write', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.runsPruneDays', {
          type: 'number',
          effective: { scope: 'default', file: null, value: 30 },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('rt.runsPruneDays');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.runsPruneDays')).toHaveValue('30')
    );
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('follows a refreshed effective value and writes nothing on a bare blur', async () => {
    const s = store();
    const { rerender } = renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    rerender(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'default', file: null, value: 'medium' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    expect(input).toHaveValue('medium');
    await userEvent.click(input);
    input.blur();
    await new Promise(r => setTimeout(r, 0));
    expect(s.set).not.toHaveBeenCalled();
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('Enter on a highlighted suggestion saves the suggestion, once', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.agent.model')}
        store={s}
        subhead={null}
        query=""
        suggestions={['sonnet-long', 'opus']}
      />
    );
    const input = screen.getByRole('combobox', {
      name: 'board.agent.model',
    });
    await userEvent.type(input, 'son');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'board.agent.model',
        'user',
        'sonnet-long'
      )
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it("shows rt's refusal verbatim under the row", async () => {
    const s = store();
    s.set.mockResolvedValue('rt: nope');
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort')}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.type(input, 'x');
    input.blur();
    expect(await screen.findByText('rt: nope')).toBeInTheDocument();
  });

  it('an invalid winning layer says so and the next save still targets it', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.yolo', {
          type: 'boolean',
          effective: { scope: 'user', file: '/u', invalid: 'expected boolean' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(
      screen.getByText('stored value rejected: expected boolean')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('agent.claude.yolo'));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.yolo', 'user', true)
    );
  });

  it('toggles a boolean immediately', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.yolo', { type: 'boolean' })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByLabelText('agent.claude.yolo'));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.yolo', 'user', true)
    );
  });

  it('a Switch keeps its node and focus across a save and refresh', async () => {
    const s = store();
    const at = (value: boolean) =>
      def('agent.claude.yolo', {
        type: 'boolean',
        effective: { scope: 'user', file: '/u', value },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at(false)} store={s} subhead={null} query="" />
    );
    const toggle = screen.getByLabelText('agent.claude.yolo');
    await userEvent.click(toggle);
    await waitFor(() => expect(s.set).toHaveBeenCalled());
    rerender(<SettingRow def={at(true)} store={s} subhead={null} query="" />);
    const after = screen.getByLabelText('agent.claude.yolo');
    expect(after).toBe(toggle);
    expect(after).toHaveFocus();
    expect(after).toBeChecked();
  });

  it('offers the ENUMS options as a select', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.logLevel', {
          scopes: ['machine', 'user'],
          effective: { scope: 'default', file: null, value: 'info' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('combobox', { name: 'rt.logLevel' })
    );
    await userEvent.click(await screen.findByRole('option', { name: 'debug' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.logLevel', 'machine', 'debug')
    );
  });

  it('labels the provider options by product name and writes the id', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('agent.provider', {
          effective: { scope: 'default', file: null, value: 'claude' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const select = screen.getByRole('combobox', { name: 'agent.provider' });
    expect(select).toHaveValue('Claude');
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.provider', 'user', 'codex')
    );
  });

  it('hides the badge under a matching subhead and still moves from the open row', async () => {
    const s = store();
    explains([
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: '/u', present: false },
      { scope: 'machine', file: '/m', present: true, value: 'x' },
    ]);
    renderRow(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', value: 'x' },
        })}
        store={s}
        subhead="machine"
        query=""
      />
    );
    expect(screen.queryByText('machine')).toBeNull();
    await openRow('board.agent.model');
    await userEvent.click(
      within(await screen.findByTestId('layer-machine')).getByRole('button', {
        name: 'move board.agent.model from machine',
      })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to user' })
    );
    await waitFor(() =>
      expect(s.move).toHaveBeenCalledWith(
        'board.agent.model',
        'machine',
        'user'
      )
    );
  });

  it('removes a stored value from its layer in the open row', async () => {
    const s = store();
    explains([
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: '/u', present: true, value: false },
      { scope: 'machine', file: '/m', present: false },
    ]);
    renderRow(
      <SettingRow
        def={def('agent.claude.yolo', {
          type: 'boolean',
          effective: { scope: 'user', file: '/u', value: false },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openRow('agent.claude.yolo');
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'remove agent.claude.yolo from user',
      })
    );
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('agent.claude.yolo', 'user')
    );
  });

  it('a stored secret or an unwritable stored row offers no remove', async () => {
    explains([{ scope: 'user', file: '/u', present: true, value: 'x' }]);
    renderRow(
      <>
        <SettingRow
          def={def('chat.apiToken', {
            secret: true,
            writable: false,
            effective: { scope: 'user', file: '/u' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('rt.roles', {
            writable: false,
            effective: { scope: 'user', file: '/u', value: 'x' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    await openRow('chat.apiToken');
    await openRow('rt.roles');
    await waitFor(() =>
      expect(screen.getAllByTestId('layer-user')).toHaveLength(2)
    );
    expect(screen.queryByRole('button', { name: /^remove / })).toBeNull();
  });

  it('the team badge names the machine team when the page knows it', () => {
    renderWithProviders(
      <SettingsTeamContext.Provider value="acme">
        <SettingRow
          def={def('board.title', {
            scopes: ['team'],
            effective: { scope: 'team', file: '/t', value: 'x' },
          })}
          store={store()}
          subhead={null}
          query=""
        />
      </SettingsTeamContext.Provider>
    );
    expect(screen.getByText('team (acme)')).toBeInTheDocument();
  });

  it('a value from the registry default offers no remove', async () => {
    explains([
      { scope: 'default', file: null, present: true, value: 'info' },
      { scope: 'user', file: '/u', present: false },
      { scope: 'machine', file: '/m', present: false },
    ]);
    renderRow(
      <SettingRow
        def={def('rt.logLevel', {
          effective: { scope: 'default', file: null, value: 'info' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.logLevel');
    await screen.findByTestId('layer-default');
    expect(screen.queryByRole('button', { name: /^remove / })).toBeNull();
  });

  it('an unset secret says unset once and shows no mask', () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.linearToken', { secret: true, writable: false })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getAllByText('unset')).toHaveLength(1);
    expect(screen.queryByText('•••')).toBeNull();
  });

  it('an external row summarises and names its owner', () => {
    renderWithProviders(
      <SettingRow
        def={def('board.members', {
          type: 'array',
          scopes: ['team'],
          writable: false,
          effective: { scope: 'team', file: '/t', value: [{}, {}, {}] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('3 members · edited in board')).toBeInTheDocument();
  });
});

describe('with a repo picked', () => {
  const REPO = 'gitlab.example.com/acme/app';
  const inRepo = (ui: ReactElement) =>
    renderRow(
      <SettingsRepoContext.Provider value={REPO}>
        {ui}
      </SettingsRepoContext.Provider>
    );

  it('an edit of a repo-scoped key inherited from a global layer writes a repo override', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team', 'machine'],
          repoScoped: true,
          effective: { scope: 'team', file: '/t', value: 'a' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('rt.worktreeCwd');
    await userEvent.clear(input);
    await userEvent.type(input, 'b');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.worktreeCwd', 'team', 'b', REPO)
    );
  });

  it('emptying a repo-scoped scalar inherited from a global layer resets it instead of writing an empty repo section', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team', 'machine'],
          repoScoped: true,
          effective: { scope: 'team', file: '/t', value: 'a' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('rt.worktreeCwd');
    await userEvent.clear(input);
    await userEvent.tab();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.worktreeCwd')).toHaveValue('a')
    );
    expect(s.unset).not.toHaveBeenCalled();
    expect(s.set).not.toHaveBeenCalled();
  });

  it('a key that is not repo-scoped writes as before, with no repo argument', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    await userEvent.type(input, 'low');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.effort', 'user', 'low')
    );
  });

  it('a value from a repo rung can be removed but not moved', async () => {
    const s = store();
    explains([
      { scope: 'default', file: null, present: false },
      { scope: 'team', file: '/t', present: false },
      { scope: 'team.repo', file: '/t', present: true, value: 'a' },
    ]);
    inRepo(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team', 'machine'],
          repoScoped: true,
          effective: { scope: 'team.repo', file: '/t', value: 'a' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('team · repo')).toBeInTheDocument();
    await openRow('rt.worktreeCwd');
    const rung = await screen.findByTestId('layer-team.repo');
    expect(within(rung).queryByRole('button', { name: /^move / })).toBeNull();
    await userEvent.click(
      within(rung).getByRole('button', {
        name: 'remove rt.worktreeCwd from team · repo',
      })
    );
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.worktreeCwd', 'team', REPO)
    );
  });
});

describe('issues while Where it’s set is open', () => {
  const rowOf = (key: string) =>
    document.querySelector<HTMLElement>(`[data-key="${key}"]`)!;

  it('an issue on a global layer shows once, on its layer; a secret’s diverged issue stays in the row', async () => {
    explainGet.mockImplementation(async (url: string) =>
      ok({
        def: null,
        rows: url.includes('chat.apiToken')
          ? [{ scope: 'user', file: '/u', present: true }]
          : [
              { scope: 'default', file: null, present: false },
              { scope: 'user', file: '/u', present: false },
              {
                scope: 'machine',
                file: '/m',
                present: true,
                invalid: 'not a model',
              },
            ],
      })
    );
    renderRow(
      <>
        <SettingRow
          def={def('board.agent.model', {
            effective: { scope: 'machine', file: '/m', invalid: 'not a model' },
            issues: [
              {
                scope: 'machine',
                file: '/m',
                kind: 'invalid',
                path: [],
                message: 'not a model',
              },
            ],
          })}
          store={store()}
          subhead={null}
          query=""
        />
        <SettingRow
          def={def('chat.apiToken', {
            secret: true,
            writable: false,
            effective: { scope: 'user', file: '/u' },
            issues: [
              {
                scope: 'user',
                file: '/u',
                kind: 'diverged',
                path: [],
                message: 'older store name changed',
                storeName: 'chat.token',
              },
            ],
          })}
          store={store()}
          subhead={null}
          query=""
        />
      </>
    );
    const model = rowOf('board.agent.model');
    const token = rowOf('chat.apiToken');
    expect(within(model).getAllByText(/not a model/)).toHaveLength(1);

    await openRow('board.agent.model');
    const machine = await within(model).findByTestId('layer-machine');
    expect(within(model).getAllByText(/not a model/)).toEqual([
      within(machine).getByText('not a model'),
    ]);

    await openRow('chat.apiToken');
    await within(token).findByTestId('layer-user');
    expect(
      within(token).getByText(
        'user · chat.token differs from the current value'
      )
    ).toBeInTheDocument();
    expect(
      within(token).queryByText(/still holds a different value/)
    ).toBeNull();
  });

  it('a rejected value shows once, on its layer, and returns to the row when it closes', async () => {
    explains([
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: '/u', present: false },
      { scope: 'machine', file: '/m', present: true, invalid: 'not a model' },
    ]);
    renderRow(
      <SettingRow
        def={def('board.agent.model', {
          effective: { scope: 'machine', file: '/m', invalid: 'not a model' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(
      screen.getByText('stored value rejected: not a model')
    ).toBeInTheDocument();

    await openRow('board.agent.model');
    const machine = await screen.findByTestId('layer-machine');
    expect(screen.getAllByText(/not a model/)).toEqual([
      within(machine).getByText('not a model'),
    ]);

    await userEvent.click(
      screen.getByRole('button', { name: 'close board.agent.model' })
    );
    expect(
      screen.getByText('stored value rejected: not a model')
    ).toBeInTheDocument();
  });
});

describe('repo reach', () => {
  it('a repo-scoped row says it edits all repos and how many repos set it', () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team'],
          repoScoped: true,
          repos: [
            { identity: 'gitlab.example.com/acme/app', scopes: ['team'] },
            { identity: 'gitlab.example.com/acme/web', scopes: ['user'] },
          ],
          effective: { scope: 'user', file: '/u', value: 'a' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('all repos · set in 2 repos')).toBeInTheDocument();
  });

  it('a key that is not repo-scoped says nothing about repos', () => {
    renderWithProviders(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByText(/all repos/)).toBeNull();
  });
});
