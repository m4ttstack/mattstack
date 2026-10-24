import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { BlockError, type BlockDiagnostic } from "../blocks/diagnostics.ts";
import type { SourcedTree } from "../blocks/render.ts";
import { collectBlockTree, walk } from "../blocks/tree.ts";
import type { Block, BlockTree } from "../blocks/types.ts";
import { collectBlockPropValues, includeNamesIn, type BlockValues, type PropBindings } from "../compile-blocks.ts";
import { handPathDiagnostics } from "../hand-paths.ts";
import { layeredFromManifest } from "../manifest-merge.ts";
import type { LayeredBindings } from "../pipelines.ts";
import { loadAttachment, loadInclude, type PluginRoots } from "../sources.ts";
import type { AttachmentSource } from "../types.ts";
import { renderDiagnostics, type IncludeLookup } from "./render-check.ts";
import { fixView, readPack, type Pack } from "./skill-paths.ts";

export type ManifestBindings = { layered: LayeredBindings; pipelineLayered: Record<string, LayeredBindings> };

export type Analysis = {
  trees: Map<string /* engine dir */, BlockTree | null>;
  manifests: Map<string /* path */, ManifestBindings | null>;
  diagnostics: Map<string /* file */, BlockDiagnostic[]>;
  byBlockId: Map<string /* <plugin>:<block id> */, { tree: BlockTree; block: Block }>;
  packs: Pack[];
  /** The packs compiling each tree, directly or through an engine that includes it. */
  enginePacks: Map<string /* engine dir */, Pack[]>;
};

/** One compiled source text; a null view is a compile whose pack the workspace cannot see. */
type PathInput = { text: string; file: string; startLine: number; indent: number; noFix: boolean; views: Set<Pack | null> };

export type Plugin = { dir: string; name: string; version: string };
type Engine = { dir: string; plugin: Plugin };

const INDEX = "index.block.md";
const MANIFEST = "skills.jsonc";
const BLOCK_SUFFIX = ".block.md";
const PLUGIN_JSON = join(".claude-plugin", "plugin.json");
const SKIP_DIRS = new Set(["node_modules"]);

const diskRead = (p: string) => readFileSync(p, "utf8");

function listDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every directory under `root`, root included, skipping dot and dependency folders. */
function walkDirs(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    out.push(dir);
    for (const e of listDir(dir)) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) visit(join(dir, e.name));
    }
  };
  visit(root);
  return out;
}

const toPosix = (p: string) => p.split(sep).join("/");

/** `walked` is told of each folder tree actually read from disk, so a caller can see when discovery runs. */
export type WorkspaceHooks = { walked?: (root: string) => void; home?: string };

/** The nearest folder above `file` holding `.claude-plugin/plugin.json`. */
export function pluginRootOf(file: string): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, PLUGIN_JSON))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** A client started in the home folder (Claude Code in `~`) names it as the workspace; walking it, or `/`, reads the whole disk. */
function walkableRoot(root: string, home: string): boolean {
  const dir = resolve(root);
  if (dir === parse(dir).root) return false;
  return home !== dir && !home.startsWith(dir + sep);
}

/** What the folder walks found; only a structural change (a new file, a move, a plugin.json) drops it. */
type Discovery = { dirs: Map<string, string[]>; plugins?: Plugin[]; engines?: Engine[]; manifests?: string[] };

export class Workspace {
  private readonly overlay = new Map<string, string>();
  private readonly lastGood = new Map<string, BlockTree>();
  private cached: Analysis | null = null;
  private discovery: Discovery = { dirs: new Map() };
  private readonly walkable: string[];
  private readonly openedPlugins: string[] = [];

  constructor(
    private readonly roots: string[],
    private readonly readFile: (p: string) => string = diskRead,
    private readonly hooks: WorkspaceHooks = {},
  ) {
    const home = resolve(hooks.home ?? process.env.HOME ?? homedir());
    this.walkable = roots.filter((r) => walkableRoot(r, home));
  }

  open(file: string, text: string): void {
    const structural = (!this.overlay.has(file) && !existsSync(file)) || file.endsWith(sep + PLUGIN_JSON);
    const adopted = this.adoptPluginOf(file);
    this.overlay.set(file, text);
    this.invalidate(structural || adopted);
  }

