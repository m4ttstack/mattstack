// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import type { SkillsSurfaceRow } from '../useWiring';
import { SURFACE_GROUP_ORDER, surfaceGroupsOf } from './surfaceGroups';

const item = (skill: string, children: FocusItem[] = []): FocusItem => ({
  key: skill,
  label: skill,
  skill,
  icon: 'squareTerminal',
  step: null,
  attention: false,
  children,
});

const GROUPS: FocusGroups = {
  pipelines: [item('work', [item('stage-plan'), item('stage-ship')])],
  standalone: [item('review')],
  board: [],
  skills: [],
  unwired: { count: 1, attention: false, items: [item('loose')] },
  empty: null,
};

const row = (
  name: string,
  kind: SkillsSurfaceRow['kind'] = 'compiled',
  over: Partial<SkillsSurfaceRow> = {}
): SkillsSurfaceRow =>
  ({ name, kind, status: 'internal', ...over }) as SkillsSurfaceRow;

const fills = (...names: string[]) => ({
  fills: names.map(name => ({ binding: `acme:${name}` })),
});

describe('surfaceGroupsOf', () => {
  it('orders the groups commands, reference skills, stages, then fills', () => {
    expect(SURFACE_GROUP_ORDER).toEqual([
      'commands',
      'reference',
      'stages',
      'fills',
    ]);
  });

  it('puts each row in the group the focus groups give it', () => {
    const groups = surfaceGroupsOf(
      [
        row('work'),
        row('review'),
        row('stage-plan'),
        row('criteria', 'hand-authored'),
        row('notes', 'hand-authored'),
      ],
      GROUPS,
      fills('criteria') as never
    );
    expect(Object.fromEntries(groups)).toEqual({
      work: 'commands',
      review: 'commands',
      'stage-plan': 'stages',
      criteria: 'fills',
      notes: 'reference',
    });
  });

  it('files a base reference skill and a base fill by what they do', () => {
    const groups = surfaceGroupsOf(
      [
        row('stage-ship', 'compiled', { base: 'acme-base' }),
        row('board-review', 'compiled', { base: 'acme-base', fill: true }),
      ],
      GROUPS,
      undefined
    );
    expect(groups.get('stage-ship')).toBe('reference');
    expect(groups.get('board-review')).toBe('fills');
  });

  it('lists a public fill or stage with what agents see, so it can be turned off', () => {
    const groups = surfaceGroupsOf(
      [
        row('criteria', 'hand-authored', { status: 'public' }),
        row('stage-plan', 'compiled', { status: 'public' }),
      ],
      GROUPS,
      fills('criteria') as never
    );
    expect(groups.get('criteria')).toBe('reference');
    expect(groups.get('stage-plan')).toBe('commands');
  });

  it('keeps a fill nothing binds out of Fills', () => {
    const groups = surfaceGroupsOf(
      [row('loose', 'hand-authored')],
      GROUPS,
      fills('loose') as never
    );
    expect(groups.get('loose')).toBe('reference');
  });

  it('falls back by kind with no composition yet: compiled to Commands, the rest to reference skills', () => {
    const groups = surfaceGroupsOf(
      [row('ship'), row('context', 'hand-authored')],
      null,
      undefined
    );
    expect(groups.get('ship')).toBe('commands');
    expect(groups.get('context')).toBe('reference');
  });
});
