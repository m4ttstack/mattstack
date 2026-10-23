import type { LayerValue } from "./blocks/props.ts";

export type BindingsMap = Record<string, Record<string, string>>;

/** Keyed `<engineRef>[/<blockPath>]` -> prop -> every layer's value in layer order. */
export type LayeredBindings = Record<string, Record<string, LayerValue[]>>;

export type PipelineValue = string[] | { stages?: string[]; bindings?: BindingsMap };

/** A pipeline's name becomes a copy directory and a `{{verb.path}}` segment, so it carries the skill-name rule. */
export const PIPELINE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** A copy is named `<stage>--<pipeline>`, so a `--` in the pipeline name could make two copies' names collide. */
export function pipelineNameError(name: string): string | null {
  if (!PIPELINE_NAME_RE.test(name)) return `pipeline "${name}" must match [a-z][a-z0-9-]*`;
  if (name.includes("--")) return `pipeline "${name}" must not contain "--"`;
  return null;
}

// Manifest keys are untrusted: a "__proto__" key read off a plain object would return Object.prototype.
function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined;
}

export function normalizePipelines(raw: unknown): { stages: Record<string, string[]>; bindings: Record<string, BindingsMap> } {
  const stages: Record<string, string[]> = Object.create(null);
  const bindings: Record<string, BindingsMap> = Object.create(null);
  if (!raw || typeof raw !== "object") return { stages, bindings };
  for (const [type, value] of Object.entries(raw as Record<string, PipelineValue>)) {
    if (Array.isArray(value)) {
      stages[type] = [...value];
      continue;
    }
    if (value.stages) stages[type] = [...value.stages];
    const refs = Object.entries(value.bindings ?? {});
    if (refs.length === 0) continue;
    const copy: BindingsMap = Object.create(null);
    for (const [engineRef, slots] of refs) copy[engineRef] = { ...slots };
    bindings[type] = copy;
  }
  return { stages, bindings };
}

export function pipelineBindingKey(type: string, engineRef: string, slot: string): string {
  return `${type}/${engineRef} ${slot}`;
}

export function stageCopyName(stage: string, pipeline: string): string {
  return `${stage}--${pipeline}`;
}

export function effectiveSlotBindings(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): Record<string, string> {
  return { ...own(defaults, engineRef), ...own(overrides, engineRef) };
}

/** A pipeline's values follow the top-level ones, so a pipeline's `""` clears the top level the way a later layer's does. */
export function effectiveBindings(defaults: LayeredBindings, overrides: LayeredBindings | undefined, key: string): Record<string, LayerValue[]> {
  const out: Record<string, LayerValue[]> = Object.create(null);
  for (const source of [own(defaults, key), own(overrides, key)]) {
    for (const [prop, values] of Object.entries(source ?? {})) out[prop] = [...(out[prop] ?? []), ...values];
  }
  return out;
}

/** The stage a binding key belongs to: a block engine's keys add `/<block path>` to the engine ref a pipeline lists. */
export function engineRefOf(key: string): string {
  const slash = key.indexOf("/");
  return slash < 0 ? key : key.slice(0, slash);
}

/** A block engine's blocks bind under `<engineRef>/<block path>`, so each of those keys can differ too; a slot engine has only `engineRef`. */
export function fillsDiffer(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): boolean {
  const ownsKey = (key: string) => key === engineRef || key.startsWith(`${engineRef}/`);
  const keys = new Set([...Object.keys(defaults), ...Object.keys(overrides ?? {})].filter(ownsKey));
  for (const key of keys) {
    const base = own(defaults, key) ?? {};
    const effective = effectiveSlotBindings(defaults, overrides, key);
    for (const slot of new Set([...Object.keys(base), ...Object.keys(effective)])) {
      if ((base[slot] ?? "") !== (effective[slot] ?? "")) return true;
    }
  }
  return false;
}

export function defaultPipeline(stages: Record<string, unknown>): string | null {
  const names = Object.keys(stages);
  if (names.length === 1) return names[0]!;
  return names.includes("feature") ? "feature" : null;
}
