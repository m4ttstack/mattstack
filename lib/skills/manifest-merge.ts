import type { LayerValue } from "./blocks/props.ts";
import { engineRefOf, normalizePipelines, pipelineBindingKey, pipelineNameError, type BindingsMap, type LayeredBindings, type PipelineValue } from "./pipelines.ts";
import { stripJsonc } from "../jsonc.ts";

export type Fragment = {
  extends?: string;
  /** A base pack only exists to be named by other packs' `extends`: it never claims a repo and gets no bindings file. */
  base?: boolean;
  skills?: { enabled?: string[] };
  pipelines?: Record<string, PipelineValue>;
  bindings?: Record<string, Record<string, string>>;
};

/** label is the layer's provenance name: "default", "base:<pack>", "pack" or "override". */
export type Layer = { label: string; fragment: Fragment };

export type { LayeredBindings };

export type DroppedOverride = { key: string; layer: string };

/** "removed": some layer's list for that pipeline had the stage and a higher one took it out. "unlisted": no layer's list ever had it. */
export type MergedDroppedOverride = DroppedOverride & { reason: "removed" | "unlisted" };

export type MergedManifest = {
  enabled: string[];
  pipelines: Record<string, string[]>;
  bindings: BindingsMap;
  /** Per-pipeline prop overrides, keyed pipeline -> binding key -> prop; only pipelines that carry any appear. */
  pipelineBindings: Record<string, BindingsMap>;
  /** Overrides the final stage list leaves without a stage to apply to. */
  dropped: MergedDroppedOverride[];
  provenance: Record<string, string>;
  /** Every layer's value per (key, prop) in layer order, `""` included; `bindings` is its last-wins view. */
  layered: LayeredBindings;
  pipelineLayered: Record<string, LayeredBindings>;
};

export class FragmentError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function bindingsShapeError(bindings: unknown, path: string): string | null {
  if (!isObject(bindings)) return `${path} is not an object`;
  for (const [key, props] of Object.entries(bindings)) {
    if (!isObject(props)) return `${path}.${key} is not an object`;
    // An empty fill is how a later layer clears a prop an earlier one filled.
    for (const [prop, fill] of Object.entries(props)) {
      if (typeof fill !== "string") return `${path}.${key}.${prop} is not a string`;
    }
  }
  return null;
}

function pipelineShapeError(type: string, value: unknown): string | null {
  if (Array.isArray(value)) return isStringArray(value) ? null : `pipelines.${type} is not an array of strings`;
  if (!isObject(value)) return `pipelines.${type} is not an array of strings or an object`;
  const unknown = Object.keys(value).find((key) => key !== "stages" && key !== "bindings");
  if (unknown !== undefined) return `pipelines.${type}.${unknown} is not a known key (stages, bindings)`;
  if (value.stages !== undefined && !isStringArray(value.stages)) return `pipelines.${type}.stages is not an array of strings`;
  if (value.bindings === undefined) return null;
  const problem = bindingsShapeError(value.bindings, `pipelines.${type}.bindings`);
  if (problem) return problem;
  return pipelineNameError(type);
}

function shapeError(doc: Record<string, unknown>): string | null {
  if (doc.extends !== undefined && typeof doc.extends !== "string") return "extends is not a string";
  if (doc.base !== undefined && typeof doc.base !== "boolean") return "base is not a boolean";
  if (doc.skills !== undefined) {
    if (!isObject(doc.skills)) return "skills is not an object";
    if (doc.skills.enabled !== undefined && !isStringArray(doc.skills.enabled)) return "skills.enabled is not an array of strings";
  }
  if (doc.pipelines !== undefined) {
    if (!isObject(doc.pipelines)) return "pipelines is not an object";
    for (const [type, value] of Object.entries(doc.pipelines)) {
      const problem = pipelineShapeError(type, value);
      if (problem) return problem;
    }
  }
  if (doc.bindings !== undefined) return bindingsShapeError(doc.bindings, "bindings");
  return null;
}

export function parseFragment(text: string, path: string): Fragment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    throw new FragmentError(`fragment is not valid JSONC: ${path}`);
  }
  if (!isObject(parsed)) {
    throw new FragmentError(`fragment is not a JSON object: ${path}`);
  }
  const problem = shapeError(parsed);
  if (problem) throw new FragmentError(`fragment ${problem}: ${path}`);
  return parsed as Fragment;
}

