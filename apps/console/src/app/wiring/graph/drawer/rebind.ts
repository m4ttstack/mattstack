import { layerLabel } from '../../layerLabel';
import {
  invertBindings,
  pluginOf,
  suffixOf,
  type BindingSite,
  type SkillsComposition,
} from '../../outline';
import { slotFactsOf } from '../model/templateModel';

export type RebindOption = {
  binding: string;
  name: string;
  plugin: string;
  /** Where else the fill is bound: "bound here now", "bound nowhere", "bound
      by 2 other skills". */
  where: string;
};

export type RebindChoices = {
  contract: string | null;
  setBy: string;
  required: string;
  /** The binding that fills the slot now, or null when nothing does. */
  current: string | null;
  /** Every fill with the slot's contract, the current one first. */
  options: RebindOption[];
};

function otherSkills(
  sites: readonly BindingSite[],
  ref: string,
  slot: string
): number {
  return new Set(
    sites
      .filter(site => !(site.ref === ref && site.slot === slot))
      .map(site => site.ref)
  ).size;
}

function whereBound(others: number, here: boolean): string {
  const skills = `${others} other skill${others === 1 ? '' : 's'}`;
  if (here)
    return others === 0 ? 'bound here now' : `bound here now and by ${skills}`;
  return others === 0 ? 'bound nowhere' : `bound by ${skills}`;
}

/**
 * What a slot can be rebound to: the fills that provide its contract, the
 * current one first, then the ones fewest other skills bind.
 */
export function rebindChoices(
  composition: SkillsComposition,
  skill: string,
  ref: string,
  slot: string
): RebindChoices {
  const facts = slotFactsOf(composition, skill, ref).get(slot);
  const contract = facts?.contract ?? null;
  const current = facts?.boundTo ?? null;
  const sites = invertBindings(composition);

  const ranked = composition.fills
    .filter(fill => contract !== null && fill.provides === contract)
    .map(fill => ({
      fill,
      here: fill.binding === current,
      others: otherSkills(sites[fill.binding] ?? [], ref, slot),
    }))
    .sort(
      (a, b) =>
        Number(b.here) - Number(a.here) ||
        a.others - b.others ||
        a.fill.binding.localeCompare(b.fill.binding)
    );

  return {
    contract,
    setBy: facts?.layer
      ? layerLabel(facts.layer)
      : current
        ? 'unknown'
        : 'not set',
    required:
      facts?.required == null ? 'unknown' : facts.required ? 'yes' : 'no',
    current,
    options: ranked.map(({ fill, here, others }) => ({
      binding: fill.binding,
      name: suffixOf(fill.binding),
      plugin: pluginOf(fill.binding),
      where: whereBound(others, here),
    })),
  };
}
