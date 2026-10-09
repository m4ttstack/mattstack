import '../icons';

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
  sameJson,
  shapeOf,
  whereDraws,
  type PanelStore,
  type PanelTab,
} from './KeyPanel';
import classes from './KeyPanel.module.css';
import {
  actionsTrigger,
  clickLayerAction,
  closeLayerActions,
  layerAction,
  openLayerActions,
} from './layerActions.testutil';
import { PanelToolbar } from './PanelToolbar';
import { schemaFields } from './testSchemas';
import {
  prefetchKeyExplain,
  SettingsOrgContext,
  SettingsRepoContext,
  SettingsTeamContext,
} from './useConsoleSettings';

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
    org?: string;
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
  const panel = (
    fix: string | null | undefined,
    repo: string | null = opts.repo ?? null
  ) => (
    <QueryClientProvider client={client}>
      <SettingsOrgContext.Provider value={opts.org ?? null}>
        <SettingsTeamContext.Provider value={opts.team ?? null}>
          <SettingsRepoContext.Provider value={repo}>
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
      </SettingsOrgContext.Provider>
    </QueryClientProvider>
  );
  const { rerender, unmount } = renderWithProviders(panel(opts.fix));
  return {
    s,
    onTab,
    unmount,
    refix: (fix: string | null) => rerender(panel(fix)),
    repick: (repo: string) => rerender(panel(opts.fix, repo)),
  };
}

