// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import type { SkillsAnatomy } from '../../../useWiring';
import { drawerContent, parseTarget, withHeader } from '../drawerContent';
import { buildTemplateView } from '../templateModel';

const anatomyWork = designFixture('anatomy.work');
const anatomyPlan = designFixture('anatomy.stage-plan');
const anatomyPlanUnsynced = designFixture('anatomy.stage-plan.unsynced');
const composition = designFixture('composition');
const compositionUnsynced = designFixture('composition.unsynced');
const check = designFixture('check');
const changesUnsynced = designFixture('changes.unsynced');

const workView = buildTemplateView({
  anatomy: anatomyWork,
  composition,
  check,
  changes: undefined,
  step: null,
});
const planView = buildTemplateView({
  anatomy: anatomyPlan,
  composition,
  check,
  changes: undefined,
  step: 2,
});

const plan = (
  select: string,
  requested: 'template' | 'rendered' | null = null
) => drawerContent(parseTarget(select)!, planView, anatomyPlan, requested);
const work = (
  select: string,
  requested: 'template' | 'rendered' | null = null
) => drawerContent(parseTarget(select)!, workView, anatomyWork, requested);

describe('parseTarget', () => {
  it.each([
    ['row:1', { kind: 'row', line: 1 }],
    ['row:140', { kind: 'row', line: 140 }],
    [
      'input:include:gate-protocol',
      { kind: 'input', id: 'include:gate-protocol' },
    ],
    [
      'input:variable:run-start.flags:work',
      { kind: 'input', id: 'variable:run-start.flags:work' },
    ],
    ['output', { kind: 'output', part: null }],
    [
      'output:include:gate-protocol',
      { kind: 'output', part: 'include:gate-protocol' },
    ],
    [
      'link:../../attachments/gates/SKILL.md',
      { kind: 'link', path: '../../attachments/gates/SKILL.md' },
    ],
  ])('%s', (select, target) => {
    expect(parseTarget(select)).toEqual(target);
  });

  it.each([
    null,
    '',
    'row:',
    'row:0',
    'row:x',
    'row:1.5',
    'input:',
    'link:',
    'output:',
    'nope',
  ])('refuses %s', select => {
    expect(parseTarget(select)).toBeNull();
  });
});

describe('a text range row (drawer-text-range)', () => {
  const content = work('row:1');

  it('opens the template with the range highlighted', () => {
    expect(content).toMatchObject({
      filePath: anatomyWork.template.path,
      fileLabel: 'work/SKILL.md',
      view: 'template',
      canToggle: true,
      highlight: { template: [1, 28], rendered: null },
      bands: [],
    });
  });

  it('reads as the board does', () => {
    expect(content?.chip).toBe('L1-28');
    expect(content?.sentence).toBe(
      '28 lines of orchestrator text, as written in the template.'
    );
    expect(content?.meta).toBe('mattstack 0.30.4 · installed copy, read only');
  });

  it('draws no kind badge and no tab strip over the template', () => {
    expect(content?.badge).toBeNull();
    expect(content?.tabs).toEqual(['text']);
  });

  it('switches to the rendered file on request', () => {
    const rendered = work('row:1', 'rendered');
    expect(rendered).toMatchObject({
      filePath: anatomyWork.rendered.path,
      fileLabel: 'work/SKILL.md',
      view: 'rendered',
      badge: 'rendered',
      meta: null,
      tabs: ['text', 'history'],
    });
  });

  it('says a short range is still text of its kind', () => {
    expect(work('row:37')?.sentence).toBe(
      '3 lines of orchestrator text, as written in the template.'
    );
  });
});

