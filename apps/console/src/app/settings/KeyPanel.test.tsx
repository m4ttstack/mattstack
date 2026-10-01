import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KeyPanel,
  whereDraws,
  type PanelStore,
  type PanelTab,
} from './KeyPanel';
import classes from './KeyPanel.module.css';
import { PanelToolbar } from './PanelToolbar';
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
afterEach(() => explainGet.mockReset());

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: 'string',
    scopes: ['team', 'user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'What it does.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: '/stores/user.jsonc', value: 'm-user' },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const LAYERS: ExplainRowWire[] = [
  { scope: 'default', file: null, present: true, value: 'm-default' },
  { scope: 'team', file: '/stores/team.jsonc', present: false },
  { scope: 'user', file: '/stores/user.jsonc', present: true, value: 'm-user' },
  { scope: 'machine', file: '/stores/local.jsonc', present: false },
];

function store(over: Partial<PanelStore> = {}): PanelStore {
  return {
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
    prune: vi.fn(async () => null as string | null),
    ...over,
  };
}

function renderPanel(
  d: SettingDefWire,
  rows: ExplainRowWire[],
  opts: {
    s?: PanelStore;
    tab?: PanelTab;
    team?: string;
    repo?: string;
    value?: ReactNode;
    fix?: string | null;
  } = {}
) {
  explainGet.mockResolvedValue(ok({ def: d, rows }));
  const s = opts.s ?? store();
  const onTab = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const panel = (fix: string | null | undefined) => (
    <QueryClientProvider client={client}>
      <SettingsTeamContext.Provider value={opts.team ?? null}>
        <SettingsRepoContext.Provider value={opts.repo ?? null}>
          <KeyPanel
            def={d}
            store={s}
            tab={opts.tab ?? 'where'}
            onTab={onTab}
            value={opts.value ?? <div>value tab</div>}
            fix={fix}
          />
        </SettingsRepoContext.Provider>
      </SettingsTeamContext.Provider>
    </QueryClientProvider>
  );
  const { rerender } = renderWithProviders(panel(opts.fix));
  return { s, onTab, refix: (fix: string | null) => rerender(panel(fix)) };
}

