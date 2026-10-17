import type { InferResponseType } from 'hono/client';

import type { client } from '../api';

export type SkillsComposition = InferResponseType<
  typeof client.api.skills.composition.$get,
  200
>;
export type SkillsCheck = InferResponseType<
  typeof client.api.skills.check.$get,
  200
>;

type CompositionVerb = SkillsComposition['verbs'][number];
type CompositionFill = SkillsComposition['fills'][number];
type CompositionBinder = NonNullable<SkillsComposition['binders']>[number];
type CompositionBinderSlot = CompositionBinder['slots'][number];
type CompositionTarget = NonNullable<SkillsComposition['targets']>[number];
type CheckVerb = SkillsCheck['verbs'][number];

/** The fill a binder slot takes in `workType`: that pipeline's override when
    it has one, else the default. "" is bound to nothing. */
export function effectiveBoundTo(
  slot: Pick<CompositionBinderSlot, 'boundTo' | 'overrides'>,
  workType: string | null
): string {
  return overrideOf(slot, workType)?.boundTo ?? slot.boundTo;
}

export function overrideOf(
  slot: Pick<CompositionBinderSlot, 'overrides'>,
  workType: string | null
) {
  if (workType === null) return undefined;
  return slot.overrides?.find(override => override.pipeline === workType);
}

/** The pipeline the plain `work` verb runs, the way rt picks it: the only
    one, else `feature`. */
export function defaultPipelineOf(
  pipelines: Record<string, string[]> | undefined
): string | null {
  const names = Object.keys(pipelines ?? {});
  if (names.length === 1) return names[0]!;
  return names.includes('feature') ? 'feature' : null;
}

/** The verb that runs `workType`: the one whose stub names it, else `work`. */
export function leadVerbOf<
  V extends Pick<CompositionVerb, 'name' | 'pipeline'>,
>(verbs: readonly V[], workType: string | null): V | undefined {
  return (
    (workType !== null
      ? verbs.find(verb => verb.pipeline === workType)
      : undefined) ?? verbs.find(verb => verb.name === ORCHESTRATOR_VERB)
  );
}

/** Whether `verb` runs a pipeline, which makes it an orchestrator. */
export function leadsAPipeline(
  verb: Pick<CompositionVerb, 'name' | 'pipeline'>
): boolean {
  return verb.name === ORCHESTRATOR_VERB || verb.pipeline !== undefined;
}

/** The copy rt compiles of `stage` for `workType`, when its fills differ. */
export function stageCopyOf(
  targets: readonly CompositionTarget[] | undefined,
  stage: string,
  workType: string | null
): CompositionTarget | undefined {
  if (workType === null) return undefined;
  return targets?.find(
    target => target.engine === stage && target.pipeline === workType
  );
}

/** Compile copies a base's board-only fills into the pack, and materialize
    binds the copy, so the base original is never bound by name. */
function hasBoundTeamCopy(
  fill: CompositionFill,
  composition: SpineComposition,
  boundBindings: ReadonlySet<string>
): boolean {
  if (fill.origin !== 'base' || !composition.pack) return false;
  const fillName = fill.binding.slice(fill.binding.indexOf(':') + 1);
  return composition.fills.some(
    copy =>
      copy !== fill &&
      copy.origin === 'base' &&
      copy.base === fill.base &&
      copy.binding === `${composition.pack}:${fillName}` &&
      boundBindings.has(copy.binding)
  );
}

/** Only the fields the spine needs -- `pack`/`packDir` ride along on the
    real response but `buildSpine` has no use for them. */
export interface SpineComposition {
  pack?: string;
  verbs: CompositionVerb[];
  fills: CompositionFill[];
  binders?: CompositionBinder[];
  pipelines?: Record<string, string[]>;
  targets?: CompositionTarget[];
}
export interface OutlineCheck {
  verbs: CheckVerb[];
}

/** The verb that reads the pipeline and runs it. It leads the spine because
    it is the only skill that has a position relative to ALL the stages. */
export const ORCHESTRATOR_VERB = 'work';

export type WiringHealth =
  'in-sync' | 'source-newer' | 'never-compiled' | 'orphaned' | 'unknown';

export interface BoundFill {
  binding: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
}

