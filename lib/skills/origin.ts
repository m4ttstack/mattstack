import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { LOCK_REL, readLock, type CompiledLock } from "./compiled-lock.ts";
import { isEmittedAttachmentDir, PROVENANCE_FILE } from "./base-attachments.ts";
import type { PluginRoots } from "./sources.ts";

export type Origin = { origin: "base"; base: string; baseVersion: string | null };
type NoOrigin = Record<string, never>;

export function originOf(roots: PluginRoots, plugin: string): Origin | NoOrigin {
  if (!roots.folderOnly?.has(plugin)) return {};
  return { origin: "base", base: plugin, baseVersion: roots.byName[plugin]?.baseVersion ?? null };
}

export function originOfDir(dir: string): Origin | NoOrigin {
  if (!isEmittedAttachmentDir(dir)) return {};
  const { base, version } = JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), "utf8")) as { base: string; version?: string | null };
  const locked = packLockOf(dir)?.bases[base];
  return { origin: "base", base, baseVersion: locked || version || null };
}

/** The lock of the pack a compiled copy sits in: the nearest ancestor that has one. */
function packLockOf(dir: string): CompiledLock | null {
  for (let at = dirname(dir); at !== dirname(at); at = dirname(at)) {
    if (existsSync(join(at, LOCK_REL))) return readLock(at);
  }
  return null;
}

/** A team-pack copy of a base file is the base's, whatever plugin name binds it. */
export function originFor(roots: PluginRoots, plugin: string, dir: string | null): Origin | NoOrigin {
  const byPath = dir ? originOfDir(dir) : {};
  return "origin" in byPath ? byPath : originOf(roots, plugin);
}
