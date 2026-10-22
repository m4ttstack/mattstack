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

export function resolveProp(
  spec: PropSpec,
  layers: LayerValue[],
  load: (binding: string) => AttachmentSource,
  where: { file: string; internalRoster: Set<string> },
): PropValue {
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

  const at = (code: string, message: string): BlockDiagnostic => ({
    file: where.file,
    line: spec.declaredAt.line,
    col: spec.declaredAt.col,
    message,
    code,
  });

  let fromDefault = false;
  if (kept.length === 0) {
    if (spec.default === null) {
      const why = clearedBy !== null ? `it was cleared by ${clearedBy}` : "no layer passes a value";
      throw new BlockError([at("required-prop", `prop "${spec.name}" is required and has no default; ${why}`)]);
    }
    fromDefault = true;
    if (spec.default === "") return { spec, sources: [], fromDefault };
    kept = [{ layer: "default", value: spec.default }];
  }

  const sources = kept.map(({ layer, value }) => {
    const fill = load(value);
    const mode: "inline" | "reference" = fill.file !== null || isInlined(fill, where.internalRoster) ? "inline" : "reference";
    return { layer, fill, mode };
  });

  if (spec.contract !== null) {
    const mismatches = sources
      .filter((s) => s.fill.provides !== spec.contract)
      .map((s) =>
        at(
          "contract-mismatch",
          `prop "${spec.name}": ${s.fill.binding} (from ${s.layer}) provides "${s.fill.provides}", but the prop's contract is "${spec.contract}"`,
        ),
      );
    if (mismatches.length > 0) throw new BlockError(mismatches);
  }

  return { spec, sources, fromDefault };
}
