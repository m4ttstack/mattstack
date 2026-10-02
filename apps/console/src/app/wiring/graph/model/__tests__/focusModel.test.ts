// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import type { SkillsComposition } from '../../../outline';
import {
  buildFocusGroups,
  findFocus,
  firstFocus,
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

  it('gives one pipeline led by the orchestrator', () => {
    expect(groups.pipelines).toHaveLength(1);
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

  it('lists the on-demand verbs with internal ones locked and review flagged', () => {
    expect(
      groups.onDemand.map(item => [item.label, item.key, item.icon])
    ).toEqual([
      ['shepherdr', 'shepherdr', 'squareTerminal'],
      ['review', 'review', 'squareTerminal'],
      ['self-review', 'self-review', 'lock'],
      ['receive-review', 'receive-review', 'lock'],
      ['ship', 'ship', 'squareTerminal'],
      ['watch-ci', 'watch-ci', 'squareTerminal'],
    ]);
    expect(flagged(groups.onDemand)).toEqual(['review']);
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

  it('counts unwired verbs and the fill nothing binds, flagged for the required slot left unbound', () => {
    expect(groups.unwired.count).toBe(6);
    expect(groups.unwired.attention).toBe(true);
    expect(labels(groups.unwired.items)).toEqual([
      'checkout',
      'sync-open-mrs',
      'rebase-worktree',
      'release-notes',
      'standup',
    ]);
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
      'work · bugfix',
    ]);
    expect(groups.pipelines[1]!.key).toBe('pipeline:bugfix');
    expect(
      groups.pipelines[1]!.children.map(step => [step.step, step.label])
    ).toEqual([
      [1, 'provision'],
      [2, 'implement'],
      [3, 'ship'],
    ]);
    expect(labels(groups.onDemand)).toEqual(
      labels(buildFocusGroups(composition, check).onDemand)
    );
  });

  it('marks a pack with no pipeline and lists its orchestrator on demand', () => {
    const groups = buildFocusGroups({ ...composition, pipelines: {} }, check);
    expect(groups.empty).toBe('no-pipeline');
    expect(groups.pipelines).toEqual([]);
    expect(labels(groups.onDemand)[0]).toBe('work');
  });

  it('tells an rt too old to report pipelines apart from a pack that declares none', () => {
    const groups = buildFocusGroups(
      { ...composition, pipelines: undefined },
      check
    );
    expect(groups.empty).toBe('rt-without-pipelines');
    expect(groups.pipelines).toEqual([]);
    expect(labels(groups.onDemand)[0]).toBe('work');
  });

  it('lists a board binder that binds no slot', () => {
    const groups = buildFocusGroups(
      {
        ...composition,
        binders: [
          ...composition.binders,
          { ref: 'board:triage', verb: null, kind: 'external', slots: [] },
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
    expect(flagged(groups.onDemand)).toEqual([]);
    expect(groups.unwired.attention).toBe(true);
  });
});

describe('onlyAttention', () => {
  const filtered = onlyAttention(buildFocusGroups(composition, check));

  it('keeps work with only its stale steps', () => {
    expect(labels(filtered.pipelines)).toEqual(['work · feature']);
    expect(labels(filtered.pipelines[0]!.children)).toEqual([
      'evidence',
      'ship',
      'watch-ci',
    ]);
  });

  it('keeps review and unwired, and drops the board group', () => {
    expect(labels(filtered.onDemand)).toEqual(['review']);
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

  it('starts on the first on-demand verb when the pack declares no pipeline', () => {
    const groups = buildFocusGroups(
      { ...composition, pipelines: {} } as SkillsComposition,
      check
    );
    expect(firstFocus(groups)?.key).toBe(groups.onDemand[0]!.key);
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

describe('workTypeOf', () => {
  it('reads the work type out of a pipeline key and nothing else', () => {
    expect(workTypeOf('pipeline:feature')).toBe('feature');
    expect(workTypeOf('stage-plan')).toBeNull();
  });
});
