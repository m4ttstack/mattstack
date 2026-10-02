// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { rebindChoices } from '../drawer/rebind';
import { designFixture } from './designFixtures';

const where = (composition = designFixture('composition')) =>
  rebindChoices(
    composition,
    'stage-plan',
    'mattstack:stage-plan',
    'domain'
  ).options.map(option => [option.name, option.where]);

describe('rebindChoices', () => {
  it('says where each fill with the contract is bound, the current one first', () => {
    expect(where()).toEqual([
      ['plan-policy', 'bound here now'],
      ['plan-policy-strict', 'bound nowhere'],
      ['plan-policy-lite', 'bound by 1 other skill'],
    ]);
  });

  it("does not count the skill's own other slots as other skills", () => {
    const composition = designFixture('composition');
    composition.binders = composition.binders.map(binder =>
      binder.ref === 'mattstack:stage-plan'
        ? {
            ...binder,
            slots: [
              ...binder.slots,
              {
                name: 'fallback',
                boundTo: 'acme:plan-policy-lite',
                layer: 'pack',
              },
              {
                name: 'second',
                boundTo: 'acme:plan-policy-strict',
                layer: 'pack',
              },
            ],
          }
        : binder
    );
    expect(where(composition)).toEqual([
      ['plan-policy', 'bound here now'],
      ['plan-policy-strict', 'bound nowhere'],
      ['plan-policy-lite', 'bound by 1 other skill'],
    ]);
  });
});