  /** The folders discovery walks: the walkable workspace roots, then the plugin of each opened file outside them. */
  private walkRoots(): string[] {
    return [...this.walkable, ...this.openedPlugins];
  }

  private adoptPluginOf(file: string): boolean {
    if (this.walkRoots().some((r) => file.startsWith(r + sep))) return false;
    const root = pluginRootOf(file);
    if (root === null || this.openedPlugins.includes(root)) return false;
    this.openedPlugins.push(root);
    return true;
  }

  change(file: string, text: string): void {
    this.open(file, text);
  }

  close(file: string): void {
    this.overlay.delete(file);
    this.invalidate(!existsSync(file) || file.endsWith(sep + PLUGIN_JSON));
  }

  /**
   * Files changed on disk under the open documents. A moved path carries its overlay along, and its
   * last good trees are dropped, since they hold the old paths.
   */
  refresh(moves: { from: string; to: string }[] = []): void {
    const under = (file: string, dir: string) => file === dir || file.startsWith(dir + sep);
    for (const { from, to } of moves) {
      for (const [file, text] of [...this.overlay]) {
        if (!under(file, from)) continue;
        this.overlay.delete(file);
        this.overlay.set(to + file.slice(from.length), text);
      }
      for (const dir of [...this.lastGood.keys()]) {
        if (under(dir, from) || under(from, dir)) this.lastGood.delete(dir);
      }
    }
    this.invalidate(true);
  }

  private invalidate(structural: boolean): void {
    this.cached = null;
    if (structural) this.discovery = { dirs: new Map() };
  }

  private dirsUnder(root: string): string[] {
    let dirs = this.discovery.dirs.get(root);
    if (!dirs) {
      this.hooks.walked?.(root);
      dirs = walkDirs(root);
      this.discovery.dirs.set(root, dirs);
    }
    return dirs;
  }

  text(file: string): string {
    const open = this.overlay.get(file);
    if (open !== undefined) return open;
    try {
      return this.readFile(file);
    } catch {
      return "";
    }
  }

  engineDirs(): string[] {
    return this.engines().map((e) => e.dir);
  }

  analysis(): Analysis {
    this.cached ??= this.analyse();
    return this.cached;
  }

  /** The roots a fill named from `files` resolves through: the plugins holding them own their names, last wins. */
  rootsFor(files: string[]): PluginRoots {
    const plugins = this.plugins();
    const own = files.map((f) => this.pluginOf(f, plugins)).filter((p): p is Plugin => p !== null);
    return pluginRoots(plugins, own);
  }

  relativePath(file: string): string {
    const root = this.roots.filter((r) => file.startsWith(r + sep)).sort((a, b) => b.length - a.length)[0];
    return root === undefined ? file : toPosix(relative(root, file));
  }

  private exists(file: string): boolean {
    return this.overlay.has(file) || existsSync(file);
  }

  /** Every plugin under the roots, in discovery order. */
  plugins(): Plugin[] {
    this.discovery.plugins ??= this.discoverPlugins();
    return this.discovery.plugins;
  }

  private discoverPlugins(): Plugin[] {
    const out: Plugin[] = [];
    for (const root of this.walkRoots()) {
      for (const dir of this.dirsUnder(root)) {
        if (!this.exists(join(dir, PLUGIN_JSON))) continue;
        try {
          const json = JSON.parse(this.text(join(dir, PLUGIN_JSON))) as { name?: unknown; version?: unknown };
          if (typeof json.name !== "string" || json.name === "") continue;
          out.push({ dir, name: json.name, version: typeof json.version === "string" ? json.version : "unknown" });
        } catch {
          continue;
        }
      }
    }
    return out;
  }

  /** The innermost open plugin holding `file`. */
  pluginAt(file: string): Plugin | null {
    return this.pluginOf(file, this.plugins());
  }

  /** Every `*.block.md` under the roots, open or on disk, whether or not its tree loads. */
  blockFiles(): string[] {
    const found = new Set<string>();
    for (const root of this.walkRoots()) {
      for (const dir of this.dirsUnder(root)) {
        for (const e of listDir(dir)) if (e.isFile() && e.name.endsWith(BLOCK_SUFFIX)) found.add(join(dir, e.name));
      }
    }
    for (const file of this.overlay.keys()) {
      if (file.endsWith(BLOCK_SUFFIX) && this.walkRoots().some((r) => file.startsWith(r + sep))) found.add(file);
    }
    return [...found];
  }

