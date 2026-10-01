// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import type { SkillsCheck, SkillsComposition } from '../../../outline';
import type { SkillsAnatomy } from '../../../useWiring';
import { buildTemplateView, type TemplateRow } from '../templateModel';

const anatomyWork = designFixture('anatomy.work');
const anatomyPlan = designFixture('anatomy.stage-plan');
const anatomyPlanUnsynced = designFixture('anatomy.stage-plan.unsynced');
const composition = designFixture('composition');
const compositionUnsynced = designFixture('composition.unsynced');
const check = designFixture('check');
const changesClean = designFixture('changes.clean');
const changesUnsynced = designFixture('changes.unsynced');

type Part = SkillsAnatomy['parts'][number];

const rowText = (row: TemplateRow) =>
  row.kind === 'text' ? row.label : row.code;
const rowsOf = (rows: TemplateRow[]) =>
  rows.map(row => [row.gutter, rowText(row)]);

const workView = () =>
  buildTemplateView({
    anatomy: anatomyWork,
    composition,
    check,
    changes: changesClean,
    step: null,
  });
const planView = () =>
  buildTemplateView({
    anatomy: anatomyPlan,
    composition,
    check,
    changes: changesClean,
    step: 2,
  });

function withPart(
  anatomy: SkillsAnatomy,
  name: string,
  patch: Partial<Part>
): SkillsAnatomy {
  return {
    ...anatomy,
    parts: anatomy.parts.map(part =>
      part.name === name ? { ...part, ...patch } : part
    ),
  };
}

describe('the work template', () => {
  const view = workView();

  it('names its file and what it renders to', () => {
    expect(view.skill).toBe('work');
    expect(view.templateFile).toBe('work/SKILL.md');
    expect(view.templateMeta).toBe('250 lines → renders 824');
    expect(view.textNoun).toBe('orchestrator');
  });

  it('draws the 17 rows of the work board', () => {
    expect(rowsOf(view.rows)).toEqual([
      ['L1-28', '28 lines of orchestrator text'],
      ['L29', '{{verb.path:stage-provision}}'],
      ['L30', '{{verb.path:stage-plan}}'],
      ['L31', '{{verb.path:stage-gates}}'],
      ['L32', '{{verb.path:stage-evidence}}'],
      ['L33', '{{verb.path:stage-implement}}'],
      ['L34', '{{verb.path:stage-self-review}}'],
      ['L35', '{{verb.path:stage-ship}}'],
      ['L36', '{{verb.path:stage-watch-ci}}'],
      ['L37-39', '3 lines'],
      ['L40', '{{run-start.flags:work}}'],
      ['L41-241', '201 lines of orchestrator text'],
      ['L242', '{{slot:tiering}}'],
      ['L243-245', '3 lines'],
      ['L246', '{{include:gate-protocol}}'],
      ['L247-249', '3 lines'],
      ['L250', '{{include:wrap-up-form}}'],
    ]);
  });

  it('keys each row by the template line a select names', () => {
    expect(view.rows.map(row => row.line).slice(0, 3)).toEqual([1, 29, 30]);
    expect(new Set(view.rows.map(row => row.id)).size).toBe(17);
  });

  it('substitutes in the four inputs of the work board', () => {
    expect(
      view.inputs.map(card => [card.title, card.subtitle, card.icon])
    ).toEqual([
      ['run flags', 'variable · rt fills this in for each run', 'cpu'],
      [
        'model-tiering/SKILL.md',
        'mattstack default · picked by this pack',
        'fileText',
      ],
      ['gate-protocol/SKILL.md', 'partial · mattstack · 450 lines', 'fileText'],
      ['wrap-up-form/SKILL.md', 'partial · mattstack · 28 lines', 'fileText'],
    ]);
    expect(view.inputs.map(card => card.id)).toEqual([
      'variable:run-start.flags:work',
      'slot:tiering',
      'include:gate-protocol',
      'include:wrap-up-form',
    ]);
  });

  it('ties every input to the row of its placeholder', () => {
    const lineOf = (rowId: string) =>
      view.rows.find(row => row.id === rowId)?.line;
    expect(view.inputs.map(card => lineOf(card.rowId))).toEqual([
      40, 242, 246, 250,
    ]);
  });

  it('links to the eight rendered steps with their status from check', () => {
    expect(
      view.links.map(link => [link.title, link.subtitle, link.status])
    ).toEqual([
      ['stage-provision/SKILL.md', 'step 1 · rendered · 777 lines', 'in-sync'],
      ['stage-plan/SKILL.md', 'step 2 · rendered · 780 lines', 'in-sync'],
      ['stage-gates/SKILL.md', 'step 3 · rendered · 212 lines', 'in-sync'],
      [
        'stage-evidence/SKILL.md',
        'step 4 · stale: its template changed · 1152 lines',
        'stale',
      ],
      ['stage-implement/SKILL.md', 'step 5 · rendered · 91 lines', 'in-sync'],
      [
        'stage-self-review/SKILL.md',
        'step 6 · rendered · 105 lines',
        'in-sync',
      ],
      [
        'stage-ship/SKILL.md',
        'step 7 · stale: its template changed · 1091 lines',
        'stale',
      ],
      [
        'stage-watch-ci/SKILL.md',
        'step 8 · stale: its template changed · 1116 lines',
        'stale',
      ],
    ]);
    expect(view.links[1]!.skill).toBe('stage-plan');
    expect(
      view.links.map(link => view.rows.find(r => r.id === link.rowId)?.line)
    ).toEqual([29, 30, 31, 32, 33, 34, 35, 36]);
  });

  it('names the drift cause behind a stale step', () => {
    const causes = [
      ['include', 'a pasted file changed'],
      ['fill', 'its pack text changed'],
      ['frontmatter', 'its header changed'],
      ['structure', 'its files changed'],
      ['vendored', 'its files changed'],
    ] as const;
    for (const [cause, words] of causes) {
      const drifted: SkillsCheck = {
        ...check,
        verbs: check.verbs.map(row =>
          row.name === 'stage-gates'
            ? { ...row, status: 'stale', staleBecause: [cause] }
            : row
        ),
      };
      const view = buildTemplateView({
        anatomy: anatomyWork,
        composition,
        check: drifted,
        changes: undefined,
        step: null,
      });
      expect(view.links[2]!.subtitle).toBe(
        `step 3 · stale: ${words} · 212 lines`
      );
    }
  });

  it('has links instead of an output card', () => {
    expect(view.output).toBeNull();
  });
});

