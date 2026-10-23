import type { Block } from "../blocks/types.ts";
import { loadAttachment } from "../sources.ts";
import type { AttachmentSource } from "../types.ts";
import type { Workspace } from "./workspace.ts";

/** The analysed block a file holds, and its `<plugin>:<block id>` key. */
export function blockIn(ws: Workspace, file: string): { key: string; block: Block } | null {
  for (const [key, { block }] of ws.analysis().byBlockId) if (block.path === file) return { key, block };
  return null;
}

/** A fill resolved through the plugins holding `from`, or null when it does not load. */
export function loadFill(ws: Workspace, value: string, prop: string, from: string[]): AttachmentSource | null {
  try {
    return loadAttachment(value, prop, ws.rootsFor(from));
  } catch {
    return null;
  }
}
