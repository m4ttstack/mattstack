import '../../icons';

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

vi.mock('../../api', () => ({
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
    },
  },
}));

const { WiringMap } = await import('../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
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
      slots: [],
    },
    // Bound by a `verb` binder outside the pipeline: an on-demand verb.
    {
      name: 'review',
      engine: 'review',
      engineRef: 'mattstack:review',
      plugin: 'mattstack',
      description: 'review',
      public: true,
      sourcePath: '/plugins/mattstack/skills/review/SKILL.md',
      artifactPath: '/p/skills/review',
      slots: [],
    },
  ],
  fills: [],
  binders: [
    { ref: 'mattstack:review', verb: 'review', kind: 'verb', slots: [] },
  ],
  // Empty stage list -- this fixture only needs the orchestrator row to
  // exist and to drift, not a real pipeline order.
  pipelines: { feature: [] },
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
  ],
};

const SURFACE = {
  pack: 'demo',
  packDir: '/p',
  rows: [{ name: 'work', kind: 'compiled', status: 'public' }],
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
  surfaceGet.mockResolvedValue(ok(SURFACE));
  anatomyGet.mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ error: 'no anatomy in this fixture' }),
  });
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
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('WiringMap: top-level tabs', () => {
  it('renders Graph / Surface / Health, in that order, with Graph active by default', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('focus-list');

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Graph',
      'Surface',
      expect.stringMatching(/^Health/),
    ]);
    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: /^Surface/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('shows the attention count as a badge on the Health tab', async () => {
    mockHappyPath();
    renderWiring();

    await screen.findByTestId('focus-list');

    expect(await screen.findByTestId('health-tab-count')).toHaveTextContent(
      '1'
    );
  });

  it('clicking Health hides the focus list and shows the Health panel', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('focus-list');

    await user.click(screen.getByRole('tab', { name: /^Health/ }));

    expect(screen.queryByTestId('focus-list')).not.toBeInTheDocument();
    const health = await screen.findByTestId('health-tab');
    // CHECK's one verb ('work') is stale, so it sits in "Recompile needed".
    expect(health).toHaveTextContent('1');
    expect(
      screen.getByTestId('health-group-recompile-needed')
    ).toBeInTheDocument();
  });

  it('clicking Surface hides the focus list and shows the roster inline', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('focus-list');
    expect(surfaceGet).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: /^Surface/ }));

    expect(screen.queryByTestId('focus-list')).not.toBeInTheDocument();
    const roster = await screen.findByTestId('surface-tab');
    await waitFor(() =>
      expect(surfaceGet).toHaveBeenCalledWith(
        expect.objectContaining({ query: { pack: 'demo' } })
      )
    );
    expect(roster).toHaveTextContent('Public skills can be invoked by name');
  });

  it('opening a Health row switches to Graph with that skill in focus', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('focus-list');
    await user.click(screen.getByRole('tab', { name: /^Health/ }));
    await screen.findByTestId('health-tab');

    await user.click(screen.getByTestId('health-row-mattstack:work'));

    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(new URLSearchParams(window.location.search).get('focus')).toBe(
      'work'
    );
    expect(
      within(await screen.findByTestId('focus-list')).getByTestId(
        'focus-pipeline:feature'
      )
    ).toHaveAttribute('data-active');
  });

  it('returns to the focus list when Graph is clicked again', async () => {
    mockHappyPath();
    const user = userEvent.setup();
    renderWiring();

    await screen.findByTestId('focus-list');
    await user.click(screen.getByRole('tab', { name: /^Health/ }));
    await screen.findByTestId('health-tab');

    await user.click(screen.getByRole('tab', { name: 'Graph' }));

    expect(await screen.findByTestId('focus-list')).toBeInTheDocument();
    expect(screen.queryByTestId('health-tab')).not.toBeInTheDocument();
  });
});

describe('WiringMap: a pack the URL names', () => {
  it('says so when no pack has that name, and which pack it shows instead', async () => {
    mockHappyPath();
    window.history.pushState(null, '', '/wiring?pack=globex');
    renderWiring();

    expect(
      await screen.findByText('No pack named globex; showing demo.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('pack-name')).toHaveTextContent('demo');
  });

  it('says nothing for a pack that exists, or when the URL names none', async () => {
    mockHappyPath();
    window.history.pushState(null, '', '/wiring?pack=demo');
    const { unmount } = renderWiring();
    await screen.findByTestId('pack-name');
    expect(screen.queryByTestId('missing-pack')).toBeNull();
    unmount();

    window.history.pushState(null, '', '/wiring');
    renderWiring();
    await screen.findByTestId('pack-name');
    expect(screen.queryByTestId('missing-pack')).toBeNull();
  });
});
