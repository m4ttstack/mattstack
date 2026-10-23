import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { logCliEvent } from "../../cli-logger.ts";
import type { BlockTree } from "../blocks/types.ts";
import { blockIn, lineRange, type HeldBlock } from "./lookup.ts";
import { lineRegions, tokenAt, tokensIn, type Position, type Range, type Token } from "./positions.ts";
import type { Workspace } from "./workspace.ts";

export type Reference = { uri: string; range: Range; kind: "decl" | "marker" | "binding" | "file" | "binding-key" | "include" };

const MODULE = "skills-lsp";
const TITLE_RE = /^#\s/;
const ORIGIN: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

const uriOf = (file: string) => pathToFileURL(file).href;
const keyOf = (t: { engineRef: string; blockPath: string | null }) => (t.blockPath === null ? t.engineRef : `${t.engineRef}/${t.blockPath}`);

/**
 * The decl and markers come from `held`, the copy asked about; a manifest key cannot tell same-named
 * copies apart, so every binding keyed `held.key` is listed for each of them.
 */
export function propReferences(ws: Workspace, held: HeldBlock, prop: string): Reference[] {
  const refs: Reference[] = [];
  const file = held.block.path;
  for (const t of tokensIn(ws.text(file), file)) {
    if (t.kind === "prop-decl" && t.prop === prop) refs.push({ uri: uriOf(file), range: t.range, kind: "decl" });
    else if (t.kind === "marker" && t.prop === prop) refs.push({ uri: uriOf(file), range: t.range, kind: "marker" });
  }
  for (const path of ws.analysis().manifests.keys()) {
    for (const t of tokensIn(ws.text(path), path)) {
      if (t.kind === "binding-prop" && t.key === held.key && t.prop === prop) refs.push({ uri: uriOf(path), range: t.range, kind: "binding" });
    }
  }
  return refs;
}

/** The block's file, every binding key on it or a descendant, and, for an include root, every include naming it. */
export function blockReferences(ws: Workspace, held: HeldBlock): Reference[] {
  const refs: Reference[] = [{ uri: uriOf(held.block.path), range: titleRange(ws.text(held.block.path)), kind: "file" }];
  for (const path of ws.analysis().manifests.keys()) {
    for (const t of tokensIn(ws.text(path), path)) {
      if (t.kind !== "binding-key") continue;
      const key = keyOf(t);
      if (key === held.key || key.startsWith(`${held.key}/`)) refs.push({ uri: uriOf(path), range: t.range, kind: "binding-key" });
    }
  }
  if (held.block === held.tree.root) {
    for (const file of ws.blockFiles()) {
      if (!ws.pluginAt(file)) continue;
      for (const t of tokensIn(ws.text(file), file)) {
        if (t.kind === "include" && includeDir(ws, file, t.name) === held.tree.dir) refs.push({ uri: uriOf(file), range: t.range, kind: "include" });
      }
    }
  }
  return refs;
}

export function referencesAt(ws: Workspace, file: string, pos: Position): Reference[] {
  try {
    const token = tokenAt(ws.text(file), file, pos);
    return token ? referencesOf(ws, file, token) : [];
  } catch (err) {
    logCliEvent("error", MODULE, "references failed", { file, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** LSP's `includeDeclaration: false` leaves out a prop's declaration and a block's own file. */
export function toLocations(refs: Reference[], includeDeclaration: boolean): { uri: string; range: Range }[] {
  return refs.filter((r) => includeDeclaration || (r.kind !== "decl" && r.kind !== "file")).map(({ uri, range }) => ({ uri, range }));
}

function referencesOf(ws: Workspace, file: string, token: Token): Reference[] {
  switch (token.kind) {
    case "marker":
    case "prop-decl": {
      const held = blockIn(ws, file);
      return held ? propReferences(ws, held, token.prop) : [];
    }
    case "binding-prop":
    case "binding-value": {
      const held = heldFromManifest(ws, file, token.key);
      return held ? propReferences(ws, held, token.prop) : [];
    }
    case "binding-key": {
      const held = heldFromManifest(ws, file, keyOf(token));
      return held ? blockReferences(ws, held) : [];
    }
    case "include": {
      const tree = includeTree(ws, file, token.name);
      const held = tree && blockIn(ws, tree.root.path);
      return held ? blockReferences(ws, held) : [];
    }
    default:
      return [];
  }
}

/** The block a manifest's `<plugin>:<block id>` key names in the copy of that plugin the manifest resolves through. */
export function heldFromManifest(ws: Workspace, manifest: string, key: string): HeldBlock | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const plugin = ws.rootsFor([manifest]).byName[key.slice(0, colon)];
  if (!plugin) return null;
  const id = key.slice(colon + 1);
  for (const [dir, tree] of ws.analysis().trees) {
    if (!tree || ws.pluginAt(dir)?.dir !== plugin.dir) continue;
    const block = tree.byId.get(id);
    if (block) return { key, tree, block };
  }
  return null;
}

/** Where an include in `file` resolves, as definition resolves it: the mattstack plugin those files see. */
function includeDir(ws: Workspace, file: string, name: string): string | null {
  const mattstack = ws.rootsFor([file]).byName.mattstack;
  return mattstack ? join(mattstack.dir, "attachments", name) : null;
}

/** The block tree an `{{include:name}}` in `file` renders, or null for a flat include or an unknown name. */
export function includeTree(ws: Workspace, file: string, name: string): BlockTree | null {
  const dir = includeDir(ws, file, name);
  return dir === null ? null : (ws.analysis().trees.get(dir) ?? null);
}

function titleRange(text: string): Range {
  const lines = text.split("\n");
  const regions = lineRegions(lines);
  const title = lines.findIndex((l, i) => regions[i] === "body" && TITLE_RE.test(l));
  return title < 0 ? ORIGIN : lineRange(text, title);
}