  private pluginOf(file: string, plugins: Plugin[]): Plugin | null {
    let best: Plugin | null = null;
    for (const p of plugins) {
      if ((file === p.dir || file.startsWith(p.dir + sep)) && (!best || p.dir.length > best.dir.length)) best = p;
    }
    return best;
  }

  /**
   * A tree's top dir: its index's parent holds no index. In a plugin these are the pipeline steps and
   * the includes, and the index's frontmatter is not read, so a root that stops parsing stays an engine.
   */
  private engines(): Engine[] {
    this.discovery.engines ??= this.discoverEngines(this.plugins());
    return this.discovery.engines;
  }

  private discoverEngines(plugins: Plugin[]): Engine[] {
    const out: Engine[] = [];
    for (const plugin of plugins) {
      for (const dir of this.dirsUnder(plugin.dir)) {
        if (!this.exists(join(dir, INDEX)) || this.exists(join(dirname(dir), INDEX))) continue;
        if (this.pluginOf(dir, plugins) !== plugin) continue;
        out.push({ dir, plugin });
      }
    }
    return out;
  }

  private manifestPaths(): string[] {
    this.discovery.manifests ??= this.discoverManifests();
    return this.discovery.manifests;
  }

  private discoverManifests(): string[] {
    const found = new Set<string>();
    for (const root of this.walkRoots()) {
      for (const dir of this.dirsUnder(root)) {
        if (this.exists(join(dir, MANIFEST))) found.add(join(dir, MANIFEST));
      }
    }
    for (const file of this.overlay.keys()) {
      if (basename(file) === MANIFEST && this.walkRoots().some((r) => file.startsWith(r + sep))) found.add(file);
    }
    return [...found];
  }

