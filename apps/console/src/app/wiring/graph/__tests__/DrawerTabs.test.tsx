import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { builtFrom, staleSteps } from '../drawer/history';
import { usedBySites } from '../drawer/usedBy';
import { buildFocusGroups } from '../model/focusModel';
import { designFixture, designSource } from './designFixtures';

const anatomyGet = vi.fn();
const historyGet = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        packs: {
          $get: () =>
            Promise.resolve(
              ok({
                packs: [
                  {
                    name: 'acme',
                    dir: '/fixture/packs/acme',
                    layout: 'grouped',
                  },
                ],
              })
            ),
        },
        composition: {
          $get: () => Promise.resolve(ok(designFixture('composition'))),
        },
        check: { $get: () => Promise.resolve(ok(designFixture('check'))) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        changes: {
          $get: () => Promise.resolve(ok(designFixture('changes.clean'))),
        },
        source: {
          $get: ({ query }: { query: { path: string } }) =>
            Promise.resolve(ok(designSource(query.path))),
        },
        compile: { $get: vi.fn() },
        history: { $get: (...args: unknown[]) => historyGet(...args) },
        diff: { $get: vi.fn() },
        surface: {
          $get: () =>
            Promise.resolve(
              ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
            ),
          apply: { $post: vi.fn() },
        },
        sync: { $post: vi.fn() },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve(ok({ editor: 'zed' })),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

/** stage-ship as the design check reports it: stale because its template
    changed, built from the same files as plan. */
function stageShip() {
  const plan = designFixture('anatomy.stage-plan');
  return {
    ...plan,
    skill: 'stage-ship',
    description: 'Push the branch and open the merge request.',
    template: {
      ...plan.template,
      ref: 'mattstack:stage-ship',
      path: '/fixture/mattstack/attachments/pipeline/stage-ship/SKILL.md',
    },
    rendered: {
      ...plan.rendered,
      path: '/fixture/packs/acme/attachments/stage-ship/SKILL.md',
    },
    status: 'stale' as const,
    staleBecause: ['source' as const],
  };
}

let writeText: ReturnType<typeof vi.fn>;
let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: 19,
    viewportHeight: 380,
    contentHeight: 1000 * 19,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const anatomy: Record<string, unknown> = {
    work: designFixture('anatomy.work'),
    'stage-plan': designFixture('anatomy.stage-plan'),
    'stage-ship': stageShip(),
  };
  anatomyGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(ok(anatomy[query.skill]))
  );
  historyGet.mockResolvedValue(
    ok({
      scope: 'skills/work',
      limit: 20,
      truncated: false,
      commits: [],
      runtime: { dirtyFiles: [], moreDirtyFiles: false, packVersion: '0.8.14' },
    })
  );
});

