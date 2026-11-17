import { createHash, type Hash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSkippedAttachmentPath } from "./base-attachments.ts";
import { isEmittedAttachmentDir } from "./emitted.ts";
import { hasCompiledHeader } from "./compile.ts";
import { LOCK_REL, readLock } from "./compiled-lock.ts";
import { FLOOR_REL } from "../engine-floor.ts";
import { PIPELINES_REL } from "./pipeline-manifest.ts";

/** Pack-level files a compile writes beside its units. */
const COMPILE_WRITTEN_FILES = new Set([LOCK_REL, FLOOR_REL, PIPELINES_REL]);

/** A unit folder compile wrote: a lock target, a base copy or door, or a body carrying the compiler header. */
function isCompiledUnit(packDir: string, rel: string, lockTargets: Set<string>): boolean {
  const dir = join(packDir, rel);
  return lockTargets.has(rel) || isEmittedAttachmentDir(dir) || hasCompiledHeader(dir);
}

function sourceFiles(packDir: string): string[] {
  const lockTargets = new Set(Object.keys(readLock(packDir).targets));
  const files: string[] = [];
  const walk = (rel: string) => {
    const abs = rel === "" ? packDir : join(packDir, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      // A copy never carries these, so they would change the hash from Mac to Mac with nothing to render.
      if (isSkippedAttachmentPath(child)) continue;
      if (entry.isDirectory()) {
        if (!isCompiledUnit(packDir, child, lockTargets)) walk(child);
      } else if (entry.isFile() && !COMPILE_WRITTEN_FILES.has(child)) {
        files.push(child);
      }
    }
  };
  if (existsSync(packDir)) walk("");
  return files.sort();
}

function hashTree(hash: Hash, label: string, dir: string): void {
  for (const rel of sourceFiles(dir)) {
    hash.update(`${label}/${rel}\0`);
    hash.update(readFileSync(join(dir, rel)));
    hash.update("\0");
  }
}

/** What a render reads: the pack's and its base's sources and the merged bindings, never anything a compile wrote. */
export function inputHash(packDir: string, baseDir: string | null, manifestText: string): string {
  const hash = createHash("sha256");
  hashTree(hash, "pack", packDir);
  if (baseDir !== null) hashTree(hash, "base", baseDir);
  hash.update("bindings\0");
  hash.update(manifestText);
  return hash.digest("hex");
}
