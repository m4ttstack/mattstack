import '../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();
const anatomyGet = vi.fn();
const changesGet = vi.fn();
const surfaceGet = vi.fn();
const defaultEditorGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: (...args: unknown[]) => packsGet(...args) },
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        changes: { $get: (...args: unknown[]) => changesGet(...args) },
        surface: {
          $get: (...args: unknown[]) => surfaceGet(...args),
          apply: { $post: vi.fn() },
        },
      },
      settings: {
        'default-editor': {
          $get: (...args: unknown[]) => defaultEditorGet(...args),
        },
      },
    },
  },
}));

const { WiringMap } = await import('./WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'work',
      engine: 'work',
      engineRef: 'mattstack:work',
      plugin: 'mattstack',
      description: 'the orchestrator',
      public: true,
      sourcePath: '/plugins/mattstack/attachments/pipeline/work/SKILL.md',
      artifactPath: '/p/skills/work',
      props: {
        work: [
          {
            name: 'tiering',
            merge: 'replace' as const,
            contract: 'model-tiering@1',
            required: false,
            default: '',
            values: [
              {
                boundTo: 'mattstack:model-tiering',
                layer: 'pack',
                fillSourcePath: '/fills/model-tiering/SKILL.md',
                fillVersion: '0.8.0',
                registered: false,
                inlined: true,
              },
            ],
          },
        ],
      },
      includes: [],
    },
    {
      name: 'watch-ci',
      engine: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      plugin: 'mattstack',
      description: 'watch ci',
      public: true,
      sourcePath: '/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md',
      artifactPath: '/p/skills/watch-ci',
      props: {
        'watch-ci': [
          {
            name: 'domain',
            merge: 'replace' as const,
            contract: 'watch-ci-domain@1',
            required: false,
            default: '',
            values: [
              {
                boundTo: 'demo:watch-ci-domain',
                layer: 'pack',
                fillSourcePath: '/fills/watch-ci-domain/SKILL.md',
                fillVersion: '0.4.11',
                registered: false,
                inlined: true,
              },
            ],
          },
        ],
      },
      includes: [],
    },
    // No binder names it and no pipeline reaches it, which is exactly how rt
    // reports a roster verb that binds nothing.
    {
      name: 'rebase-worktree',
      engine: 'rebase-worktree',
      engineRef: 'mattstack:rebase-worktree',
      plugin: 'mattstack',
      description: 'rebase a worktree',
      public: true,
      sourcePath: '/plugins/mattstack/skills/rebase-worktree/SKILL.md',
      artifactPath: '/p/skills/rebase-worktree',
      props: {},
      includes: [],
    },
  ],
  fills: [
    {
      binding: 'mattstack:model-tiering',
      provides: 'model-tiering@1',
      sourcePath: '/fills/model-tiering/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/fills/watch-ci-domain/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:work-provision',
      provides: 'provision-domain@1',
      sourcePath: '/fills/work-provision/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/fills/unused/SKILL.md',
      registered: false,
    },
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      props: [{ name: 'domain', boundTo: 'demo:watch-ci-domain', layer: null }],
    },
    {
      ref: 'mattstack:stage-watch-ci',
      verb: null,
      kind: 'stage',
      props: [{ name: 'domain', boundTo: 'demo:watch-ci-domain', layer: null }],
    },
    {
      ref: 'mattstack:work',
      verb: 'work',
      kind: 'verb',
      props: [
        { name: 'tiering', boundTo: 'mattstack:model-tiering', layer: null },
      ],
    },
    {
      ref: 'mattstack:stage-provision',
      verb: null,
      kind: 'stage',
      props: [{ name: 'domain', boundTo: 'demo:work-provision', layer: null }],
    },
  ],
  pipelines: {
    feature: [
      'mattstack:stage-provision',
      'mattstack:stage-implement',
      'mattstack:stage-watch-ci',
    ],
    hotfix: ['mattstack:stage-watch-ci'],
  },
};

const CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    {
      name: 'work',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
    {
      name: 'watch-ci',
      status: 'in-sync',
      staleFiles: [],
      orphanFiles: [],
    },
    {
      name: 'rebase-worktree',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
  ],
};

function renderWiring() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
}

function mockHappyPath() {
  packsGet.mockResolvedValue(
    ok({ packs: [{ name: 'demo', dir: '/p', layout: 'flat' }] })
  );
  compositionGet.mockResolvedValue(ok(COMPOSITION));
  checkGet.mockResolvedValue(ok(CHECK));
  anatomyGet.mockResolvedValue(err(404, 'no anatomy in this fixture'));
  changesGet.mockResolvedValue(
    ok({
      pack: 'demo',
      packDir: '/p',
      dirty: false,
      files: [],
      outsideScope: [],
      bindings: [],
      surface: [],
    })
  );
  defaultEditorGet.mockResolvedValue(ok({ editor: null }));
}

/** Every test leaves the URL where the next one expects it. */
afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('WiringMap: the live roster', () => {
  it('reads it for the Overview, and lists it on the Config tab', async () => {
    mockHappyPath();
    surfaceGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        rows: [{ name: 'watch-ci', kind: 'compiled', status: 'public' }],
      })
    );
    const user = userEvent.setup();
    renderWiring();

    // The Overview's focus list names a public command by the roster, so it
    // reads the roster itself.
    await screen.findByTestId('focus-pipeline:feature');
    await waitFor(() =>
      expect(surfaceGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'demo' } })
      )
    );

    await user.click(screen.getByRole('tab', { name: /^Config/ }));

    const panel = await screen.findByTestId('surface-tab');
    await waitFor(() =>
      expect(
        within(panel).getByTestId('surface-row-watch-ci')
      ).toBeInTheDocument()
    );
  });
});

describe('WiringMap: the pack', () => {
  it('offers an Open pack link straight to the pack directory', async () => {
    mockHappyPath();
    renderWiring();

    const open = await screen.findByTestId('open-pack');
    expect(open).toHaveAttribute('href', 'vscode://file/p');
  });

  it('builds the Open pack href from the default-editor preference', async () => {
    mockHappyPath();
    defaultEditorGet.mockResolvedValue(ok({ editor: 'zed' }));
    renderWiring();

    const open = await screen.findByTestId('open-pack');
    await waitFor(() => expect(open).toHaveAttribute('href', 'zed://file/p'));
  });
});

describe('WiringMap: the base a pack extends', () => {
  it('names the base beside the pack actions when the pack extends one', async () => {
    mockHappyPath();
    compositionGet.mockResolvedValue(
      ok({ ...COMPOSITION, extends: { name: 'acme-base', version: '0.1.0' } })
    );
    renderWiring();

    await screen.findByText('extends acme-base');
    expect(screen.getByTestId('pack-extends')).toHaveAttribute(
      'title',
      "This pack's fills and shared attachments come partly from the org's acme-base base pack."
    );
    expect(screen.getByTestId('open-pack')).toBeInTheDocument();
  });

  it('shows nothing when the pack extends none', async () => {
    mockHappyPath();
    compositionGet.mockResolvedValue(ok({ ...COMPOSITION, extends: null }));
    renderWiring();

    await screen.findByTestId('open-pack');
    await screen.findByTestId('focus-pipeline:feature');
    expect(screen.queryByText(/^extends /)).not.toBeInTheDocument();
  });

  it('shows nothing when an older rt answers without the field', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('open-pack');
    await screen.findByTestId('focus-pipeline:feature');
    expect(screen.queryByText(/^extends /)).not.toBeInTheDocument();
  });
});