describe('the plan step template', () => {
  const view = planView();

  it('names its file and the build that rendered it', () => {
    expect(view.templateFile).toBe('stage-plan/SKILL.md');
    expect(view.templateMeta).toBe('144 lines · mattstack 0.28.10');
    expect(view.textNoun).toBe('step');
    expect(view.links).toEqual([]);
  });

  it('draws the 10 rows of the plan board', () => {
    expect(rowsOf(view.rows)).toEqual([
      ['L1-15', '15 lines of step text'],
      ['L16', '{{stage.fields}}'],
      ['L17-75', '59 lines of step text'],
      ['L76', '{{include:execution-strategy}}'],
      ['L77-135', '59 lines of step text'],
      ['L136', '{{slot:domain}}'],
      ['L137-139', '3 lines'],
      ['L140', '{{include:gate-protocol}}'],
      ['L141-143', '3 lines'],
      ['L144', '{{include:wrap-up-form}}'],
    ]);
  });

  it('substitutes in the five inputs of the plan board', () => {
    expect(
      view.inputs.map(card => [card.title, card.subtitle, card.subtitleTone])
    ).toEqual([
      ['run fields', 'variable · rt fills this in for each run', 'dimmed'],
      [
        'execution-strategy/SKILL.md',
        'partial · mattstack · 149 lines',
        'dimmed',
      ],
      ['plan-policy/SKILL.md', 'written by acme · 80 lines', 'accent'],
      ['gate-protocol/SKILL.md', 'partial · mattstack · 450 lines', 'dimmed'],
      ['wrap-up-form/SKILL.md', 'partial · mattstack · 28 lines', 'dimmed'],
    ]);
    expect(view.inputs.every(card => card.state === 'ok')).toBe(true);
  });

  it('counts the skills in this pack that use each input', () => {
    expect(view.inputs.map(card => [card.id, card.usedBy])).toEqual([
      ['variable:stage.fields', 0],
      ['include:execution-strategy', 1],
      ['slot:domain', 1],
      ['include:gate-protocol', 14],
      ['include:wrap-up-form', 2],
    ]);
  });

  it('carries the slot contract on its row', () => {
    const slot = view.rows.find(row => row.line === 136);
    expect(slot).toMatchObject({ name: 'domain', contract: 'plan-domain@1' });
  });

  it('breaks the rendered output down as the plan board does', () => {
    expect(view.output).toMatchObject({
      step: 2,
      title: 'plan',
      lines: 780,
      status: 'in-sync',
      reason: null,
    });
    expect(
      view.output!.parts.map(part => [
        part.label,
        `${part.lines} · ${part.share}%`,
        part.own,
      ])
    ).toEqual([
      ['step text', '64 · 8%', true],
      ['execution-strategy', '149 · 19%', false],
      ['plan-policy', '80 · 10%', false],
      ['gate-protocol', '450 · 58%', false],
      ['wrap-up-form', '28 · 4%', false],
    ]);
    expect(view.output!.parts.map(part => part.id)).toEqual([
      'text',
      'include:execution-strategy',
      'slot:domain',
      'include:gate-protocol',
      'include:wrap-up-form',
    ]);
  });

  it('lists the files its text links to', () => {
    expect(view.output!.links).toEqual([
      {
        label: 'gates/SKILL.md',
        path: '../../attachments/gates/SKILL.md',
        skill: null,
      },
      {
        label: 'evidence/SKILL.md',
        path: '../../attachments/evidence/SKILL.md',
        skill: null,
      },
      {
        label: 'dev-servers/SKILL.md',
        path: '../../attachments/dev-servers/SKILL.md',
        skill: null,
      },
    ]);
  });

  it('names the compiled skill a link points at', () => {
    const view = buildTemplateView({
      anatomy: {
        ...anatomyPlan,
        links: [{ path: '../stage-ship/SKILL.md', line: 9 }],
      },
      composition,
      check,
      changes: undefined,
      step: 2,
    });
    expect(view.output!.links[0]!.skill).toBe('stage-ship');
  });

  it('reports the stale cause check gives', () => {
    const stale: SkillsCheck = {
      ...check,
      verbs: check.verbs.map(row =>
        row.name === 'stage-plan'
          ? { ...row, status: 'stale', staleBecause: ['fill'] }
          : row
      ),
    };
    const view = buildTemplateView({
      anatomy: anatomyPlan,
      composition,
      check: stale,
      changes: undefined,
      step: 2,
    });
    expect(view.output).toMatchObject({
      status: 'stale',
      reason: 'its pack text changed',
    });
  });
});