describe('KeyPanel', () => {
  it('shows the tab it is given and reports a switch', async () => {
    const { onTab } = renderPanel(def('board.agent.model'), LAYERS, {
      tab: 'value',
    });
    expect(screen.getByText('value tab')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('radio', { name: "Where it's set" })
    );
    expect(onTab).toHaveBeenCalledWith('where');
  });

  it('puts the Value tab’s editor header on the tab bar', () => {
    renderPanel(def('board.agent.model'), LAYERS, {
      tab: 'value',
      value: (
        <PanelToolbar>
          <span>Editing the user layer</span>
        </PanelToolbar>
      ),
    });
    expect(
      within(screen.getByTestId('panel-toolbar')).getByText(
        'Editing the user layer'
      )
    ).toBeInTheDocument();
  });

  it('shows a string value bare and keeps JSON for anything else', async () => {
    renderPanel(def('board.agent.model'), [
      { scope: 'default', file: null, present: true, value: 'm-default' },
      { scope: 'team', file: '/stores/team.jsonc', present: true, value: '' },
      { scope: 'user', file: '/stores/user.jsonc', present: true, value: 30 },
    ]);
    expect(await screen.findByTestId('layer-value-default')).toHaveTextContent(
      /^m-default$/
    );
    expect(screen.getByTestId('layer-value-team')).toHaveTextContent(/^""$/);
    expect(screen.getByTestId('layer-value-user')).toHaveTextContent(/^30$/);
  });

  it('drops the loading skeleton once the layers arrive, even when there are none', async () => {
    const skeleton = () => document.querySelector('.mantine-Skeleton-root');
    renderPanel(def('board.agent.model'), []);
    expect(skeleton()).not.toBeNull();
    await waitFor(() => expect(explainGet).toHaveBeenCalled());
    await waitFor(() => expect(skeleton()).toBeNull());
  });

  it('marks the winner in effect and mutes what it overrides', async () => {
    renderPanel(def('board.agent.model'), LAYERS);
    expect(
      await screen.findByText('Weakest first. The last layer set wins.')
    ).toBeInTheDocument();
    const user = await screen.findByTestId('layer-user');
    expect(within(user).getByText('in effect')).toBeInTheDocument();
    expect(screen.getByTestId('layer-value-user')).toHaveAttribute(
      'data-role',
      'winner'
    );
    expect(screen.getByTestId('layer-value-default')).toHaveAttribute(
      'data-role',
      'overridden'
    );
  });

  it('a deep-merge key marks every contributing layer merged', async () => {
    const d = def('rt.homeSnapshot', {
      type: 'object',
      merge: 'deep',
      effective: {
        scope: 'machine',
        file: '/stores/local.jsonc',
        value: { enabled: true },
      },
    });
    renderPanel(d, [
      {
        scope: 'default',
        file: null,
        present: true,
        value: { enabled: false },
      },
      { scope: 'team', file: '/stores/team.jsonc', present: false },
      {
        scope: 'user',
        file: '/stores/user.jsonc',
        present: true,
        value: { debounceSec: 5 },
      },
      {
        scope: 'machine',
        file: '/stores/local.jsonc',
        present: true,
        value: { enabled: true },
      },
    ]);
    expect(
      await screen.findByText('Merged key by key. Lists replace whole.')
    ).toBeInTheDocument();
    expect(
      within(await screen.findByTestId('layer-user')).getByText('merged')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('layer-machine')).getByText('merged')
    ).toBeInTheDocument();
    expect(screen.getByTestId('layer-value-machine')).not.toHaveTextContent(
      '{'
    );
  });

  it('captions a deep-merge key before its layers load', () => {
    explainGet.mockReturnValue(new Promise(() => {}));
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <KeyPanel
          def={def('rt.homeSnapshot', { type: 'object', merge: 'deep' })}
          store={store()}
          tab="where"
          onTab={vi.fn()}
          value={null}
        />
      </QueryClientProvider>
    );
    expect(
      screen.getByText('Merged key by key. Lists replace whole.')
    ).toBeInTheDocument();
  });

  it('hides a layer the key does not allow', async () => {
    renderPanel(
      def('board.agent.model', { scopes: ['user', 'machine'] }),
      LAYERS
    );
    await screen.findByTestId('layer-user');
    expect(screen.queryByTestId('layer-team')).toBeNull();
  });

  it('a stray value at a layer the key does not allow says so and offers no actions', async () => {
    const d = def('board.agent.model', { scopes: ['user', 'machine'] });
    renderPanel(d, [
      ...LAYERS.slice(0, 1),
      {
        scope: 'team',
        file: '/stores/team.jsonc',
        present: true,
        value: 'stray',
      },
      ...LAYERS.slice(2),
    ]);
    const team = await screen.findByTestId('layer-team');
    expect(within(team).getByText('not allowed here')).toBeInTheDocument();
    expect(within(team).queryByRole('button', { name: /^remove / })).toBeNull();
  });

  it('offers moves from the value in effect to the other layers the key allows', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    await userEvent.click(
      within(user).getByRole('button', {
        name: 'move board.agent.model from user',
      })
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Move to team' })
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to machine' })
    );
    expect(s.move).toHaveBeenCalledWith('board.agent.model', 'user', 'machine');
    expect(
      within(screen.getByTestId('layer-default')).queryByRole('button', {
        name: /^move /,
      })
    ).toBeNull();
  });

  it('a rejected stored value can be removed but not moved', async () => {
    renderPanel(
      def('board.agent.model', {
        effective: {
          scope: 'user',
          file: '/stores/user.jsonc',
          invalid: 'bad',
        },
      }),
      [LAYERS[0]!, LAYERS[1]!, { ...LAYERS[2]!, invalid: 'bad' }, LAYERS[3]!]
    );
    const user = await screen.findByTestId('layer-user');
    expect(within(user).queryByRole('button', { name: /^move / })).toBeNull();
    expect(
      within(user).getByRole('button', {
        name: 'remove board.agent.model from user',
      })
    ).toBeInTheDocument();
  });

  it('names the team in Remove and Move when the page knows it', async () => {
    renderPanel(
      def('board.agent.model'),
      [
        LAYERS[0]!,
        {
          scope: 'team',
          file: '/stores/team.jsonc',
          present: true,
          value: 'm-team',
        },
        LAYERS[2]!,
        LAYERS[3]!,
      ],
      { team: 'acme' }
    );
    const team = await screen.findByTestId('layer-team');
    await userEvent.hover(
      within(team).getByRole('button', {
        name: 'remove board.agent.model from team',
      })
    );
    expect(
      await screen.findByText('Remove from team (acme)')
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByTestId('layer-user')).getByRole('button', {
        name: 'move board.agent.model from user',
      })
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Move to team (acme)' })
    ).toBeInTheDocument();
  });

  it('labels Remove from a global layer "(all repos)" when a repo is picked', async () => {
    renderPanel(
      def('rt.worktreeCwd', {
        repoScoped: true,
        effective: {
          scope: 'machine',
          file: '/stores/local.jsonc',
          value: '/x',
        },
      }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'machine',
          file: '/stores/local.jsonc',
          present: true,
          value: '/x',
        },
      ],
      { repo: 'gitlab.example.com/acme/app' }
    );
    await userEvent.hover(
      await screen.findByRole('button', {
        name: 'remove rt.worktreeCwd from machine',
      })
    );
    expect(
      await screen.findByText('Remove from machine (all repos)')
    ).toBeInTheDocument();
  });

  it('a value from a repo rung can be removed but not moved', async () => {
    renderPanel(
      def('rt.worktreeCwd', {
        repoScoped: true,
        effective: {
          scope: 'machine.repo',
          file: '/stores/local.jsonc',
          value: '/x',
        },
      }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'machine.repo',
          file: '/stores/local.jsonc',
          present: true,
          value: '/x',
        },
      ],
      { repo: 'gitlab.example.com/acme/app' }
    );
    const rung = await screen.findByTestId('layer-machine.repo');
    expect(within(rung).queryByRole('button', { name: /^move / })).toBeNull();
    expect(
      within(rung).getByRole('button', {
        name: 'remove rt.worktreeCwd from machine · repo',
      })
    ).toBeInTheDocument();
  });

  it('keeps the Move button shown while its menu is open', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = readFileSync(
      'src/app/settings/KeyPanel.module.css',
      'utf8'
    ).replace(
      /\.([a-zA-Z][\w-]*)/g,
      (_, name: string) => `.${(classes as Record<string, string>)[name]}`
    );
    document.head.appendChild(sheet);
    // jsdom's :focus-within misreports after a focus change, so a computed
    // style cannot isolate the open-menu reveal; this asks the module's
    // top-level rules for one that holds without hover or focus.
    const revealedBy = (el: Element) =>
      Array.from(sheet.sheet!.cssRules)
        .filter(
          (r): r is CSSStyleRule =>
            r instanceof CSSStyleRule && r.style.opacity === '1'
        )
        .flatMap(r => r.selectorText.split(','))
        .filter(s => !/:hover|:focus-within/.test(s))
        .some(s => el.matches(s));
    try {
      renderPanel(def('board.agent.model'), LAYERS);
      const user = await screen.findByTestId('layer-user');
      const move = within(user).getByRole('button', {
        name: 'move board.agent.model from user',
      });
      const actions = move.closest<HTMLElement>(`.${classes.actions}`)!;
      expect(revealedBy(actions)).toBe(false);

      await userEvent.click(move);
      await screen.findByRole('menuitem', { name: 'Move to machine' });
      expect(revealedBy(actions)).toBe(true);
    } finally {
      sheet.remove();
    }
  });

  it("shows rt's refusal of a move under the layers", async () => {
    renderPanel(def('board.agent.model'), LAYERS, {
      s: store({ move: vi.fn(async () => 'store is read-only') }),
    });
    const user = await screen.findByTestId('layer-user');
    await userEvent.click(
      within(user).getByRole('button', {
        name: 'move board.agent.model from user',
      })
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to machine' })
    );
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
  });

  it('links each set layer to its file; the registry default has no link', async () => {
    renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    expect(
      within(user).getByRole('link', { name: 'open /stores/user.jsonc' })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('layer-default')).queryByRole('link')
    ).toBeNull();
  });

  it('re-reads the stack after a remove', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'remove board.agent.model from user',
      })
    );
    expect(s.unset).toHaveBeenCalledWith('board.agent.model', 'user');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('a second Fix on an open panel opens that layer’s editor', async () => {
    const { refix } = renderPanel(def('board.agent.model'), LAYERS);
    await screen.findByRole('button', {
      name: 'set board.agent.model at user',
    });
    refix('user');
    expect(
      await screen.findByRole('button', {
        name: 'cancel editing board.agent.model at user',
      })
    ).toBeInTheDocument();
  });
});

describe('whereDraws', () => {
  const REPO = 'gitlab.example.com/acme/app';
  const issue = (scope: string, extra: Record<string, unknown> = {}) => ({
    scope,
    file: '/f',
    kind: 'nonconforming',
    path: [],
    message: 'bad',
    ...extra,
  });
  const diverged = issue('user', {
    kind: 'diverged',
    storeName: 'old.name',
    olderValue: 1,
    currentValue: 2,
  });

  it('draws a global layer’s issue, and a rung’s only for the picked repo', () => {
    const open = { secret: false };
    expect(whereDraws(open, issue('user'), REPO)).toBe(true);
    expect(whereDraws(open, issue('team.repo', { repo: REPO }), REPO)).toBe(
      true
    );
    expect(
      whereDraws(
        open,
        issue('team.repo', { repo: 'gitlab.example.com/x' }),
        REPO
      )
    ).toBe(false);
  });

  it('draws a diverged value as its panel, except for a secret key', () => {
    expect(whereDraws({ secret: false }, diverged, null)).toBe(true);
    expect(whereDraws({ secret: true }, diverged, null)).toBe(false);
  });
});
