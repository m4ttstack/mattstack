import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
      slots: [
        {
          name: 'tiering',
          contract: 'model-tiering@1',
          required: false,
          boundTo: 'mattstack:model-tiering',
          fillSourcePath: '/fills/model-tiering/SKILL.md',
          fillVersion: '0.8.0',
          registered: false,
          inlined: true,
        },
      ],
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
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: false,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: '/fills/watch-ci-domain/SKILL.md',
          fillVersion: '0.4.11',
          registered: false,
          inlined: true,
        },
      ],
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
      slots: [],
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
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mattstack:stage-watch-ci',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mattstack:work',
      verb: 'work',
      kind: 'verb',
      slots: [{ name: 'tiering', boundTo: 'mattstack:model-tiering' }],
    },
    {
      ref: 'mattstack:stage-provision',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:work-provision' }],
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

describe('WiringMap: wiring the deferred surfaces', () => {
  it('fetches the live roster only once the Surface tab is opened', async () => {
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

    // The roster is not fetched before its tab is selected -- no rt
    // subprocess is spent on a panel nobody asked to see.
    await screen.findByTestId('focus-pipeline:feature');
    expect(surfaceGet).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Surface' }));

    const panel = await screen.findByTestId('surface-tab');
    expect(surfaceGet).toHaveBeenCalledWith(
      expect.objectContaining({ query: { pack: 'demo' } })
    );
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

describe('WiringMap: the header row', () => {
  it('leads the tab row with the page title and trails it with the pack actions, outside the tablist', async () => {
    mockHappyPath();
    renderWiring();

    const tabList = await screen.findByRole('tablist', { name: 'Page tabs' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Wiring' });
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

    await screen.findByTestId('pack-select');
    expect(screen.queryByTestId('pack-name')).not.toBeInTheDocument();
  });

  it('keeps the title on screen when no packs are found', async () => {
    packsGet.mockResolvedValue(ok({ packs: [] }));
    renderWiring();

    await screen.findByTestId('no-packs');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Wiring' })
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
    window.history.pushState(null, '', '/wiring?pack=acme');
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

  it('writes a picked pack to the URL and drops the old focus', async () => {
    twoPacks();
    window.history.pushState(null, '', '/wiring?focus=watch-ci');
    const user = userEvent.setup();
    renderWiring();

    await user.click(await screen.findByTestId('pack-select'));
    await user.click(await screen.findByRole('option', { name: 'acme' }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('pack')).toBe('acme');
    expect(params.get('focus')).toBeNull();
  });
});