describe('slot states', () => {
  it('marks a slot rendered as a reference', () => {
    const view = buildTemplateView({
      anatomy: withPart(anatomyPlan, 'domain', { mode: 'reference' }),
      composition,
      check,
      changes: undefined,
      step: 2,
    });
    const row = view.rows.find(r => r.line === 136);
    expect(row).toMatchObject({ state: 'referenced' });
    expect(view.inputs.find(c => c.id === 'slot:domain')).toMatchObject({
      state: 'referenced',
      subtitle: 'referenced: the rendered text links to it',
    });
  });

  const releaseNotes = (required: boolean): SkillsComposition => ({
    ...composition,
    verbs: composition.verbs.map(verb =>
      verb.name === 'release-notes'
        ? {
            ...verb,
            slots: verb.slots.map(slot => ({ ...slot, required })),
          }
        : verb
    ),
  });
  const releaseNotesAnatomy: SkillsAnatomy = {
    ...anatomyPlan,
    skill: 'release-notes',
    kind: 'verb',
    public: true,
    template: {
      ...anatomyPlan.template,
      ref: 'mattstack:release-notes',
      path: '/fixture/mattstack/skills/release-notes/SKILL.md',
      lines: 30,
    },
    parts: [
      {
        kind: 'text',
        name: null,
        templateLines: [1, 21],
        renderedLines: [1, 21],
        mode: null,
        source: null,
        target: null,
        changed: false,
      },
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

  it('warns about a required slot nothing fills', () => {
    const view = buildTemplateView({
      anatomy: releaseNotesAnatomy,
      composition: releaseNotes(true),
      check,
      changes: undefined,
      step: null,
    });
    expect(view.rows[1]).toMatchObject({ state: 'required-unbound' });
    expect(view.inputs).toEqual([
      expect.objectContaining({
        id: 'slot:changelog',
        title: 'changelog slot',
        subtitle: 'required, nothing bound',
        path: null,
        state: 'required-unbound',
      }),
    ]);
    expect(view.textNoun).toBe('verb');
    expect(view.output!.parts[0]!.label).toBe('verb text');
  });

  it('leaves an optional slot nothing fills without a card', () => {
    const view = buildTemplateView({
      anatomy: releaseNotesAnatomy,
      composition: releaseNotes(false),
      check,
      changes: undefined,
      step: null,
    });
    expect(view.rows[1]).toMatchObject({ state: 'optional-unbound' });
    expect(view.inputs).toEqual([]);
  });

  it('carries the rt message for a slot that failed to resolve', () => {
    const failing: SkillsComposition = {
      ...composition,
      verbs: composition.verbs.map(verb =>
        verb.name === 'release-notes'
          ? {
              ...verb,
              slots: verb.slots.map(slot => ({
                ...slot,
                resolveError: 'no fill provides changelog-style@1',
              })),
            }
          : verb
      ),
    };
    const view = buildTemplateView({
      anatomy: releaseNotesAnatomy,
      composition: failing,
      check,
      changes: undefined,
      step: null,
    });
    expect(view.rows[1]).toMatchObject({ state: 'resolve-error' });
    expect(view.inputs[0]).toMatchObject({
      state: 'resolve-error',
      subtitle: 'no fill provides changelog-style@1',
    });
  });

  it('names the fill a slot is bound to when that fill is missing', () => {
    const view = buildTemplateView({
      anatomy: withPart(anatomyPlan, 'domain', {
        source: null,
        renderedLines: null,
      }),
      composition,
      check,
      changes: undefined,
      step: 2,
    });
    expect(view.rows.find(r => r.line === 136)).toMatchObject({
      state: 'no-matching-fill',
    });
    expect(view.inputs.find(c => c.id === 'slot:domain')).toMatchObject({
      title: 'plan-policy/SKILL.md',
      subtitle: 'no fill named acme:plan-policy in this pack',
      state: 'no-matching-fill',
    });
  });

  it('tags a rebind not yet synced on the row, the card and the output', () => {
    const view = buildTemplateView({
      anatomy: anatomyPlanUnsynced,
      composition: compositionUnsynced,
      check,
      changes: changesUnsynced,
      step: 2,
    });
    expect(view.rows.find(r => r.line === 136)).toMatchObject({
      state: 'unsynced',
    });
    expect(view.inputs.find(c => c.id === 'slot:domain')).toMatchObject({
      title: 'plan-policy-strict/SKILL.md',
      subtitle: 'written by acme · 64 lines',
      state: 'unsynced',
    });
    expect(view.output!.status).toBe('unsynced');
    expect(
      view.output!.parts.map(p => [p.label, `${p.lines} · ${p.share}%`])
    ).toEqual([
      ['step text', '64 · 8%'],
      ['execution-strategy', '149 · 19%'],
      ['plan-policy-strict', '64 · 8%'],
      ['gate-protocol', '450 · 58%'],
      ['wrap-up-form', '28 · 4%'],
    ]);
  });
});

describe('engines without a template trace', () => {
  it('gutters the rows of a legacy engine by their rendered lines', () => {
    const legacy: SkillsAnatomy = {
      ...anatomyPlan,
      parts: [
        {
          kind: 'text',
          name: null,
          templateLines: null,
          renderedLines: [5, 6],
          mode: null,
          source: null,
          target: null,
          changed: false,
        },
        {
          kind: 'include',
          name: 'gate-protocol',
          templateLines: null,
          renderedLines: [7, 456],
          mode: null,
          source: anatomyPlan.parts[7]!.source,
          target: null,
          changed: false,
        },
      ],
    };
    const view = buildTemplateView({
      anatomy: legacy,
      composition,
      check,
      changes: undefined,
      step: 2,
    });
    expect(rowsOf(view.rows)).toEqual([
      ['rendered L5-6', '2 lines'],
      ['rendered L7-456', '{{include:gate-protocol}}'],
    ]);
    expect(view.rows.map(row => row.line)).toEqual([5, 7]);
    expect(view.rows[1]).toMatchObject({ templateLine: null });
  });
});

describe('a step never compiled', () => {
  const neverCompiled: SkillsAnatomy = {
    ...anatomyPlan,
    status: 'never-compiled',
    rendered: { ...anatomyPlan.rendered, exists: false, lines: 0 },
    parts: anatomyPlan.parts.map(part => ({ ...part, renderedLines: null })),
    links: [],
  };
  const checkWithout: SkillsCheck = {
    ...check,
    verbs: check.verbs.filter(row => row.name !== 'stage-plan'),
  };

  it('falls back to the anatomy when check has no row for it', () => {
    const view = buildTemplateView({
      anatomy: neverCompiled,
      composition,
      check: checkWithout,
      changes: undefined,
      step: 2,
    });
    expect(view.output).toMatchObject({
      status: 'never-compiled',
      lines: 0,
      parts: [],
      links: [],
    });
  });

  it('takes the word of check when it has a row', () => {
    const view = buildTemplateView({
      anatomy: neverCompiled,
      composition,
      check: {
        ...check,
        verbs: check.verbs.map(row =>
          row.name === 'stage-plan' ? { ...row, status: 'never-compiled' } : row
        ),
      },
      changes: undefined,
      step: 2,
    });
    expect(view.output!.status).toBe('never-compiled');
  });
});