export function mergeLayers(layers: Layer[]): MergedManifest {
  // Fragment keys are untrusted: a "__proto__" key assigned into a plain object would write through to Object.prototype.
  const out: MergedManifest = { enabled: [], pipelines: Object.create(null), bindings: Object.create(null), pipelineBindings: Object.create(null), dropped: [], provenance: Object.create(null), layered: Object.create(null), pipelineLayered: Object.create(null) };
  // The engine refs the layer that last set a pipeline's stages also overrode in that same fragment.
  const stagesLayerRefs: Record<string, Set<string>> = Object.create(null);
  const everListed: Record<string, Set<string>> = Object.create(null);
  for (const { label, fragment } of layers) {
    for (const name of fragment.skills?.enabled ?? []) {
      if (!out.enabled.includes(name)) out.enabled.push(name);
    }
    const { stages, bindings } = normalizePipelines(fragment.pipelines);
    for (const [type, list] of Object.entries(stages)) {
      out.pipelines[type] = list;
      out.provenance[`pipeline ${type}`] = label;
      stagesLayerRefs[type] = new Set(Object.keys(bindings[type] ?? {}));
      const listed = (everListed[type] ??= new Set());
      for (const stage of list) listed.add(stage);
    }
    for (const [type, refs] of Object.entries(bindings)) {
      for (const [key, props] of Object.entries(refs)) {
        for (const [prop, fill] of Object.entries(props)) {
          const forType = (out.pipelineBindings[type] ??= Object.create(null) as BindingsMap);
          (forType[key] ??= Object.create(null) as Record<string, string>)[prop] = fill;
          appendLayer((out.pipelineLayered[type] ??= Object.create(null) as LayeredBindings), key, prop, label, fill);
          out.provenance[pipelineBindingKey(type, key, prop)] = label;
        }
      }
    }
    for (const [key, props] of Object.entries(fragment.bindings ?? {})) {
      for (const [prop, fill] of Object.entries(props)) {
        (out.bindings[key] ??= Object.create(null) as Record<string, string>)[prop] = fill;
        appendLayer(out.layered, key, prop, label, fill);
        out.provenance[`${key} ${prop}`] = label;
      }
    }
  }
  settlePipelineBindings(out, stagesLayerRefs, everListed);
  return out;
}

function appendLayer(into: LayeredBindings, key: string, prop: string, layer: string, value: string): void {
  ((into[key] ??= Object.create(null) as Record<string, LayerValue[]>)[prop] ??= []).push({ layer, value });
}

function settlePipelineBindings(out: MergedManifest, stagesLayerRefs: Record<string, Set<string>>, everListed: Record<string, Set<string>>): void {
  for (const type of Object.keys(out.pipelineBindings)) {
    const stages = out.pipelines[type];
    if (!stages) throw new FragmentError(`pipeline "${type}" has bindings but no layer gives it stages`);
    const refs = out.pipelineBindings[type]!;
    for (const engineRef of Object.keys(refs)) {
      if (stages.includes(engineRefOf(engineRef))) continue;
      if (stagesLayerRefs[type]!.has(engineRef)) throw new FragmentError(`pipeline "${type}" binds ${engineRef} but does not list it`);
      const reason = everListed[type]!.has(engineRefOf(engineRef)) ? "removed" : "unlisted";
      for (const prop of Object.keys(refs[engineRef]!)) {
        const key = pipelineBindingKey(type, engineRef, prop);
        out.dropped.push({ key, layer: out.provenance[key]!, reason });
        delete out.provenance[key];
      }
      delete refs[engineRef];
      delete out.pipelineLayered[type]![engineRef];
    }
    if (Object.keys(refs).length === 0) {
      delete out.pipelineBindings[type];
      delete out.pipelineLayered[type];
    }
  }
}

export const PROVENANCE_LINE = /^\/\/\s{3}(.+?) <- (\S+)\s*$/;

const DROPPED_LINE = /^\/\/ dropped: (.+?) <- (\S+)\s*$/;

const ZONE_LINE = /^\/\/ zone: (\S+)\s*$/;

