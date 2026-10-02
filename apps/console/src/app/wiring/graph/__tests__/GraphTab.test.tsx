import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { designFixture } from './designFixtures';

const packsGet = vi.fn();
const compositionGet = vi.fn();
const checkGet = vi.fn();
const anatomyGet = vi.fn();
const changesGet = vi.fn();
const surfaceGet = vi.fn();

vi.mock('../../../api', () => ({
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
        sync: { $post: vi.fn() },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: 'no anatomy' }),
  };
}

const ANATOMY: Record<string, unknown> = {
  work: designFixture('anatomy.work'),
  'stage-plan': designFixture('anatomy.stage-plan'),
};

function mockDesignPack({ changes = designFixture('changes.clean') } = {}) {
  packsGet.mockResolvedValue(
    ok({
      packs: [{ name: 'acme', dir: '/fixture/packs/acme', layout: 'grouped' }],
    })
  );
  compositionGet.mockResolvedValue(ok(designFixture('composition')));
  checkGet.mockResolvedValue(ok(designFixture('check')));
  changesGet.mockResolvedValue(ok(changes));
  surfaceGet.mockResolvedValue(
    ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
  );
  anatomyGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(
      ANATOMY[query.skill] ? ok(ANATOMY[query.skill]) : notFound()
    )
  );
}

