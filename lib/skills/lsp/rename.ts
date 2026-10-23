import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logCliEvent } from "../../cli-logger.ts";
import type { Block, BlockTree } from "../blocks/types.ts";
import { blockIn, type HeldBlock } from "./lookup.ts";
import { skillPathTokens, tokenAt, type Position, type Range, type SkillPathToken, type Token } from "./positions.ts";
import { fillFiles, packArg, packsFor } from "./skill-paths.ts";
import { blockReferences, heldFromManifest, includeTree, propReferences, type Reference } from "./references.ts";
import type { Workspace } from "./workspace.ts";

export type TextEdit = { range: Range; newText: string };
export type TextDocumentEdit = { textDocument: { uri: string; version: null }; edits: TextEdit[] };
export type RenameFile = { kind: "rename"; oldUri: string; newUri: string };
export type WorkspaceEdit = {
  changes: Record<string /* uri */, TextEdit[]>;
  documentChanges?: (TextDocumentEdit | RenameFile)[];
  warnings: string[];
};

/** `fileRenames`: the client lists `"rename"` in `workspace.workspaceEdit.resourceOperations`. */
export type RenameOptions = { fileRenames: boolean };

/** A rename the server answers with a plain message and no edit. */
export class RenameRefused extends Error {}

const MODULE = "skills-lsp";
const PROP_NAME_RE = /^[a-z][a-z0-9-]*$/;
const BLOCK_NAME_RE = /^[a-z][a-z0-9-]*$/;
const MARKER_OPEN = "{{props.".length;
const MARKER_CLOSE = "}}".length;
const INCLUDE_OPEN = "{{include:".length;
const MATTSTACK_SEGMENT = "/plugins/mattstack/";
const INDEX = "index.block.md";
const SUFFIX = ".block.md";
const NO_FILE_RENAMES = "this editor cannot rename files, so it cannot rename a block";
const NO_RENAMES: RenameOptions = { fileRenames: false };

type Target = { kind: "prop"; held: HeldBlock; prop: string } | { kind: "block"; held: HeldBlock };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const tailOf = (id: string) => id.slice(id.lastIndexOf("/") + 1);
const isMattstack = (block: Block) => block.path.split("\\").join("/").includes(MATTSTACK_SEGMENT);

/** Answers only what `renameAt` would carry out; throws `RenameRefused` for what it would refuse. */
export function prepareRename(ws: Workspace, file: string, pos: Position, opts: RenameOptions = NO_RENAMES): { range: Range; placeholder: string } | null {
  let token: Token | null;
  let target: Target | null;
  try {
    token = tokenAt(ws.text(file), file, pos);
    target = targetOf(ws, file, token);
  } catch (err) {
    if (err instanceof RenameRefused) throw err;
    logCliEvent("error", MODULE, "prepare rename failed", { file, error: errorText(err) });
    return null;
  }
  if (!token || !target) return null;
  allowed(ws, target, opts);
  switch (token.kind) {
    case "prop-decl":
    case "marker":
    case "binding-prop":
      return { range: nameRange(token.kind, token.range), placeholder: token.prop };
    case "binding-key": {
      const tail = tailOf(target.held.block.id);
      const end = token.range.end.character - 1;
      return { range: { start: { line: token.range.start.line, character: end - tail.length }, end: { line: token.range.start.line, character: end } }, placeholder: tail };
    }
    case "include": {
      const { line, character } = token.range.start;
      return { range: { start: { line, character: character + INCLUDE_OPEN }, end: { line, character: token.range.end.character - MARKER_CLOSE } }, placeholder: token.name };
    }
    default:
      return null;
  }
}

/** The edit for a rename at `pos`, or null when nothing renameable is there. Throws `RenameRefused`. */
export function renameAt(ws: Workspace, file: string, pos: Position, to: string, opts: RenameOptions = NO_RENAMES): WorkspaceEdit | null {
  let target: Target | null;
  try {
    target = targetOf(ws, file, tokenAt(ws.text(file), file, pos));
  } catch (err) {
    if (err instanceof RenameRefused) throw err;
    logCliEvent("error", MODULE, "rename failed", { file, error: errorText(err) });
    return null;
  }
  if (!target) return null;
  allowed(ws, target, opts);
  return target.kind === "prop" ? renameProp(ws, target.held, target.prop, to) : renameBlock(ws, target.held, to);
}

function targetOf(ws: Workspace, file: string, token: Token | null): Target | null {
  if (!token) return null;
  switch (token.kind) {
    case "prop-decl":
    case "marker": {
      const held = blockIn(ws, file);
      if (!held) throw new RenameRefused("this file's block does not load, so its props cannot be renamed");
      return { kind: "prop", held, prop: token.prop };
    }
    case "binding-prop":
      return { kind: "prop", held: manifestHeld(ws, file, token.key), prop: token.prop };
    case "binding-key":
      return { kind: "block", held: manifestHeld(ws, file, token.blockPath === null ? token.engineRef : `${token.engineRef}/${token.blockPath}`) };
    case "include": {
      const tree = includeTree(ws, file, token.name);
      const held = tree && blockIn(ws, tree.root.path);
      return held ? { kind: "block", held } : null;
    }
    default:
      return null;
  }
}