  private analyse(): Analysis {
    const diagnostics = new Map<string, BlockDiagnostic[]>();
    const seen = new Set<string>();
    const report = (d: BlockDiagnostic, base: string | null) => {
      const file = isAbsolute(d.file) || base === null ? d.file : resolve(base, d.file);
      const key = JSON.stringify([file, d.line, d.col, d.code, d.message]);
      if (seen.has(key)) return;
      seen.add(key);
      const list = diagnostics.get(file) ?? [];
      list.push({ ...d, file });
      diagnostics.set(file, list);
    };
    for (const file of this.overlay.keys()) diagnostics.set(file, []);

    const plugins = this.plugins();
    const trees = new Map<string, BlockTree | null>();
    const loaded: { tree: BlockTree; engine: Engine }[] = [];
    for (const engine of this.engines()) {
      const tree = this.loadTree(engine, (d) => report(d, engine.plugin.dir));
      trees.set(engine.dir, tree);
      if (tree) loaded.push({ tree, engine });
    }

    const manifests = new Map<string, ManifestBindings | null>();
    for (const path of this.manifestPaths()) {
      const text = this.text(path);
      diagnostics.set(path, diagnostics.get(path) ?? []);
      try {
        manifests.set(path, layeredFromManifest(text));
      } catch (err) {
        manifests.set(path, null);
        report({ file: path, line: 1, col: 1, code: "bad-manifest", message: `${MANIFEST} does not parse: ${errorText(err)}` }, null);
      }
    }

    const packs = plugins.flatMap((plugin) => {
      const own = [...manifests].flatMap(([path, bindings]) => (bindings && this.pluginOf(path, plugins) === plugin ? [{ text: this.text(path), bindings }] : []));
      const pack = readPack(plugin, own);
      return pack ? [pack] : [];
    });
    const enginePacks = new Map<string, Pack[]>();
    const inputs = new Map<string, PathInput>();
    const input = (file: string, text: string, startLine: number, indent: number, noFix: boolean): PathInput => {
      const key = JSON.stringify([file, startLine]);
      let hit = inputs.get(key);
      if (!hit) inputs.set(key, (hit = { text, file, startLine, indent, noFix, views: new Set() }));
      return hit;
    };

    const engineOf = new Map<BlockTree, Engine>(loaded.map(({ tree, engine }) => [tree, engine]));
    const sourced = (tree: BlockTree, engine: Engine): SourcedTree => ({ tree, plugin: engine.plugin.name, version: engine.plugin.version });
    for (const { tree, engine } of loaded) {
      const roots = pluginRoots(plugins, [engine.plugin]);
      const compiling = packs.filter((p) => p.engines.has(tree.root.id));
      for (const bindings of bindingRuns(manifests, (p) => this.text(p))) {
        const pack = bindings.manifest ? this.pluginOf(bindings.manifest.path, plugins) : null;
        const runRoots = pack ? pluginRoots(plugins, [pack, engine.plugin]) : roots;
        const load = (binding: string, prop: string) => loadAttachment(binding, prop, runRoots, (p) => this.text(p));
        const runPack = pack && compiling.find((p) => p.plugin === pack);
        const views: (Pack | null)[] = bindings.manifest === null && compiling.length > 0 ? compiling : [runPack ?? null];
        try {
          const { values, diagnostics: found } = collectBlockPropValues([sourced(tree, engine)], bindings, load, new Set<string>());
          for (const d of found) if (!heldElsewhere(d, bindings, loaded)) report(d, engine.plugin.dir);
          for (const fill of inlineFills(values)) {
            const dir = runRoots.byName[fill.plugin]?.dir;
            if (dir === undefined) continue;
            const at = input(resolve(dir, fill.srcPath), fill.body, fill.bodyStartLine, fill.bodyIndent ?? 0, false);
            views.forEach((v) => at.views.add(v));
          }
        } catch (err) {
          const file = bindings.manifest?.path ?? tree.root.path;
          report({ file, line: 1, col: 1, code: "bad-value", message: errorText(err) }, null);
        }
      }
      const includeRoot = roots.byName.mattstack?.dir ?? null;
      const lookup: IncludeLookup = {
        tree: (name) => {
          const hit = includeRoot === null ? undefined : loaded.find((l) => l.engine.dir === join(includeRoot, "attachments", name));
          return hit ? sourced(hit.tree, hit.engine) : null;
        },
        flat: (name) => {
          try {
            return loadInclude(name, roots);
          } catch {
            return null;
          }
        },
      };
      for (const d of renderDiagnostics(sourced(tree, engine), lookup, (t) => (engineOf.get(t.tree) ?? engine).plugin.dir)) report(d, null);

      const drawn = drawnFrom(tree, lookup);
      for (const t of drawn.trees) {
        const known = enginePacks.get(t.dir) ?? [];
        enginePacks.set(t.dir, [...known, ...compiling.filter((p) => !known.includes(p))]);
        for (const block of walk(t)) {
          const at = input(block.path, block.text, block.textStartLine, block.textIndent, false);
          compiling.forEach((p) => at.views.add(p));
        }
      }
      for (const inc of drawn.flat) {
        const dir = roots.byName[inc.plugin]?.dir;
        if (dir !== undefined) input(resolve(dir, inc.srcPath), inc.body, inc.bodyStartLine, inc.bodyIndent ?? 0, true);
      }
    }
    for (const d of [...inputs.values()].flatMap(handPathsOf)) report(d, null);

    const byBlockId = new Map<string, { tree: BlockTree; block: Block }>();
    for (const { tree, engine } of loaded) {
      for (const block of walk(tree)) byBlockId.set(`${engine.plugin.name}:${block.id}`, { tree, block });
    }
    return { trees, manifests, diagnostics, byBlockId, packs, enginePacks };
  }

  /** A clean load replaces the last good tree; a failed or partial one reports and keeps it. */
  private loadTree(engine: Engine, report: (d: BlockDiagnostic) => void): BlockTree | null {
    const relRoot = toPosix(relative(engine.plugin.dir, engine.dir));
    let collected;
    try {
      collected = collectBlockTree(engine.dir, { idPrefix: basename(engine.dir), relRoot, readFile: (p) => this.text(p) });
    } catch (err) {
      const ds = err instanceof BlockError ? err.diagnostics : [{ file: `${relRoot}/${INDEX}`, line: 1, col: 1, code: "bad-value", message: errorText(err) }];
      ds.forEach(report);
      return this.lastGood.get(engine.dir) ?? null;
    }
    collected.diagnostics.forEach(report);
    if (collected.tree && collected.diagnostics.length === 0) {
      this.lastGood.set(engine.dir, collected.tree);
      return collected.tree;
    }
    return this.lastGood.get(engine.dir) ?? collected.tree;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Several open plugins may share a name, so `own` (the manifest's pack, then the engine's plugin, last wins)
 * resolve their names to themselves; any other name resolves to the first plugin found.
 */
function pluginRoots(plugins: Plugin[], own: Plugin[]): PluginRoots {
  const byName: PluginRoots["byName"] = {};
  for (const p of plugins) byName[p.name] ??= { dir: p.dir, version: p.version };
  for (const p of own) byName[p.name] = { dir: p.dir, version: p.version };
  return { byName, list: [] };
}

const BINDING_KEY_RE = /^binding "([^"]+)"/;
const UNKNOWN_PROP_RE = /declares no prop "([^"]+)"$/;