export interface SlotOutlineNode {
  name: string;
  /**
   * A roster verb declares its slots' contracts; a stage or cross-plugin
   * binder carries only `name -> boundTo`, so the contract shown for those
   * is what the BOUND FILL provides, not what the slot demands. Null when
   * neither is known, which renders as "contract unknown" rather than blank.
   */
  contract: string | null;
  /** Null where the payload never states it -- a binder-only slot. */
  required: boolean | null;
  boundTo: string | null;
  resolveError?: string;
  /**
   * rt's ABSOLUTE path for the fill's own SKILL.md, computed inside rt as
   * `join(<fill's plugin root>, srcPath)`. The only sound way to say which
   * file a slot seam's line span is measured in: the seam states a path
   * relative to a plugin root the client cannot resolve. Null for a
   * binder-only slot and wherever rt states none.
   */
  fillSourcePath: string | null;
  fill: BoundFill | null;
  /** Null for a binder-only slot or an rt that predates the field. */
  layer: string | null;
  /** Set when the slot came from an org base; absent for a binder-only slot
      and an rt that predates the field. */
  origin?: 'base';
  base?: string;
}

export type BindingSiteKind = CompositionBinder['kind'];

/** One place in the manifest that resolves to a fill: a ref, the slot on it,
    and what that ref is. `verb` is null wherever the ref is not a roster
    verb, which is most of them. */
export interface BindingSite {
  ref: string;
  verb: string | null;
  kind: BindingSiteKind;
  slot: string;
  /** The pipeline whose override binds here; absent for the default. */
  pipeline?: string;
}

/** Kinds ahead of names, so the drawer reads in the order its own sentence
    names them. Any order would render; a STABLE one is what keeps the list
    from moving under the cursor between fetches of the same pack. */
const SITE_KIND_RANK: Record<BindingSiteKind, number> = {
  verb: 0,
  stage: 1,
  skill: 2,
  external: 3,
};

export type SpineEntryKind = 'orchestrator' | 'stage' | 'outside';

export interface SpineEntry {
  kind: SpineEntryKind;
  key: string;
  label: string;
  /** The manifest binding key, e.g. `mattstack:stage-ship`. Null for a
      grouped cross-plugin entry, which stands for several refs. */
  ref: string | null;
  /** The roster verb backing this entry, when there is one. */
  verb: string | null;
  /** 1..N for a stage; null everywhere else. Never replaced by health. */
  step: number | null;
  /** The stage copy rt compiles for this work type, when it has one. */
  copy?: string;
  /** A roster verb with a public artifact -- the only thing rt checks. */
  invocable: boolean;
  /** A binder belonging to another plugin's roster, not this pack's. */
  external: boolean;
  /** A roster verb no binder names. It binds nothing, so the manifest never
      mentions it and the pipeline never reaches it -- but it still compiles
      to an artifact `check` covers, so it can drift. */
  unwired: boolean;
  sourcePath: string | null;
  artifactPath: string | null;
  health: WiringHealth;
  engineError?: string;
  staleFiles: string[];
  orphanFiles: string[];
  slots: SlotOutlineNode[];
}

export interface OrphanFillEntry {
  fill: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
  health: 'orphaned';
}

/**
 * `absent` is an rt whose `composition --json` predates the `pipelines`
 * field; `empty` is that rt answering for a pack whose manifest declares no
 * pipeline. Same spine, different sentence -- collapsing them would tell a
 * reader to fix their manifest when the fix is to update rt.
 */
export type PipelineState = 'ok' | 'empty' | 'absent';

export interface WiringSpine {
  workType: string | null;
  workTypes: string[];
  pipelineState: PipelineState;
  orchestrator: SpineEntry | null;
  stages: SpineEntry[];
  outside: SpineEntry[];
  orphans: OrphanFillEntry[];
  attentionCount: number;
}

/** `check.status` names rt's own vocabulary; an unrecognized value degrades
    to `unknown` rather than a guessed health, which is what keeps an older
    rt's answer honest instead of silently claiming a status it never sent. */
function healthFromStatus(
  status: CheckVerb['status'] | undefined
): WiringHealth {
  switch (status) {
    case 'in-sync':
      return 'in-sync';
    case 'stale':
      return 'source-newer';
    case 'never-compiled':
      return 'never-compiled';
    default:
      return 'unknown';
  }
}

export function suffixOf(ref: string): string {
  const colon = ref.indexOf(':');
  return colon === -1 ? ref : ref.slice(colon + 1);
}

export function pluginOf(ref: string): string {
  const colon = ref.indexOf(':');
  return colon === -1 ? ref : ref.slice(0, colon);
}