function manifestHeld(ws: Workspace, manifest: string, key: string): HeldBlock {
  const held = heldFromManifest(ws, manifest, key);
  if (!held) throw new RenameRefused(`no open block is keyed "${key}"`);
  return held;
}

function allowed(ws: Workspace, target: Target, opts: RenameOptions): void {
  if (target.kind === "prop") {
    if (!target.held.block.props.some((p) => p.name === target.prop)) throw new RenameRefused(`${target.held.block.id} declares no prop "${target.prop}"`);
    return;
  }
  if (!opts.fileRenames) throw new RenameRefused(NO_FILE_RENAMES);
  refuseEngineRoot(ws, target.held);
}

/** Skills and pipelines name an engine by its folder, outside any binding, so only its blocks and include roots rename. */
function refuseEngineRoot(ws: Workspace, { tree, block }: HeldBlock): void {
  if (block === tree.root && !isIncludeRoot(ws, tree)) throw new RenameRefused(`${block.id} is an engine: skills and pipelines name it outside bindings, so it cannot be renamed here`);
}

function isIncludeRoot(ws: Workspace, tree: BlockTree): boolean {
  const plugin = ws.pluginAt(tree.dir);
  return plugin !== null && dirname(tree.dir) === join(plugin.dir, "attachments") && tree.root.frontmatter.type !== "pipeline-step";
}

/** Renames `from` on the copy `held` names: its declaration and markers, and every binding keyed `held.key`. */
export function renameProp(ws: Workspace, held: HeldBlock, from: string, to: string): WorkspaceEdit {
  const { block } = held;
  if (!PROP_NAME_RE.test(to)) throw new RenameRefused(`"${to}" is not a prop name: use lowercase letters, digits and dashes, starting with a letter`);
  if (to === from) throw new RenameRefused(`the prop is already called "${from}"`);
  if (!block.props.some((p) => p.name === from)) throw new RenameRefused(`${block.id} declares no prop "${from}"`);
  if (block.props.some((p) => p.name === to)) throw new RenameRefused(`${block.id} already declares a prop "${to}"`);

  const changes: WorkspaceEdit["changes"] = {};
  for (const ref of propReferences(ws, held, from)) {
    (changes[ref.uri] ??= []).push(editFor(ref, to));
  }
  const warnings = isMattstack(block)
    ? [`renaming a mattstack prop is a breaking change: add \`props-change: ${block.id}.${from}: renamed to ${to}\` to the PR body`]
    : [];
  return { changes, warnings };
}

/**
 * Moves the block's file (a folder block's folder) to `toTail` and rewrites every binding key on it or a
 * descendant and, for an include root, every include naming it. Edits target the old uris, so the move comes last.
 */
export function renameBlock(ws: Workspace, held: HeldBlock, toTail: string): WorkspaceEdit {
  const { block } = held;
  refuseEngineRoot(ws, held);
  const tail = tailOf(block.id);
  if (!BLOCK_NAME_RE.test(toTail)) throw new RenameRefused(`"${toTail}" is not a block name: use lowercase letters, digits and dashes, starting with a letter`);
  if (toTail === "index") throw new RenameRefused(`"index" names a folder block's own file, so a block cannot be called that`);
  if (toTail === tail) throw new RenameRefused(`the block is already called "${tail}"`);

  const isFolder = basename(block.path) === INDEX;
  const from = isFolder ? dirname(block.path) : block.path;
  const parent = dirname(from);
  for (const taken of [join(parent, `${toTail}${SUFFIX}`), join(parent, toTail)]) {
    if (occupied(ws, taken)) throw new RenameRefused(`"${toTail}" is taken: ${ws.relativePath(taken)} already exists`);
  }
  const to = isFolder ? join(parent, toTail) : join(parent, `${toTail}${SUFFIX}`);
  const newId = `${block.id.slice(0, block.id.length - tail.length)}${toTail}`;
  const newKey = `${held.key.slice(0, held.key.length - tail.length)}${toTail}`;

  const byUri = new Map<string, TextEdit[]>();
  for (const ref of blockReferences(ws, held)) {
    if (ref.kind === "binding-key") {
      const row = ws.text(fileURLToPath(ref.uri)).split("\n")[ref.range.start.line] ?? "";
      const key = JSON.parse(row.slice(ref.range.start.character, ref.range.end.character)) as string;
      const range = nameRange("binding-prop", ref.range);
      push(byUri, ref.uri, { range, newText: JSON.stringify(`${newKey}${key.slice(held.key.length)}`).slice(1, -1) });
    } else if (ref.kind === "include") {
      push(byUri, ref.uri, { range: ref.range, newText: `{{include:${toTail}}}` });
    }
  }
  for (const [uri, edits] of pathMoveEdits(ws, from, to)) edits.forEach((edit) => push(byUri, uri, edit));
  const documentChanges: WorkspaceEdit["documentChanges"] = [...byUri].map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits }));
  documentChanges.push({ kind: "rename", oldUri: pathToFileURL(from).href, newUri: pathToFileURL(to).href });
  return { changes: {}, documentChanges, warnings: isMattstack(block) ? blockWarnings(held, newId) : [] };
}

