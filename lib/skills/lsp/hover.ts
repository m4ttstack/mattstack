import { basename, join } from "node:path";
import { logCliEvent } from "../../cli-logger.ts";
import { keptLayers, type LayerValue } from "../blocks/props.ts";
import { walk } from "../blocks/tree.ts";
import type { Block, PropSpec } from "../blocks/types.ts";
import { loadInclude, stripFrontmatter } from "../sources.ts";
import type { AttachmentSource } from "../types.ts";
import { blockIn, loadFill } from "./lookup.ts";
import { tokenAt, type Position, type Range, type SkillPathToken, type Token } from "./positions.ts";
import { packsFor, packTarget, verbTarget } from "./skill-paths.ts";
import type { Workspace } from "./workspace.ts";

export type Hover = { contents: string; range: Range };

const MODULE = "skills-lsp";

export function hoverAt(ws: Workspace, file: string, pos: Position): Hover | null {
  try {
    const token = tokenAt(ws.text(file), file, pos);
    if (!token) return null;
    const contents = hoverText(ws, file, token);
    return contents === null ? null : { contents, range: token.range };
  } catch (err) {
    logCliEvent("error", MODULE, "hover failed", { file, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function hoverText(ws: Workspace, file: string, token: Token): string | null {
  switch (token.kind) {
    case "marker":
    case "prop-decl": {
      const held = blockIn(ws, file);
      const spec = held?.block.props.find((p) => p.name === token.prop);
      return held && spec ? propHover(ws, held.key, held.block, spec) : null;
    }
    case "binding-value":
      return bindingValueHover(ws, file, token.key, token.prop, token.value);
    case "include":
      return includeHover(ws, file, token.name);
    case "pack-path":
    case "verb-path":
      return skillPathHover(ws, file, token);
    default:
      return null;
  }
}

/** The target from its pack's root, per pack compiling the file: the rendered form depends on the output file. */
function skillPathHover(ws: Workspace, file: string, token: SkillPathToken): string | null {
  const packs = packsFor(ws, file);
  if (packs.length === 0) return null;
  const marker = token.kind === "pack-path" ? "pack.path" : "verb.path";
  return packs
    .map((pack) => {
      const target = token.kind === "pack-path" ? packTarget(pack, token.attachment, token.file) : verbTarget(pack, token.verb);
      const line = target
        ? `\`${target.rel}\` · ${target.compiled ? "compiled output, not pack source" : target.exists ? "exists" : "does not exist"}`
        : token.kind === "pack-path"
          ? "takes <attachment>/<file>"
          : `\`${token.verb}\` is not a compiled verb of ${pack.plugin.name}`;
      return `**${marker}** · ${pack.plugin.name}\n\n${line}`;
    })
    .join("\n\n");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function propHover(ws: Workspace, key: string, block: Block, spec: PropSpec): string {
  const sections = [`**${spec.name}** · ${spec.merge} · default: ${spec.default === null ? "none" : JSON.stringify(spec.default)}`];
  const groups = layerGroups(ws, key, spec.name);
  const manifests = new Set(groups.map((g) => g.manifest)).size;
  let lastManifest: string | null = null;
  for (const g of groups) {
    const lines: string[] = [];
    if (manifests > 1 && g.manifest !== lastManifest) sections.push(`**${ws.relativePath(g.manifest)}**`);
    lastManifest = g.manifest;
    if (g.pipeline !== null) lines.push(`**pipeline ${g.pipeline}**`);
    const { kept } = keptLayers(spec, g.layers);
    for (const layer of g.layers) lines.push(layerLine(ws, layer, spec.name, [g.manifest, block.path], kept.includes(layer)));
    sections.push(lines.join("\n"));
  }
  if (spec.contract !== null) sections.push(`contract: ${spec.contract}`);
  return sections.join("\n\n");
}

type Group = { manifest: string; pipeline: string | null; layers: LayerValue[] };

function layerGroups(ws: Workspace, key: string, prop: string): Group[] {
  const groups: Group[] = [];
  const valuesIn = (layered: Record<string, Record<string, LayerValue[]>>) =>
    Object.hasOwn(layered, key) && Object.hasOwn(layered[key]!, prop) ? layered[key]![prop]! : null;
  const manifests = [...ws.analysis().manifests].sort(([a], [b]) => a.localeCompare(b));
  for (const [manifest, bindings] of manifests) {
    if (!bindings) continue;
    const top = valuesIn(bindings.layered);
    if (top) groups.push({ manifest, pipeline: null, layers: top });
    for (const pipeline of Object.keys(bindings.pipelineLayered).sort()) {
      const layers = valuesIn(bindings.pipelineLayered[pipeline]!);
      if (layers) groups.push({ manifest, pipeline, layers });
    }
  }
  return groups;
}

function layerLine(ws: Workspace, layer: LayerValue, prop: string, from: string[], kept: boolean): string {
  if (layer.value === "") return `- ${layer.layer}: cleared`;
  const fill = loadFill(ws, layer.value, prop, from);
  const shown = fill ? `${basename(fill.dir)}/${fill.file ?? "SKILL.md"} (${plural(lineCount(fill.body), "line")})` : layer.value;
  return `- ${layer.layer}: ${shown}${kept ? "" : " (not kept)"}`;
}

const lineCount = (body: string) => (body.trim() === "" ? 0 : body.trim().split("\n").length);

function bindingValueHover(ws: Workspace, file: string, key: string, prop: string, value: string): string | null {
  if (value === "") return null;
  const held = ws.analysis().byBlockId.get(key);
  const fill = loadFill(ws, value, prop, held ? [file, held.block.path] : [file]);
  if (!fill) return null;
  const description = describe(ws, join(fill.dir, "SKILL.md"));
  return [`**${value}**`, ...(description ? [description] : []), `provides: ${fill.provides}`].join("\n\n");
}

function describe(ws: Workspace, skillMd: string): string | null {
  const { frontmatter } = stripFrontmatter(ws.text(skillMd));
  return typeof frontmatter.description === "string" && frontmatter.description !== "" ? frontmatter.description : null;
}

function includeHover(ws: Workspace, file: string, name: string): string | null {
  const roots = ws.rootsFor([file]);
  const mattstack = roots.byName.mattstack;
  if (!mattstack) return null;
  const tree = ws.analysis().trees.get(join(mattstack.dir, "attachments", name));
  if (tree) return `**${tree.root.title ?? name}** · ${plural(walk(tree).length, "block")}`;
  let flat: AttachmentSource;
  try {
    flat = loadInclude(name, roots);
  } catch {
    return null;
  }
  const description = describe(ws, join(flat.dir, "SKILL.md"));
  return [`**${name}** · flat include`, ...(description ? [description] : [])].join("\n\n");
}