/** `zone` is the team clone's slug under teams/; the stale-file sweep reads it back to tell a removed pack from an absent zone. */
export function renderManifest(merged: MergedManifest, opts: { repo: string; pack: string; zone: string }): string {
  const lines = [
    "// GENERATED by rt skills materialize -- do not hand-edit for keeps;",
    "// the next pack install or materialize run rewrites this file.",
    `// repo: ${opts.repo}`,
    `// pack: ${opts.pack}`,
    `// zone: ${opts.zone}`,
    "// provenance (binding <- layer):",
    ...Object.entries(merged.provenance).map(([key, label]) => `//   ${key} <- ${label}`),
    ...merged.dropped.map(({ key, layer }) => `// dropped: ${key} <- ${layer}`),
  ];
  // A pipeline with no overrides stays a plain list so manifests written before overrides existed render byte for byte the same.
  const pipelines: Record<string, PipelineValue | { stages: string[]; bindings: BindingsMap; layered: LayeredBindings }> = Object.create(null);
  let v2 = usesV2Forms(merged.bindings);
  for (const [type, stages] of Object.entries(merged.pipelines)) {
    const bindings = merged.pipelineBindings[type];
    if (!bindings) {
      pipelines[type] = stages;
      continue;
    }
    v2 ||= usesV2Forms(bindings);
    const layered = stackedOnly(merged.pipelineLayered[type] ?? {});
    v2 ||= layered !== null;
    pipelines[type] = layered ? { stages, bindings, layered } : { stages, bindings };
  }
  const layered = stackedOnly(merged.layered);
  v2 ||= layered !== null;
  // Version 1 output stays byte for byte today's, so only a file that needs a version 2 form says 2.
  const body = { version: v2 ? 2 : 1, skills: { enabled: merged.enabled }, pipelines, bindings: merged.bindings, ...(layered ? { layered } : {}) };
  return `${lines.join("\n")}\n${JSON.stringify(body, null, 2)}\n`;
}

/** The layered section carries only what several layers bound; the rest reads back from `bindings` and provenance. */
function stackedOnly(layered: LayeredBindings): LayeredBindings | null {
  const out: LayeredBindings = Object.create(null);
  for (const [key, props] of Object.entries(layered)) {
    for (const [prop, values] of Object.entries(props)) {
      if (values.length > 1) (out[key] ??= Object.create(null) as Record<string, LayerValue[]>)[prop] = values;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function usesV2Forms(bindings: BindingsMap): boolean {
  return Object.entries(bindings).some(([key, props]) => key.includes("/") || Object.values(props).some((value) => value.includes("/")));
}

type ManifestDoc = { bindings?: unknown; layered?: unknown; pipelines?: unknown };

/** A string binding takes its layer from provenance, or "pack" in a file with no provenance lines (a fragment read directly). */
export function layeredFromManifest(text: string): { layered: LayeredBindings; pipelineLayered: Record<string, LayeredBindings> } {
  const doc = JSON.parse(stripJsonc(text)) as ManifestDoc;
  const provenance = readManifestProvenance(text);
  const layerOf = (provKey: string) => (Object.hasOwn(provenance, provKey) ? provenance[provKey]! : "pack");
  const layered = readLayered(doc.bindings, doc.layered, (key, prop) => layerOf(`${key} ${prop}`));
  const pipelineLayered: Record<string, LayeredBindings> = Object.create(null);
  if (isObject(doc.pipelines)) {
    for (const [type, value] of Object.entries(doc.pipelines)) {
      if (!isObject(value) || !isObject(value.bindings)) continue;
      const read = readLayered(value.bindings, value.layered, (key, prop) => layerOf(pipelineBindingKey(type, key, prop)));
      if (Object.keys(read).length > 0) pipelineLayered[type] = read;
    }
  }
  return { layered, pipelineLayered };
}

function readLayered(bindings: unknown, stacked: unknown, layerOf: (key: string, prop: string) => string): LayeredBindings {
  const out: LayeredBindings = Object.create(null);
  if (!isObject(bindings)) return out;
  const stackedMap = isObject(stacked) ? stacked : {};
  for (const [key, props] of Object.entries(bindings)) {
    if (!isObject(props)) continue;
    const stackedProps = Object.hasOwn(stackedMap, key) && isObject(stackedMap[key]) ? stackedMap[key] : {};
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== "string") continue;
      const several = Object.hasOwn(stackedProps, prop) ? layerValues(stackedProps[prop]) : null;
      (out[key] ??= Object.create(null) as Record<string, LayerValue[]>)[prop] = several ?? [{ layer: layerOf(key, prop), value }];
    }
  }
  return out;
}

function layerValues(raw: unknown): LayerValue[] | null {
  if (!Array.isArray(raw)) return null;
  const ok = raw.every((v) => isObject(v) && typeof v.layer === "string" && typeof v.value === "string");
  return ok ? raw.map((v) => ({ layer: v.layer as string, value: v.value as string })) : null;
}

export function readManifestProvenance(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) break;
    const m = PROVENANCE_LINE.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function readManifestDropped(text: string): DroppedOverride[] {
  const out: DroppedOverride[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) break;
    const m = DROPPED_LINE.exec(line);
    if (m) out.push({ key: m[1]!, layer: m[2]! });
  }
  return out;
}

export function readManifestZone(text: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) break;
    const m = ZONE_LINE.exec(line);
    if (m) return m[1]!;
  }
  return null;
}
