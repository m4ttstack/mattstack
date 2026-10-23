import { jsoncSites, type JsoncSite } from "../jsonc.ts";
import { BlockError, type BlockDiagnostic } from "./blocks/diagnostics.ts";
import { resolveProp, type LayerValue, type PropValue } from "./blocks/props.ts";
import { propPartsDir, renderTree, type IncludeResolver, type SourcedTree } from "./blocks/render.ts";
import { walk } from "./blocks/tree.ts";
import type { Block, BlockTree } from "./blocks/types.ts";
import {
  assertNoStrayBraces,
  assertNoTeamMarkerInVendoredFile,
  buildFrontmatter,
  dedupePreserveOrder,
  HEADER_COMMENT,
  lintInternalRoster,
  lintReferences,
  placeholderContext,
  toWildcardRule,
  type CompileSkillOpts,
} from "./compile.ts";
import { assertNoPlaceholders, assertNoTeamMarkerInAllowedTools, findPlaceholders, skillDirFor } from "./placeholders.ts";
import { effectiveBindings, type LayeredBindings } from "./pipelines.ts";
import { AttachmentLoadError } from "./sources.ts";
import type { AttachmentSource, CompiledFile, CompileResult, PlaceholderContext, StepSource, VerbDef } from "./types.ts";

const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";

export type BlockValues = Map<string /* block id */, Map<string /* prop */, PropValue>>;

/**
 * `pipelineLayered` is the pipeline's own section, read after the top level
 * the way `effectiveBindings` reads it. `pipelineSections` is every pipeline's
 * section, checked for keys naming no block even where no stage copy compiles it.
 */
export type PropBindings = {
  layered: LayeredBindings;
  pipelineLayered?: LayeredBindings;
  pipeline?: string;
  pipelineSections?: Record<string, LayeredBindings>;
  manifest: { path: string; text: string } | null;
};

type Pos = { file: string; line: number; col: number };

/** Positions in the manifest, so a binding's diagnostic names the line a person edits. */
class ManifestSites {
  private readonly sites: Map<string, JsoncSite>;

  constructor(private readonly b: PropBindings) {
    this.sites = b.manifest ? jsoncSites(b.manifest.text) : new Map();
  }

  private sections(): (string | number)[][] {
    return this.b.pipeline === undefined ? [[]] : [[], ["pipelines", this.b.pipeline]];
  }

  private at(path: (string | number)[], part: "key" | "value"): Pos | null {
    const site = this.sites.get(JSON.stringify(path));
    const pos = site ? (part === "key" ? site.key ?? site.value : site.value) : null;
    return pos && this.b.manifest ? { file: this.b.manifest.path, ...pos } : null;
  }

  private fallback(): Pos {
    return { file: this.b.manifest?.path ?? "skills.jsonc", line: 1, col: 1 };
  }

  key(key: string, prop?: string): Pos {
    for (const base of this.sections().reverse()) {
      const pos = this.keyIn(base, key, prop);
      if (pos) return pos;
    }
    return this.fallback();
  }

  keyIn(base: (string | number)[], key: string, prop?: string): Pos | null {
    return this.at([...base, "bindings", key, ...(prop === undefined ? [] : [prop])], "key");
  }

  /** One position per layer value, in the order `effectiveBindings` lists them. */
  values(key: string, prop: string): Pos[] {
    const out: Pos[] = [];
    const layeredOf = [this.b.layered, this.b.pipelineLayered ?? {}];
    this.sections().forEach((base, s) => {
      const count = (Object.hasOwn(layeredOf[s]!, key) ? layeredOf[s]![key]![prop]?.length : 0) ?? 0;
      for (let i = 0; i < count; i++) {
        out.push(this.at([...base, "layered", key, prop, i, "value"], "value") ?? this.at([...base, "bindings", key, prop], "value") ?? this.fallback());
      }
    });
    return out;
  }
}

/** The top level, then every pipeline section, each with where its keys sit in the manifest. */
function sectionsOf(b: PropBindings): { base: (string | number)[]; layered: LayeredBindings }[] {
  const pipelines = { ...b.pipelineSections };
  if (b.pipeline !== undefined && b.pipelineLayered) pipelines[b.pipeline] = b.pipelineLayered;
  return [{ base: [], layered: b.layered }, ...Object.entries(pipelines).map(([type, layered]) => ({ base: ["pipelines", type], layered }))];
}

