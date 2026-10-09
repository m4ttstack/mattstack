import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowSummary } from './CompositeControls';
import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';
import { resetExplainCache } from './useConsoleSettings';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      aria-label="JSON"
      value={value}
      onChange={e => onChange?.(e.currentTarget.value)}
    />
  ),
}));

async function openRow(key: string) {
  await userEvent.click(screen.getByRole('button', { name: `open ${key}` }));
  await screen.findByRole('radiogroup', { name: `${key} panel` });
}

/** Opens a row, whose structured value opens in JSON, and turns to Form. */
async function openForm(key: string) {
  await openRow(key);
  await userEvent.click(await screen.findByRole('radio', { name: 'Form' }));
}

function def(key: string, over: Partial<SettingDefWire>): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A composite.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}
const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null),
  move: vi.fn(async () => null),
  prune: vi.fn(async () => null as string | null),
});

const SNAPSHOT_DEFAULTS = {
  enabled: true,
  debounceSec: 20,
  pushDelaySec: 60,
  janitorThresholdHours: 6,
  janitorIntervalMin: 30,
};

function stubExplain() {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      def: {},
      rows: [
        {
          scope: 'default',
          file: null,
          present: true,
          value: SNAPSHOT_DEFAULTS,
        },
        {
          scope: 'machine',
          file: '/m',
          present: true,
          value: { enabled: false },
        },
      ],
    }),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('composite rows', () => {
  const PREFIXES = def('board.ticketPrefixes', {
    scopes: ['team'],
    effective: { scope: 'team', file: '/t', value: ['RT', 'MAT'] },
  });

  it('a short string list shows its items as tags with a separate add control', () => {
    renderWithProviders(
      <SettingRow def={PREFIXES} store={store()} subhead={null} query="" />
    );
    expect(screen.getByText('RT')).toBeInTheDocument();
    expect(screen.getByText('MAT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'remove RT' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'remove MAT' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('the add control opens a field that appends on Enter', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    const field = screen.getByRole('textbox', { name: 'board.ticketPrefixes' });
    expect(field).toHaveFocus();
    await userEvent.type(field, 'MAT{enter}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('an inline tag keeps its commas', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('boxscore.excludeFilePatterns', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['*.md'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'add to boxscore.excludeFilePatterns',
      })
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'boxscore.excludeFilePatterns' }),
      '*.{{js,ts}{enter}'
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'boxscore.excludeFilePatterns',
        'team',
        ['*.md', '*.{js,ts}']
      )
    );
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('a tag’s x removes just that item', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'remove RT' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'MAT',
      ])
    );
  });

  it('Backspace in an empty add field removes the last tag', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', ['RT'])
    );
  });

  it('Escape closes the add field and writes nothing', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('JIRA{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
    expect(s.set).not.toHaveBeenCalled();
  });

  it('leaving the add field keeps what was typed', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('JIRA');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
        'JIRA',
      ])
    );
  });

  it('after an Escape, the next add still saves on leaving the field', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    const plus = () =>
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' });
    await userEvent.click(plus());
    await userEvent.keyboard('{Escape}');
    await userEvent.click(plus());
    await userEvent.keyboard('JIRA');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
        'JIRA',
      ])
    );
  });

  it('keys in the add field write nothing more while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await userEvent.keyboard('{Backspace}{Enter}');
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  it('removing a tag from the keyboard leaves focus on the add control', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    screen.getByRole('button', { name: 'remove RT' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
      ).toHaveFocus()
    );
  });

  it('tabbing out after a Backspace removal leaves focus where Tab put it', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    );
    await userEvent.keyboard('{Backspace}');
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    await userEvent.tab();
    expect(
      screen.getByRole('button', { name: 'open board.ticketPrefixes' })
    ).toHaveFocus();
  });

  it('a repeated item removes one copy at a time', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT', 'RT', 'MAT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'remove RT' })[1]!
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
  });

  it('inline tags hold still while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow def={PREFIXES} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'remove RT' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'remove MAT' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeDisabled();
  });

  it('list editors hold still while a save is in flight', async () => {
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            value: ['~/a', '~/b', '~/c', '~/d'],
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoRoots');
    await userEvent.click(screen.getByRole('button', { name: 'remove ~/a' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'remove ~/b' })).toBeDisabled();
    expect(screen.getByLabelText('add to rt.repoRoots')).toBeDisabled();
  });

  it('a long string list expands to rows with remove and add', async () => {
    const s = store();
    const value = ['~/a', '~/b', '~/c', '~/d'];
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: { scope: 'machine', file: '/m', value },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoRoots');
    await userEvent.click(screen.getByRole('button', { name: 'remove ~/b' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.repoRoots', 'machine', [
        '~/a',
        '~/c',
        '~/d',
      ])
    );
    await userEvent.type(
      screen.getByLabelText('add to rt.repoRoots'),
      '~/e{enter}'
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenLastCalledWith('rt.repoRoots', 'machine', [
        '~/a',
        '~/b',
        '~/c',
        '~/d',
        '~/e',
      ])
    );
  });

  it('a failed add in a long string list shows the error and keeps the draft', async () => {
    const s = store();
    s.set.mockImplementation(async () => 'the org settings belong to dev1');
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            value: ['~/a', '~/b', '~/c', '~/d'],
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoRoots');
    const add = screen.getByLabelText('add to rt.repoRoots');
    await userEvent.type(add, '~/e{enter}');
    expect(
      await screen.findByText(/the org settings belong to dev1/)
    ).toBeInTheDocument();
    await waitFor(() => expect(add).toBeEnabled());
    expect(add).toHaveValue('~/e');
    expect(s.set).toHaveBeenCalledTimes(1);
  });

  function stubLayers(
    rows: { scope: string; present: boolean; value?: unknown }[]
  ) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: rows.map(r => ({ file: null, ...r })),
      }),
    }));
  }
  const ROOTS = ['~/a', '~/b', '~/c', '~/d'];
  const rootsDef = (scope: string) =>
    def('rt.repoRoots', {
      hasDefault: true,
      defaultValue: [],
      effective: { scope, file: '/m', value: ROOTS },
    });

  it('a long string list whose only authored layer is its own offers Reset to default, which unsets it', async () => {
    stubLayers([
      { scope: 'default', present: true, value: [] },
      { scope: 'machine', present: true, value: ROOTS },
    ]);
    const s = store();
    renderWithProviders(
      <SettingRow def={rootsDef('machine')} store={s} subhead={null} query="" />
    );
    await openForm('rt.repoRoots');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reset to default' })
    );
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine')
    );
  });

  it('no reset when another authored layer sits under the row’s own, since clearing it would not land on the default', async () => {
    stubLayers([
      { scope: 'default', present: true, value: [] },
      { scope: 'team', present: true, value: ['~/a'] },
      { scope: 'machine', present: true, value: ROOTS },
    ]);
    renderWithProviders(
      <SettingRow
        def={rootsDef('machine')}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoRoots');
    await screen.findByRole('radio', { name: 'JSON' });
    await new Promise(r => setTimeout(r, 50));
    expect(
      screen.queryByRole('button', { name: 'Reset to default' })
    ).toBeNull();
  });

  it('a long string list still on its default offers no reset', async () => {
    stubLayers([{ scope: 'default', present: true, value: ROOTS }]);
    renderWithProviders(
      <SettingRow
        def={rootsDef('default')}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoRoots');
    await screen.findByRole('radio', { name: 'JSON' });
    await new Promise(r => setTimeout(r, 50));
    expect(
      screen.queryByRole('button', { name: 'Reset to default' })
    ).toBeNull();
  });

  it('a string map edits a value in place', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoIdentityOverrides', {
          type: 'object',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { 'https://example.dev/a.git': 'a' },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.repoIdentityOverrides');
    const identity = screen.getByLabelText(
      'identity for https://example.dev/a.git'
    );
    await userEvent.clear(identity);
    await userEvent.type(identity, 'apps');
    identity.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith(
        'rt.repoIdentityOverrides',
        'machine',
        { 'https://example.dev/a.git': 'apps' }
      )
    );
  });

  it('a leaves field writes onto the target layer’s own object and shows its source', async () => {
    stubExplain();
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.homeSnapshot');
    expect(await screen.findByText('debounceSec')).toBeInTheDocument();
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    await userEvent.type(debounce, '45');
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'machine', {
        enabled: false,
        debounceSec: 45,
      })
    );
  });

  it('a list of options draws one checkbox each, every box on while unset, and a click writes the explicit list', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: {}, rows: [] }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.turn', {
          type: 'object',
          scopes: ['team', 'user'],
          effective: { scope: null, file: null },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('board.turn');
    const author = await screen.findByRole('group', {
      name: 'board.turn.author',
    });
    const boxes = within(author).getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    for (const box of boxes) expect(box).toBeChecked();
    const conflicts = within(author).getByRole('checkbox', {
      name: 'Merge conflicts',
    });
    await waitFor(() => expect(conflicts).toBeEnabled());
    await userEvent.click(conflicts);
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.turn', 'team', {
        author: [
          'threads',
          'changesRequested',
          'rebase',
          'ciFailing',
          'readyToMerge',
        ],
      })
    );
  });

  it('emptying a number leaf clears that field from the target layer', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { enabled: false, debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false, debounceSec: 45 },
            authored: { enabled: false, debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.homeSnapshot');
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'machine', {
        enabled: false,
      })
    );
  });

  it('emptying a leaf the target layer does not set writes nothing and restores it', async () => {
    stubExplain();
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.homeSnapshot');
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toHaveValue(
        '20'
      )
    );
    expect(s.set).not.toHaveBeenCalled();
    expect(s.unset).not.toHaveBeenCalled();
  });

  it('emptying the last field the target layer sets unsets that layer', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, debounceSec: 45 },
            authored: { debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.homeSnapshot');
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    debounce.blur();
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.homeSnapshot', 'machine')
    );
    expect(s.set).not.toHaveBeenCalled();
  });

  it('a leaves field follows a refreshed value and writes nothing on a bare blur', async () => {
    stubExplain();
    const s = store();
    const at = (debounceSec: number) =>
      def('rt.homeSnapshot', {
        type: 'object',
        merge: 'deep',
        effective: {
          scope: 'machine',
          file: '/m',
          value: { ...SNAPSHOT_DEFAULTS, enabled: false, debounceSec },
          authored: { enabled: false, debounceSec },
        },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at(20)} store={s} subhead={null} query="" />
    );
    await openForm('rt.homeSnapshot');
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeEnabled()
    );
    rerender(<SettingRow def={at(90)} store={s} subhead={null} query="" />);
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    expect(debounce).toHaveValue('90');
    await userEvent.click(debounce);
    debounce.blur();
    await new Promise(r => setTimeout(r, 0));
    expect(s.set).not.toHaveBeenCalled();
  });

  it('after a scope move, leaf fields wait for fresh rows and write onto the new layer', async () => {
    const machineRows = [
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      {
        scope: 'machine',
        file: '/m',
        present: true,
        value: { enabled: false },
      },
      { scope: 'team', file: '/t', present: false },
    ];
    const teamRows = [
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      { scope: 'machine', file: '/m', present: false },
      { scope: 'team', file: '/t', present: true, value: { enabled: false } },
    ];
    let release: () => void = () => {};
    const moved = new Promise<void>(r => (release = r));
    let moving = false;
    vi.stubGlobal('fetch', async () => {
      const rows = moving ? (await moved, teamRows) : machineRows;
      return { ok: true, status: 200, json: async () => ({ def: {}, rows }) };
    });
    const s = store();
    const at = (scope: string) =>
      def('rt.homeSnapshot', {
        type: 'object',
        merge: 'deep',
        scopes: ['machine', 'team'],
        effective: {
          scope,
          file: '/x',
          value: { ...SNAPSHOT_DEFAULTS, enabled: false },
          authored: { enabled: false },
        },
      });
    const { rerender } = renderWithProviders(
      <SettingRow def={at('machine')} store={s} subhead={null} query="" />
    );
    await openForm('rt.homeSnapshot');
    await waitFor(() =>
      expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeEnabled()
    );
    moving = true;
    rerender(<SettingRow def={at('team')} store={s} subhead={null} query="" />);
    expect(screen.getByLabelText('rt.homeSnapshot.debounceSec')).toBeDisabled();
    release();
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    await userEvent.type(debounce, '45');
    debounce.blur();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'team', {
        enabled: false,
        debounceSec: 45,
      })
    );
  });

  it('other leaf fields are disabled while a leaf save is pending', async () => {
    stubExplain();
    const s = store();
    s.set.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: false },
            authored: { enabled: false },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openForm('rt.homeSnapshot');
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.click(screen.getByLabelText('rt.homeSnapshot.enabled'));
    await waitFor(() => expect(s.set).toHaveBeenCalledTimes(1));
    expect(debounce).toBeDisabled();
  });

  it('a leaves row offers no editor until the layer rows arrive', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { enabled: false },
            authored: { enabled: false },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.homeSnapshot');
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Form' })).toBeNull();
    expect(screen.queryByLabelText('rt.homeSnapshot.debounceSec')).toBeNull();
  });

  it('an empty short list says so instead of showing a blank box', () => {
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          effective: { scope: 'default', file: null, value: [] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'add to board.ticketPrefixes' })
    ).toBeInTheDocument();
  });

  it('a deep key locked by a weaker layer clears that layer, not the winner', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          {
            scope: 'default',
            file: null,
            present: true,
            value: SNAPSHOT_DEFAULTS,
          },
          {
            scope: 'user',
            file: '/u',
            present: true,
            value: { enabled: 'yes' },
          },
          {
            scope: 'machine',
            file: '/m',
            present: true,
            value: { debounceSec: 45 },
          },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.homeSnapshot', {
          type: 'object',
          merge: 'deep',
          scopes: ['user', 'machine'],
          effective: {
            scope: 'machine',
            file: '/m',
            value: { ...SNAPSHOT_DEFAULTS, enabled: 'yes', debounceSec: 45 },
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('unexpected shape')).toBeInTheDocument();
    const clear = await screen.findByRole('button', { name: 'Clear' });
    expect(clear.style.getPropertyValue('--button-height')).toBe(
      'var(--button-height-sm)'
    );
    await waitFor(() => expect(clear).toBeEnabled());
    await userEvent.click(clear);
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.homeSnapshot', 'user')
    );
  });

  it('a stored value of the wrong shape locks behind Clear', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: { scope: 'machine', file: '/m', value: [1, 2] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('unexpected shape')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine')
    );
  });

  it('an invalid winning layer on a composite offers Clear, not an editor', async () => {
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            invalid: 'expected array',
          },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(
      screen.getByText('stored value rejected: expected array')
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine')
    );
    expect(s.set).not.toHaveBeenCalled();
  });

  it('an unshaped composite is read-only with a preview and its file', async () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.cron', {
          type: 'object',
          writable: false,
          effective: {
            scope: 'machine',
            file: '/stores/local.jsonc',
            value: { triggers: [] },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.cron');
    expect(screen.getByText('/stores/local.jsonc')).toBeInTheDocument();
    expect(screen.getByText(/"triggers"/)).toBeInTheDocument();
    expect(screen.getByTestId('json-block')).toBeInTheDocument();
  });

  it('an unset read-only composite summarises as unset, as text', () => {
    renderWithProviders(
      <SettingRow
        def={def('rt.runaway', {
          type: 'object',
          writable: false,
          effective: { scope: null, file: null },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.getAllByRole('button', { expanded: false })).toEqual([
      screen.getByRole('button', { name: 'open rt.runaway' }),
    ]);
    expect(screen.getAllByText('unset')).toHaveLength(2);
  });

  it('a shaped key that is not writable gets no editor and no Clear', async () => {
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', {
          scopes: ['team'],
          writable: false,
          effective: { scope: 'team', file: '/t', value: ['RT', 7] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await openRow('board.ticketPrefixes');
    expect(screen.getByText(/"RT"/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('an invalid row offers no JSON editor on its Value tab', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: null, rows: [] }),
    }));
    renderWithProviders(
      <SettingRow
        def={def('rt.repoRoots', {
          effective: {
            scope: 'machine',
            file: '/m',
            invalid: 'expected array',
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.repoRoots');
    await userEvent.click(screen.getByRole('radio', { name: 'Value' }));
    expect(screen.getAllByRole('button', { name: 'Clear' })).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: 'JSON' })).toBeNull();
  });

  it('a short string list’s Value tab opens in JSON, and Form brings its tags back', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: null, rows: [] }),
    }));
    renderWithProviders(
      <SettingRow def={PREFIXES} store={store()} subhead={null} query="" />
    );
    await openRow('board.ticketPrefixes');
    expect(screen.getByRole('radio', { name: 'Value' })).toBeChecked();
    expect(screen.getAllByRole('button', { name: 'remove RT' })).toHaveLength(
      1
    );
    expect(
      JSON.parse(
        (screen.getByRole('textbox', { name: 'JSON' }) as HTMLTextAreaElement)
          .value
      )
    ).toEqual(['RT', 'MAT']);
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'remove RT' })).toHaveLength(
      2
    );
  });
});

