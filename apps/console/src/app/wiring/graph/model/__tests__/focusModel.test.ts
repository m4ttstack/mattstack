// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import type { SkillsComposition } from '../../../outline';
import {
  buildFocusGroups,
  findFocus,
  firstFocus,
  focusUnder,
  onlyAttention,
  pipelineOf,
  workTypeOf,
  type FocusItem,
} from '../focusModel';

const composition = designFixture('composition');
const check = designFixture('check');

const labels = (items: FocusItem[]) => items.map(item => item.label);
const flagged = (items: FocusItem[]) =>
  items.filter(item => item.attention).map(item => item.label);

describe('buildFocusGroups on the design pack', () => {
  const groups = buildFocusGroups(composition, check);

  it('gives one item per pipeline, feature led by the orchestrator', () => {
    expect(groups.pipelines.map(pipeline => pipeline.key)).toEqual([
      'pipeline:feature',
      'pipeline:accessibility',
    ]);
    expect(groups.pipelines[0]).toMatchObject({
      key: 'pipeline:feature',
      label: 'work · feature',
      skill: 'work',
      icon: 'workflow',
      step: null,
      attention: true,
    });
  });

  it('numbers the pipeline steps in run order under their short names', () => {
    const steps = groups.pipelines[0]!.children;
    expect(steps.map(s => [s.step, s.label, s.key, s.skill])).toEqual([
      [1, 'provision', 'stage-provision', 'stage-provision'],
      [2, 'plan', 'stage-plan', 'stage-plan'],
      [3, 'gates', 'stage-gates', 'stage-gates'],
      [4, 'evidence', 'stage-evidence', 'stage-evidence'],
      [5, 'implement', 'stage-implement', 'stage-implement'],
      [6, 'self-review', 'stage-self-review', 'stage-self-review'],
      [7, 'ship', 'stage-ship', 'stage-ship'],
      [8, 'watch-ci', 'stage-watch-ci', 'stage-watch-ci'],
    ]);
  });

  it('flags the steps check calls stale', () => {
    expect(flagged(groups.pipelines[0]!.children)).toEqual([
      'evidence',
      'ship',
      'watch-ci',
    ]);
  });

  it('lists the standalone verbs, propless ones included, with internal ones locked, review and standup flagged', () => {
    expect(
      groups.standalone.map(item => [item.label, item.key, item.icon])
    ).toEqual([
      ['shepherdr', 'shepherdr', 'squareTerminal'],
      ['review', 'review', 'squareTerminal'],
      ['self-review', 'self-review', 'lock'],
      ['receive-review', 'receive-review', 'lock'],
      ['ship', 'ship', 'squareTerminal'],
      ['watch-ci', 'watch-ci', 'squareTerminal'],
      ['checkout', 'checkout', 'squareTerminal'],
      ['sync-open-mrs', 'sync-open-mrs', 'squareTerminal'],
      ['rebase-worktree', 'rebase-worktree', 'squareTerminal'],
      ['standup', 'standup', 'squareTerminal'],
    ]);
    // standup's engine is no block tree, which rt reports as an engine error.
    expect(flagged(groups.standalone)).toEqual(['review', 'standup']);
  });

  it('lists the board skills this pack binds', () => {
    expect(
      groups.board.map(item => [item.label, item.key, item.skill, item.icon])
    ).toEqual([
      ['board:review', 'board:review', 'board:review', 'layoutDashboard'],
      ['board:respond', 'board:respond', 'board:respond', 'layoutDashboard'],
      ['board:doctor', 'board:doctor', 'board:doctor', 'layoutDashboard'],
    ]);
  });

  it('counts the verb whose prop nothing binds and the fill nothing binds, flagged for the required prop', () => {
    expect(groups.unwired.count).toBe(2);
    expect(groups.unwired.attention).toBe(true);
    expect(labels(groups.unwired.items)).toEqual(['release-notes']);
    expect(flagged(groups.unwired.items)).toEqual(['release-notes']);
  });

  it('is not empty', () => {
    expect(groups.empty).toBeNull();
  });
});

