import { describe, expect, it } from 'vitest';

import type { FocusItem } from '../graph/model/focusModel';
import { switcherMetaOf } from './skillKind';

const item = (over: Partial<FocusItem> = {}): FocusItem => ({
  key: 'ship',
  label: 'ship',
  skill: 'ship',
  icon: 'squareTerminal',
  step: null,
  attention: false,
  children: [],
  ...over,
});

const feature = item({
  key: 'pipeline:feature',
  label: 'feature',
  skill: 'work',
  icon: 'workflow',
  children: Array.from({ length: 8 }, (_, i) => item({ key: `s${i}` })),
});

describe('switcherMetaOf', () => {
  it('says how a verb runs and how many blocks it has', () => {
    expect(switcherMetaOf(item(), null, 38)).toBe('on-demand · 38 blocks');
    expect(switcherMetaOf(item({ icon: 'lock' }), null, 1)).toBe(
      'internal verb · 1 block'
    );
  });

  it('names a stage by its place, leaving the pipeline to the header', () => {
    const plan = item({ key: 'stage-plan', label: 'plan', step: 2 });
    expect(switcherMetaOf(plan, feature, 9)).toBe('stage 2 of 8 · 9 blocks');
  });

  it('calls a board skill a board skill', () => {
    expect(switcherMetaOf(item({ icon: 'layoutDashboard' }), null, null)).toBe(
      'board skill'
    );
  });
});