function renderAt(search: string) {
  window.history.pushState(null, '', `/wiring${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
}

const params = () => new URLSearchParams(window.location.search);

/** The list once its composition has answered, loaded or failed. */
async function focusList() {
  const list = await screen.findByTestId('focus-list');
  await waitFor(() =>
    expect(
      within(list).queryByTestId('focus-list-loading')
    ).not.toBeInTheDocument()
  );
  return list;
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('Graph tab: the page', () => {
  it('replaces Pipeline and On-demand with Graph, ahead of Surface and Health', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature');
    await focusList();

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Graph',
      'Surface',
      expect.stringMatching(/^Health/),
    ]);
    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      screen.queryByRole('tab', { name: 'Pipeline' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'On-demand' })
    ).not.toBeInTheDocument();
  });

  it('opens on the Graph tab when the URL names no tab', async () => {
    mockDesignPack();
    renderAt('');
    await focusList();

    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('switches tabs through the URL', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?focus=stage-plan');
    await focusList();

    await user.click(screen.getByRole('tab', { name: 'Surface' }));

    expect(params().get('tab')).toBe('surface');
    expect(await screen.findByTestId('surface-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('focus-list')).not.toBeInTheDocument();
  });

  it('never writes a default pack into the URL', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan');
    await focusList();
    await screen.findByTestId('focus-header');

    expect(params().get('pack')).toBeNull();
    expect(params().get('focus')).toBe('stage-plan');
  });
});

describe('Graph tab: the focus list', () => {
  it("draws the board's groups: the pipeline, on-demand verbs, board skills and Unwired", async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();

    expect(within(list).getByText('Pipeline')).toBeInTheDocument();
    expect(within(list).getByText('On-demand')).toBeInTheDocument();
    expect(within(list).getByText('Board')).toBeInTheDocument();

    const pipeline = within(list).getByTestId('focus-pipeline:feature');
    expect(pipeline).toHaveTextContent('work · feature');
    expect(pipeline).toHaveTextContent('8');
    expect(pipeline).toHaveAttribute('data-active');

    for (const verb of [
      'shepherdr',
      'review',
      'self-review',
      'receive-review',
      'ship',
      'watch-ci',
    ]) {
      expect(within(list).getByTestId(`focus-${verb}`)).toHaveTextContent(verb);
    }
    for (const board of ['board:review', 'board:respond', 'board:doctor']) {
      expect(within(list).getByTestId(`focus-${board}`)).toBeInTheDocument();
    }
    expect(within(list).getByTestId('focus-unwired')).toHaveTextContent(
      'Unwired6'
    );
  });

  it('marks the items that need attention with a dot', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();

    await waitFor(() =>
      expect(
        within(within(list).getByTestId('focus-review')).getByTestId(
          'attention-dot'
        )
      ).toBeInTheDocument()
    );
    expect(
      within(within(list).getByTestId('focus-shepherdr')).queryByTestId(
        'attention-dot'
      )
    ).not.toBeInTheDocument();
    expect(
      within(within(list).getByTestId('focus-unwired')).getByTestId(
        'attention-dot'
      )
    ).toBeInTheDocument();
  });

  it('keeps a focused pipeline folded and unfolds it on a step', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();
    expect(
      within(list).queryByTestId('focus-stage-plan')
    ).not.toBeInTheDocument();

    window.history.pushState(null, '', '/wiring?tab=graph&focus=stage-plan');
    window.dispatchEvent(new PopStateEvent('popstate'));

    const step = await within(list).findByTestId('focus-stage-plan');
    expect(step).toHaveTextContent('2plan');
    expect(step).toHaveAttribute('data-active');
    expect(
      within(list).getByTestId('focus-pipeline:feature')
    ).not.toHaveAttribute('data-active');
  });

  it('focuses plan from the unfolded pipeline', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();

    await user.click(within(list).getByTestId('focus-pipeline:feature'));
    await user.click(await within(list).findByTestId('focus-stage-plan'));

    expect(params().get('focus')).toBe('stage-plan');
    expect(
      await within(await screen.findByTestId('focus-header')).findByText('plan')
    ).toBeInTheDocument();
  });

  it('focuses and unfolds a pipeline on the first click, and folds it on the next', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=shepherdr');
    const list = await focusList();
    const pipeline = within(list).getByTestId('focus-pipeline:feature');

    await user.click(pipeline);
    expect(params().get('focus')).toBe('pipeline:feature');
    expect(
      await within(list).findByTestId('focus-stage-plan')
    ).toBeInTheDocument();

    await user.click(pipeline);
    await waitFor(() =>
      expect(
        within(list).queryByTestId('focus-stage-plan')
      ).not.toBeInTheDocument()
    );
    expect(params().get('focus')).toBe('pipeline:feature');
  });

  it('keeps a pipeline open when it takes focus back from one of its steps', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=stage-plan');
    const list = await focusList();

    await user.click(within(list).getByTestId('focus-pipeline:feature'));
    // Past the fold's collapse, so a closing row would be gone by now.
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(params().get('focus')).toBe('pipeline:feature');
    expect(within(list).getByTestId('focus-stage-plan')).toBeInTheDocument();
  });

  it('focuses an on-demand verb', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();

    await user.click(within(list).getByTestId('focus-shepherdr'));

    expect(params().get('focus')).toBe('shepherdr');
    expect(within(list).getByTestId('focus-shepherdr')).toHaveAttribute(
      'data-active'
    );
  });

  it('lists the unwired verbs under Unwired', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();

    await user.click(within(list).getByTestId('focus-unwired'));
    await user.click(await within(list).findByTestId('focus-checkout'));

    expect(params().get('focus')).toBe('checkout');
  });

  it('checks the Needs attention switch from ?attention=1 and hides in-sync items', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&attention=1');
    const list = await focusList();

    expect(
      within(list).getByRole('switch', { name: 'Needs attention' })
    ).toBeChecked();
    await waitFor(() =>
      expect(
        within(list).queryByTestId('focus-shepherdr')
      ).not.toBeInTheDocument()
    );
    expect(within(list).getByTestId('focus-review')).toBeInTheDocument();
    expect(
      within(list).getByTestId('focus-pipeline:feature')
    ).toBeInTheDocument();
    expect(
      within(list).queryByTestId('focus-board:review')
    ).not.toBeInTheDocument();
  });

  it('turns the attention filter on and off through the URL', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=graph&focus=pipeline:feature');
    const list = await focusList();
    const toggle = within(list).getByRole('switch', {
      name: 'Needs attention',
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(params().get('attention')).toBe('1');
    expect(params().get('focus')).toBe('pipeline:feature');

    await user.click(toggle);
    expect(params().get('attention')).toBeNull();
  });

  it('counts only the flagged unwired verbs under the filter', async () => {
    mockDesignPack();
    renderAt('?tab=graph&attention=1');
    const list = await focusList();

    await waitFor(() =>
      expect(within(list).getByTestId('focus-unwired')).toHaveTextContent(
        'Unwired1'
      )
    );
  });

  it('keeps the filtered list loading until check answers', async () => {
    mockDesignPack();
    checkGet.mockReturnValue(new Promise(() => {}));
    renderAt('?tab=graph&attention=1');

    const list = await screen.findByTestId('focus-list');
    await waitFor(() => expect(compositionGet).toHaveBeenCalled());
    expect(within(list).getByTestId('focus-list-loading')).toBeInTheDocument();
    expect(
      within(list).queryByTestId('focus-pipeline:feature')
    ).not.toBeInTheDocument();
  });

  it('warns that no row can state its drift when check fails', async () => {
    mockDesignPack();
    checkGet.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'rt skills check: pack not found' }),
    });
    renderAt('?tab=graph');
    const list = await focusList();

    expect(
      await within(list).findByText(
        'rt skills check failed, so no row below can state its drift: rt skills check: pack not found'
      )
    ).toBeInTheDocument();
  });

  it('says "not measured" rather than "nothing wrong" when the filter empties the list and check never answered', async () => {
    mockDesignPack();
    const composition = designFixture('composition');
    composition.verbs = composition.verbs.filter(
      verb => verb.name !== 'release-notes'
    );
    compositionGet.mockResolvedValue(ok(composition));
    checkGet.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'rt skills check: pack not found' }),
    });
    renderAt('?tab=graph&attention=1');
    const list = await focusList();

    const empty = await within(list).findByTestId('attention-empty');
    expect(empty).toHaveTextContent('Not measured');
    expect(empty).not.toHaveTextContent('Nothing needs attention');
  });

  it('states a clean filtered list as measured', async () => {
    mockDesignPack();
    const composition = designFixture('composition');
    composition.verbs = composition.verbs.filter(
      verb => verb.name !== 'release-notes'
    );
    compositionGet.mockResolvedValue(ok(composition));
    const check = designFixture('check');
    for (const verb of check.verbs) {
      verb.status = 'in-sync';
      verb.staleBecause = [];
    }
    checkGet.mockResolvedValue(ok(check));
    renderAt('?tab=graph&attention=1');
    const list = await focusList();

    const empty = await within(list).findByTestId('attention-empty');
    expect(empty).toHaveTextContent(
      `Nothing needs attention: rt skills check compared ${check.verbs.length} roster verbs and none differed.`
    );
  });

  it('says so when the pack declares no pipeline', async () => {
    mockDesignPack();
    const composition = designFixture('composition');
    composition.pipelines = {};
    compositionGet.mockResolvedValue(ok(composition));
    renderAt('?tab=graph');
    const list = await focusList();

    expect(
      await within(list).findByText(/manifest declares no pipeline/)
    ).toBeInTheDocument();
  });

  it('offers a retry when the composition fails to load', async () => {
    mockDesignPack();
    compositionGet.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'rt exploded' }),
    });
    const user = userEvent.setup();
    renderAt('?tab=graph');
    const list = await focusList();

    expect(await within(list).findByText('rt exploded')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Retry' }));
    expect(
      await within(list).findByTestId('focus-pipeline:feature')
    ).toBeInTheDocument();
  });
});

describe('Graph tab: the focus header', () => {
  it('names a pipeline by its orchestrator, with its stage count and description', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature');
    const header = await screen.findByTestId('focus-header');

    expect(within(header).getByText('work')).toBeInTheDocument();
    expect(
      within(header).getByText('feature pipeline · 8 stages')
    ).toBeInTheDocument();
    expect(
      await within(header).findByText(
        'Runs a unit of work end to end, from provisioning through ship and CI.'
      )
    ).toBeInTheDocument();
    expect(
      within(header).queryByTestId('focus-status')
    ).not.toBeInTheDocument();
  });

  it("places a step in its pipeline and states its rendered file's status", async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan');
    const header = await screen.findByTestId('focus-header');

    expect(within(header).getByText('plan')).toBeInTheDocument();
    expect(
      within(header).getByText('stage 2 of 8 · work · feature')
    ).toBeInTheDocument();
    expect(
      await within(header).findByText(
        'Triage the approach and commit to it visibly before any implementation.'
      )
    ).toBeInTheDocument();
    expect(await within(header).findByTestId('focus-status')).toHaveTextContent(
      'in sync with installed mattstack 0.30.4'
    );
  });

  it('says a step rebuilt in this checkout is not synced yet', async () => {
    mockDesignPack({ changes: designFixture('changes.unsynced') });
    anatomyGet.mockImplementation(() =>
      Promise.resolve(ok(designFixture('anatomy.stage-plan.unsynced')))
    );
    renderAt('?tab=graph&focus=stage-plan');
    const header = await screen.findByTestId('focus-header');

    expect(await within(header).findByTestId('focus-status')).toHaveTextContent(
      'rebuilt here, not synced yet'
    );
  });

  it('names a stale skill and why', async () => {
    mockDesignPack();
    const stale = designFixture('anatomy.stage-plan');
    stale.status = 'stale';
    stale.staleBecause = ['include'];
    const check = designFixture('check');
    const row = check.verbs.find(verb => verb.name === 'stage-plan')!;
    row.status = 'stale';
    row.staleBecause = ['include'];
    checkGet.mockResolvedValue(ok(check));
    anatomyGet.mockImplementation(() => Promise.resolve(ok(stale)));
    renderAt('?tab=graph&focus=stage-plan');
    const header = await screen.findByTestId('focus-header');

    expect(await within(header).findByTestId('focus-status')).toHaveTextContent(
      'stale: a pasted file changed'
    );
  });

  it('calls an on-demand verb public', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=shepherdr');
    const header = await screen.findByTestId('focus-header');

    expect(within(header).getByText('shepherdr')).toBeInTheDocument();
    expect(within(header).getByText('public verb')).toBeInTheDocument();
  });

  it('calls a locked verb internal', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=self-review');
    const header = await screen.findByTestId('focus-header');

    expect(within(header).getByText('internal verb')).toBeInTheDocument();
  });

  it('focuses the first pipeline when the URL names no focus', async () => {
    mockDesignPack();
    renderAt('?tab=graph');
    const header = await screen.findByTestId('focus-header');

    expect(
      within(header).getByText('feature pipeline · 8 stages')
    ).toBeInTheDocument();
    expect(params().get('focus')).toBeNull();
  });
});

describe('Graph tab: an unknown focus', () => {
  it('says the pack has nothing by that name', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=nope');

    expect(await screen.findByTestId('focus-missing')).toHaveTextContent(
      'Nothing named nope is in this pack.'
    );
    expect(screen.queryByTestId('focus-header')).not.toBeInTheDocument();
  });
});

describe('Graph tab: from Health', () => {
  it('lands an opened Health row on the Graph tab with that skill in focus', async () => {
    mockDesignPack();
    const user = userEvent.setup();
    renderAt('?tab=health');
    await screen.findByTestId('health-tab');

    await user.click(screen.getByRole('button', { name: 'open review' }));

    expect(params().get('tab')).toBeNull();
    expect(params().get('focus')).toBe('review');
    const list = await focusList();
    expect(within(list).getByTestId('focus-review')).toHaveAttribute(
      'data-active'
    );
    expect(
      within(await screen.findByTestId('focus-header')).getByText('review')
    ).toBeInTheDocument();
  });
});