describe('KeyPanel', () => {
  it('draws a warmed read’s layer lines on the first render, with no placeholder', async () => {
    const d = def('board.agent.model');
    explainGet.mockResolvedValue(ok({ def: d, rows: LAYERS }));
    await prefetchKeyExplain(d, null);
    renderPanel(d, LAYERS);
    expect(screen.getByTestId('layer-user')).toBeInTheDocument();
  });

  it('an older read that lands late never replaces the newer rows a panel seeds from', async () => {
    const d = def('board.agent.model');
    const older = LAYERS;
    const newer = LAYERS.map(r =>
      r.scope === 'user' ? { ...r, value: 'm-newer' } : r
    );
    let land: (v: unknown) => void = () => {};
    explainGet
      .mockImplementationOnce(() => new Promise(r => (land = r)))
      .mockResolvedValue(ok({ def: d, rows: newer }));
    const warming = prefetchKeyExplain(d, null);
    const first = renderPanel(d, newer);
    expect(await screen.findByText('m-newer')).toBeInTheDocument();
    land(ok({ def: d, rows: older }));
    await warming;
    first.unmount();
    renderPanel(d, newer);
    expect(screen.getByTestId('layer-value-user')).toHaveTextContent('m-newer');
  });

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

  it('an add list marks every layer that adds items merged, with its own caption', async () => {
    renderPanel(
      def('claude.plugins', {
        type: 'array',
        scopes: ['user', 'team', 'org'],
        merge: 'add',
        effective: {
          scope: 'team',
          file: '/stores/team.jsonc',
          value: ['acme-tools@acme', 'widgets@acme'],
        },
      }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'org',
          file: '/stores/org.jsonc',
          present: true,
          value: ['acme-tools@acme'],
        },
        {
          scope: 'team',
          file: '/stores/team.jsonc',
          present: true,
          value: ['widgets@acme'],
        },
        { scope: 'user', file: '/stores/user.jsonc', present: false },
      ],
      { team: 'widgets', org: 'acme' }
    );
    expect(
      await screen.findByText('Every layer adds its items.')
    ).toBeInTheDocument();
    expect(
      within(await screen.findByTestId('layer-org')).getByText('merged')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('layer-team')).getByText('merged')
    ).toBeInTheDocument();
    expect(screen.queryByText('in effect')).toBeNull();
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
    await openLayerActions(team);
    expect(screen.queryByRole('menuitem', { name: /^remove / })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^set / })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Move to / })).toBeNull();
  });

  it('offers moves from the value in effect to the other layers the key allows', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    expect(await layerAction(user, 'Move to team')).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Move to machine' })
    );
    expect(s.move).toHaveBeenCalledWith('board.agent.model', 'user', 'machine');
    expect(actionsTrigger(screen.getByTestId('layer-default'))).toBeNull();
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
    expect(
      await layerAction(user, 'remove board.agent.model from user')
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Move to / })).toBeNull();
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
      { team: 'widgets', org: 'acme' }
    );
    const team = await screen.findByTestId('layer-team');
    expect(
      await layerAction(team, 'remove board.agent.model from team')
    ).toHaveTextContent('Remove from team (widgets)');
    await closeLayerActions(team);
    expect(
      await layerAction(
        screen.getByTestId('layer-user'),
        'Move to team (widgets)'
      )
    ).toBeInTheDocument();
  });

  it('names the org and the team as separate layers', async () => {
    renderPanel(
      def('board.agent.model', {
        scopes: ['org', 'team', 'user', 'machine'],
      }),
      [
        LAYERS[0]!,
        { scope: 'org', file: '/stores/org.jsonc', present: false },
        {
          scope: 'team',
          file: '/stores/team.jsonc',
          present: true,
          value: 'm-team',
        },
        LAYERS[2]!,
        LAYERS[3]!,
      ],
      { team: 'widgets', org: 'acme' }
    );
    const org = await screen.findByTestId('layer-org');
    expect(within(org).getByText('org (acme)')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('layer-team')).getByText('team (widgets)')
    ).toBeInTheDocument();
    expect(
      await layerAction(org, 'set board.agent.model at org')
    ).toHaveTextContent('Set at org (acme)');
    await closeLayerActions(org);
    const team = screen.getByTestId('layer-team');
    expect(
      await layerAction(team, 'remove board.agent.model from team')
    ).toHaveTextContent('Remove from team (widgets)');
    await closeLayerActions(team);
    expect(
      await layerAction(screen.getByTestId('layer-user'), 'Move to org (acme)')
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
    expect(
      await layerAction(
        await screen.findByTestId('layer-machine'),
        'remove rt.worktreeCwd from machine'
      )
    ).toHaveTextContent('Remove from machine (all repos)');
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
    expect(
      await layerAction(rung, 'remove rt.worktreeCwd from machine · repo')
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Move to / })).toBeNull();
  });

  it("shows rt's refusal of a move under the layers", async () => {
    renderPanel(def('board.agent.model'), LAYERS, {
      s: store({ move: vi.fn(async () => 'store is read-only') }),
    });
    const user = await screen.findByTestId('layer-user');
    await clickLayerAction(user, 'Move to machine');
    expect(await screen.findByText('store is read-only')).toBeInTheDocument();
  });

  it('links each set layer to its file; the registry default has no link', async () => {
    renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    expect(await layerAction(user, 'open /stores/user.jsonc')).toHaveAttribute(
      'href'
    );
    expect(actionsTrigger(screen.getByTestId('layer-default'))).toBeNull();
  });

  it('re-reads the stack after a remove', async () => {
    const { s } = renderPanel(def('board.agent.model'), LAYERS);
    await clickLayerAction(
      await screen.findByTestId('layer-user'),
      'remove board.agent.model from user'
    );
    expect(s.unset).toHaveBeenCalledWith('board.agent.model', 'user');
    await waitFor(() => expect(explainGet).toHaveBeenCalledTimes(2));
  });

  it('a second Fix on an open panel opens that layer’s editor', async () => {
    const { refix } = renderPanel(def('board.agent.model'), LAYERS);
    const user = await screen.findByTestId('layer-user');
    expect(
      await layerAction(user, 'set board.agent.model at user')
    ).toBeInTheDocument();
    await closeLayerActions(user);
    refix('user');
    expect(
      await layerAction(
        await screen.findByTestId('layer-user'),
        'cancel editing board.agent.model at user'
      )
    ).toBeInTheDocument();
  });

  describe('the Repos list with no repo picked', () => {
    const STOREFRONT = 'gitlab.example.com/acme/storefront';
    const BILLING = 'gitlab.example.com/acme/billing';

    function renderRepos(
      d: SettingDefWire,
      rowsFor: Record<string, ExplainRowWire[]>,
      global: ExplainRowWire[] = [
        { scope: 'default', file: null, present: false },
      ]
    ) {
      explainGet.mockImplementation(async (url: string) => {
        const repo = new URL(url, 'http://x').searchParams.get('repo');
        return ok({
          def: d,
          rows: (repo && rowsFor[repo]) ?? global,
        });
      });
      renderWithProviders(
        <QueryClientProvider client={new QueryClient()}>
          <KeyPanel
            def={d}
            store={store()}
            tab="where"
            onTab={vi.fn()}
            value={null}
          />
        </QueryClientProvider>
      );
    }

    it('draws each repo section’s set rungs as read-only layer lines', async () => {
      const d = def('rt.worktreePool', {
        type: 'object',
        merge: 'deep',
        repoScoped: true,
        repoOnly: true,
        repos: [
          { identity: STOREFRONT, scopes: ['user'] },
          { identity: BILLING, scopes: ['team'] },
        ],
        effective: { scope: null, file: null },
      });
      renderRepos(d, {
        [STOREFRONT]: [
          {
            scope: 'user.repo',
            file: '/stores/user.jsonc',
            present: true,
            value: { onDeck: 2, ready: [{ run: 'bun install' }] },
          },
        ],
        [BILLING]: [
          {
            scope: 'team.repo',
            file: '/stores/team.jsonc',
            present: true,
            value: { onDeck: 1 },
          },
        ],
      });
      const storefront = await screen.findByTestId(`repo-${STOREFRONT}`);
      const value = await within(storefront).findByTestId(
        'layer-value-user.repo'
      );
      expect(value).toHaveTextContent(/^2 fields$/);
      expect(value.closest(`.${classes.line}`)).not.toBeNull();
      expect(within(storefront).getByText('user')).toBeInTheDocument();
      expect(within(storefront).queryByText('· repo')).toBeNull();
      expect(within(storefront).queryByTestId('json-block')).toBeNull();
      expect(within(storefront).queryByRole('link')).toBeNull();
      expect(actionsTrigger(storefront)).toBeNull();
      const billing = screen.getByTestId(`repo-${BILLING}`);
      expect(
        await within(billing).findByTestId('layer-value-team.repo')
      ).toHaveTextContent(/^1 field$/);
      expect(within(billing).getByText('team')).toBeInTheDocument();
      expect(within(billing).queryByText('· repo')).toBeNull();
    });

    it('a warmed repo section draws its line on the first render', async () => {
      const d = def('rt.worktreePool', {
        type: 'object',
        merge: 'deep',
        repoScoped: true,
        repoOnly: true,
        repos: [{ identity: STOREFRONT, scopes: ['user'] }],
        effective: { scope: null, file: null },
      });
      const rowsFor: Record<string, ExplainRowWire[]> = {
        [STOREFRONT]: [
          {
            scope: 'user.repo',
            file: '/stores/user.jsonc',
            present: true,
            value: { onDeck: 2 },
          },
        ],
      };
      explainGet.mockImplementation(async (url: string) => {
        const repo = new URL(url, 'http://x').searchParams.get('repo');
        return ok({
          def: d,
          rows: (repo && rowsFor[repo]) ?? [
            { scope: 'default', file: null, present: false },
          ],
        });
      });
      await prefetchKeyExplain(d, null);
      renderRepos(d, rowsFor);
      expect(
        within(screen.getByTestId(`repo-${STOREFRONT}`)).getByTestId(
          'layer-value-user.repo'
        )
      ).toHaveTextContent(/^1 field$/);
    });

    it('a deep key whose schema is all leaves counts each layer’s own fields', async () => {
      const d = def('rt.gitStatus', {
        type: 'object',
        merge: 'deep',
        repoScoped: true,
        repos: [{ identity: STOREFRONT, scopes: ['user'] }],
        schema: {
          type: 'object',
          properties: {
            sweep: { type: 'boolean' },
            sweepIntervalSec: { type: 'number' },
            fetchIntervalSec: { type: 'number' },
          },
        } as NonNullable<SettingDefWire['schema']>,
        effective: { scope: 'user', file: '/stores/user.jsonc' },
      });
      renderRepos(
        d,
        {
          [STOREFRONT]: [
            {
              scope: 'user.repo',
              file: '/stores/user.jsonc',
              present: true,
              value: { fetchIntervalSec: 120 },
            },
          ],
        },
        [
          { scope: 'default', file: null, present: false },
          {
            scope: 'user',
            file: '/stores/user.jsonc',
            present: true,
            value: { sweep: false },
          },
        ]
      );
      expect(await screen.findByTestId('layer-value-user')).toHaveTextContent(
        /^1 field$/
      );
      const storefront = await screen.findByTestId(`repo-${STOREFRONT}`);
      expect(
        await within(storefront).findByTestId('layer-value-user.repo')
      ).toHaveTextContent(/^1 field$/);
    });

    it('a repo section shows a string value bare', async () => {
      const d = def('rt.worktreeCwd', {
        repoScoped: true,
        repos: [{ identity: STOREFRONT, scopes: ['machine'] }],
        effective: { scope: null, file: null },
      });
      renderRepos(d, {
        [STOREFRONT]: [
          {
            scope: 'machine.repo',
            file: '/stores/local.jsonc',
            present: true,
            value: 'apps/web',
          },
        ],
      });
      const storefront = await screen.findByTestId(`repo-${STOREFRONT}`);
      expect(
        await within(storefront).findByTestId('layer-value-machine.repo')
      ).toHaveTextContent(/^apps\/web$/);
    });
  });

  it('a repo switch drops an open rung editor and writes nothing', async () => {
    const d = def('board.ticketPrefixes', {
      type: 'array',
      repoScoped: true,
      effective: { scope: 'user.repo', file: '/stores/user.jsonc', value: [] },
    });
    const rows = (value: string[]): ExplainRowWire[] => [
      { scope: 'default', file: null, present: false },
      { scope: 'user', file: '/stores/user.jsonc', present: false },
      { scope: 'user.repo', file: '/stores/user.jsonc', present: true, value },
    ];
    const { s, repick } = renderPanel(d, rows(['A']), {
      repo: 'gitlab.example.com/acme/a',
    });
    await clickLayerAction(
      await screen.findByTestId('layer-user.repo'),
      'set board.ticketPrefixes at user · repo'
    );
    expect(
      screen.getByText('Saves to user · repo')
    ).toBeInTheDocument();

    let loaded: (body: unknown) => void = () => {};
    explainGet.mockReturnValue(
      new Promise(resolve => {
        loaded = resolve;
      })
    );
    repick('gitlab.example.com/acme/b');
    expect(screen.queryByText('Saves to user · repo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    loaded(ok({ def: d, rows: rows(['B']) }));
    expect(
      await screen.findByRole('button', {
        name: 'actions for board.ticketPrefixes at user · repo',
      })
    ).toBeEnabled();
    expect(screen.queryByText('Saves to user · repo')).toBeNull();
    expect(s.set).not.toHaveBeenCalled();
  });
});