/**
 * Resolves every prop of every block in `trees` (the engine first, then the
 * block trees it includes). A binding key is `<plugin>:<block id>`, so a key
 * under a tree's root id that names no block, or a prop the block does not
 * declare, is refused at the manifest line; every problem is collected before
 * one BlockError is thrown.
 */
export function blockPropValues(
  trees: SourcedTree[],
  bindings: PropBindings,
  load: (binding: string, prop: string) => AttachmentSource,
  internalRoster: Set<string>,
): BlockValues {
  const sites = new ManifestSites(bindings);
  const diagnostics: BlockDiagnostic[] = [];
  const values: BlockValues = new Map();
  const sections = sectionsOf(bindings);

  for (const { tree, plugin } of trees) {
    const prefix = `${plugin}:${tree.root.id}`;
    for (const { base, layered } of sections) {
      for (const [key, props] of Object.entries(layered)) {
        if (key !== prefix && !key.startsWith(`${prefix}/`)) continue;
        const id = `${tree.root.id}${key.slice(prefix.length)}`;
        const block = tree.byId.get(id);
        const keyAt = (prop?: string) => sites.keyIn(base, key, prop) ?? sites.key(key, prop);
        if (!block) {
          diagnostics.push({ ...keyAt(), code: "missing-block", message: `binding "${key}": ${prefix} has no block "${id}"` });
          continue;
        }
        for (const prop of Object.keys(props)) {
          if (block.props.some((p) => p.name === prop)) continue;
          diagnostics.push({ ...keyAt(prop), code: "unknown-prop", message: `binding "${key}": block "${id}" declares no prop "${prop}"` });
        }
      }
    }

    for (const block of walk(tree)) {
      const key = `${plugin}:${block.id}`;
      const props = new Map<string, PropValue>();
      for (const spec of block.props) {
        const layers = effectiveBindings(bindings.layered, bindings.pipelineLayered, key)[spec.name] ?? [];
        const where = (layer: string, binding: string): Pos => {
          if (layer === "default") return { file: block.relPath, ...spec.declaredAt };
          const i = layers.findLastIndex((l: LayerValue) => l.layer === layer && l.value === binding);
          return sites.values(key, spec.name)[i] ?? sites.key(key, spec.name);
        };
        const loadAt = (binding: string, layer: string): AttachmentSource => {
          try {
            return load(binding, spec.name);
          } catch (err) {
            if (!(err instanceof AttachmentLoadError)) throw err;
            const message = `binding "${key}" ${spec.name} (from ${layer}): ${err.message}`;
            throw new BlockError([{ ...where(layer, binding), code: err.code, message }]);
          }
        };
        try {
          props.set(spec.name, resolveProp(spec, layers, loadAt, { file: block.relPath, internalRoster, valueAt: where }));
        } catch (err) {
          if (!(err instanceof BlockError)) throw err;
          diagnostics.push(...err.diagnostics);
        }
      }
      values.set(block.id, props);
    }
  }

  if (diagnostics.length > 0) throw new BlockError(diagnostics);
  return values;
}

/**
 * A key `<plugin>:<tree>/<block path>` whose tree no compiled verb loaded
 * names nothing; `claimed` holds every loaded tree's `<plugin>:<root id>`,
 * and `blockPropValues` checks the keys under those.
 */
export function unclaimedBlockKeys(bindings: PropBindings, claimed: Set<string>): BlockDiagnostic[] {
  const sites = new ManifestSites(bindings);
  const diagnostics: BlockDiagnostic[] = [];
  for (const { base, layered } of sectionsOf(bindings)) {
    for (const key of Object.keys(layered)) {
      const slash = key.indexOf("/");
      if (slash < 0 || claimed.has(key.slice(0, slash))) continue;
      const pos = sites.keyIn(base, key) ?? sites.key(key);
      diagnostics.push({ ...pos, code: "missing-block", message: `binding "${key}" names a block of ${key.slice(0, slash)}, which no compiled verb loads` });
    }
  }
  return diagnostics;
}

