import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clickLayerAction } from './layerActions.testutil';

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

const { SettingRow } = await import('./SettingRow');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');

const USER_FILE = '/home/user/settings.user.jsonc';
const RULE = {
  pattern: 'gate/opened/*',
  category: 'gate',
  title: '{label}',
  message: '{question}',
};
const INTERCEPT = {
  command: 'bun',
  matches: [{ cwdGlob: '/home/user/src/*', role: 'dev' }],
};

function def(
  key: string,
  value: unknown,
  over: Partial<SettingDefWire> = {}
): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A JSON key.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: USER_FILE, value },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

function deepDef(
  key: string,
  value: Record<string, unknown>,
  over: Partial<SettingDefWire> = {}
): SettingDefWire {
  return {
    key,
    type: 'object',
    scopes: ['user'],
    merge: 'deep',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A deep map.',
    hasDefault: true,
    defaultValue: {},
    effective: { scope: 'user', file: USER_FILE, value },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
  prune: vi.fn(async () => null as string | null),
});

function stubRows(rows: ExplainRowWire[], d: SettingDefWire | null = null) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: d, rows }),
  }));
}
afterEach(() => vi.unstubAllGlobals());

const editor = () => screen.getByRole('textbox', { name: 'JSON' });
async function openRow(key: string) {
  await userEvent.click(screen.getByRole('button', { name: `open ${key}` }));
  await screen.findByRole('radiogroup', { name: `${key} panel` });
}
const setText = (t: string) =>
  fireEvent.change(editor(), { target: { value: t } });

