import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { teamSettingsPath } from "../src/settings/paths.ts";

function writeJson(file: string, value: unknown): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}

/** The store a test seeds to put a value in the layer every member shares. HOME is read at call time. */
export function sharedStorePath(org: string): string {
  return teamSettingsPath(org);
}

export function writeSharedStore(org: string, value: unknown): string {
  return writeJson(sharedStorePath(org), value);
}
