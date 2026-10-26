import { walk } from "../blocks/tree.ts";
import type { Block, BlockTree } from "../blocks/types.ts";
import { loadAttachment } from "../sources.ts";
import type { AttachmentSource } from "../types.ts";
import type { Range } from "./positions.ts";
import type { Workspace } from "./workspace.ts";

export type HeldBlock = { key: string; tree: BlockTree; block: Block };

/**
 * The analysed block a file holds, its tree and its `<plugin>:<block id>` key. Read from the trees, not
 * `byBlockId`, because two open copies of a plugin share every key and `byBlockId` keeps only the last.
 */
export function blockIn(ws: Workspace, file: string): HeldBlock | null {
  for (const tree of ws.analysis().trees.values()) {
    if (!tree) continue;
    const block = walk(tree).find((b) => b.path === file);
    if (!block) continue;
    const plugin = ws.pluginAt(tree.dir);
    return plugin ? { key: `${plugin.name}:${block.id}`, tree, block } : null;
  }
  return null;
}

/** One line's text, its indent and trailing space left out. */
export function lineRange(text: string, line: number): Range {
  const row = text.split("\n")[line] ?? "";
  const start = row.length - row.trimStart().length;
  return { start: { line, character: start }, end: { line, character: row.trimEnd().length } };
}

/** A fill resolved through the plugins holding `from`, or null when it does not load. */
export function loadFill(ws: Workspace, value: string, prop: string, from: string[]): AttachmentSource | null {
  try {
    return loadAttachment(value, prop, ws.rootsFor(from));
  } catch {
    return null;
  }
}
