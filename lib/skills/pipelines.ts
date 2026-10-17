export type BindingsMap = Record<string, Record<string, string>>;

export type PipelineValue = string[] | { stages?: string[]; bindings?: BindingsMap };

/** A pipeline's name becomes a copy directory and a `{{verb.path}}` segment, so it carries the skill-name rule. */
export const PIPELINE_NAME_RE = /^[a-z][a-z0-9-]*$/;

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

export function fillsDiffer(defaults: BindingsMap, overrides: BindingsMap | undefined, engineRef: string): boolean {
  const base = own(defaults, engineRef) ?? {};
  const effective = effectiveSlotBindings(defaults, overrides, engineRef);
  for (const slot of new Set([...Object.keys(base), ...Object.keys(effective)])) {
    if ((base[slot] ?? "") !== (effective[slot] ?? "")) return true;
  }
  return false;
}

export function defaultPipeline(stages: Record<string, unknown>): string | null {
  const names = Object.keys(stages);
  if (names.length === 1) return names[0]!;
  return names.includes("feature") ? "feature" : null;
}