describe('a composite layer value', () => {
  const pool = (merge: SettingDefWire['merge'], value: unknown) =>
    def('rt.homeSnapshot', {
      type: 'object',
      merge,
      effective: { scope: 'user', file: '/stores/user.jsonc', value },
    });

  it('opens the Value tab from the layer in effect', async () => {
    const { onTab } = renderPanel(pool('replace', { enabled: true }), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'team',
        file: '/stores/team.jsonc',
        present: true,
        value: { enabled: false, debounceSec: 5 },
      },
      {
        scope: 'user',
        file: '/stores/user.jsonc',
        present: true,
        value: { enabled: true },
      },
    ]);
    const value = await screen.findByTestId('layer-value-user');
    expect(value).toHaveTextContent(/^1 field$/);
    await userEvent.click(value);
    expect(onTab).toHaveBeenCalledWith('value');
  });

  it('shows an overridden layer’s own JSON in a popover', async () => {
    const { onTab } = renderPanel(pool('replace', { enabled: true }), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'team',
        file: '/stores/team.jsonc',
        present: true,
        value: { enabled: false, debounceSec: 5 },
      },
      {
        scope: 'user',
        file: '/stores/user.jsonc',
        present: true,
        value: { enabled: true },
      },
    ]);
    const value = await screen.findByTestId('layer-value-team');
    expect(value).toHaveTextContent(/^2 fields$/);
    await userEvent.click(value);
    const editor = await screen.findByTestId('codemirror-editor');
    await waitFor(() =>
      expect(editor.textContent).toContain('"debounceSec": 5')
    );
    expect(onTab).not.toHaveBeenCalled();
  });

  it('opens the Value tab from the only part of a merge', async () => {
    const { onTab } = renderPanel(
      pool('deep', { debounceSec: 5, enabled: true }),
      [
        { scope: 'default', file: null, present: false },
        { scope: 'team', file: '/stores/team.jsonc', present: false },
        {
          scope: 'user',
          file: '/stores/user.jsonc',
          present: true,
          value: { enabled: true, debounceSec: 5 },
        },
      ]
    );
    await userEvent.click(await screen.findByTestId('layer-value-user'));
    expect(onTab).toHaveBeenCalledWith('value');
  });

  it('shows one part of a wider merge in a popover', async () => {
    const { onTab } = renderPanel(
      pool('deep', { enabled: true, debounceSec: 5 }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'team',
          file: '/stores/team.jsonc',
          present: true,
          value: { debounceSec: 5 },
        },
        {
          scope: 'user',
          file: '/stores/user.jsonc',
          present: true,
          value: { enabled: true },
        },
      ]
    );
    await userEvent.click(await screen.findByTestId('layer-value-user'));
    const editor = await screen.findByTestId('codemirror-editor');
    await waitFor(() =>
      expect(editor.textContent).toContain('"enabled": true')
    );
    expect(onTab).not.toHaveBeenCalled();
  });
});