/**
 * The edits for files or folders the editor is about to move: the client applies them before the move, so
 * they target the old uris. Never throws; a failure returns no edits.
 */
export function willRenameEdits(ws: Workspace, moves: { from: string; to: string }[]): WorkspaceEdit {
  const byUri = new Map<string, TextEdit[]>();
  try {
    for (const { from, to } of moves) {
      for (const [uri, edits] of pathMoveEdits(ws, from, to)) edits.forEach((edit) => push(byUri, uri, edit));
    }
  } catch (err) {
    logCliEvent("error", MODULE, "will rename failed", { error: errorText(err) });
    return { changes: {}, warnings: [] };
  }
  return { changes: Object.fromEntries(byUri), warnings: [] };
}

/**
 * The pack.path and verb.path markers naming `from` rewritten to name `to`, in every file a compile of
 * `from`'s pack reads. A move that leaves the pack's attachments/ and skills/ has nothing to rename to.
 */
function pathMoveEdits(ws: Workspace, from: string, to: string): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>();
  const plugin = ws.pluginAt(from);
  const pack = plugin && ws.analysis().packs.find((p) => p.plugin.dir === plugin.dir);
  if (!pack || ws.pluginAt(to)?.dir !== pack.plugin.dir) return out;
  const oldArg = packArg(pack, from);
  const newArg = packArg(pack, to);
  if (oldArg === null || newArg === null || oldArg === newArg) return out;
  const isVerb = !oldArg.includes("/") && !newArg.includes("/") && Object.hasOwn(pack.verbSides, oldArg);
  const rewrite = (t: SkillPathToken): string | null => {
    if (t.kind === "verb-path") return isVerb && t.verb === oldArg ? `{{verb.path:${newArg}}}` : null;
    const arg = `${t.attachment}/${t.file}`;
    if (t.file === "" || (arg !== oldArg && !arg.startsWith(`${oldArg}/`))) return null;
    const moved = `${newArg}${arg.slice(oldArg.length)}`;
    return moved.indexOf("/") > 0 ? `{{pack.path:${moved}}}` : null;
  };
  const files = new Set([...ws.blockFiles(), ...fillFiles(pack)]);
  for (const file of files) {
    if (!packsFor(ws, file).includes(pack)) continue;
    const edits = skillPathTokens(ws.text(file), file).flatMap((t) => {
      const newText = rewrite(t);
      return newText === null ? [] : [{ range: t.range, newText }];
    });
    if (edits.length > 0) out.set(pathToFileURL(file).href, edits);
  }
  return out;
}

function push(byUri: Map<string, TextEdit[]>, uri: string, edit: TextEdit): void {
  const list = byUri.get(uri) ?? [];
  list.push(edit);
  byUri.set(uri, list);
}

/** Open documents count: a sibling typed but not yet saved still takes the name. */
function occupied(ws: Workspace, path: string): boolean {
  if (existsSync(path)) return true;
  return ws.blockFiles().some((f) => f === path || f.startsWith(path + sep));
}

/**
 * The signature check sees every prop under the old id removed. Under a renamed child the engine keeps its
 * name, so a required prop also reads as newly required under the new id; a renamed root is a new engine.
 */
function blockWarnings(held: HeldBlock, newId: string): string[] {
  const { block } = held;
  const renamesEngine = block === held.tree.root;
  const out: string[] = [];
  const visit = (b: Block) => {
    const renamed = `${newId}${b.id.slice(block.id.length)}`;
    for (const p of b.props) {
      const removed = `\`props-change: ${b.id}.${p.name}: block renamed to ${renamed}\``;
      const required = !renamesEngine && p.default === null ? ` and \`props-change: ${renamed}.${p.name}: block renamed from ${b.id}\`` : "";
      out.push(`renaming a mattstack block is a breaking change: add ${removed}${required} to the PR body${required ? ", each on its own line" : ""}`);
    }
    b.children.forEach(visit);
  };
  visit(block);
  return out;
}

function editFor(ref: Reference, to: string): TextEdit {
  if (ref.kind === "marker") return { range: ref.range, newText: `{{props.${to}}}` };
  return { range: nameRange(ref.kind === "binding" ? "binding-prop" : "prop-decl", ref.range), newText: to };
}

/** The name inside a token: a marker's `{{props.` and `}}` and a manifest string's quotes left out. */
function nameRange(kind: "prop-decl" | "marker" | "binding-prop", range: Range): Range {
  const { line } = range.start;
  if (kind === "marker") return { start: { line, character: range.start.character + MARKER_OPEN }, end: { line, character: range.end.character - MARKER_CLOSE } };
  if (kind === "binding-prop") return { start: { line, character: range.start.character + 1 }, end: { line, character: range.end.character - 1 } };
  return range;
}