describe('WiringMap: the header row', () => {
  it('leads the tab row with the page title and trails it with the pack actions, outside the tablist', async () => {
    mockHappyPath();
    renderWiring();

    const tabList = await screen.findByRole('tablist', { name: 'Page tabs' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Packs' });
    const open = await screen.findByTestId('open-pack');

    expect(tabList).not.toContainElement(heading);
    expect(tabList).not.toContainElement(open);
    expect(
      heading.compareDocumentPosition(tabList) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      tabList.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('names the only pack as plain text where the pack picker would sit', async () => {
    mockHappyPath();
    renderWiring();

    const name = await screen.findByTestId('pack-name');
    expect(name).toHaveTextContent('demo');
    expect(screen.queryByTestId('pack-select')).not.toBeInTheDocument();
  });

  it('shows the picker, not the plain name, when there is more than one pack', async () => {
    mockHappyPath();
    packsGet.mockResolvedValue(
      ok({
        packs: [
          { name: 'demo', dir: '/p', layout: 'flat' },
          { name: 'acme', dir: '/a', layout: 'flat' },
        ],
      })
    );
    renderWiring();

    // The pack picker is settings' team menu over the packs.
    await screen.findByRole('button', { name: /switch team/ });
    expect(screen.queryByTestId('pack-name')).not.toBeInTheDocument();
  });

  it('keeps the title on screen when no packs are found', async () => {
    packsGet.mockResolvedValue(ok({ packs: [] }));
    renderWiring();

    await screen.findByTestId('no-packs');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Packs' })
    ).toBeInTheDocument();
  });
});

describe('WiringMap: the pack picker', () => {
  function twoPacks() {
    mockHappyPath();
    packsGet.mockResolvedValue(
      ok({
        packs: [
          { name: 'demo', dir: '/p', layout: 'flat' },
          { name: 'acme', dir: '/a', layout: 'flat' },
        ],
      })
    );
  }

  it('reads the pack from the URL', async () => {
    twoPacks();
    window.history.pushState(null, '', '/packs?pack=acme');
    renderWiring();

    await waitFor(() =>
      expect(compositionGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'acme' } })
      )
    );
    expect(screen.getByTestId('open-pack')).toHaveAttribute(
      'href',
      'vscode://file/a'
    );
  });

  it('opens the pack menu on the shown pack', async () => {
    twoPacks();
    window.history.pushState(null, '', '/packs?pack=acme');
    renderWiring();

    // Settings' team menu over the packs; picking from it is the settings
    // page's own test (same component).
    expect(
      await screen.findByRole('button', { name: 'team: acme, switch team' })
    ).toBeInTheDocument();
  });
});

describe('WiringMap: dev packs apart from the team packs', () => {
  function teamsAndPlugin() {
    mockHappyPath();
    packsGet.mockResolvedValue(
      ok({
        packs: [
          { name: 'widgets', dir: '/c', layout: 'flat', team: 'widgets' },
          { name: 'ingest', dir: '/i', layout: 'flat', team: 'ingest' },
          { name: 'mattstack', dir: '/m', layout: 'grouped', team: null },
        ],
      })
    );
    const restore = stubVirtualLayout({
      rowHeight: 40,
      viewportHeight: 200,
      contentHeight: 120,
    });
    onTestFinished(restore);
  }

  it('keeps a dev pack out of the team menu', async () => {
    teamsAndPlugin();
    renderWiring();

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'team: widgets, switch team',
      })
    );
    await screen.findByRole('menuitem', { name: /ingest/ });
    expect(
      screen.queryByRole('menuitem', { name: /mattstack/ })
    ).not.toBeInTheDocument();
  });

  it('opens a dev pack from its toggle and toggles back to a team', async () => {
    teamsAndPlugin();
    renderWiring();

    const toggle = await screen.findByRole('button', {
      name: 'dev pack: mattstack',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(compositionGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'mattstack' } })
      )
    );
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'pick a team' })
    ).toBeInTheDocument();

    await userEvent.click(toggle);
    await screen.findByRole('button', { name: 'team: widgets, switch team' });
  });

  it('opens on a team pack when the URL names none', async () => {
    mockHappyPath();
    packsGet.mockResolvedValue(
      ok({
        packs: [
          { name: 'aaa-dev', dir: '/d', layout: 'grouped', team: null },
          { name: 'widgets', dir: '/c', layout: 'flat', team: 'widgets' },
        ],
      })
    );
    renderWiring();

    await waitFor(() =>
      expect(compositionGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'widgets' } })
      )
    );
  });
});
