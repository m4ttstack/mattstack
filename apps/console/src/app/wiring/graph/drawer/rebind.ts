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
      in its fallback slot", "bound by 2 other skills". */
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

function otherSkills(sites: readonly BindingSite[], ref: string): number {
  return new Set(sites.map(site => site.ref).filter(site => site !== ref)).size;
}

function ownOtherSlots(
  sites: readonly BindingSite[],
  ref: string,
  slot: string
): string[] {
  const slots = sites
    .filter(site => site.ref === ref && site.slot !== slot)
    .map(site => site.slot);
  return [...new Set(slots)].sort();
}

function listed(names: string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function whereBound(here: boolean, ownSlots: string[], others: number): string {
  const places = [
    here ? 'here now' : null,
    ownSlots.length > 0
      ? `in its ${listed(ownSlots)} slot${ownSlots.length === 1 ? '' : 's'}`
      : null,
    others > 0 ? `by ${others} other skill${others === 1 ? '' : 's'}` : null,
  ].filter(place => place !== null);
  return places.length === 0 ? 'bound nowhere' : `bound ${listed(places)}`;
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
      ownSlots: ownOtherSlots(sites[fill.binding] ?? [], ref, slot),
      others: otherSkills(sites[fill.binding] ?? [], ref),
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
    options: ranked.map(({ fill, here, ownSlots, others }) => ({
      binding: fill.binding,
      name: suffixOf(fill.binding),
      plugin: pluginOf(fill.binding),
      where: whereBound(here, ownSlots, others),
    })),
  };
}
