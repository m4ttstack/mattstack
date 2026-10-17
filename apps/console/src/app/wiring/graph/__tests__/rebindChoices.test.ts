// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { pipelineChoices, rebindChoices } from '../drawer/rebind';
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
      rebuilds: ['work', 'work-a11y'],
    });
  });

  it('rebuilds only the stage it binds', () => {
    expect(evidence('accessibility').rebuilds).toEqual(['stage-evidence']);
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

describe('pipelineChoices', () => {
  const composition = designFixture('composition');
  const evidence = (
    workType: string | null,
    skill = 'stage-evidence',
    of = composition
  ) =>
    pipelineChoices(of, skill, 'mattstack:stage-evidence', 'domain', workType);
  const DEFAULT = { pipeline: null, label: 'Default' };

  it("offers Default and the specialized pipeline, preselecting the view's", () => {
    expect(evidence('accessibility')).toEqual({
      choices: [DEFAULT, { pipeline: 'accessibility', label: 'accessibility' }],
      preselected: 'accessibility',
    });
  });

  it('preselects Default on the default pipeline, which it does not offer', () => {
    const { choices, preselected } = evidence('feature');
    expect(preselected).toBeNull();
    expect(choices.map(choice => choice.pipeline)).toEqual([
      null,
      'accessibility',
    ]);
  });

  it('offers and preselects the default pipeline once it overrides the slot', () => {
    const overridden = designFixture('composition');
    overridden.binders = overridden.binders.map(binder =>
      binder.ref === 'mattstack:stage-evidence'
        ? {
            ...binder,
            slots: binder.slots.map(slot => ({
              ...slot,
              overrides: [
                ...(slot.overrides ?? []),
                {
                  pipeline: 'feature',
                  boundTo: 'acme:evidence-a11y',
                  layer: 'pack',
                },
              ],
            })),
          }
        : binder
    );
    const { choices, preselected } = evidence(
      'feature',
      'stage-evidence',
      overridden
    );
    expect(preselected).toBe('feature');
    expect(choices).toContainEqual({ pipeline: 'feature', label: 'feature' });
  });

  it("gives no choice on a work verb's own slot", () => {
    expect(
      pipelineChoices(
        composition,
        'work-a11y',
        'mattstack:work',
        'tiering',
        'accessibility'
      ).choices
    ).toEqual([]);
  });

  it('gives no choice on a stage copy, which stays on its pipeline', () => {
    expect(evidence(null, 'stage-evidence--accessibility').choices).toEqual([]);
  });
});

describe('rebindChoices for a chosen pipeline', () => {
  const composition = designFixture('composition');
  const evidence = (chosen: string | null, skill = 'stage-evidence') =>
    rebindChoices(
      composition,
      skill,
      'mattstack:stage-evidence',
      'domain',
      'accessibility',
      chosen
    );

  it('reads and writes the default when Default is chosen', () => {
    expect(evidence(null)).toMatchObject({
      pipeline: null,
      current: 'acme:evidence-policy',
      overridden: false,
    });
  });

  it("reads the chosen pipeline's override and the default it falls back to", () => {
    expect(evidence('accessibility')).toMatchObject({
      pipeline: 'accessibility',
      current: 'acme:evidence-a11y',
      overridden: true,
      fallback: 'acme:evidence-policy',
    });
  });

  it('use default on a copy targets its engine and pipeline', () => {
    expect(
      rebindChoices(
        composition,
        'stage-evidence--accessibility',
        'mattstack:stage-evidence',
        'domain',
        null
      )
    ).toMatchObject({
      verb: 'stage-evidence',
      pipeline: 'accessibility',
      overridden: true,
      fallback: 'acme:evidence-policy',
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