describe('an include row (drawer-include-row)', () => {
  const content = plan('row:140');

  it('opens the rendered file scrolled to where the partial landed', () => {
    expect(content).toMatchObject({
      filePath: anatomyPlan.rendered.path,
      fileLabel: 'stage-plan/SKILL.md',
      badge: 'rendered',
      canToggle: true,
      view: 'rendered',
      highlight: { template: [140, 140], rendered: [303, 752] },
      tabs: ['text', 'history'],
      meta: null,
      slot: null,
    });
  });

  it('reads as the board does', () => {
    expect(content?.chip).toBe('L140 → L303-752');
    expect(content?.sentence).toBe(
      'gate-protocol is pasted here: 450 lines, 58% of what the agent reads in this step.'
    );
  });

  it('bands every line: each pasted part, the clicked one in accent, and the step text between them', () => {
    expect(content?.bands).toEqual([
      { from: 1, to: 48, label: 'step text', tone: 'muted' },
      { from: 49, to: 197, label: 'execution-strategy', tone: 'muted' },
      { from: 198, to: 222, label: 'step text', tone: 'muted' },
      { from: 223, to: 302, label: 'plan-policy', tone: 'muted' },
      { from: 303, to: 752, label: 'gate-protocol', tone: 'accent' },
      { from: 753, to: 780, label: 'wrap-up-form', tone: 'muted' },
    ]);
  });

  it('fills the gaps between pasted parts of a stale build with its own text', () => {
    const bands = work('row:246', 'rendered')!.bands;
    expect(
      bands
        .filter(band => band.label === 'orchestrator text')
        .map(band => [band.from, band.to])
    ).toEqual([
      [1, 248],
      [341, 343],
      [794, 796],
    ]);
  });

  it('bands a step text row in accent', () => {
    expect(plan('row:1', 'rendered')?.bands[0]).toEqual({
      from: 1,
      to: 48,
      label: 'step text',
      tone: 'accent',
    });
  });

  it('shows the template line on request, without bands', () => {
    expect(plan('row:140', 'template')).toMatchObject({
      filePath: anatomyPlan.template.path,
      view: 'template',
      badge: null,
      bands: [],
      tabs: ['text'],
      chip: 'L140 → L303-752',
    });
  });

  it('opens a stale skill on the template, its rendered view one toggle away', () => {
    expect(work('row:246')).toMatchObject({
      view: 'template',
      chip: 'L246 → L344-793',
    });
    expect(work('row:246', 'rendered')).toMatchObject({
      view: 'rendered',
      highlight: { template: [246, 246], rendered: [344, 793] },
    });
  });
});

describe('a slot row (drawer-rebind)', () => {
  const content = plan('row:136');

  it('reads as the board does and names the slot', () => {
    expect(content?.chip).toBe('L136 → L223-302');
    expect(content?.sentence).toBe(
      'The domain slot. This pack fills it with plan-policy: 80 lines.'
    );
    expect(content?.slot).toEqual({
      name: 'domain',
      contract: 'plan-domain@1',
      bound: true,
    });
    expect(content?.view).toBe('rendered');
    expect(content?.error).toBeNull();
  });

  it('names the new fill once rebound here', () => {
    const view = buildTemplateView({
      anatomy: anatomyPlanUnsynced,
      composition: compositionUnsynced,
      check,
      changes: changesUnsynced,
      step: 2,
    });
    expect(
      drawerContent(parseTarget('row:136')!, view, anatomyPlanUnsynced, null)
        ?.sentence
    ).toBe(
      'The domain slot. This pack fills it with plan-policy-strict: 64 lines.'
    );
  });
});

describe('a slot nothing fills', () => {
  const releaseNotes: SkillsAnatomy = {
    ...anatomyPlan,
    skill: 'release-notes',
    kind: 'verb',
    parts: [
      {
        kind: 'slot',
        name: 'changelog',
        templateLines: [22, 22],
        renderedLines: null,
        mode: null,
        source: null,
        target: null,
        changed: false,
      },
    ],
    links: [],
  };
  const viewWith = (slot: Record<string, unknown>) =>
    buildTemplateView({
      anatomy: releaseNotes,
      composition: {
        ...composition,
        verbs: composition.verbs.map(verb =>
          verb.name === 'release-notes'
            ? { ...verb, slots: verb.slots.map(s => ({ ...s, ...slot })) }
            : verb
        ),
      },
      check,
      changes: undefined,
      step: null,
    });
  const open = (view: ReturnType<typeof viewWith>, select: string) =>
    drawerContent(parseTarget(select)!, view, releaseNotes, null);

  it('offers to bind a slot nothing is bound to, from its row and its card', () => {
    const view = viewWith({});
    for (const select of ['row:22', 'input:slot:changelog'])
      expect(open(view, select)).toMatchObject({
        sentence:
          'The changelog slot. It is required, and nothing is bound to it.',
        slot: {
          name: 'changelog',
          contract: 'changelog-style@1',
          bound: false,
        },
        error: null,
      });
  });

  it('offers to bind a slot rt could not resolve when nothing is bound to it, as the rebind panel says', () => {
    const view = viewWith({
      resolveError: 'no fill provides changelog-style@1',
    });
    expect(open(view, 'row:22')).toMatchObject({
      sentence: 'The changelog slot. rt could not resolve it.',
      slot: { name: 'changelog', bound: false },
      error: 'no fill provides changelog-style@1',
    });
  });

  it('reads an empty binding as nothing bound, as the rebind panel does', () => {
    const view = viewWith({
      boundTo: '',
      resolveError: 'no fill provides changelog-style@1',
    });
    expect(open(view, 'row:22')).toMatchObject({
      slot: { name: 'changelog', bound: false },
    });
  });

  it("carries rt's whole message for a slot it could not resolve", () => {
    const message =
      'loadAttachment: slot "changelog": binding "acme:changelog-style" not found; searched:\n/a\n/b';
    const view = viewWith({
      boundTo: 'acme:changelog-style',
      resolveError: message,
    });
    expect(open(view, 'row:22')).toMatchObject({
      sentence: 'The changelog slot. rt could not resolve it.',
      slot: { name: 'changelog', bound: true },
      error: message,
    });
  });
});