export type IncludeSite = { name: string; file: string; line: number; col: number };

/** Each include name a tree's own text places, at its first marker; render resolves each to a tree or a flat attachment. */
export function includeSitesIn(tree: BlockTree): IncludeSite[] {
  const sites: IncludeSite[] = [];
  for (const block of walk(tree)) {
    const lines = block.text.split("\n");
    for (const p of findPlaceholders(block.text)) {
      if (p.kind !== "include" || !p.arg || sites.some((s) => s.name === p.arg)) continue;
      sites.push({ name: p.arg, file: block.relPath, line: block.textStartLine + p.line - 1, col: lines[p.line - 1]!.indexOf(p.raw) + 1 });
    }
  }
  return sites;
}

export function includeNamesIn(tree: BlockTree): string[] {
  return includeSitesIn(tree).map((s) => s.name);
}

/** A copy of the tree whose block text has been rewritten line for line, so seams and marker lines still hold. */
function withText(tree: BlockTree, rewrite: (text: string) => string): BlockTree {
  const byId = new Map<string, Block>();
  const copy = (b: Block): Block => {
    const out: Block = { ...b, text: rewrite(b.text), children: b.children.map(copy) };
    byId.set(out.id, out);
    return out;
  };
  return { root: copy(tree.root), dir: tree.dir, byId };
}

/** A tree include as render draws it: its `${CLAUDE_SKILL_DIR}` points where its files vendor, `parts/include-<name>/`. */
export function includedTree(name: string, inc: AttachmentSource & { tree: BlockTree }, ctx: PlaceholderContext): SourcedTree {
  const dir = skillDirFor(inc, ctx, `include-${name}`);
  return { tree: withText(inc.tree, (t) => t.split(SKILL_DIR_TOKEN).join(dir)), plugin: inc.plugin, version: inc.version };
}

type Placed = { block: Block; tree: BlockTree };

function placedBlocks(trees: BlockTree[]): Placed[] {
  return trees.flatMap((tree) => walk(tree).map((block) => ({ block, tree })));
}

/**
 * Builds a block-tree engine into the same one-file SKILL.md `compileSkill`
 * writes for a slot engine. `opts.includes` carries flat and tree includes
 * alike; a tree include renders through its blocks, a flat one through
 * today's `include:` part. Render diagnostics come back in `diagnostics`
 * with no files.
 */