/**
 * Every fill the pack declares, mapped to every binding site that resolves
 * to it. A declared fill nothing binds gets an empty array rather than no
 * key: absent and bound-by-nothing are different facts, and a missing key
 * would render as "unknown" where the honest answer is "bound by nothing".
 *
 * Inverts `binders[]`, never `verbs[]`. The roster holds roughly a third of
 * the manifest's binding keys -- the rest are pipeline stages, other
 * plugins' skills, and mattstack skills that are neither -- so a
 * roster-derived index reports genuinely-bound fills as orphaned in the one
 * view consulted before deleting something. Nor is `Resolved.bindings`
 * inverted directly: its outer key is `${step.plugin}:${verb.engine}`, an
 * engine ref, not a verb name.
 *
 * Unioning `verbs[]` in would add nothing: rt reads a verb slot's `boundTo`
 * out of the same `resolved.bindings` map it emits every `binders[]` entry
 * from, so `binders[]` is a superset of the roster's bindings by
 * construction (measured on the live demo pack: 18 binders cover all
 * 12 verbs' bound slots, ref/slot/binding identical).
 */
export function invertBindings(
  composition: SpineComposition
): Record<string, BindingSite[]> {
  const sites: Record<string, BindingSite[]> = {};
  for (const fill of composition.fills) sites[fill.binding] = [];

  for (const binder of composition.binders ?? []) {
    const site = { ref: binder.ref, verb: binder.verb, kind: binder.kind };
    for (const slot of binder.slots) {
      if (slot.boundTo) {
        (sites[slot.boundTo] ??= []).push({ ...site, slot: slot.name });
      }
      for (const { pipeline, boundTo } of slot.overrides ?? []) {
        if (!boundTo) continue;
        (sites[boundTo] ??= []).push({ ...site, slot: slot.name, pipeline });
      }
    }
  }

  for (const list of Object.values(sites)) {
    list.sort(
      (a, b) =>
        SITE_KIND_RANK[a.kind] - SITE_KIND_RANK[b.kind] ||
        (a.verb ?? a.ref).localeCompare(b.verb ?? b.ref) ||
        a.slot.localeCompare(b.slot) ||
        (a.pipeline ?? '').localeCompare(b.pipeline ?? '')
    );
  }
  return sites;
}

/**
 * The one predicate behind both `attentionCount` and the "needs attention
 * only" filter -- a badge that disagreed with the list it links to would be
 * two derivations of the same claim.
 *
 * Every signal it reads reaches an entry through a ROSTER VERB: `health`
 * comes from `check` keyed by verb name, `engineError` off the verb, and
 * `required`/`resolveError` off the verb's declared slots. A binder-only
 * slot carries `required: null` and no `resolveError`, and a ref no verb
 * backs gets `health: 'unknown'`. So this can only ever answer true for an
 * entry with `verb !== null` -- which is what makes `attentionCount`
 * independent of the work type. See `buildSpine`.
 */
/** A verb rt sweeps in unwired whose slots nothing binds. A verb with no
    slots has nothing to bind, so it stands on its own instead. */
export function looseEnd(entry: SpineEntry): boolean {
  return entry.unwired && entry.slots.length > 0;
}

export function needsAttention(entry: SpineEntry): boolean {
  if (entry.health === 'source-newer' || entry.health === 'never-compiled')
    return true;
  if (entry.engineError) return true;
  return entry.slots.some(
    slot => slot.resolveError || (slot.required === true && !slot.boundTo)
  );
}

/**
 * Every row the spine draws, in render order. Names the set `attentionCount`
 * ranges over so the count and the filter cannot each decide for
 * themselves what a row is. Orphaned fills are not
 * rows: they are fills, and the count never included them.
 */
export function spineRows(
  spine: Pick<WiringSpine, 'orchestrator' | 'stages' | 'outside'>
): SpineEntry[] {
  return [
    ...(spine.orchestrator ? [spine.orchestrator] : []),
    ...spine.stages,
    ...spine.outside,
  ];
}

/**
 * Shapes one pack's composition into the spine the Wiring surface renders:
 * the orchestrator, the pipeline's stages in their run order, every other
 * binder under "Outside the pipeline", and the fills nothing binds.
 *
 * Two invariants the substrate exists to protect:
 *
 * - **Order comes from `pipelines[workType]` and nowhere else.** `binders[]`
 *   is a map, not a sequence; `kind === 'stage'` says a ref IS a stage, never
 *   where it runs. Reconstructing order from it (or sorting it) invents an
 *   order the manifest never stated.
 * - **Orphan detection reads `binders[]`, not `verbs[]`.** A fill can be
 *   bound by a pipeline stage or another plugin's skill and never by a roster
 *   verb; on the live pack, deriving orphans from `verbs[]` wrongly orphans
 *   nine bound fills.
 */
