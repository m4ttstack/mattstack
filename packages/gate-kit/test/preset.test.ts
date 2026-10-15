import { expect, test } from 'vitest';

import { presetSelections, withoutPreset } from '@mattstack/gate-kit';

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

test('withoutPreset drops only picks still equal to the preset', () => {
  expect(
    withoutPreset({ next: 'proceed', tier: 'a' }, { next: 'proceed' })
  ).toEqual({ tier: 'a' });
  expect(withoutPreset({ next: 'hold' }, { next: 'proceed' })).toEqual({
    next: 'hold',
  });
});
