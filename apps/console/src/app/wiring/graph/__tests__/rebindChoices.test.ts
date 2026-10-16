// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { rebindChoices } from '../drawer/rebind';
import { designFixture } from './designFixtures';

const where = (composition = designFixture('composition')) =>
  rebindChoices(
    composition,
    'stage-plan',
    'mattstack:stage-plan',
    'domain',
    null
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
    rebindChoices(
      composition,
      'stage-plan',
      'mattstack:stage-plan',
      'domain',
      null
    );

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

describe('rebindChoices per pipeline', () => {
  const composition = designFixture('composition');
  const evidence = (workType: string | null, skill = 'stage-evidence') =>
    rebindChoices(
      composition,
      skill,
      'mattstack:stage-evidence',
      'domain',
      workType
    );

  it('reads the override under its pipeline and the default under the other', () => {
    expect(evidence('accessibility').current).toBe('acme:evidence-a11y');
    expect(evidence('feature').current).toBe('acme:evidence-policy');
    expect(evidence(null).current).toBe('acme:evidence-policy');
  });

  it("writes the pipeline's override under it, and the default under the default pipeline", () => {
    expect(evidence('accessibility')).toMatchObject({
      verb: 'stage-evidence',
      pipeline: 'accessibility',
    });
    expect(evidence('feature')).toMatchObject({
      verb: 'stage-evidence',
      pipeline: null,
    });
  });

  it("writes the default for the lead's own slot, which no pipeline overrides", () => {
    expect(
      rebindChoices(
        composition,
        'work-a11y',
        'mattstack:work',
        'tiering',
        'accessibility'
      )
    ).toMatchObject({
      current: 'mattstack:model-tiering',
      verb: 'work-a11y',
      pipeline: null,
    });
  });

  it('binds a stage copy through its engine and its own pipeline', () => {
    expect(evidence(null, 'stage-evidence--accessibility')).toMatchObject({
      current: 'acme:evidence-a11y',
      verb: 'stage-evidence',
      pipeline: 'accessibility',
    });
  });

  it('says where the same slot is bound in the other pipelines', () => {
    const where = (workType: string) =>
      evidence(workType).options.map(option => [option.name, option.where]);
    expect(where('accessibility')).toEqual([
      ['evidence-a11y', 'bound here now'],
      ['evidence-policy', 'bound here by default'],
    ]);
    expect(where('feature')).toEqual([
      ['evidence-policy', 'bound here now'],
      ['evidence-a11y', 'bound here in accessibility'],
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
