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
  /** Whether `pipeline` overrides this slot, at any layer. */
  overridden: boolean;
  /** Whether that override is this pack's to remove. An override with no
      layer counts, as rt lets an unset through on one. */
  removable: boolean;
  /** The layer, as a badge reads it, that sets an override this pack cannot
      remove; null otherwise. */
  overrideSetBy: string | null;
  /** The view's pipeline when a write sets the default and that pipeline
      keeps its own override of the slot; null otherwise. */
  keptOverride: string | null;
  /** The slot's default fill, which a removed override falls back to; null
      when nothing is bound by default. */
  fallback: string | null;
  /** The skills a write recompiles: every roster verb on the bound verb's
      engine, since they share its binding key. */
  rebuilds: string[];
  /** Whether a default write rebuilds the whole pack: rt recompiles every
      skill for a stage bind. */
  rebuildsPack: boolean;
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

export function listed(names: string[]): string {
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

export type PipelineChoice = { pipeline: string | null; label: string };

/** The badge words for a layer, with the override layer named as one so the
    sentence it sits in reads as a place to go. */
function overrideLayerLabel(layer: string): string {
  return layer === 'override' ? 'the override layer' : layerLabel(layer);
}

function binderSlotOf(
  composition: SkillsComposition,
  ref: string,
  slot: string
) {
  return composition.binders
    .find(binder => binder.ref === ref)
    ?.slots.find(candidate => candidate.name === slot);
}

/** The pipeline a write from `workType`'s view sets when nobody picks one.
    rt overrides only a stage the pipeline lists, so anything else, a work
    verb's own slots included, takes the default; so does the default
    pipeline, unless it already overrides the slot. */
function viewPipeline(
  composition: SkillsComposition,
  ref: string,
  slot: string,
  workType: string | null
): string | null {
  if (workType === null) return null;
  const isStageOf = composition.pipelines?.[workType]?.includes(ref) ?? false;
  const overridden =
    overrideOf(binderSlotOf(composition, ref, slot) ?? {}, workType) !==
    undefined;
  return isStageOf &&
    (overridden || workType !== defaultPipelineOf(composition.pipelines))
    ? workType
    : null;
}

/**
 * The pipelines a write to a stage slot can target from `workType`'s view:
 * Default, every other pipeline that lists the stage, and the default
 * pipeline only once it overrides the slot. A stage copy, which a
 * specialized view always opens in place of its stage, offers its stage's
 * choices with its own pipeline preselected. No choice on a slot no
 * specialized pipeline lists, which always takes the default.
 */
export function pipelineChoices(
  composition: SkillsComposition,
  skill: string,
  ref: string,
  slot: string,
  workType: string | null
): { choices: PipelineChoice[]; preselected: string | null } {
  const copyOf = composition.targets?.find(t => t.name === skill)?.pipeline;
  const defaultPipeline = defaultPipelineOf(composition.pipelines);
  const binderSlot = binderSlotOf(composition, ref, slot) ?? {};
  const listing = Object.entries(composition.pipelines ?? {})
    .filter(([, stages]) => stages.includes(ref))
    .map(([name]) => name);
  const preselected = copyOf ?? viewPipeline(composition, ref, slot, workType);
  if (!listing.some(name => name !== defaultPipeline))
    return { choices: [], preselected };

  const offered = listing.filter(
    name =>
      name !== defaultPipeline || overrideOf(binderSlot, name) !== undefined
  );
  return {
    choices: [
      { pipeline: null, label: 'Default' },
      ...offered.map(name => ({ pipeline: name, label: name })),
    ],
    preselected,
  };
}

/**
 * What a slot can be rebound to in `workType`: the fills that provide its
 * contract, the current one first, then the ones fewest other skills bind.
 * A stage copy reads and writes its own pipeline's override. A stage of any
 * other pipeline but the default writes that pipeline's override too, as
 * does a stage the pipeline already overrides at the slot. A `chosen`
 * pipeline, null for the default, replaces that rule, on a copy too: it is
 * both the one read and the one written.
 */
export function rebindChoices(
  composition: SkillsComposition,
  skill: string,
  ref: string,
  slot: string,
  workType: string | null,
  chosen?: string | null
): RebindChoices {
  const target = composition.targets?.find(t => t.name === skill);
  const verb = target?.engine ?? skill;
  const pipeline =
    chosen !== undefined
      ? chosen
      : (target?.pipeline ?? viewPipeline(composition, ref, slot, workType));
  const reading =
    chosen !== undefined ? chosen : (target?.pipeline ?? workType);
  // A copy's facts read its own pipeline whatever they are asked, so another
  // pipeline is read through the stage it copies.
  const readAs = chosen !== undefined ? verb : skill;
  const binderSlot = binderSlotOf(composition, ref, slot);
  const override = overrideOf(binderSlot ?? {}, pipeline);
  const overrideLayer = override?.layer ?? null;
  const removable =
    override !== undefined &&
    (overrideLayer === null || overrideLayer === 'pack');
  const viewing = target?.pipeline ?? workType;
  const keptOverride =
    pipeline === null && overrideOf(binderSlot ?? {}, viewing) !== undefined
      ? viewing
      : null;

  const rosterVerb = composition.verbs.find(v => v.name === verb);
  const rebuilds = rosterVerb
    ? composition.verbs
        .filter(v => v.engine === rosterVerb.engine)
        .map(v => v.name)
    : [verb];

  const facts = slotFactsOf(composition, readAs, ref, reading).get(slot);
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
    overridden: override !== undefined,
    removable,
    overrideSetBy:
      overrideLayer !== null && !removable
        ? overrideLayerLabel(overrideLayer)
        : null,
    keptOverride,
    fallback: binderSlot?.boundTo || null,
    rebuilds,
    rebuildsPack: rosterVerb === undefined,
  };
}