afterEach(() => {
  restoreLayout();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

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

const groupsOfDesign = () =>
  buildFocusGroups(designFixture('composition'), designFixture('check'));

describe('usedBySites', () => {
  it('lists every skill that pastes gate-protocol, grouped as the focus list groups them', () => {
    const sites = usedBySites(designFixture('composition'), groupsOfDesign(), {
      kind: 'include',
      name: 'gate-protocol',
    });

    expect(sites).toHaveLength(14);
    expect(sites.map(site => [site.group, site.skill, site.line])).toEqual([
      ['PIPELINE STEPS', 'work', 246],
      ['PIPELINE STEPS', 'stage-provision', 154],
      ['PIPELINE STEPS', 'stage-plan', 140],
      ['PIPELINE STEPS', 'stage-evidence', 268],
      ['PIPELINE STEPS', 'stage-ship', 435],
      ['PIPELINE STEPS', 'stage-watch-ci', 499],
      ['ON-DEMAND', 'review', 786],
      ['ON-DEMAND', 'self-review', 442],
      ['ON-DEMAND', 'receive-review', 1376],
      ['ON-DEMAND', 'ship', 712],
      ['ON-DEMAND', 'watch-ci', 804],
      ['NOT WIRED INTO ANYTHING', 'checkout', 271],
      ['NOT WIRED INTO ANYTHING', 'sync-open-mrs', 416],
      ['NOT WIRED INTO ANYTHING', 'rebase-worktree', 451],
    ]);
    expect(sites[0]!.focus).toBe('pipeline:feature');
    expect(sites[2]!.focus).toBe('stage-plan');
  });

  it('finds a fill at each slot that binds it, the board skills with no template line', () => {
    const sites = usedBySites(designFixture('composition'), groupsOfDesign(), {
      kind: 'fill',
      name: 'mattstack:model-tiering',
    });

    expect(sites.map(site => [site.group, site.skill, site.line])).toEqual([
      ['PIPELINE STEPS', 'work', 242],
      ['ON-DEMAND', 'shepherdr', 38],
      ['ON-DEMAND', 'review', 44],
      ['ON-DEMAND', 'self-review', 31],
      ['ON-DEMAND', 'receive-review', 52],
      ['ON-DEMAND', 'ship', 27],
      ['ON-DEMAND', 'watch-ci', 35],
      ['BOARD', 'board:review', null],
      ['BOARD', 'board:respond', null],
      ['BOARD', 'board:doctor', null],
    ]);
  });
});

describe('builtFrom', () => {
  it('reads every file plan was built from as unchanged or current', () => {
    const rows = builtFrom(
      designFixture('anatomy.stage-plan'),
      designFixture('check').verbs.find(row => row.name === 'stage-plan')
    );

    expect(
      rows.map(row => [
        row.file,
        row.kind,
        row.builtWith,
        row.installed,
        row.status,
      ])
    ).toEqual([
      [
        'stage-plan/SKILL.md',
        'template',
        'mattstack 0.28.10',
        '0.30.4',
        'unchanged',
      ],
      [
        'execution-strategy/SKILL.md',
        'partial',
        'mattstack 0.28.10',
        '0.30.4',
        'unchanged',
      ],
      ['plan-policy/SKILL.md', 'pack text', 'acme 0.8.14', '0.8.14', 'current'],
      [
        'gate-protocol/SKILL.md',
        'partial',
        'mattstack 0.28.10',
        '0.30.4',
        'unchanged',
      ],
      [
        'wrap-up-form/SKILL.md',
        'partial',
        'mattstack 0.28.10',
        '0.30.4',
        'unchanged',
      ],
    ]);
  });

  it('says unmeasured for every file when check has no row for the skill', () => {
    const rows = builtFrom(designFixture('anatomy.stage-plan'), undefined);

    expect(new Set(rows.map(row => row.status))).toEqual(
      new Set(['unmeasured'])
    );
  });
});

describe('staleSteps', () => {
  it('lists the stale steps of the pipeline other than the one open', () => {
    const groups = groupsOfDesign();
    const steps = staleSteps(
      groups.pipelines[0]!,
      designFixture('check'),
      'stage-plan'
    );

    expect(steps.map(step => [step.skill, step.reason])).toEqual([
      ['stage-evidence', 'template changed'],
      ['stage-ship', 'template changed'],
      ['stage-watch-ci', 'template changed'],
    ]);
  });
});

describe('Used by tab', () => {
  it('lists the sites grouped, marks the open skill, and says where to edit it', async () => {
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    expect(
      within(tab)
        .getAllByTestId('used-by-group')
        .map(group => group.textContent)
    ).toEqual(['PIPELINE STEPS', 'ON-DEMAND', 'NOT WIRED INTO ANYTHING']);
    const rows = within(tab).getAllByTestId('used-by-row');
    expect(rows).toHaveLength(14);
    expect(rows[0]).toHaveTextContent('work/SKILL.md');
    expect(rows[0]).toHaveTextContent('pastes it at L246');

    const here = rows[2]!;
    expect(here).toHaveAttribute('data-active');
    expect(here).toHaveTextContent('stage-plan/SKILL.md');
    expect(here).toHaveTextContent('you are here · pastes it at L140');
    expect(rows.filter(row => row.hasAttribute('data-active'))).toHaveLength(1);

    expect(tab).toHaveTextContent(
      'Edit it in the mattstack plugin. Every skill above picks up the change on its next compile.'
    );
  });

  it('says a pack text is edited in this pack', async () => {
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:slot:domain&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    expect(within(tab).getAllByTestId('used-by-row')).toHaveLength(1);
    expect(tab).toHaveTextContent('you are here · pastes it at L136');
    expect(tab).toHaveTextContent(
      'Edit it in this pack. Every skill above picks up the change when you sync.'
    );
  });

  it('focuses the skill a row names, which closes the drawer', async () => {
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    fireEvent.click(
      within(tab).getAllByTestId('used-by-row')[6]! // review
    );

    await waitFor(() => expect(params().get('focus')).toBe('review'));
    expect(params().get('select')).toBeNull();
  });
});

describe('History tab', () => {
  it('shows plan built from five files unchanged or current, and why the stamp is old', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=output&drawerTab=history');
    const tab = await screen.findByTestId('drawer-history');

    const rows = within(tab).getAllByTestId('built-from-row');
    expect(rows.map(row => row.getAttribute('data-status'))).toEqual([
      'unchanged',
      'unchanged',
      'current',
      'unchanged',
      'unchanged',
    ]);
    expect(rows[0]).toHaveTextContent('stage-plan/SKILL.md');
    expect(rows[0]).toHaveTextContent('template');
    expect(rows[0]).toHaveTextContent('mattstack 0.28.10');
    expect(rows[0]).toHaveTextContent('0.30.4');
    expect(within(tab).getByTestId('history-note')).toHaveTextContent(
      'Its version stamp says mattstack 0.28.10, but none of these files changed since. The text the agent reads is current; a rebuild would only update the stamp.'
    );

    expect(
      within(tab)
        .getAllByTestId('stale-step')
        .map(row => row.textContent)
    ).toEqual([
      'stage-evidence/SKILL.mdstale: template changed',
      'stage-ship/SKILL.mdstale: template changed',
      'stage-watch-ci/SKILL.mdstale: template changed',
    ]);
    expect(within(tab).getByTestId('sync-command')).toHaveTextContent(
      'rt skills sync --pack acme'
    );
    expect(tab).toHaveTextContent(
      'Rebuilds every stale step from the installed sources.'
    );
  });

  it('puts a status dot beside the output sentence', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=output&drawerTab=history');

    const dot = await screen.findByTestId('drawer-dot');
    expect(dot).toHaveAttribute('data-tone', 'ok');
  });

  it('copies the sync command', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=output&drawerTab=history');
    const command = await screen.findByTestId('sync-command');

    fireEvent.click(within(command).getByRole('button'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('rt skills sync --pack acme')
    );
  });

  it("marks a stale step's template changed and leaves the stamp note out", async () => {
    renderAt('?tab=graph&focus=stage-ship&select=output&drawerTab=history');
    const tab = await screen.findByTestId('drawer-history');

    const rows = within(tab).getAllByTestId('built-from-row');
    expect(rows[0]).toHaveAttribute('data-status', 'changed');
    expect(within(rows[0]!).getByText('changed')).toBeInTheDocument();
    expect(within(tab).queryByTestId('history-note')).toBeNull();
    expect(
      within(tab)
        .getAllByTestId('stale-step')
        .map(row => row.textContent?.split('/')[0])
    ).toEqual(['stage-evidence', 'stage-watch-ci']);
  });

  it("opens a stale step's own history", async () => {
    renderAt('?tab=graph&focus=stage-plan&select=output&drawerTab=history');
    const tab = await screen.findByTestId('drawer-history');

    fireEvent.click(within(tab).getAllByTestId('stale-step')[1]!);

    await waitFor(() => expect(params().get('focus')).toBe('stage-ship'));
    expect(params().get('select')).toBe('output');
    expect(params().get('drawerTab')).toBe('history');
  });

  it("shows a verb's commit timeline under its build", async () => {
    renderAt(
      '?tab=graph&focus=pipeline:feature&select=input:include:gate-protocol&drawerTab=history'
    );
    const tab = await screen.findByTestId('drawer-history');

    expect(
      await within(tab).findByTestId('version-timeline')
    ).toBeInTheDocument();
    expect(historyGet).toHaveBeenCalled();
  });
});