export function compileBlockSkill(
  verb: VerbDef,
  step: StepSource & { tree: BlockTree },
  values: BlockValues,
  roster: Set<string>,
  opts: CompileSkillOpts,
): CompileResult {
  const internalRoster = opts.internalRoster ?? new Set<string>();
  const where = opts.where ?? `verb "${verb.name}"`;
  const includes = opts.includes ?? {};
  const flatIncludes = Object.fromEntries(Object.entries(includes).filter(([, inc]) => !inc.tree));

  const sources = [...values.values()].flatMap((props) => [...props.values()].flatMap((v) => v.sources));
  const compiledParts = dedupePreserveOrder([`${step.plugin}@${step.version}`, ...sources.map(({ fill }) => `${fill.binding}@${fill.version}`)]);
  const ctx = placeholderContext(step, { fills: {}, slotMode: {}, includes: flatIncludes }, compiledParts.join(" + "), opts);

  // A stage's own scripts live beside it, not at the orchestrator's ${CLAUDE_SKILL_DIR}; prop values are rewritten by render.
  const stageDir = opts.stageDir ?? null;
  const engine = stageDir ? withText(step.tree, (t) => t.split(`${SKILL_DIR_TOKEN}/`).join(`${stageDir}/`)) : step.tree;
  const included = new Map<string, SourcedTree>();
  for (const [name, inc] of Object.entries(includes)) {
    if (inc.tree) included.set(name, includedTree(name, { ...inc, tree: inc.tree }, ctx));
  }
  const resolver: IncludeResolver = (name) => included.get(name) ?? null;
  const placed = placedBlocks([engine, ...[...included.values()].map((s) => s.tree)]);

  let rendered;
  const diagnostics: BlockDiagnostic[] = [];
  try {
    rendered = renderTree({ tree: engine, source: { plugin: step.plugin, version: step.version }, values, includes: resolver, ctx });
  } catch (err) {
    if (!(err instanceof BlockError)) throw err;
    return { files: [], warnings: [], errors: [], diagnostics: err.diagnostics };
  }
  const body = `${HEADER_COMMENT}\n\n${rendered.body}`;
  assertNoPlaceholders(body, step.name);
  assertNoStrayBraces(body, step.name);

  const allowedTools = dedupePreserveOrder([
    ...step.allowedTools,
    ...propFills(placed, values, engine).flatMap(({ fill, dir }) => {
      assertNoTeamMarkerInAllowedTools(fill);
      return fill.allowedTools.map((tool) => tool.split(SKILL_DIR_TOKEN).join(skillDirFor(fill, ctx, dir)));
    }),
    ...(opts.stageAllowedTools ?? []).map(toWildcardRule),
  ]);
  const content = `${buildFrontmatter(verb, allowedTools, compiledParts)}\n\n${body}\n`;

  const vendored = vendorBlockFiles(step, placed, values, engine, includes, opts, diagnostics);
  if (diagnostics.length > 0) return { files: [], warnings: [], errors: [], diagnostics };
  const files: CompiledFile[] = [{ path: "SKILL.md", content }, ...vendored];

  const layout = opts.packRoot && opts.compiledDir ? { packRoot: opts.packRoot, compiledDir: opts.compiledDir } : null;
  const warnings = lintReferences(body, roster, files, sources.map(({ fill }) => fill.binding), {
    where,
    exemptPrefixes: opts.emittedSiblingDirs ?? [],
    exemptPaths: rendered.packPaths,
    layout,
    emittedTargetDirs: opts.emittedTargetDirs ?? [],
    plannedAttachments: opts.plannedAttachments,
  });
  const errors = [...lintInternalRoster(body, internalRoster, "body"), ...lintInternalRoster(verb.description, internalRoster, "description")];
  return { files, warnings, errors, diagnostics: [] };
}

type PropFill = { block: Block; fill: AttachmentSource; dir: string };

function propFills(placed: Placed[], values: BlockValues, engine: BlockTree): PropFill[] {
  return placed.flatMap(({ block, tree }) =>
    [...(values.get(block.id)?.values() ?? [])].flatMap((value) =>
      value.sources.map(({ fill }) => ({ block, fill, dir: propPartsDir(block, value.spec.name, tree, engine) })),
    ),
  );
}

/** A referenced value's files vendor too, as a bound slot's do, so its rewritten allowed-tools path exists. */
function vendorBlockFiles(
  step: StepSource,
  placed: Placed[],
  values: BlockValues,
  engine: BlockTree,
  includes: Record<string, AttachmentSource>,
  opts: CompileSkillOpts,
  diagnostics: BlockDiagnostic[],
): CompiledFile[] {
  const files: CompiledFile[] = [];
  const owner = new Map<string, string>();
  const add = (path: string, copyFrom: string, file: string) => {
    const first = owner.get(path);
    if (first === copyFrom) return;
    if (first !== undefined) {
      diagnostics.push({ file, line: 1, col: 1, code: "vendor-collision", message: `${first} and ${copyFrom} would both vendor to ${path}` });
      return;
    }
    owner.set(path, copyFrom);
    files.push({ path, copyFrom });
  };

  for (const entry of step.stepFiles) add(entry, `${step.dir}/${entry}`, step.tree!.root.relPath);
  for (const { block, fill, dir } of propFills(placed, values, engine)) {
    for (const entry of fill.extraFiles) {
      assertNoTeamMarkerInVendoredFile(fill, entry, opts.team ?? null);
      add(`parts/${dir}/${entry}`, `${fill.dir}/${entry}`, block.relPath);
    }
  }
  for (const [name, inc] of Object.entries(includes)) {
    for (const entry of inc.extraFiles) add(`parts/include-${name}/${entry}`, `${inc.dir}/${entry}`, inc.srcPath);
  }
  return files;
}
