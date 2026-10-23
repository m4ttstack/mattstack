import { resolve } from "node:path";
import { BlockError, type BlockDiagnostic } from "../blocks/diagnostics.ts";
import type { PropValue } from "../blocks/props.ts";
import { renderTree, type SourcedTree } from "../blocks/render.ts";
import { walk } from "../blocks/tree.ts";
import { includeNamesIn, type BlockValues } from "../compile-blocks.ts";
import type { AttachmentSource, PlaceholderContext } from "../types.ts";

export type IncludeLookup = {
  tree: (name: string) => SourcedTree | null;
  flat: (name: string) => AttachmentSource | null;
};

/**
 * The verb, stage and pipeline an engine compiles into are unknown here, so
 * only the placeholder refusals that hold in every compile are kept.
 */
const CONTEXT_FREE_RE = /unknown placeholder|is not a loaded attachment|must be alone on its line|takes no argument|would include itself/;

const ctxFor = (includes: Record<string, AttachmentSource>): PlaceholderContext => ({
  partsPrefix: "${CLAUDE_SKILL_DIR}/parts",
  includes,
  pipelines: {},
  repoKey: "",
  mattstackSha: "",
  mattstackDirty: 0,
  packSha: "",
  stageDir: null,
  stageMeta: null,
  compiledFrom: "",
  verbSides: {},
  side: "skills",
  packRoot: null,
  pipeline: null,
  team: null,
});

/**
 * Every prop renders empty: render's own checks (marker placement, includes,
 * placeholders) do not depend on fills, and a prop with no value aborts the render.
 */
function emptyValues(trees: SourcedTree[]): BlockValues {
  const values: BlockValues = new Map();
  for (const { tree } of trees) {
    for (const block of walk(tree)) {
      values.set(block.id, new Map(block.props.map((spec): [string, PropValue] => [spec.name, { spec, sources: [], fromDefault: true }])));
    }
  }
  return values;
}

/** A dry render of `engine` with its includes; diagnostics come back with absolute files. */
export function renderDiagnostics(engine: SourcedTree, lookup: IncludeLookup, pluginDirOf: (t: SourcedTree) => string): BlockDiagnostic[] {
  const drawn: SourcedTree[] = [engine];
  const treeIncludes = new Map<string, SourcedTree>();
  const flat: Record<string, AttachmentSource> = {};
  for (let i = 0; i < drawn.length; i++) {
    for (const name of includeNamesIn(drawn[i]!.tree)) {
      if (treeIncludes.has(name) || Object.hasOwn(flat, name)) continue;
      const tree = lookup.tree(name);
      if (tree) {
        treeIncludes.set(name, tree);
        drawn.push(tree);
        continue;
      }
      const inc = lookup.flat(name);
      if (inc) flat[name] = inc;
    }
  }

  let found: BlockDiagnostic[] = [];
  try {
    renderTree({
      tree: engine.tree,
      source: { plugin: engine.plugin, version: engine.version },
      values: emptyValues(drawn),
      includes: (name) => treeIncludes.get(name) ?? null,
      ctx: ctxFor(flat),
    });
  } catch (err) {
    found =
      err instanceof BlockError
        ? err.diagnostics.filter((d) => d.code !== "bad-value" || CONTEXT_FREE_RE.test(d.message))
        : [{ file: engine.tree.root.relPath, line: 1, col: 1, code: "bad-value", message: err instanceof Error ? err.message : String(err) }];
  }

  const ownerOf = new Map<string, SourcedTree>();
  for (const t of drawn) for (const block of walk(t.tree)) if (!ownerOf.has(block.relPath)) ownerOf.set(block.relPath, t);
  return found.map((d) => ({ ...d, file: resolve(pluginDirOf(ownerOf.get(d.file) ?? engine), d.file) }));
}
