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

describe('rebindChoices owners', () => {
  const fromBase = () => {
    const composition = designFixture('composition');
    composition.fills = composition.fills.map(fill =>
      fill.binding === 'acme:plan-policy-strict'
        ? {
            ...fill,
            binding: 'acme-base:plan-policy-strict',
            origin: 'base' as const,
            base: 'acme-base',
            baseVersion: '0.1.0',
          }
        : fill
    );
    return composition;
  };
  const choices = (composition = fromBase()) =>
    rebindChoices(composition, 'stage-plan', 'mattstack:stage-plan', 'domain');

  it('names a base fill as the org base and a pack fill as the pack', () => {
    const { options } = choices();
    expect(options.map(option => [option.name, option.owner])).toEqual([
      ['plan-policy', { kind: 'pack' }],
      [
        'plan-policy-strict',
        { kind: 'base', name: 'acme-base', version: '0.1.0' },
      ],
      ['plan-policy-lite', { kind: 'pack' }],
    ]);
  });

  it('owns the current fill by its composition fill, and a missing one as a plugin', () => {
    expect(choices().currentOwner).toEqual({ kind: 'pack' });
    const composition = designFixture('composition');
    composition.fills = composition.fills.map(fill =>
      fill.binding === 'acme:plan-policy'
        ? {
            ...fill,
            origin: 'base' as const,
            base: 'acme-base',
            baseVersion: '0.1.0',
          }
        : fill
    );
    expect(choices(composition).currentOwner).toEqual({
      kind: 'base',
      name: 'acme-base',
      version: '0.1.0',
    });
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
