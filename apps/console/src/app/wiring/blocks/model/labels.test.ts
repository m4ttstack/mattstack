import { describe, expect, it } from 'vitest';

import { countOf, cutLabel, shortLabel } from './labels';

describe('countOf', () => {
  it('names one thing in the singular and any other count in the plural', () => {
    expect(countOf(1, 'step')).toBe('1 step');
    expect(countOf(0, 'step')).toBe('0 steps');
    expect(countOf(27, 'block')).toBe('27 blocks');
  });
});

describe('shortLabel', () => {
  it('drops a trailing parenthetical that names the skill in view', () => {
    expect(shortLabel('Checks pass (ship)?', 'ship')).toBe('Checks pass?');
    expect(shortLabel('Watch CI (ship)', 'ship')).toBe('Watch CI');
  });

  it('keeps a parenthetical that says more than the skill', () => {
    expect(shortLabel('Done (ship again)?', 'ship')).toBe('Done (ship again)?');
    expect(shortLabel('Checks pass (plan)?', 'ship')).toBe(
      'Checks pass (plan)?'
    );
  });

  it('keeps the label whole with no skill, and reads a skill literally', () => {
    expect(shortLabel('Checks pass (ship)?', undefined)).toBe(
      'Checks pass (ship)?'
    );
    expect(shortLabel('Run (a.b)', 'a.b')).toBe('Run');
    expect(shortLabel('Run (axb)', 'a.b')).toBe('Run (axb)');
  });
});

describe('cutLabel', () => {
  it('cuts an exit label at its first colon', () => {
    expect(cutLabel('no: redo with their note')).toBe('no');
    expect(cutLabel('clean')).toBe('clean');
  });
});
