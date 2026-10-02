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

  it("names the skill's own other slots rather than counting them as other skills", () => {
    const composition = withOwnSlots({
      fallback: 'acme:plan-policy-lite',
      second: 'acme:plan-policy-strict',
    });
    expect(where(composition)).toEqual([
      ['plan-policy', 'bound here now'],
      ['plan-policy-strict', 'bound in its second slot'],
      ['plan-policy-lite', 'bound in its fallback slot and by 1 other skill'],
    ]);
  });

  it('says the current fill is bound in its other slots too', () => {
    const composition = withOwnSlots({
      fallback: 'acme:plan-policy',
      second: 'acme:plan-policy',
    });
    expect(where(composition)[0]).toEqual([
      'plan-policy',
      'bound here now and in its fallback and second slots',
    ]);
  });
});

/** stage-plan with extra slots of its own, each bound to the given fill. */
function withOwnSlots(slots: Record<string, string>) {
  const composition = designFixture('composition');
  composition.binders = composition.binders.map(binder =>
    binder.ref === 'mattstack:stage-plan'
      ? {
          ...binder,
          slots: [
            ...binder.slots,
            ...Object.entries(slots).map(([name, boundTo]) => ({
              name,
              boundTo,
              layer: 'pack',
            })),
          ],
        }
      : binder
  );
  return composition;
}
