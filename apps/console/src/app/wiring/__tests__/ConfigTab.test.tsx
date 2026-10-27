import '../../icons';

import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const compositionGet = vi.fn();
const checkGet = vi.fn();
const surfaceGet = vi.fn();
const changesGet = vi.fn();
const compilePost = vi.fn();
const syncPost = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        surface: {
          $get: (...args: unknown[]) => surfaceGet(...args),
          apply: { $post: vi.fn() },
        },
        changes: { $get: (...args: unknown[]) => changesGet(...args) },
        compile: { $post: (...args: unknown[]) => compilePost(...args) },
        sync: { $post: (...args: unknown[]) => syncPost(...args) },
        discard: { $post: vi.fn() },
      },
    },
  },
}));

const { ConfigTab } = await import('../ConfigTab');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function verb(name: string) {
  return {
    name,
    engine: name,
    engineRef: `mattstack:${name}`,
    plugin: 'mattstack',
    description: name,
    public: true,
    sourcePath: `/plugins/mattstack/skills/${name}/SKILL.md`,
    artifactPath: `/p/skills/${name}`,
    props: {},
    includes: [],
  };
}

const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: [verb('work'), verb('review')],
  fills: [],
  binders: [
    { ref: 'mattstack:review', verb: 'review', kind: 'verb', props: [] },
  ],
  pipelines: { feature: [] },
};

type Status = 'in-sync' | 'stale' | 'never-compiled';

function check(
  statuses: Record<string, Status>,
  installed: { status: string; version: string | null } | null = {
    status: 'current',
    version: '0.11.17',
  }
) {
  return {
    pack: 'demo',
    packDir: '/p',
    verbs: Object.entries(statuses).map(([name, status]) => ({
      name,
      status,
      staleFiles: status === 'stale' ? ['SKILL.md'] : [],
      orphanFiles: [],
    })),
    installed: installed && {
      plugin: 'demo',
      marketplace: 'acme',
      sourceVersion: '0.11.17',
      ...installed,
    },
  };
}

const IN_SYNC = { work: 'in-sync', review: 'in-sync' } as const;

const CLEAN = {
  pack: 'demo',
  packDir: '/p',
  dirty: false,
  files: [],
  outsideScope: [],
  bindings: [],
  surface: [],
  signature: 'clean',
};

const UNSYNCED = {
  ...CLEAN,
  dirty: true,
  files: [
    { path: 'skills/work/SKILL.md', status: 'M', hash: 'a'.repeat(40) },
    { path: 'skills/review/SKILL.md', status: 'M', hash: 'b'.repeat(40) },
  ],
  signature: 'two',
};

function renderConfig({
  statuses = IN_SYNC as Record<string, Status>,
  installed,
  changes = CLEAN,
}: {
  statuses?: Record<string, Status>;
  installed?: { status: string; version: string | null } | null;
  changes?: unknown;
} = {}) {
  compositionGet.mockResolvedValue(ok(COMPOSITION));
  checkGet.mockResolvedValue(
    ok(installed === undefined ? check(statuses) : check(statuses, installed))
  );
  surfaceGet.mockResolvedValue(
    ok({
      pack: 'demo',
      packDir: '/p',
      rows: [
        { name: 'work', kind: 'compiled', status: 'public' },
        { name: 'review', kind: 'compiled', status: 'public' },
      ],
    })
  );
  changesGet.mockResolvedValue(ok(changes));
  const onReview = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConfigTab pack="demo" onReview={onReview} />
    </QueryClientProvider>
  );
  return { onReview };
}

async function statusBar() {
  return screen.findByTestId('pack-status', {}, { timeout: 5000 });
}

afterEach(() => {
  act(() => notifications.clean());
  vi.clearAllMocks();
});

