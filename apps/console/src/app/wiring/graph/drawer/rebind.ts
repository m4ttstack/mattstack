import { layerLabel } from '../../layerLabel';
import {
  defaultPipelineOf,
  invertBindings,
  overrideOf,
  pluginOf,
  suffixOf,
  type BindingSite,
  type SkillsComposition,
} from '../../outline';
import { ownerOf, type Owner } from '../../owner';
import { slotFactsOf } from '../model/templateModel';

export type RebindOption = {
  binding: string;
  name: string;
  plugin: string;
  owner: Owner;
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
  /** Who owns the current fill; a fill rt does not list is the plugin its
      binding names. */
  currentOwner: Owner | null;
  /** Every fill with the slot's contract, the current one first. */
  options: RebindOption[];
  /** The skill `rt skills bind` names: a stage copy's engine, since rt
      binds a copy through it. */
  verb: string;
  /** The pipeline whose override a write sets; null writes the default. */
  pipeline: string | null;
};

function otherSkills(sites: readonly BindingSite[], ref: string): number {
  return new Set(sites.map(site => site.ref).filter(site => site !== ref)).size;
}

/** Where the slot itself binds the fill outside the pipeline being written:
    "here by default", "here in accessibility". */
function sameSlotElsewhere(
  sites: readonly BindingSite[],
  ref: string,
  slot: string,
  pipeline: string | null
): string[] {
  return sites
    .filter(
      site =>
        site.ref === ref &&
        site.slot === slot &&
        (site.pipeline ?? null) !== pipeline
    )
    .map(site =>
      site.pipeline ? `here in ${site.pipeline}` : 'here by default'
    );
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

function whereBound(
  here: boolean,
  sameSlot: string[],
  ownSlots: string[],
  others: number
): string {
  const places = [
    here ? 'here now' : null,
    ...(here ? [] : sameSlot),
    ownSlots.length > 0
      ? `in its ${listed(ownSlots)} slot${ownSlots.length === 1 ? '' : 's'}`
      : null,
    others > 0 ? `by ${others} other skill${others === 1 ? '' : 's'}` : null,
  ].filter(place => place !== null);
  return places.length === 0 ? 'bound nowhere' : `bound ${listed(places)}`;
}

/**
 * What a slot can be rebound to in `workType`: the fills that provide its
 * contract, the current one first, then the ones fewest other skills bind.
 * A stage copy reads and writes its own pipeline's override. Any other
 * pipeline but the default writes its override too, as does one that
 * already overrides the slot.
 */
export function rebindChoices(
  composition: SkillsComposition,
  skill: string,
  ref: string,
  slot: string,
  workType: string | null
): RebindChoices {
  const target = composition.targets?.find(t => t.name === skill);
  const verb = target?.engine ?? skill;
  const reading = target?.pipeline ?? workType;
  const binderSlot = composition.binders
    .find(binder => binder.ref === ref)
    ?.slots.find(candidate => candidate.name === slot);
  const overridden = overrideOf(binderSlot ?? {}, reading) !== undefined;
  const pipeline =
    reading !== null &&
    (overridden || reading !== defaultPipelineOf(composition.pipelines))
      ? reading
      : null;

  const facts = slotFactsOf(composition, skill, ref, reading).get(slot);
  const contract = facts?.contract ?? null;
  const current = facts?.boundTo ?? null;
  const sites = invertBindings(composition);

  const ranked = composition.fills
    .filter(fill => contract !== null && fill.provides === contract)
    .map(fill => ({
      fill,
      here: fill.binding === current,
      sameSlot: sameSlotElsewhere(
        sites[fill.binding] ?? [],
        ref,
        slot,
        pipeline
      ),
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
    currentOwner:
      current === null
        ? null
        : ownerOf(
            current,
            composition.fills.find(fill => fill.binding === current),
            composition.pack
          ),
    options: ranked.map(({ fill, here, sameSlot, ownSlots, others }) => ({
      binding: fill.binding,
      name: suffixOf(fill.binding),
      plugin: pluginOf(fill.binding),
      owner: ownerOf(fill.binding, fill, composition.pack),
      where: whereBound(here, sameSlot, ownSlots, others),
    })),
    verb,
    pipeline,
  };
}