describe('placeholder rows that are not files', () => {
  it('shows what rt rendered for a variable', () => {
    expect(plan('row:16')).toMatchObject({
      view: 'rendered',
      chip: 'L16 → L16-24',
      highlight: { template: [16, 16], rendered: [16, 24] },
      sentence: 'A variable rt fills in for each run: 9 lines here.',
    });
  });

  it('names the step a link row points at', () => {
    expect(work('row:30')).toMatchObject({
      view: 'template',
      chip: 'L30',
      sentence: 'This line points the agent at stage-plan/SKILL.md.',
    });
  });
});

describe('an input card (drawer-input-card)', () => {
  const content = plan('input:include:gate-protocol');

  it('opens the partial on its own text', () => {
    expect(content).toMatchObject({
      filePath: '/fixture/mattstack/attachments/gate-protocol/SKILL.md',
      fileLabel: 'gate-protocol/SKILL.md',
      badge: 'partial',
      canToggle: false,
      view: 'template',
      chip: null,
      highlight: { template: null, rendered: null },
      bands: [],
      slot: null,
    });
    expect(content?.tabs[0]).toBe('text');
  });

  it('reads as the board does', () => {
    expect(content?.sentence).toBe(
      'A mattstack partial. 14 skills in this pack paste it in.'
    );
    expect(content?.meta).toBe('mattstack 0.30.4 · installed copy, read only');
    expect(content?.tabs).toEqual(['text', 'used-by', 'history']);
  });

  it('calls pack text by the pack that wrote it', () => {
    expect(plan('input:slot:domain')).toMatchObject({
      badge: 'pack text',
      sentence: 'Written by acme. 1 skill in this pack uses it.',
      meta: 'acme 0.8.14',
      slot: { name: 'domain', contract: 'plan-domain@1', bound: true },
      error: null,
    });
  });

  it('calls a default fill by the plugin that ships it', () => {
    expect(work('input:slot:tiering')?.sentence).toBe(
      'A mattstack default. 10 skills in this pack use it.'
    );
  });

  it('opens a variable card on what rt rendered in its place', () => {
    expect(plan('input:variable:stage.fields')).toEqual(plan('row:16'));
  });
});

describe('an input card for a fill from the org base', () => {
  const baseView = (baseVersion: string | null) => {
    const baseComposition = JSON.parse(
      JSON.stringify(composition)
        .replaceAll('"acme:plan-policy-lite"', '"acme-base:plan-policy"')
        .replaceAll('"acme:plan-policy"', '"acme-base:plan-policy"')
    ) as typeof composition;
    const anatomy = {
      ...anatomyPlan,
      parts: anatomyPlan.parts.map(part =>
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
                baseVersion,
              },
            }
          : part
      ),
    };
    const view = buildTemplateView({
      anatomy,
      composition: baseComposition,
      check,
      changes: undefined,
      step: 2,
    });
    return drawerContent(
      parseTarget('input:slot:domain')!,
      view,
      anatomy,
      null
    )!;
  };

  it('words it as a base pack, read only here', () => {
    const content = baseView('0.1.0');
    expect(content.meta).toBe(
      'acme-base 0.1.0 · org base pack, read only here'
    );
    expect(content.sentence).toBe(
      "From the org's acme-base base pack. 2 skills in this pack use it."
    );
    expect(content.badge).toBe('partial');
    expect(content.usedBy).toMatchObject({
      kind: 'fill',
      owner: { kind: 'base', name: 'acme-base', version: '0.1.0' },
    });
  });

  it('never prints the org token as a version', () => {
    const content = baseView(null);
    expect(content.meta).toBe('acme-base · org base pack, read only here');
    expect(JSON.stringify(content)).not.toMatch(/acme-base org\b/);
    expect(JSON.stringify(content)).not.toMatch(/org ·/);
  });

  it('adds where a team-pack copy comes from when the ref belongs to this pack', () => {
    const anatomy = {
      ...anatomyPlan,
      parts: anatomyPlan.parts.map(part =>
        part.name === 'domain'
          ? {
              ...part,
              source: {
                ...part.source!,
                origin: 'base' as const,
                base: 'acme-base',
                baseVersion: '0.1.0',
              },
            }
          : part
      ),
    };
    const view = buildTemplateView({
      anatomy,
      composition,
      check,
      changes: undefined,
      step: 2,
    });
    const content = drawerContent(
      parseTarget('input:slot:domain')!,
      view,
      anatomy,
      null
    )!;
    expect(content.badge).toBe('partial');
    expect(content.sentence).toBe(
      "From the org's acme-base base pack. 1 skill in this pack uses it. Compile copies it from the org's acme-base base pack and rewrites it on every compile; edit it there."
    );
    expect(view.inputs.find(card => card.id === 'slot:domain')!.subtitle).toBe(
      'acme-base · org base · picked by this pack'
    );
  });
});

