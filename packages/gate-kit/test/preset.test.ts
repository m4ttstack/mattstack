import { expect, test } from 'vitest';

import { presetSelections, withoutPreset } from '@mattstack/gate-kit';

const NEXT = { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'iterate', 'hold'] };

test('Proceed is preset on a single-select next that offers it', () => {
  expect(presetSelections([NEXT])).toEqual({ next: 'proceed' });
  expect(presetSelections([{ ...NEXT, options: [{ value: 'proceed', label: 'Proceed (Recommended)' }, 'hold'] }])).toEqual({ next: 'proceed' });
});

test('nothing is preset without a next question, without proceed, or on a multi', () => {
  expect(presetSelections([{ ...NEXT, id: 'action' }])).toEqual({});
  expect(presetSelections([{ ...NEXT, options: ['done', 'hold'] }])).toEqual({});
  expect(presetSelections([{ ...NEXT, multi: true }])).toEqual({});
});

test('withoutPreset drops only picks still equal to the preset', () => {
  expect(withoutPreset({ next: 'proceed', tier: 'a' }, { next: 'proceed' })).toEqual({ tier: 'a' });
  expect(withoutPreset({ next: 'hold' }, { next: 'proceed' })).toEqual({ next: 'hold' });
});