export function buildSpine(
  composition: SpineComposition,
  check: OutlineCheck,
  requestedWorkType?: string | null
): WiringSpine {
  const checkByName = new Map(check.verbs.map(v => [v.name, v] as const));
  const fillsByBinding = new Map(
    composition.fills.map(f => [f.binding, f] as const)
  );
  const binders = composition.binders ?? [];
  const bindersByRef = new Map(binders.map(b => [b.ref, b] as const));
  const verbsByEngineRef = new Map(
    composition.verbs
      .filter(v => v.engineRef !== null)
      .map(v => [v.engineRef as string, v] as const)
  );

  const boundBindings = new Set<string>();
  for (const verb of composition.verbs) {
    for (const slot of verb.slots) {
      if (slot.boundTo) boundBindings.add(slot.boundTo);
    }
  }
  for (const [binding, sites] of Object.entries(invertBindings(composition))) {
    if (sites.length > 0) boundBindings.add(binding);
  }

  const workTypes = Object.keys(composition.pipelines ?? {});
  const pipelineState: PipelineState =
    composition.pipelines === undefined
      ? 'absent'
      : workTypes.length === 0
        ? 'empty'
        : 'ok';
  const workType =
    requestedWorkType && workTypes.includes(requestedWorkType)
      ? requestedWorkType
      : (workTypes[0] ?? null);
  const stageRefs = workType ? (composition.pipelines?.[workType] ?? []) : [];

  function slotsFor(
    verb: CompositionVerb | undefined,
    binder: CompositionBinder | undefined
  ): SlotOutlineNode[] {
    const bound = new Map(binder?.slots.map(slot => [slot.name, slot]));
    const slots: SlotOutlineNode[] = (verb?.slots ?? []).map(slot => {
      const override = overrideOf(bound.get(slot.name) ?? {}, workType);
      if (override) {
        const fill = fillsByBinding.get(override.boundTo) ?? null;
        return {
          name: slot.name,
          contract: slot.contract,
          required: slot.required,
          boundTo: override.boundTo || null,
          fillSourcePath: fill?.sourcePath ?? null,
          fill,
          layer: override.layer,
        };
      }
      return {
        name: slot.name,
        contract: slot.contract,
        required: slot.required,
        boundTo: slot.boundTo,
        resolveError: slot.resolveError,
        fillSourcePath: slot.fillSourcePath,
        fill: slot.boundTo ? (fillsByBinding.get(slot.boundTo) ?? null) : null,
        layer: slot.layer ?? null,
        ...(slot.origin === 'base' ? { origin: slot.origin } : {}),
        ...(slot.base !== undefined ? { base: slot.base } : {}),
      };
    });
    const declared = new Set(slots.map(s => s.name));

    for (const slot of binder?.slots ?? []) {
      if (declared.has(slot.name)) continue;
      const boundTo = effectiveBoundTo(slot, workType);
      if (!boundTo) continue;
      const fill = fillsByBinding.get(boundTo) ?? null;
      slots.push({
        name: slot.name,
        contract: fill?.provides ?? null,
        required: null,
        boundTo,
        fillSourcePath: null,
        fill,
        layer: null,
      });
    }
    return slots;
  }

  function entryFor(
    kind: SpineEntryKind,
    ref: string,
    step: number | null,
    lead?: CompositionVerb
  ): SpineEntry {
    const binder = bindersByRef.get(ref);
    const verb = lead ?? verbsByEngineRef.get(ref);
    const checkRow = verb ? checkByName.get(verb.name) : undefined;
    const slots = slotsFor(verb, binder);

    return {
      kind,
      key: ref,
      label: verb?.name ?? suffixOf(ref),
      ref,
      verb: verb?.name ?? null,
      step,
      invocable: verb?.public ?? false,
      external: false,
      unwired: false,
      sourcePath: verb?.sourcePath ?? null,
      artifactPath: verb?.artifactPath ?? null,
      health: healthFromStatus(checkRow?.status),
      engineError: verb?.engineError,
      staleFiles: checkRow?.staleFiles ?? [],
      orphanFiles: checkRow?.orphanFiles ?? [],
      slots,
    };
  }

  // Every work verb shares the `work` engine, so its engine ref names no one
  // verb: the lead is found by the pipeline its stub names.
  const orchestratorVerb = leadVerbOf(composition.verbs, workType);
  const orchestratorRef = orchestratorVerb?.engineRef ?? null;
  const orchestrator = orchestratorRef
    ? entryFor('orchestrator', orchestratorRef, null, orchestratorVerb)
    : null;

  // A ref the manifest names as a stage always gets a row, whether or not
  // anything in the payload covers it: rt omits a binder for a stage that
  // binds nothing, so "not in binders[]" means "takes nothing from the
  // pack", never "missing".
  const stages = stageRefs.map((ref, i) => {
    const entry = entryFor('stage', ref, i + 1);
    const copy = stageCopyOf(composition.targets, suffixOf(ref), workType);
    return copy ? { ...entry, copy: copy.name } : entry;
  });

  const spineRefs = new Set(stageRefs);
  if (orchestratorRef) spineRefs.add(orchestratorRef);

  const outside: SpineEntry[] = [];
  // Cross-plugin binders group under their plugin: mr-board's four keys are
  // one neighbour of this pack, not four. Each row underneath is one of its
  // binders (name column) at one of that binder's slots (contract column).
  const externalGroups = new Map<string, SpineEntry>();

  for (const binder of binders) {
    if (spineRefs.has(binder.ref)) continue;

    if (binder.kind === 'external') {
      const plugin = pluginOf(binder.ref);
      let group = externalGroups.get(plugin);
      if (!group) {
        group = {
          kind: 'outside',
          key: `external:${plugin}`,
          label: plugin,
          ref: null,
          verb: null,
          step: null,
          invocable: false,
          external: true,
          unwired: false,
          sourcePath: null,
          artifactPath: null,
          health: 'unknown',
          staleFiles: [],
          orphanFiles: [],
          slots: [],
        };
        externalGroups.set(plugin, group);
        outside.push(group);
      }
      for (const slot of binder.slots) {
        const fill = fillsByBinding.get(slot.boundTo) ?? null;
        group.slots.push({
          name: suffixOf(binder.ref),
          contract: slot.name,
          required: null,
          boundTo: slot.boundTo,
          fillSourcePath: null,
          fill,
          layer: null,
        });
      }
      continue;
    }

    outside.push(entryFor('outside', binder.ref, null));
  }

  // Every roster verb reaches a row. rt emits no binder for a verb that binds
  // nothing, so such a verb is named by neither `binders[]` nor the pipeline
  // and would otherwise render nowhere -- while `check` still reports its
  // drift, which is the exact thing this surface exists to surface.
  const placedVerbs = new Set(
    [orchestrator, ...stages, ...outside]
      .map(entry => entry?.verb)
      .filter((name): name is string => typeof name === 'string')
  );

  for (const rosterVerb of composition.verbs) {
    if (placedVerbs.has(rosterVerb.name)) continue;
    const checkRow = checkByName.get(rosterVerb.name);
    const slots = slotsFor(rosterVerb, undefined);

    outside.push({
      kind: 'outside',
      // Work verbs share an engine ref, so one keys by its name.
      key:
        leadsAPipeline(rosterVerb) || rosterVerb.engineRef === null
          ? `verb:${rosterVerb.name}`
          : rosterVerb.engineRef,
      label: rosterVerb.name,
      ref: rosterVerb.engineRef,
      verb: rosterVerb.name,
      step: null,
      invocable: rosterVerb.public,
      external: false,
      // A work verb leads its own pipeline, so it is wired even where
      // another verb leads this one.
      unwired: !leadsAPipeline(rosterVerb),
      sourcePath: rosterVerb.sourcePath,
      artifactPath: rosterVerb.artifactPath,
      health: healthFromStatus(checkRow?.status),
      engineError: rosterVerb.engineError,
      staleFiles: checkRow?.staleFiles ?? [],
      orphanFiles: checkRow?.orphanFiles ?? [],
      slots,
    });
  }

  const orphans: OrphanFillEntry[] = composition.fills
    .filter(
      fill =>
        !boundBindings.has(fill.binding) &&
        !hasBoundTeamCopy(fill, composition, boundBindings)
    )
    .map(fill => ({
      fill: fill.binding,
      provides: fill.provides,
      sourcePath: fill.sourcePath,
      registered: fill.registered,
      health: 'orphaned',
    }));

  // Work-type independence, which the rail badge depends on: the rail has no
  // work-type picker, so it counts against the pack's default while the page
  // counts against whatever the picker says. Those agree because the ONLY
  // rows that come and go with the work type are stage refs that no binder
  // and no roster verb backs -- rt omits a binder for a stage that binds
  // nothing, so such a ref is a row in the work types whose pipeline names it
  // and absent everywhere else. `needsAttention` can never answer true for
  // one (see its comment: every signal arrives via a roster verb), and every
  // roster verb gets exactly one row in EVERY work type -- placed as the
  // orchestrator, a stage or a binder, or swept in unwired just above. So the
  // count cannot move when the work type does.
  const attentionCount = spineRows({ orchestrator, stages, outside }).filter(
    needsAttention
  ).length;

  return {
    workType,
    workTypes,
    pipelineState,
    orchestrator,
    stages,
    outside,
    orphans,
    attentionCount,
  };
}