describe('the boxscore roles summary', () => {
  afterEach(() => vi.unstubAllGlobals());

  function serveRoster(
    access: 'owner' | 'member' = 'member',
    fixed: Record<string, 'admin' | 'owner'> = {}
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          members: [
            { username: 'ada', name: 'Ada', fixed: fixed.ada ?? null },
            { username: 'bob', name: null, fixed: fixed.bob ?? null },
            { username: 'cy', name: null, fixed: fixed.cy ?? null },
          ],
          access,
        })
      )
    );
  }

  it('counts the roster members on Team view, case-insensitively', async () => {
    serveRoster();
    renderWithProviders(
      <SettingRow
        def={def('boxscore.roles', {
          type: 'object',
          scopes: ['team'],
          effective: {
            scope: 'team',
            file: '/t',
            value: { ADA: 'team', ada: 'team', Bob: 'team', bob: 'self' },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(await screen.findByText('1 of 3 on Team view')).toBeInTheDocument();
  });

  it('counts a member who sees the team by their org role as Team', async () => {
    serveRoster('member', { bob: 'owner' });
    renderWithProviders(
      <SettingRow
        def={def('boxscore.roles', {
          type: 'object',
          scopes: ['team'],
          effective: {
            scope: 'team',
            file: '/t',
            value: { ada: 'team', bob: 'self' },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(await screen.findByText('2 of 3 on Team view')).toBeInTheDocument();
  });

  it('keeps the stored count when no member sees the team by their org role', async () => {
    serveRoster('owner');
    renderWithProviders(
      <SettingRow
        def={def('boxscore.roles', {
          type: 'object',
          scopes: ['team'],
          effective: {
            scope: 'team',
            file: '/t',
            value: { ada: 'team', bob: 'self' },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(await screen.findByText('1 of 3 on Team view')).toBeInTheDocument();
  });

  it('counts nobody on Team view when no roles are set', async () => {
    serveRoster();
    renderWithProviders(
      <SettingRow
        def={def('boxscore.roles', { type: 'object', scopes: ['team'] })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(await screen.findByText('0 of 3 on Team view')).toBeInTheDocument();
  });

  it('leaves every other string map on its own summary', () => {
    serveRoster();
    renderWithProviders(
      <SettingRow
        def={def('rt.repoIdentityOverrides', {
          type: 'object',
          effective: {
            scope: 'machine',
            file: '/m',
            value: { 'https://example.dev/a.git': 'a' },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByText(/on Team view/)).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith('/api/settings/boxscore-roles');
  });
});

describe('rowSummary', () => {
  const MERGED = {
    'gitlab.example.com': { provider: 'gitlab' },
    'github.example.com': { provider: 'github' },
  };
  const AUTHORED = { 'github.example.com': { provider: 'github' } };

  it("counts a deep map's authored layer, not the merged value, when authored is present", () => {
    const d = def('gitq.forges', {
      type: 'object',
      merge: 'deep',
      effective: {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        value: MERGED,
        authored: AUTHORED,
      },
    });
    expect(rowSummary(d)).toBe('1 entry');
  });

  it('falls back to effective.value when a deep map has no authored layer', () => {
    const d = def('gitq.forges', {
      type: 'object',
      merge: 'deep',
      effective: {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        value: MERGED,
      },
    });
    expect(rowSummary(d)).toBe('2 entries');
  });
});

describe('a deep composite editor whose explain read fails', () => {
  it('shows the error instead of a permanent skeleton', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'explain failed: 500' }),
    }));
    renderWithProviders(
      <SettingRow
        def={def('gitq.forges', {
          type: 'object',
          merge: 'deep',
          effective: {
            scope: 'user',
            file: '/home/user/settings.user.jsonc',
            value: { 'gitlab.example.com': { provider: 'gitlab' } },
          },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('gitq.forges');
    expect(await screen.findByText('explain failed: 500')).toBeInTheDocument();
    expect(screen.queryByLabelText('new host')).toBeNull();
  });
});

describe('add keys', () => {
  const PLUGINS = def('claude.plugins', {
    scopes: ['user', 'team', 'org'],
    merge: 'add',
    effective: {
      scope: 'user',
      file: '/u',
      value: ['acme-tools@acme', 'mine@x'],
    },
  });
  const ROWS = [
    { scope: 'default', file: null, present: false },
    { scope: 'org', file: '/o', present: true, value: ['acme-tools@acme'] },
    { scope: 'team', file: '/t', present: false },
    { scope: 'user', file: '/u', present: true, value: ['mine@x'] },
  ];

  function stubRows(rows: unknown[] = ROWS) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: null, rows }),
    }));
  }

  beforeEach(() => resetExplainCache());

  it('a long add list saves only the target layer’s own items, never the org’s', async () => {
    const org = 'acme-tools-plugin@acme';
    const mine = 'my-own-plugin@example';
    stubRows([
      { scope: 'default', file: null, present: false },
      { scope: 'org', file: '/o', present: true, value: [org] },
      { scope: 'team', file: '/t', present: false },
      { scope: 'user', file: '/u', present: true, value: [mine] },
    ]);
    const s = store();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <SettingRow
          def={def('claude.plugins', {
            scopes: ['user', 'team', 'org'],
            merge: 'add',
            effective: { scope: 'user', file: '/u', value: [org, mine] },
          })}
          store={s}
          subhead={null}
          query=""
        />
      </QueryClientProvider>
    );
    await openForm('claude.plugins');
    await userEvent.click(screen.getByRole('radio', { name: 'Value' }));
    const add = await screen.findByLabelText('add to claude.plugins');
    await waitFor(() => expect(add).toBeEnabled());
    expect(screen.getByText(org)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `remove ${org}` })).toBeNull();
    expect(
      screen.getByRole('button', { name: `remove ${mine}` })
    ).toBeInTheDocument();
    await userEvent.type(add, 'next-plugin@example{enter}');
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('claude.plugins', 'user', [
        mine,
        'next-plugin@example',
      ])
    );
    expect((s.set.mock.calls as unknown[][])[0]![2]).not.toContain(org);
  });

  it('an inline add list says why it cannot be edited when its layers fail to load', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'explain failed: 500' }),
    }));
    renderWithProviders(
      <SettingRow def={PLUGINS} store={store()} subhead={null} query="" />
    );
    expect(await screen.findByText('explain failed: 500')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'add to claude.plugins' })
    ).toBeDisabled();
  });

  it('an edit at the user layer saves only that layer’s own items, never the org’s', async () => {
    stubRows();
    const s = store();
    renderWithProviders(
      <SettingRow def={PLUGINS} store={s} subhead={null} query="" />
    );
    const add = screen.getByRole('button', { name: 'add to claude.plugins' });
    await waitFor(() => expect(add).toBeEnabled());
    expect(screen.getByText('acme-tools@acme')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'remove mine@x' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'remove acme-tools@acme' })
    ).toBeNull();
    await userEvent.click(add);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'claude.plugins' }),
      'new@x{enter}'
    );
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('claude.plugins', 'user', [
        'mine@x',
        'new@x',
      ])
    );
    const saved = (s.set.mock.calls as unknown[][])[0]![2];
    expect(saved).not.toContain('acme-tools@acme');
  });

  it('removing the layer’s own item leaves the inherited one out of the write', async () => {
    stubRows();
    const s = store();
    renderWithProviders(
      <SettingRow def={PLUGINS} store={s} subhead={null} query="" />
    );
    const remove = await screen.findByRole('button', { name: 'remove mine@x' });
    await waitFor(() => expect(remove).toBeEnabled());
    await userEvent.click(remove);
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('claude.plugins', 'user', [])
    );
  });

  it('the JSON draft starts from the target layer’s own list', async () => {
    stubRows();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <SettingRow def={PLUGINS} store={store()} subhead={null} query="" />
      </QueryClientProvider>
    );
    await openRow('claude.plugins');
    await userEvent.click(screen.getByRole('radio', { name: 'Value' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'JSON' }));
    const json = await screen.findByRole('textbox', { name: 'JSON' });
    expect(JSON.parse((json as HTMLTextAreaElement).value)).toEqual(['mine@x']);
  });
});
