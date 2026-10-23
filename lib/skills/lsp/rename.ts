import { logCliEvent } from "../../cli-logger.ts";
import { blockIn, type HeldBlock } from "./lookup.ts";
import { tokenAt, type Position, type Range, type Token } from "./positions.ts";
import { heldFromManifest, propReferences, type Reference } from "./references.ts";
import type { Workspace } from "./workspace.ts";

export type TextEdit = { range: Range; newText: string };
export type WorkspaceEdit = { changes: Record<string /* uri */, TextEdit[]>; warnings: string[] };

/** A rename the server answers with a plain message and no edit. */
export class RenameRefused extends Error {}

const MODULE = "skills-lsp";
const PROP_NAME_RE = /^[a-z][a-z0-9-]*$/;
const MARKER_OPEN = "{{props.".length;
const MARKER_CLOSE = "}}".length;
const MATTSTACK_SEGMENT = "/plugins/mattstack/";

export function prepareRename(ws: Workspace, file: string, pos: Position): { range: Range; placeholder: string } | null {
  try {
    const token = tokenAt(ws.text(file), file, pos);
    if (!token) return null;
    switch (token.kind) {
      case "prop-decl":
      case "marker":
      case "binding-prop":
        return { range: nameRange(token.kind, token.range), placeholder: token.prop };
      default:
        return null;
    }
  } catch (err) {
    logCliEvent("error", MODULE, "prepare rename failed", { file, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The edit for a rename at `pos`, or null when nothing renameable is there. Throws `RenameRefused`. */
export function renameAt(ws: Workspace, file: string, pos: Position, to: string): WorkspaceEdit | null {
  let target: { held: HeldBlock; prop: string } | null;
  try {
    target = propTarget(ws, file, tokenAt(ws.text(file), file, pos));
  } catch (err) {
    logCliEvent("error", MODULE, "rename failed", { file, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  return target ? renameProp(ws, target.held, target.prop, to) : null;
}

function propTarget(ws: Workspace, file: string, token: Token | null): { held: HeldBlock; prop: string } | null {
  if (!token) return null;
  if (token.kind === "prop-decl" || token.kind === "marker") {
    const held = blockIn(ws, file);
    return held && { held, prop: token.prop };
  }
  if (token.kind === "binding-prop") {
    const held = heldFromManifest(ws, file, token.key);
    return held && { held, prop: token.prop };
  }
  return null;
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
  const warnings = block.path.split("\\").join("/").includes(MATTSTACK_SEGMENT)
    ? [`renaming a mattstack prop is a breaking change: add \`props-change: ${block.id}.${from}: renamed to ${to}\` to the PR body`]
    : [];
  return { changes, warnings };
}

function editFor(ref: Reference, to: string): TextEdit {
  if (ref.kind === "marker") return { range: ref.range, newText: `{{props.${to}}}` };
  return { range: nameRange(ref.kind === "binding" ? "binding-prop" : "prop-decl", ref.range), newText: to };
}

/** The prop name inside a token: a marker's `{{props.` and `}}` and a manifest key's quotes left out. */
function nameRange(kind: "prop-decl" | "marker" | "binding-prop", range: Range): Range {
  const { line } = range.start;
  if (kind === "marker") return { start: { line, character: range.start.character + MARKER_OPEN }, end: { line, character: range.end.character - MARKER_CLOSE } };
  if (kind === "binding-prop") return { start: { line, character: range.start.character + 1 }, end: { line, character: range.end.character - 1 } };
  return range;
}
