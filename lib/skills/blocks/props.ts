import { isInlined } from "../compile.ts";
import type { AttachmentSource } from "../types.ts";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import type { PropSpec } from "./types.ts";

/** One layer's binding for a prop; `value: ""` clears every layer before it. */
export type LayerValue = { layer: string; value: string };

export type PropValue = {
  spec: PropSpec;
  sources: { layer: string; fill: AttachmentSource; mode: "inline" | "reference" }[];
  fromDefault: boolean;
};

type Pos = { file: string; line: number; col: number };

/** The layer values a prop keeps after its merge and any `""` clears; `clearedBy` names the clearing layer when nothing is kept. */
export function keptLayers(spec: PropSpec, layers: LayerValue[]): { kept: LayerValue[]; clearedBy: string | null } {
  let kept: LayerValue[] = [];
  let clearedBy: string | null = null;
  for (const entry of layers) {
    if (entry.value === "") {
      kept = [];
      clearedBy = entry.layer;
    } else {
      kept = spec.merge === "replace" ? [entry] : [...kept, entry];
      clearedBy = null;
    }
  }
  return { kept, clearedBy };
}

/** `valueAt` places a diagnostic at the layer value a person edits; without it every diagnostic sits at the declaration. */
export function resolveProp(
  spec: PropSpec,
  layers: LayerValue[],
  load: (binding: string, layer: string) => AttachmentSource,
  where: { file: string; internalRoster: Set<string>; valueAt?: (layer: string, value: string) => Pos },
): PropValue {
  const resolved = keptLayers(spec, layers);
  const clearedBy = resolved.clearedBy;
  let kept = resolved.kept;

  const declaration: Pos = { file: where.file, ...spec.declaredAt };
  const at = (code: string, message: string, pos: Pos = declaration): BlockDiagnostic => ({ ...pos, message, code });
  const valuePos = (layer: string, value: string): Pos => (layer === "default" || !where.valueAt ? declaration : where.valueAt(layer, value));

  let fromDefault = false;
  if (kept.length === 0) {
    if (spec.default === null) {
      const why = clearedBy !== null ? `it was cleared by ${clearedBy}` : "no layer passes a value";
      const pos = clearedBy !== null ? valuePos(clearedBy, "") : declaration;
      throw new BlockError([at("required-prop", `prop "${spec.name}" is required and has no default; ${why}`, pos)]);
    }
    fromDefault = true;
    if (spec.default === "") return { spec, sources: [], fromDefault };
    kept = [{ layer: "default", value: spec.default }];
  }

  const sources = kept.map(({ layer, value }) => {
    const fill = load(value, layer);
    const mode: "inline" | "reference" = isInlined(fill, where.internalRoster) ? "inline" : "reference";
    return { layer, fill, mode };
  });

  if (spec.contract !== null) {
    const mismatches = sources
      .filter((s) => s.fill.provides !== spec.contract)
      .map((s) =>
        at(
          "contract-mismatch",
          `prop "${spec.name}": ${s.fill.binding} (from ${s.layer}) provides "${s.fill.provides}", but the prop's contract is "${spec.contract}"`,
          valuePos(s.layer, s.fill.binding),
        ),
      );
    if (mismatches.length > 0) throw new BlockError(mismatches);
  }

  return { spec, sources, fromDefault };
}