describe('JSON editor', () => {
  it('a key the forms cannot draw edits as JSON with schema errors inline', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('rt.intercepts', [INTERCEPT])}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.intercepts');
    expect(editor()).toHaveValue(JSON.stringify([INTERCEPT], null, 2));
    expect(screen.queryByRole('radio', { name: 'Form' })).toBeNull();

    setText('[{"command": "bun"');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(/^JSON: /);

    setText('[{"command": "bun"}]');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(
      '[0].matches: required property "matches" is missing'
    );

    const next = [{ ...INTERCEPT, command: 'bunx' }];
    setText(JSON.stringify(next));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.intercepts', 'user', next)
    );
  });

  it('switching between form and JSON keeps the draft', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('rt.notify.eventBridges', [RULE])}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.notify.eventBridges');
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Gate');
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual([
      { ...RULE, title: 'Gate' },
    ]);
    setText(JSON.stringify([{ ...RULE, title: 'Gate 2' }]));
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue('Gate 2');
  });

  it('the form stays out of reach while the JSON does not parse', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('rt.notify.eventBridges', [RULE])}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.notify.eventBridges');
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    setText('[');
    expect(screen.getByRole('radio', { name: 'Form' })).toBeDisabled();
    expect(
      screen.getByText('Fix the JSON to switch back to the form.')
    ).toBeInTheDocument();
  });

  it('a short string list edits as JSON from its Value tab', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', ['RT'], {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT'] },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openRow('board.ticketPrefixes');
    await userEvent.click(screen.getByRole('radio', { name: 'Value' }));
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    setText('["RT", "MAT"]');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', [
        'RT',
        'MAT',
      ])
    );
  });

  it('Form holds while the row closes, and the next opening starts in JSON again', async () => {
    // With no animation frames the collapse never leaves its exit.
    const frames = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 0);
    try {
      stubRows([]);
      renderWithProviders(
        <SettingRow
          def={def(
            'rt.repoIdentityOverrides',
            { 'https://example.dev/a.git': 'a' },
            { type: 'object' }
          )}
          store={store()}
          subhead={null}
          query=""
          defaultOpen={{ tab: 'value', fix: null }}
        />
      );
      expect(editor()).toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
      expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
      await userEvent.click(
        screen.getByRole('button', { name: 'close rt.repoIdentityOverrides' })
      );
      expect(
        screen.queryByRole('textbox', { name: 'JSON', hidden: true })
      ).toBeNull();
      await userEvent.click(
        screen.getByRole('button', { name: 'open rt.repoIdentityOverrides' })
      );
      expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
      expect(editor()).toBeInTheDocument();
    } finally {
      frames.mockRestore();
    }
  });

  it("a string map's JSON toggle comes back from the form to the JSON editor", async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def(
          'rt.repoIdentityOverrides',
          { 'https://example.dev/a.git': 'a' },
          { type: 'object' }
        )}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.repoIdentityOverrides');
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Form' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual({
      'https://example.dev/a.git': 'a',
    });
  });

  it('leaving an edited JSON draft for the form asks first', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def(
          'rt.repoIdentityOverrides',
          { 'https://example.dev/a.git': 'a' },
          { type: 'object' }
        )}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.repoIdentityOverrides');
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    setText('{"https://example.dev/b.git": "b"}');
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(
      await screen.findByText('Discard JSON changes?')
    ).toBeInTheDocument();
    expect(editor()).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull()
    );
    expect(s.set).not.toHaveBeenCalled();
  });

  it("a leaves object opens in JSON on the target layer's own fields, and Form shows every field", async () => {
    const SNAPSHOT_DEFAULTS = {
      enabled: true,
      debounceSec: 20,
      pushDelaySec: 60,
      janitorThresholdHours: 6,
      janitorIntervalMin: 30,
    };
    stubRows([
      { scope: 'default', file: null, present: true, value: SNAPSHOT_DEFAULTS },
      {
        scope: 'machine',
        file: '/m',
        present: true,
        value: { enabled: false },
      },
    ]);
    renderWithProviders(
      <SettingRow
        def={def(
          'rt.homeSnapshot',
          { ...SNAPSHOT_DEFAULTS, enabled: false },
          {
            type: 'object',
            merge: 'deep',
            scopes: ['machine'],
            effective: {
              scope: 'machine',
              file: '/m',
              value: { ...SNAPSHOT_DEFAULTS, enabled: false },
              authored: { enabled: false },
            },
          }
        )}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.homeSnapshot');
    const json = await screen.findByRole('textbox', { name: 'JSON' });
    expect(JSON.parse((json as HTMLTextAreaElement).value)).toEqual({
      enabled: false,
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(await screen.findByText('debounceSec')).toBeInTheDocument();
  });

  it("in JSON mode, a deep map writes only the target layer's own fields", async () => {
    const DEFAULT_FORGE = { 'gitlab.example.com': { provider: 'gitlab' } };
    const USER_FORGE = {
      'github.example.com': { provider: 'github', tokenEnv: 'GH_TOKEN' },
    };
    stubRows([
      { scope: 'default', file: null, present: true, value: DEFAULT_FORGE },
      { scope: 'user', file: USER_FILE, present: true, value: USER_FORGE },
    ]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={deepDef('gitq.forges', { ...DEFAULT_FORGE, ...USER_FORGE })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await openRow('gitq.forges');
    await userEvent.click(await screen.findByRole('radio', { name: 'JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(
      USER_FORGE
    );
    const next = { ...USER_FORGE, 'git.example.org': { provider: 'gitlab' } };
    setText(JSON.stringify(next));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('gitq.forges', 'user', next)
    );
  });

  it('in the explain modal, Escape abandons a layer edit and leaves the modal open', async () => {
    const d = def('rt.notify.eventBridges', [RULE]);
    stubRows(
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value: [RULE] },
      ],
      d
    );
    const onClose = vi.fn();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.notify.eventBridges"
          store={{ defs: [d], loading: false, error: null, ...store() }}
          onClose={onClose}
        />
      </QueryClientProvider>
    );
    await userEvent.click(
      await screen.findByRole('radio', { name: "Where it's set" })
    );
    const layer = await screen.findByTestId('layer-user');
    await clickLayerAction(layer, 'set rt.notify.eventBridges at user');
    await userEvent.click(within(layer).getByRole('radio', { name: 'JSON' }));
    setText('[]');
    await userEvent.type(
      within(layer).getByRole('textbox', { name: 'JSON' }),
      '{Escape}'
    );
    expect(within(layer).queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('structured rows open in JSON', () => {
  const MAP = { 'https://example.dev/a.git': 'a' };
  const mapDef = () => def('rt.repoIdentityOverrides', MAP, { type: 'object' });

  it('a string map opens its Value tab in JSON, with Form one click away', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow def={mapDef()} store={store()} subhead={null} query="" />
    );
    await openRow('rt.repoIdentityOverrides');
    expect(screen.getByRole('radio', { name: 'Value' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(MAP);
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getByDisplayValue('a')).toBeInTheDocument();
  });

  it('an object list opens in JSON, and Form shows its cards', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('rt.notify.eventBridges', [RULE])}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('rt.notify.eventBridges');
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual([RULE]);
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(
      within(screen.getByTestId('item-0')).getByLabelText('title')
    ).toHaveValue(RULE.title);
  });

  it('a short string list opens its Value tab in JSON and keeps its tags in the row', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', ['RT'], {
          scopes: ['team'],
          effective: { scope: 'team', file: '/t', value: ['RT'] },
        })}
        store={store()}
        subhead={null}
        query=""
      />
    );
    await openRow('board.ticketPrefixes');
    expect(screen.getByRole('radio', { name: 'Value' })).toBeChecked();
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(['RT']);
    expect(screen.getAllByRole('button', { name: 'remove RT' })).toHaveLength(
      1
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'remove RT' })).toHaveLength(
      2
    );
  });

  it('Cancel discards the JSON draft and stays in JSON', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow def={mapDef()} store={s} subhead={null} query="" />
    );
    await openRow('rt.repoIdentityOverrides');
    setText('{"https://example.dev/b.git": "b"}');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(MAP);
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(s.set).not.toHaveBeenCalled();
  });

  it('a JSON save stays in JSON', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow def={mapDef()} store={s} subhead={null} query="" />
    );
    await openRow('rt.repoIdentityOverrides');
    setText('{"https://example.dev/b.git": "b"}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.set).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(editor()).toBeInTheDocument();
  });

  it('the explain modal opens a string map’s Value tab in JSON', async () => {
    const d = mapDef();
    stubRows([], d);
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.repoIdentityOverrides"
          store={{ defs: [d], loading: false, error: null, ...store() }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    expect(await screen.findByRole('radio', { name: 'Value' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual(MAP);
    await userEvent.click(screen.getByRole('radio', { name: 'Form' }));
    expect(screen.queryByRole('textbox', { name: 'JSON' })).toBeNull();
  });
});
