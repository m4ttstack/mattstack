import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../graph/__tests__/designFixtures';
import { buildFocusGroups } from '../../graph/model/focusModel';
import type { SkillsComposition } from '../../outline';
import { BuiltFromTable } from '../BuiltFromTable';
import { blockNote, builtFrom, staleSteps } from '../model/history';
import { usedBySites } from '../model/usedBy';

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

const groupsOfDesign = () =>
  buildFocusGroups(designFixture('composition'), designFixture('check'));

describe('usedBySites', () => {
  it('lists every skill that pastes gate-protocol, grouped as the focus list groups them', () => {
    const sites = usedBySites(
      designFixture('composition'),
      groupsOfDesign(),
      'gate-protocol'
    );

    expect(sites).toHaveLength(15);
    expect(sites.map(site => [site.group, site.skill, site.line])).toEqual([
      ['PIPELINE STEPS', 'work', 246],
      ['PIPELINE STEPS', 'stage-provision', 154],
      ['PIPELINE STEPS', 'stage-plan', 140],
      ['PIPELINE STEPS', 'stage-evidence', 268],
      ['PIPELINE STEPS', 'stage-ship', 435],
      ['PIPELINE STEPS', 'stage-watch-ci', 499],
      ['PIPELINE STEPS', 'work-a11y', 246],
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

  it('names a roster verb from its own includes when no target places it', () => {
    const composition = designFixture('composition');
    const sites = usedBySites(
      {
        ...composition,
        verbs: composition.verbs.map(verb =>
          verb.name === 'shepherdr'
            ? { ...verb, includes: ['gate-protocol'] }
            : verb
        ),
      },
      groupsOfDesign(),
      'gate-protocol'
    );

    expect(sites.find(site => site.skill === 'shepherdr')).toMatchObject({
      group: 'STANDALONE',
      line: null,
      focus: 'shepherdr',
    });
  });

  it('gives a skill the focus list does not show no focus, and names it plainly', () => {
    const composition = provisionUnlisted();
    const sites = usedBySites(
      composition,
      buildFocusGroups(composition, designFixture('check')),
      'gate-protocol'
    );

    expect(sites.find(site => site.skill === 'stage-provision')).toEqual({
      group: 'NOT WIRED INTO ANYTHING',
      skill: 'stage-provision',
      line: 154,
      focus: null,
      label: 'stage-provision',
    });
  });

  it("focuses a shared step under the canvas's pipeline", () => {
    const groups = groupsOfDesign();
    const at = (workType: string) =>
      usedBySites(
        designFixture('composition'),
        groups,
        'gate-protocol',
        groups.pipelines.find(item => item.key === `pipeline:${workType}`)!
      ).find(site => site.skill === 'stage-plan')?.focus;

    expect(at('accessibility')).toBe('stage-plan@accessibility');
    expect(at('feature')).toBe('stage-plan');
  });

  it("focuses an engine's include site on the canvas pipeline's copy of it", () => {
    const groups = groupsOfDesign();
    const sites = usedBySites(
      designFixture('composition'),
      groups,
      'gate-protocol',
      groups.pipelines.find(item => item.key === 'pipeline:accessibility')!
    );

    expect(sites.find(site => site.skill === 'stage-evidence')?.focus).toBe(
      'stage-evidence@accessibility'
    );
  });
});

describe('builtFrom', () => {
  it('lists a team section as its own team values row', () => {
    const anatomy = designFixture('anatomy.stage-plan');
    const domain = anatomy.parts.find(
      part => part.name === 'stage-plan.domain'
    )!;
    const section = {
      ...domain,
      kind: 'section' as const,
      name: 'ci-extra',
      templateLines: null,
      mode: null,
      changed: true,
      source: {
        ref: 'widgets:pack/sections/ci-extra.md',
        path: '/fixture/packs/widgets/pack/sections/ci-extra.md',
        version: '0.4.0',
        builtVersion: '0.4.0',
        lines: 2,
      },
    };
    const row = designFixture('check').verbs.find(
      verb => verb.name === 'stage-plan'
    )!;
    const rows = builtFrom(
      {
        ...anatomy,
        parts: anatomy.parts.flatMap(part =>
          part === domain ? [part, section] : [part]
        ),
      },
      { ...row, status: 'stale', staleBecause: ['team'] }
    );
    expect(rows.find(r => r.kind === 'team values')).toMatchObject({
      name: 'ci-extra',
      file: 'sections/ci-extra.md',
      status: 'changed',
    });
  });

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
          part.name === 'stage-plan.domain'
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
  });

  describe("a block's note", () => {
    const rows = builtFrom(
      designFixture('anatomy.stage-plan'),
      designFixture('check').verbs.find(row => row.name === 'stage-plan')
    );

    it('names the files that changed since the build', () => {
      const changed = rows.map((row, i) =>
        i === 1 ? { ...row, status: 'changed' as const } : row
      );
      expect(blockNote(changed, 'stage-plan')).toBe(
        `${rows[1]!.file} changed after stage-plan was built, so this block is out of date until a sync rebuilds it.`
      );
    });

    it('says a never-built skill holds no copy, and an unmeasured one is unmeasured', () => {
      expect(
        blockNote([{ ...rows[0]!, status: 'not built' }], 'stage-plan')
      ).toBe(
        'stage-plan has never been built, so it holds no copy of this block yet.'
      );
      expect(
        blockNote([{ ...rows[0]!, status: 'unmeasured' }], 'stage-plan')
      ).toBe(
        'rt skills check said nothing about stage-plan, so whether this block is current is unmeasured.'
      );
    });

    it('calls the block current when nothing changed', () => {
      expect(
        blockNote([{ ...rows[0]!, status: 'unchanged' }], 'stage-plan')
      ).toBe(
        'None of these files changed since stage-plan was built, so this block is current.'
      );
    });
  });

  describe('a base file takes its status from rt check, never the org token', () => {
    const baseAnatomy = (changed: boolean) => {
      const anatomy = designFixture('anatomy.stage-plan');
      return {
        ...anatomy,
        parts: anatomy.parts.map(part =>
          part.name === 'stage-plan.domain'
            ? {
                ...part,
                changed,
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
      };
    };
    const checkRow = designFixture('check').verbs.find(
      row => row.name === 'stage-plan'
    )!;
    const statusOfBase = (
      anatomy: ReturnType<typeof baseAnatomy>,
      row: typeof checkRow
    ) =>
      builtFrom(anatomy, row).find(r => r.file === 'plan-policy/SKILL.md')!
        .status;

    it('reads unchanged for a verb check calls in sync', () => {
      expect(statusOfBase(baseAnatomy(false), checkRow)).toBe('unchanged');
    });

    it('reads changed for a stale verb whose base file changed, as a plugin file does', () => {
      const stale = { ...checkRow, status: 'stale' as const };
      expect(statusOfBase(baseAnatomy(true), stale)).toBe('changed');
    });
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
