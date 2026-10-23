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
    for (const [key, props] of refs) copy[key] = { ...props };
    bindings[type] = copy;
  }
  return { stages, bindings };
}

export function pipelineBindingKey(type: string, key: string, prop: string): string {
  return `${type}/${key} ${prop}`;
}

export function stageCopyName(stage: string, pipeline: string): string {
  return `${stage}--${pipeline}`;
}

/** The last-wins value of each prop a pipeline's stage copy reads: the pipeline's own where it binds the prop, else the top level's. */
export function lastWinsBindings(defaults: BindingsMap, overrides: BindingsMap | undefined, key: string): Record<string, string> {
  return { ...own(defaults, key), ...own(overrides, key) };
}

/** A pipeline's binding is not a layer: for each prop it binds, its values replace the top level's, stacked among themselves. */
export function effectiveBindings(defaults: LayeredBindings, overrides: LayeredBindings | undefined, key: string): Record<string, LayerValue[]> {
  const out: Record<string, LayerValue[]> = Object.create(null);
  for (const source of [own(defaults, key), own(overrides, key)]) {
    for (const [prop, values] of Object.entries(source ?? {})) out[prop] = [...values];
  }
  return out;
}

/** The stage a binding key belongs to: a block engine's keys add `/<block path>` to the engine ref a pipeline lists. */
export function engineRefOf(key: string): string {
  const slash = key.indexOf("/");
  return slash < 0 ? key : key.slice(0, slash);
}

/** A `""` drops every value before it whatever the prop's merge, so only what follows the last one reaches a compiled verb. */
function afterLastClear(values: LayerValue[]): string[] {
  return values.slice(values.findLastIndex((v) => v.value === "") + 1).map((v) => v.value);
}

/** True when a pipeline's own values change a prop of the engine, at its root key or any `<engineRef>/<block path>` key. */
export function fillsDiffer(defaults: LayeredBindings, overrides: LayeredBindings | undefined, engineRef: string): boolean {
  const ownsKey = (key: string) => key === engineRef || key.startsWith(`${engineRef}/`);
  for (const key of Object.keys(overrides ?? {}).filter(ownsKey)) {
    const base = own(defaults, key) ?? {};
    for (const [prop, values] of Object.entries(own(overrides, key) ?? {})) {
      const before = afterLastClear(base[prop] ?? []);
      const after = afterLastClear(values);
      if (before.length !== after.length || before.some((v, i) => v !== after[i])) return true;
    }
  }
  return false;
}

export function defaultPipeline(stages: Record<string, unknown>): string | null {
  const names = Object.keys(stages);
  if (names.length === 1) return names[0]!;
  return names.includes("feature") ? "feature" : null;
}