describe('buildFocusGroups on other packs', () => {
  it('gives one pipeline item per declared pipeline', () => {
    const twoPipelines: SkillsComposition = {
      ...composition,
      pipelines: {
        ...composition.pipelines,
        bugfix: [
          'mattstack:stage-provision',
          'mattstack:stage-implement',
          'mattstack:stage-ship',
        ],
      },
    };
    const groups = buildFocusGroups(twoPipelines, check);
    expect(labels(groups.pipelines)).toEqual([
      'work · feature',
      'work-a11y · accessibility',
      'work · bugfix',
    ]);
    expect(groups.pipelines[2]!.key).toBe('pipeline:bugfix');
    expect(
      groups.pipelines[2]!.children.map(step => [step.step, step.label])
    ).toEqual([
      [1, 'provision'],
      [2, 'implement'],
      [3, 'ship'],
    ]);
    expect(labels(groups.standalone)).toEqual(
      labels(buildFocusGroups(composition, check).standalone)
    );
  });

  it('marks a pack with no pipeline and lists its orchestrator on demand', () => {
    const groups = buildFocusGroups({ ...composition, pipelines: {} }, check);
    expect(groups.empty).toBe('no-pipeline');
    expect(groups.pipelines).toEqual([]);
    expect(labels(groups.standalone)[0]).toBe('work');
  });

  it('tells an rt too old to report pipelines apart from a pack that declares none', () => {
    const groups = buildFocusGroups(
      { ...composition, pipelines: undefined },
      check
    );
    expect(groups.empty).toBe('rt-without-pipelines');
    expect(groups.pipelines).toEqual([]);
    expect(labels(groups.standalone)[0]).toBe('work');
  });

  it('lists a board binder that binds no prop', () => {
    const groups = buildFocusGroups(
      {
        ...composition,
        binders: [
          ...composition.binders,
          { ref: 'board:triage', verb: null, kind: 'external', props: [] },
        ],
      },
      check
    );
    expect(labels(groups.board)).toEqual([
      'board:review',
      'board:respond',
      'board:doctor',
      'board:triage',
    ]);
  });

  it('flags nothing from drift when check has not answered', () => {
    const groups = buildFocusGroups(composition, undefined);
    expect(groups.pipelines[0]!.attention).toBe(false);
    expect(flagged(groups.standalone)).toEqual(['standup']);
    expect(groups.unwired.attention).toBe(true);
  });
});

describe('onlyAttention', () => {
  const filtered = onlyAttention(buildFocusGroups(composition, check));

  it('keeps work with only its stale steps', () => {
    expect(labels(filtered.pipelines)).toEqual([
      'work · feature',
      'work-a11y · accessibility',
    ]);
    expect(labels(filtered.pipelines[1]!.children)).toEqual([
      'ship',
      'watch-ci',
    ]);
    expect(labels(filtered.pipelines[0]!.children)).toEqual([
      'evidence',
      'ship',
      'watch-ci',
    ]);
  });

  it('keeps review, standup and unwired, and drops the board group', () => {
    expect(labels(filtered.standalone)).toEqual(['review', 'standup']);
    expect(filtered.board).toEqual([]);
    expect(labels(filtered.unwired.items)).toEqual(['release-notes']);
  });

  it('counts only the unwired verbs it kept', () => {
    expect(filtered.unwired.count).toBe(1);
  });

  it('hides unwired when nothing in it needs attention', () => {
    const groups = buildFocusGroups(composition, check);
    const quiet = onlyAttention({
      ...groups,
      unwired: { ...groups.unwired, attention: false },
    });
    expect(quiet.unwired.count).toBe(0);
  });
});

