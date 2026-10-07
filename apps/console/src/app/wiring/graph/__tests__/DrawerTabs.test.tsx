import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillsComposition } from '../../outline';
import { BuiltFromTable } from '../drawer/BuiltFromTable';
import { builtFrom, fileNote, staleSteps } from '../drawer/history';
import { usedBySites } from '../drawer/usedBy';
import { buildFocusGroups } from '../model/focusModel';
import { designFixture, designSource } from './designFixtures';

const anatomyGet = vi.fn();
const historyGet = vi.fn();
const compositionGet = vi.fn();

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
        composition: { $get: () => compositionGet() },
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
  serveComposition(designFixture('composition'));
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

function serveComposition(composition: SkillsComposition) {
  compositionGet.mockImplementation(() => Promise.resolve(ok(composition)));
}

/** The design composition with work also binding model-tiering at a second
    slot, `domain`, at its template line 100. */
function workBindsTieringTwice(): SkillsComposition {
  const composition = designFixture('composition');
  return {
    ...composition,
    binders: composition.binders.map(binder =>
      binder.ref === 'mattstack:work'
        ? {
            ...binder,
            slots: [
              ...binder.slots,
              { name: 'domain', boundTo: 'mattstack:model-tiering' },
            ],
          }
        : binder
    ),
    targets: composition.targets?.map(target =>
      target.name === 'work'
        ? {
            ...target,
            placeholders: [
              ...target.placeholders,
              { kind: 'slot', arg: 'domain', line: 100 },
            ],
          }
        : target
    ),
  };
}

/** The design composition with stage-provision run by no pipeline, so the
    focus list shows it nowhere. */