describe('shapeOf', () => {
  it('counts an array’s items', () => {
    expect(shapeOf([])).toBe('0 items');
    expect(shapeOf(['a'])).toBe('1 item');
    expect(shapeOf(['a', { b: 1 }, 3])).toBe('3 items');
  });

  it('counts an object’s top-level fields', () => {
    expect(shapeOf({})).toBe('0 fields');
    expect(shapeOf({ a: 1 })).toBe('1 field');
    expect(shapeOf({ a: 1, b: { c: 2, d: 3 } })).toBe('2 fields');
  });

  it('shows anything else as its scalar text', () => {
    expect(shapeOf(30)).toBe('30');
    expect(shapeOf(true)).toBe('true');
  });
});

describe('sameJson', () => {
  it('ignores object key order', () => {
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('keeps array order', () => {
    expect(sameJson([1, 2], [1, 2])).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson([1], [1, 1])).toBe(false);
  });

  it('compares nested values', () => {
    expect(sameJson({ a: [{ x: 1, y: [2] }] }, { a: [{ y: [2], x: 1 }] })).toBe(
      true
    );
    expect(sameJson({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('tells null, primitives, arrays and objects apart', () => {
    expect(sameJson(null, null)).toBe(true);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson({}, null)).toBe(false);
    expect(sameJson(1, '1')).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson({}, [])).toBe(false);
    expect(sameJson(undefined, null)).toBe(false);
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
