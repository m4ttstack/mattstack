import { readFileSync, statSync } from "fs";
import { join } from "path";

export const MAP_FILE = "compiled.json";

/** A hand-authored data file may also be called compiled.json, so only compile's own shape marks a folder as output. */
export function isEmittedAttachmentText(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const { base, files, version } = parsed as { base?: unknown; files?: unknown; version?: unknown };
    return typeof base === "string" && Array.isArray(files) && (version === undefined || typeof version === "string" || version === null);
  } catch {
    return false;
  }
}

export function isEmittedAttachmentDir(dir: string): boolean {
  const path = join(dir, MAP_FILE);
  try {
    return statSync(path).isFile() && isEmittedAttachmentText(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}