function provisionUnlisted(): SkillsComposition {
  const composition = designFixture('composition');
  return {
    ...composition,
    pipelines: {
      feature: composition.pipelines!.feature!.filter(
        ref => ref !== 'mattstack:stage-provision'
      ),
    },
  };
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
      ['STANDALONE', 'review', 786],
      ['STANDALONE', 'self-review', 442],
      ['STANDALONE', 'receive-review', 1376],
      ['STANDALONE', 'ship', 712],
      ['STANDALONE', 'watch-ci', 804],
      ['STANDALONE', 'checkout', 271],
      ['STANDALONE', 'sync-open-mrs', 416],
      ['STANDALONE', 'rebase-worktree', 451],
    ]);
    expect(sites[0]!.focus).toBe('pipeline:feature');
    expect(sites[0]!.label).toBe('work/SKILL.md');
    expect(sites[2]!.focus).toBe('stage-plan');
  });

  it('finds a fill at each slot that binds it, the board skills with no template line', () => {
    const sites = usedBySites(designFixture('composition'), groupsOfDesign(), {
      kind: 'fill',
      name: 'mattstack:model-tiering',
    });

    expect(sites.map(site => [site.group, site.skill, site.line])).toEqual([
      ['PIPELINE STEPS', 'work', 242],
      ['STANDALONE', 'shepherdr', 38],
      ['STANDALONE', 'review', 44],
      ['STANDALONE', 'self-review', 31],
      ['STANDALONE', 'receive-review', 52],
      ['STANDALONE', 'ship', 27],
      ['STANDALONE', 'watch-ci', 35],
      ['BOARD', 'board:review', null],
      ['BOARD', 'board:respond', null],
      ['BOARD', 'board:doctor', null],
    ]);
    expect(sites[7]!.label).toBe('board:review');
  });

  it('lists a skill once for each slot it binds the fill at', () => {
    const composition = workBindsTieringTwice();
    const sites = usedBySites(
      composition,
      buildFocusGroups(composition, designFixture('check')),
      { kind: 'fill', name: 'mattstack:model-tiering' }
    );

    expect(
      sites
        .filter(site => site.skill === 'work')
        .map(site => [site.slot, site.line])
    ).toEqual([
      ['domain', 100],
      ['tiering', 242],
    ]);
  });

  it('gives a skill the focus list does not show no focus, and names it plainly', () => {
    const composition = provisionUnlisted();
    const sites = usedBySites(
      composition,
      buildFocusGroups(composition, designFixture('check')),
      { kind: 'include', name: 'gate-protocol' }
    );

    expect(sites.find(site => site.skill === 'stage-provision')).toEqual({
      group: 'NOT WIRED INTO ANYTHING',
      skill: 'stage-provision',
      slot: null,
      line: 154,
      focus: null,
      label: 'stage-provision',
    });
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

  it('words a file from the org base as a base, never the org token', () => {
    const anatomy = designFixture('anatomy.stage-plan');
    const rows = builtFrom(
      {
        ...anatomy,
        parts: anatomy.parts.map(part =>
          part.name === 'domain'
            ? {
                ...part,
                source: {
                  ref: 'acme-base:plan-policy',
                  path: '/fixture/orgs/acme/base/attachments/plan-policy/SKILL.md',
                  version: 'org',
                  builtVersion: 'org',
                  lines: 80,
                  origin: 'base' as const,
                  base: 'acme-base',
                  baseVersion: '0.1.0',
                },
              }
            : part
        ),
      },
      designFixture('check').verbs.find(row => row.name === 'stage-plan')
    );
    const base = rows.find(row => row.file === 'plan-policy/SKILL.md')!;

    expect(base).toMatchObject({
      kind: 'partial',
      builtWith: 'acme-base 0.1.0',
      installed: 'org base',
      owner: { kind: 'base', name: 'acme-base', version: '0.1.0' },
    });
    expect(fileNote(base, 'stage-plan')).toBe(
      "stage-plan was built from the org's acme-base base pack. rt check says whether it is current."
    );
    expect(fileNote({ ...base, status: 'not built' }, 'stage-plan')).toBe(
      'stage-plan has never been built, so it holds no copy of this partial yet.'
    );
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
    ).toEqual(['PIPELINE STEPS', 'STANDALONE']);
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

  it("says a base fill is edited in the org's base pack", async () => {
    const plan = designFixture('anatomy.stage-plan');
    anatomyGet.mockImplementation(() =>
      Promise.resolve(
        ok({
          ...plan,
          parts: plan.parts.map(part =>
            part.name === 'domain'
              ? {
                  ...part,
                  source: {
                    ...part.source!,
                    ref: 'acme-base:plan-policy',
                    origin: 'base',
                    base: 'acme-base',
                    baseVersion: '0.1.0',
                  },
                }
              : part
          ),
        })
      )
    );
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:slot:domain&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    expect(tab).toHaveTextContent(
      "Edit it in the org's acme-base base pack. Every skill above picks up the change on its next compile."
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

  it('lists board skills by their ref, binding the fill with no line', async () => {
    renderAt(
      '?tab=graph&focus=pipeline:feature&select=input:slot:tiering&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    expect(
      within(tab)
        .getAllByTestId('used-by-group')
        .map(group => group.textContent)
    ).toEqual(['PIPELINE STEPS', 'STANDALONE', 'BOARD']);
    const board = within(tab)
      .getAllByTestId('used-by-row')
      .find(row => row.textContent?.startsWith('board:review'));
    expect(board).toHaveTextContent('board:reviewbinds it');
  });

  it('marks only the slot the drawer was opened from when a skill binds the fill twice', async () => {
    serveComposition(workBindsTieringTwice());
    renderAt(
      '?tab=graph&focus=pipeline:feature&select=input:slot:tiering&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    const work = within(tab)
      .getAllByTestId('used-by-row')
      .filter(row => row.textContent?.startsWith('work/SKILL.md'));
    expect(work.map(row => row.textContent)).toEqual([
      'work/SKILL.mdpastes it at L100',
      'work/SKILL.mdyou are here · pastes it at L242',
    ]);
    expect(work.map(row => row.hasAttribute('data-active'))).toEqual([
      false,
      true,
    ]);
  });

  it('says a partial is pasted in when rt names no lines', async () => {
    serveComposition({ ...designFixture('composition'), targets: undefined });
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    const rows = within(tab).getAllByTestId('used-by-row');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toHaveTextContent('work/SKILL.mdpastes it in');
    expect(rows.every(row => row.textContent?.endsWith('pastes it in'))).toBe(
      true
    );
  });

  it('shows a skill the focus list does not show as plain text', async () => {
    serveComposition(provisionUnlisted());
    renderAt(
      '?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by'
    );
    const tab = await screen.findByTestId('drawer-used-by');

    const row = within(tab)
      .getAllByTestId('used-by-row')
      .find(candidate => candidate.textContent?.startsWith('stage-provision'))!;
    expect(row).toHaveTextContent('stage-provisionpastes it at L154');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row.tagName).not.toBe('BUTTON');
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

  it("shows an input card only its own file's build in the open skill", async () => {
    renderAt(
      '?tab=graph&focus=pipeline:feature&select=input:include:gate-protocol&drawerTab=history'
    );
    const tab = await screen.findByTestId('drawer-history');

    expect(within(tab).getByTestId('history-heading')).toHaveTextContent(
      'In work'
    );
    const rows = within(tab).getAllByTestId('built-from-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('gate-protocol/SKILL.md');
    expect(rows[0]).toHaveAttribute('data-status', 'unchanged');
    expect(within(tab).getByTestId('history-note')).toHaveTextContent(
      'This partial has not changed since work was built with mattstack 0.28.10, so the copy in work is current.'
    );
    expect(within(tab).queryByTestId('version-timeline')).toBeNull();
    expect(within(tab).queryByTestId('stale-step')).toBeNull();
    expect(within(tab).queryByTestId('sync-command')).toBeNull();
    expect(historyGet).not.toHaveBeenCalled();
  });

  it("shows a verb's commit timeline under a row's history", async () => {
    renderAt(
      '?tab=graph&focus=pipeline:feature&select=row:246&view=rendered&drawerTab=history'
    );
    const tab = await screen.findByTestId('drawer-history');

    expect(within(tab).getAllByTestId('built-from-row')).toHaveLength(4);
    expect(
      await within(tab).findByTestId('version-timeline')
    ).toBeInTheDocument();
    expect(historyGet).toHaveBeenCalled();
  });
});

describe('BuiltFromTable', () => {
  it('says a file was never built once, in its status', () => {
    renderWithProviders(
      <BuiltFromTable
        rows={[
          {
            path: '/fixture/mattstack/attachments/pipeline/standup/SKILL.md',
            name: 'standup',
            file: 'standup/SKILL.md',
            kind: 'template',
            builtWith: null,
            installed: '0.30.4',
            status: 'not built',
            owner: { kind: 'plugin', name: 'mattstack' },
          },
        ]}
      />
    );

    expect(screen.getAllByText('not built')).toHaveLength(1);
  });
});