describe('the output card (drawer-history)', () => {
  it('reads as the board does when in sync', () => {
    expect(plan('output')).toMatchObject({
      filePath: anatomyPlan.rendered.path,
      fileLabel: 'stage-plan/SKILL.md',
      badge: 'rendered',
      canToggle: true,
      view: 'rendered',
      chip: null,
      sentence: 'In sync. 780 lines, rendered from 5 files.',
      highlight: { template: null, rendered: null },
      tabs: ['text', 'history'],
    });
  });

  it('says why a stale step is stale', () => {
    const stale = buildTemplateView({
      anatomy: anatomyPlan,
      composition,
      check: {
        ...check,
        verbs: check.verbs.map(row =>
          row.name === 'stage-plan'
            ? { ...row, status: 'stale', staleBecause: ['source'] }
            : row
        ),
      },
      changes: undefined,
      step: 2,
    });
    expect(
      drawerContent({ kind: 'output', part: null }, stale, anatomyPlan, null)
        ?.sentence
    ).toBe('Stale: its template changed.');
  });

  it('says a rebind is rebuilt here but not synced', () => {
    const view = buildTemplateView({
      anatomy: anatomyPlanUnsynced,
      composition: compositionUnsynced,
      check,
      changes: changesUnsynced,
      step: 2,
    });
    expect(
      drawerContent(
        { kind: 'output', part: null },
        view,
        anatomyPlanUnsynced,
        null
      )?.sentence
    ).toBe('Rebuilt here, not synced yet.');
  });

  it('scrolls to one part', () => {
    expect(plan('output:include:gate-protocol')).toMatchObject({
      view: 'rendered',
      chip: 'L140 → L303-752',
      highlight: { template: [140, 140], rendered: [303, 752] },
      sentence:
        'gate-protocol is pasted here: 450 lines, 58% of what the agent reads in this step.',
    });
  });

  it('describes the step text as a share of the whole', () => {
    expect(plan('output:text')).toMatchObject({
      view: 'rendered',
      chip: null,
      sentence:
        '64 lines of step text, 8% of what the agent reads in this step.',
    });
  });
});

describe('a links-to chip', () => {
  it('opens the linked file beside the rendered step', () => {
    expect(plan('link:../../attachments/gates/SKILL.md')).toMatchObject({
      filePath: '/fixture/packs/acme/attachments/gates/SKILL.md',
      fileLabel: 'gates/SKILL.md',
      badge: 'pack text',
      canToggle: false,
      view: 'template',
      sentence: "This step's text links to it at line 32.",
      tabs: ['text'],
    });
  });
});

describe('a links-to chip into a base attachment copy', () => {
  const withCopy = {
    ...check,
    attachments: [
      {
        name: 'gates',
        base: 'acme-base',
        status: 'in-sync' as const,
        staleFiles: [],
        orphanFiles: [],
      },
    ],
  };
  const link = (checked: typeof check) =>
    drawerContent(
      parseTarget('link:../../attachments/gates/SKILL.md')!,
      planView,
      anatomyPlan,
      null,
      checked
    );

  it('names the base and says compile rewrites the copy', () => {
    const content = link(withCopy);
    expect(content?.badge).toBe('from acme-base');
    expect(content?.sentence).toBe(
      "This step's text links to it at line 32. Compile copies it from the org's acme-base base pack and rewrites it on every compile; edit it there."
    );
  });

  it('keeps pack text when the check holds no such row', () => {
    expect(link(check)?.badge).toBe('pack text');
    expect(link({ ...withCopy, attachments: [] })?.badge).toBe('pack text');
  });
});

