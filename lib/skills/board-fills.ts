import type { LayeredBindings } from "./pipelines.ts";

/**
 * The board opens a `board:*` binding's fill by `<plugin>:<name>` at run time
 * and compile never inlines one, so a base fill bound only from board slots
 * must ride in the team pack, the one pack a Mac installs. A fill any compile
 * target binds stays inlined only.
 */
export function boardOnlyBaseFills(base: string, bindings: Record<string, Record<string, string>>): Set<string> {
  const prefix = `${base}:`;
  const board = new Set<string>();
  const elsewhere = new Set<string>();
  for (const [engineRef, slots] of Object.entries(bindings)) {
    for (const fill of Object.values(slots)) {
      if (!fill.startsWith(prefix)) continue;
      (engineRef.startsWith("board:") ? board : elsewhere).add(fill.slice(prefix.length));
    }
  }
  return new Set([...board].filter((name) => !elsewhere.has(name)));
}

/** The bindings of each fragment, later ones winning per slot; anything not shaped as engine -> slot -> fill is skipped. */
export function mergedBindings(...fragments: (Record<string, unknown> | null)[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = Object.create(null);
  for (const fragment of fragments) {
    const bindings = fragment?.bindings;
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) continue;
    for (const [engineRef, slots] of Object.entries(bindings)) {
      if (!slots || typeof slots !== "object" || Array.isArray(slots)) continue;
      for (const [slot, fill] of Object.entries(slots)) {
        if (typeof fill === "string") (out[engineRef] ??= Object.create(null) as Record<string, string>)[slot] = fill;
      }
    }
  }
  return out;
}

type Retargetable = {
  bindings: Record<string, Record<string, string>>;
  pipelineBindings: Record<string, Record<string, Record<string, string>>>;
  layered: LayeredBindings;
  pipelineLayered: Record<string, LayeredBindings>;
};

/** Points each board slot bound to one of `fills` in `base` at the team plugin that now carries it, in every section that records the binding. */
export function retargetBoardFills(merged: Retargetable, base: string, fills: Set<string>, plugin: string): void {
  const prefix = `${base}:`;
  const retarget = (fill: string) => (fill.startsWith(prefix) && fills.has(fill.slice(prefix.length)) ? `${plugin}:${fill.slice(prefix.length)}` : fill);
  for (const bindings of [merged.bindings, ...Object.values(merged.pipelineBindings)]) {
    for (const [engineRef, slots] of Object.entries(bindings)) {
      if (!engineRef.startsWith("board:")) continue;
      for (const [slot, fill] of Object.entries(slots)) slots[slot] = retarget(fill);
    }
  }
  for (const layered of [merged.layered, ...Object.values(merged.pipelineLayered)]) {
    for (const [engineRef, props] of Object.entries(layered)) {
      if (!engineRef.startsWith("board:")) continue;
      for (const values of Object.values(props)) for (const v of values) v.value = retarget(v.value);
    }
  }
}
