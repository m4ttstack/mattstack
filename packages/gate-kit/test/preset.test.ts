import { expect, test } from 'vitest';

import {
  presetSelections,
  recommendedPick,
  withoutPreset,
} from '@mattstack/gate-kit';

const NEXT = {
  id: 'next',
  label: 'Then?',
  multi: false,
  options: ['proceed', 'iterate', 'hold'],
};

test('Proceed is preset on a single-select next that offers it', () => {
  expect(presetSelections([NEXT], 'plan')).toEqual({ next: 'proceed' });
  expect(presetSelections([NEXT], 'ship')).toEqual({ next: 'proceed' });
  expect(
    presetSelections(
      [
        {
          ...NEXT,
          options: [
            { value: 'proceed', label: 'Proceed (Recommended)' },
            'hold',
          ],
        },
      ],
      'plan'
    )
  ).toEqual({ next: 'proceed' });
});

test('nothing is preset without a next question, without proceed, or on a multi', () => {
  expect(presetSelections([{ ...NEXT, id: 'action' }], 'plan')).toEqual({});
  expect(
    presetSelections([{ ...NEXT, options: ['done', 'hold'] }], 'plan')
  ).toEqual({});
  expect(presetSelections([{ ...NEXT, multi: true }], 'plan')).toEqual({});
});

test.each(['review-post', 'respond-plan', 'respond-post', 'pane-attention'])(
  'nothing is preset on a %s gate, where Proceed posts or acts',
  kind => {
    expect(presetSelections([NEXT], kind)).toEqual({});
  }
);

const TIER = {
  id: 'tier',
  label: 'Which tier?',
  multi: false,
  options: ['small', { value: 'large', label: 'Large (Recommended)' }],
};

const FIXES = {
  id: 'fixes',
  label: 'Which fixes?',
  multi: true,
  options: ['a (recommended)', 'b', { value: 'c', label: 'C (Recommended)' }],
};

test('a recommended option is preset on any single-select question', () => {
  expect(presetSelections([TIER], 'plan')).toEqual({ tier: 'large' });
});

test('every recommended option is preset on a multi-select question', () => {
  expect(presetSelections([FIXES], 'plan')).toEqual({
    fixes: ['a (recommended)', 'c'],
  });
});

test('a question with no recommended option opens empty', () => {
  expect(
    presetSelections(
      [
        { ...TIER, options: ['small', 'large'] },
        { ...FIXES, options: ['a', 'b'] },
      ],
      'plan'
    )
  ).toEqual({});
});

test('a recommended option on next wins over Proceed', () => {
  expect(
    presetSelections(
      [{ ...NEXT, options: ['proceed', 'hold (Recommended)'] }],
      'plan'
    )
  ).toEqual({ next: 'hold (Recommended)' });
});

test.each(['review-post', 'respond-plan', 'respond-post', 'pane-attention'])(
  'recommended options are not preset on a %s gate either',
  kind => {
    expect(presetSelections([TIER, FIXES], kind)).toEqual({});
  }
);

test('recommendedPick reads one question the same way', () => {
  expect(recommendedPick(TIER)).toBe('large');
  expect(recommendedPick(FIXES)).toEqual(['a (recommended)', 'c']);
  expect(recommendedPick({ ...TIER, options: ['small'] })).toBeUndefined();
});

test('a mid-label marker counts as recommended', () => {
  expect(
    recommendedPick({
      ...TIER,
      options: [
        {
          value: 'hand-back',
          label: 'Hand back (Recommended). I give you the branch.',
        },
        'hold',
      ],
    })
  ).toBe('hand-back');
  expect(
    recommendedPick({ ...TIER, options: ['not recommended', 'hold'] })
  ).toBeUndefined();
});

test('withoutPreset matches a multi preset by its values', () => {
  expect(withoutPreset({ fixes: ['c', 'a'] }, { fixes: ['a', 'c'] })).toEqual(
    {}
  );
  expect(withoutPreset({ fixes: ['a'] }, { fixes: ['a', 'c'] })).toEqual({
    fixes: ['a'],
  });
  expect(withoutPreset({ fixes: ['a', 'a'] }, { fixes: ['a', 'c'] })).toEqual({
    fixes: ['a', 'a'],
  });
});

test('withoutPreset drops only picks still equal to the preset', () => {
  expect(
    withoutPreset({ next: 'proceed', tier: 'a' }, { next: 'proceed' })
  ).toEqual({ tier: 'a' });
  expect(withoutPreset({ next: 'hold' }, { next: 'proceed' })).toEqual({
    next: 'hold',
  });
});