describe('targets the view does not hold', () => {
  it.each([
    'row:2',
    'input:include:nope',
    'output:include:nope',
    'link:nope.md',
  ])('%s answers null', select => {
    expect(plan(select)).toBeNull();
  });

  it('answers null for an output on a view without one', () => {
    expect(work('output')).toBeNull();
  });
});

describe('a step never compiled', () => {
  const neverCompiled: SkillsAnatomy = {
    ...anatomyPlan,
    status: 'never-compiled',
    template: { ...anatomyPlan.template, builtVersion: null },
    rendered: { ...anatomyPlan.rendered, exists: false, lines: 0 },
    parts: anatomyPlan.parts.map(part => ({ ...part, renderedLines: null })),
    links: [],
  };
  const view = buildTemplateView({
    anatomy: neverCompiled,
    composition,
    check: {
      ...check,
      verbs: check.verbs.filter(row => row.name !== 'stage-plan'),
    },
    changes: undefined,
    step: 2,
  });
  const open = (select: string, requested: 'template' | 'rendered' | null) =>
    drawerContent(parseTarget(select)!, view, neverCompiled, requested);

  it('opens its output on the template, its toggle showing there is no rendered file', () => {
    expect(open('output', null)).toMatchObject({
      filePath: anatomyPlan.template.path,
      view: 'template',
      badge: null,
      canToggle: true,
      sentence: 'Never compiled.',
    });
  });

  it('opens its rows on the template even when asked for the rendered file', () => {
    for (const requested of [null, 'rendered'] as const) {
      expect(open('row:140', requested)).toMatchObject({
        filePath: anatomyPlan.template.path,
        view: 'template',
        canToggle: true,
        bands: [],
      });
    }
  });
});

describe('a step check has not measured', () => {
  it('says its status is unmeasured', () => {
    const view = buildTemplateView({
      anatomy: anatomyPlan,
      composition,
      check: undefined,
      changes: undefined,
      step: 2,
    });
    expect(
      drawerContent({ kind: 'output', part: null }, view, anatomyPlan, null)
        ?.sentence
    ).toBe('Status unmeasured.');
  });
});

describe('two includes on one template line', () => {
  const shared: SkillsAnatomy = {
    ...anatomyPlan,
    rendered: { ...anatomyPlan.rendered, lines: 12 },
    parts: [
      {
        kind: 'text',
        name: null,
        templateLines: [1, 2],
        renderedLines: [1, 2],
        mode: null,
        source: null,
        target: null,
        changed: false,
      },
      ...(['alpha', 'beta'] as const).map(name => ({
        kind: 'include' as const,
        name,
        templateLines: [3, 3] as [number, number],
        renderedLines: [3, 12] as [number, number],
        mode: null,
        source: {
          ref: `mattstack:${name}`,
          path: `/fixture/mattstack/attachments/${name}/SKILL.md`,
          version: '0.30.4',
          builtVersion: '0.28.10',
          lines: name === 'alpha' ? 4 : 6,
        },
        target: null,
        changed: false,
      })),
    ],
    links: [],
  };
  const view = buildTemplateView({
    anatomy: shared,
    composition,
    check,
    changes: undefined,
    step: 2,
  });

  it('sizes each by its own source, not the shared range', () => {
    expect(
      drawerContent(parseTarget('row:3')!, view, shared, null)?.sentence
    ).toBe(
      'alpha is pasted here: 4 lines, 33% of what the agent reads in this step.'
    );
    expect(
      drawerContent(parseTarget('output:include:beta')!, view, shared, null)
        ?.sentence
    ).toBe(
      'beta is pasted here: 6 lines, 50% of what the agent reads in this step.'
    );
  });
});

describe('withHeader', () => {
  const lines = [
    '---',
    'name: x',
    '---',
    '',
    '<!-- compiled by rt skills compile -->',
    '',
    '<!-- part: step source=acme:x -->',
    '# x',
  ];

  it('bands every line above the first part marker as the header', () => {
    expect(
      withHeader([{ from: 1, to: 8, label: 'step text', tone: 'muted' }], lines)
    ).toEqual([
      { from: 1, to: 6, label: 'header', tone: 'muted' },
      { from: 7, to: 8, label: 'step text', tone: 'muted' },
    ]);
  });

  it('leaves a file with no bands, or no marker, as it is', () => {
    expect(withHeader([], lines)).toEqual([]);
    const band = { from: 1, to: 2, label: 'step text', tone: 'muted' } as const;
    expect(withHeader([band], ['a', 'b'])).toEqual([band]);
  });
});