describe('findFocus', () => {
  const groups = buildFocusGroups(composition, check);

  it('finds a pipeline, a step, a verb, a board skill and an unwired verb by key', () => {
    expect(findFocus(groups, 'pipeline:feature')?.label).toBe('work · feature');
    expect(findFocus(groups, 'stage-plan')?.step).toBe(2);
    expect(findFocus(groups, 'review')?.icon).toBe('squareTerminal');
    expect(findFocus(groups, 'board:doctor')?.label).toBe('board:doctor');
    expect(findFocus(groups, 'checkout')?.label).toBe('checkout');
  });

  it('finds the pipeline its orchestrator leads by the skill name', () => {
    expect(findFocus(groups, 'work')?.key).toBe('pipeline:feature');
  });

  it('answers null for the unwired list and an unknown key', () => {
    expect(findFocus(groups, 'unwired')).toBeNull();
    expect(findFocus(groups, 'nope')).toBeNull();
  });
});

describe('firstFocus', () => {
  it('starts on the first pipeline', () => {
    expect(firstFocus(buildFocusGroups(composition, check))?.key).toBe(
      'pipeline:feature'
    );
  });

  it('starts on the first standalone verb when the pack declares no pipeline', () => {
    const groups = buildFocusGroups(
      { ...composition, pipelines: {} } as SkillsComposition,
      check
    );
    expect(firstFocus(groups)?.key).toBe(groups.standalone[0]!.key);
  });
});

describe('pipelineOf', () => {
  const groups = buildFocusGroups(composition, check);

  it('answers the pipeline for itself and for each of its steps', () => {
    expect(pipelineOf(groups, groups.pipelines[0]!)?.key).toBe(
      'pipeline:feature'
    );
    expect(pipelineOf(groups, findFocus(groups, 'stage-plan')!)?.key).toBe(
      'pipeline:feature'
    );
  });

  it('answers null for a verb outside the pipeline', () => {
    expect(pipelineOf(groups, findFocus(groups, 'shepherdr')!)).toBeNull();
  });
});

describe('a specialized pipeline', () => {
  const groups = buildFocusGroups(composition, check);
  const a11y = groups.pipelines.find(
    pipeline => pipeline.key === 'pipeline:accessibility'
  )!;

  it('is led by the verb that runs it', () => {
    expect(a11y).toMatchObject({
      label: 'work-a11y · accessibility',
      skill: 'work-a11y',
    });
  });

  it("groups a stage copy under its engine's step, keyed apart from the default's", () => {
    expect(a11y.children).toHaveLength(8);
    expect(a11y.children[3]).toMatchObject({
      key: 'stage-evidence@accessibility',
      label: 'evidence',
      skill: 'stage-evidence--accessibility',
      step: 4,
    });
    expect(pipelineOf(groups, a11y.children[3]!)?.key).toBe(
      'pipeline:accessibility'
    );
    expect(findFocus(groups, 'stage-evidence--accessibility')?.key).toBe(
      'stage-evidence@accessibility'
    );
  });

  it('never lists a pipeline lead as standalone or unwired', () => {
    const elsewhere = [...groups.standalone, ...groups.unwired.items].map(
      item => item.skill
    );
    expect(elsewhere).not.toContain('work');
    expect(elsewhere).not.toContain('work-a11y');
  });
});

describe('focusUnder', () => {
  const groups = buildFocusGroups(composition, check);
  const pipeline = (workType: string) =>
    groups.pipelines.find(item => item.key === `pipeline:${workType}`)!;

  it("opens a step under the canvas's pipeline when that pipeline lists it", () => {
    expect(focusUnder(pipeline('accessibility'), 'stage-plan')).toBe(
      'stage-plan@accessibility'
    );
    expect(
      focusUnder(pipeline('accessibility'), 'stage-evidence--accessibility')
    ).toBe('stage-evidence@accessibility');
  });

  it("opens the first pipeline's step on its own canvas and off any pipeline", () => {
    expect(focusUnder(pipeline('feature'), 'stage-plan')).toBe('stage-plan');
    expect(focusUnder(null, 'stage-plan')).toBe('stage-plan');
    expect(focusUnder(pipeline('accessibility'), 'review')).toBe('review');
  });
});

describe('workTypeOf', () => {
  it('reads the work type out of a pipeline key and nothing else', () => {
    expect(workTypeOf('pipeline:feature')).toBe('feature');
    expect(workTypeOf('stage-plan')).toBeNull();
  });
});