describe('ConfigTab: the status bar', () => {
  it('counts the skills up to date, and says Claude has the latest version', async () => {
    renderConfig();
    const bar = await statusBar();

    expect(within(bar).getByTestId('config-stat-ok')).toHaveTextContent(
      '2up to date'
    );
    expect(within(bar).getByTestId('config-stat-warn')).toHaveTextContent(
      '0need a compile'
    );
    expect(within(bar).getByTestId('config-stat-bad')).toHaveTextContent(
      '0never compiled'
    );
    // A zero problem is faint, and not a button.
    expect(within(bar).getByTestId('config-stat-warn')).toHaveAttribute(
      'data-faint'
    );
    expect(within(bar).getByTestId('pack-current')).toHaveTextContent(
      'Claude has the latest version0.11.17'
    );
    expect(within(bar).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Compile Skill Pack when a skill needs a compile or was never compiled, and compiles on click', async () => {
    compilePost.mockResolvedValue(
      ok({ pack: 'demo', written: true, verbs: [] })
    );
    renderConfig({ statuses: { work: 'stale', review: 'never-compiled' } });
    const bar = await statusBar();

    expect(within(bar).getByTestId('config-stat-warn')).toHaveTextContent(
      '1need a compile'
    );
    expect(within(bar).getByTestId('config-stat-bad')).toHaveTextContent(
      '1never compiled'
    );
    expect(bar).toHaveTextContent('Claude has an older version');
    expect(within(bar).queryByTestId('pack-current')).not.toBeInTheDocument();

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Compile Skill Pack' })
    );

    await waitFor(() => expect(compilePost).toHaveBeenCalledTimes(1));
    expect(compilePost.mock.calls[0][0]).toMatchObject({
      json: { pack: 'demo' },
    });
    expect(
      await screen.findByText('Compiled demo. Publish to share it.')
    ).toBeInTheDocument();
  });

  it('shows a compile that failed as an error', async () => {
    compilePost.mockResolvedValue(
      ok({
        pack: 'demo',
        written: false,
        verbs: [
          { name: 'work', status: 'errored', errors: ['work: bad prop'] },
        ],
      })
    );
    renderConfig({ statuses: { work: 'stale', review: 'in-sync' } });
    const bar = await statusBar();

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Compile Skill Pack' })
    );

    expect(await screen.findByText('work: bad prop')).toBeInTheDocument();
  });

  it('filters the list to the skills that need attention from their count', async () => {
    renderConfig({ statuses: { work: 'stale', review: 'in-sync' } });
    const bar = await statusBar();

    await userEvent.click(within(bar).getByTestId('config-stat-warn'));

    const roster = await screen.findByTestId('surface-tab');
    expect(
      within(roster).getByTestId('surface-filter-needs attention')
    ).toHaveAttribute('aria-pressed', 'true');
    expect(within(roster).getByTestId('surface-row-work')).toBeInTheDocument();
    expect(
      within(roster).queryByTestId('surface-row-review')
    ).not.toBeInTheDocument();
  });

  it('counts the changes to publish, with See changes and Publish, once everything is compiled', async () => {
    const { onReview } = renderConfig({ changes: UNSYNCED });
    const bar = await statusBar();

    expect(
      await within(bar).findByText('2 changes to publish')
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole('button', { name: 'Publish' })
    ).toBeInTheDocument();
    expect(within(bar).queryByTestId('pack-current')).not.toBeInTheDocument();

    await userEvent.click(
      within(bar).getByRole('button', { name: 'See changes' })
    );
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('names the trial branch Publish goes to', async () => {
    renderConfig({ changes: { ...UNSYNCED, trialBranch: 'block-packs' } });
    const bar = await statusBar();

    expect(
      await within(bar).findByRole('button', { name: 'Publish to block-packs' })
    ).toBeInTheDocument();
  });

  it('puts the compile first while a skill needs one, even with changes to publish', async () => {
    renderConfig({
      statuses: { work: 'stale', review: 'in-sync' },
      changes: UNSYNCED,
    });
    const bar = await statusBar();

    expect(
      within(bar).getByRole('button', { name: 'Compile Skill Pack' })
    ).toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: 'Publish' })
    ).not.toBeInTheDocument();
  });

  it('offers Install latest when Claude has an older copy installed, and installs on click', async () => {
    syncPost.mockResolvedValue(
      ok({ pack: 'demo', steps: [{ name: 'install', ok: true }] })
    );
    renderConfig({ installed: { status: 'lagging', version: '0.11.16' } });
    const bar = await statusBar();

    expect(bar).toHaveTextContent('Claude has an older version');
    await userEvent.click(
      within(bar).getByRole('button', { name: 'Install latest' })
    );

    await waitFor(() => expect(syncPost).toHaveBeenCalledTimes(1));
  });
});