/** A manifest key is only wrong when no open tree under its `<plugin>:<root id>` holds the block or declares the prop. */
function heldElsewhere(d: BlockDiagnostic, bindings: PropBindings, loaded: { tree: BlockTree; engine: Engine }[]): boolean {
  if ((d.code !== "missing-block" && d.code !== "unknown-prop") || d.file !== bindings.manifest?.path) return false;
  const key = BINDING_KEY_RE.exec(d.message)?.[1];
  if (key === undefined) return false;
  const prop = d.code === "unknown-prop" ? UNKNOWN_PROP_RE.exec(d.message)?.[1] : undefined;
  return loaded.some(({ tree, engine }) => {
    const prefix = `${engine.plugin.name}:${tree.root.id}`;
    if (key !== prefix && !key.startsWith(`${prefix}/`)) return false;
    const block = tree.byId.get(`${tree.root.id}${key.slice(prefix.length)}`);
    return block !== undefined && (prop === undefined || block.props.some((p) => p.name === prop));
  });
}

/** Defaults alone, then each manifest's top level and each of its pipeline sections. */
function bindingRuns(manifests: Map<string, ManifestBindings | null>, text: (p: string) => string): PropBindings[] {
  const runs: PropBindings[] = [{ layered: {}, manifest: null }];
  for (const [path, m] of manifests) {
    if (!m) continue;
    const manifest = { path, text: text(path) };
    runs.push({ layered: m.layered, pipelineSections: m.pipelineLayered, manifest });
    for (const [pipeline, pipelineLayered] of Object.entries(m.pipelineLayered)) {
      runs.push({ layered: m.layered, pipeline, pipelineLayered, pipelineSections: m.pipelineLayered, manifest });
    }
  }
  return runs;
}

/** A fill bound by reference is a skill of its own, which compile does not read. */
function inlineFills(values: BlockValues): AttachmentSource[] {
  return [...values.values()].flatMap((props) => [...props.values()].flatMap((v) => v.sources.filter((s) => s.mode === "inline").map((s) => s.fill)));
}

/** The tree with its tree includes, followed until none is new, and the flat includes they name. */
function drawnFrom(tree: BlockTree, lookup: IncludeLookup): { trees: BlockTree[]; flat: AttachmentSource[] } {
  const trees = [tree];
  const flat = new Map<string, AttachmentSource>();
  const seen = new Set<string>();
  for (let i = 0; i < trees.length; i++) {
    for (const name of includeNamesIn(trees[i]!)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const hit = lookup.tree(name);
      if (hit) {
        if (!trees.includes(hit.tree)) trees.push(hit.tree);
        continue;
      }
      const inc = lookup.flat(name);
      if (inc && !inc.tree) flat.set(name, inc);
    }
  }
  return { trees, flat: [...flat.values()] };
}

/**
 * Compile's hand-typed path check over one source. A fix is kept only when every compile reading the
 * source would offer the same one; an unseen pack's verbs are unknown, so a fix there could be wrong.
 */
function handPathsOf(src: PathInput): BlockDiagnostic[] {
  const where = { startLine: src.startLine, indent: src.indent };
  const bare = handPathDiagnostics(src.text, src.file, { ...where, verbs: new Set(), noFix: true });
  const views = [...src.views];
  if (src.noFix || views.length === 0 || views.includes(null)) return bare;
  const each = views.map((pack) => handPathDiagnostics(src.text, src.file, { ...where, ...fixView(pack!) }));
  return bare.map((d, i) => {
    const offered = each.map((ds) => ds[i]);
    const first = offered[0];
    return first?.fix && offered.every((o) => o?.fix?.text === first.fix!.text) ? first : d;
  });
}
