import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmdirSync } from "fs";
import { parse as parseJsonc } from "jsonc-parser";
import { dirname, join, posix, relative, sep } from "path";
import { surfaceFileFor } from "./packs.ts";

export const PACK_SCOPE = ["pack", "skills", "attachments", ".claude-plugin", "surface.jsonc"] as const;

/** `path` is where the file is now; `from` is set only on a rename or copy, naming its source. */
export type PendingFile = { path: string; status: string; from?: string };
/** `hash` is git's blob id for what is on disk at `path` now, null when nothing is there. */
export type HashedFile = PendingFile & { hash: string | null };
export type BindingChange = { engineRef: string; slot: string; from: string | null; to: string | null };
export type SurfaceChange = { skill: string; from: "public" | "internal"; to: "public" | "internal" };
export type PackSideChanges = { bindings: BindingChange[]; surface: SurfaceChange[] };
export type ChangesPayload = {
  pack: string;
  packDir: string;
  dirty: boolean;
  files: HashedFile[];
  outsideScope: PendingFile[];
  bindings: BindingChange[];
  surface: SurfaceChange[];
  signature: string;
};

const C_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };

/** git wraps a path holding a space, quote or control character in C-style quotes; every other byte arrives as written. */
function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const encoder = new TextEncoder();
  const chars = Array.from(raw.slice(1, -1));
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const octal = chars.slice(i + 1, i + 4).join("");
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    const next = chars[i + 1] ?? "";
    bytes.push(...encoder.encode(C_ESCAPES[next] ?? next));
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A porcelain entry with git's own two columns kept: `xy[0]` is the index against HEAD, `xy[1]` the worktree against the index. */
export type PorcelainEntry = PendingFile & { xy: string };

export function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  return stdout.split("\n").filter((l) => l.length > 3).map((l) => {
    const xy = l.slice(0, 2);
    const rest = l.slice(3);
    const arrow = /[RC]/.test(xy) ? rest.indexOf(" -> ") : -1;
    if (arrow < 0) return { path: unquotePath(rest), status: xy.trim(), xy };
    return { path: unquotePath(rest.slice(arrow + 4)), status: xy.trim(), from: unquotePath(rest.slice(0, arrow)), xy };
  });
}

export function parsePorcelain(stdout: string): PendingFile[] {
  return parsePorcelainEntries(stdout).map(({ xy: _xy, ...f }) => f);
}

/**
 * The entries whose worktree side still differs from the index, untracked
 * files included. An entry staged in full is left out, so a later edit to it
 * is not swept in; a staged rename's source is never among them, since git
 * add fails on a path gone from both disk and index.
 */
export function needsStaging(entries: PorcelainEntry[]): PorcelainEntry[] {
  return entries.filter((e) => e.xy[1] !== " ");
}

function withFrom<T extends PendingFile>(f: T, path: string, map: (p: string) => string): T {
  return f.from === undefined ? { ...f, path } : { ...f, path, from: map(f.from) };
}

/**
 * Porcelain prints repo-root paths; a pack in a subdirectory of its repo needs
 * them relative to the pack. A repo file beside the pack is kept, spelled as a
 * path that climbs out of it, so it can never pass inScope.
 */
export function packRelative<T extends PendingFile>(files: T[], prefix: string): T[] {
  if (prefix === "") return files;
  const rel = (p: string) => posix.relative(prefix, p);
  return files.map((f) => withFrom(f, rel(f.path), rel));
}

function isUnder(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function inScope(path: string): boolean {
  return PACK_SCOPE.some((root) => isUnder(root, path));
}

function sides(f: PendingFile): string[] {
  return f.from === undefined ? [f.path] : [f.from, f.path];
}

/** A rename counts against the scope on either side: the deletion of its source travels in the same commit as its destination. */
export function outOfScopeSides(f: PendingFile): string[] {
  return sides(f).filter((p) => !inScope(p));
}

/** Whether either side of an entry, spelled from the pack, lies inside it; a repo file elsewhere climbs out with `../`. */
export function touchesPack(f: PendingFile): boolean {
  return sides(f).some((p) => p !== ".." && !p.startsWith("../"));
}

export function fullyInScope(f: PendingFile): boolean {
  return outOfScopeSides(f).length === 0;
}

/** Removing files leaves their folders behind; climb from each pack-relative path toward the pack, stopping at the first folder that still holds anything. */
export function pruneEmptiedDirs(packDir: string, paths: string[]): void {
  for (const path of paths) {
    for (let dir = dirname(join(packDir, path)); dir.startsWith(`${packDir}${sep}`); dir = dirname(dir)) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
    }
  }
}

export function literalPathspecs(files: PendingFile[]): string[] {
  return files.flatMap(sides).map((p) => `:(literal)${p}`);
}

/** Reads `git clean -n` output, which must come from a run under the C locale: the "Would remove" wording is translated. */
export function parseCleanDryRun(stdout: string): PendingFile[] {
  return stdout.split("\n").flatMap((l) => {
    const m = /^Would remove (.+)$/.exec(l);
    return m ? [{ path: unquotePath(m[1]!), status: "??" }] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingsOf(doc: unknown): Record<string, Record<string, string>> {
  const raw = isRecord(doc) ? doc.bindings : undefined;
  const out: Record<string, Record<string, string>> = {};
  if (!isRecord(raw)) return out;
  for (const [engineRef, slots] of Object.entries(raw)) {
    if (!isRecord(slots)) continue;
    out[engineRef] = Object.fromEntries(Object.entries(slots).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  return out;
}

export function bindingChanges(before: unknown, after: unknown): BindingChange[] {
  const a = bindingsOf(before);
  const b = bindingsOf(after);
  const out: BindingChange[] = [];
  for (const engineRef of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const slots = new Set([...Object.keys(a[engineRef] ?? {}), ...Object.keys(b[engineRef] ?? {})]);
    for (const slot of [...slots].sort()) {
      const from = a[engineRef]?.[slot] ?? null;
      const to = b[engineRef]?.[slot] ?? null;
      if (from !== to) out.push({ engineRef, slot, from, to });
    }
  }
  return out;
}

function publicOf(doc: unknown): Set<string> {
  const p = (doc as { public?: unknown } | null)?.public;
  return new Set(Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []);
}

export function surfaceChanges(before: unknown, after: unknown): SurfaceChange[] {
  const a = publicOf(before);
  const b = publicOf(after);
  const out: SurfaceChange[] = [];
  for (const skill of [...new Set([...a, ...b])].sort()) {
    if (a.has(skill) && !b.has(skill)) out.push({ skill, from: "public", to: "internal" });
    if (!a.has(skill) && b.has(skill)) out.push({ skill, from: "internal", to: "public" });
  }
  return out;
}

const BINDINGS_FRAGMENT = "pack/skills.jsonc";

/** HEAD's text of a pack-relative file, or null when HEAD has no such file. */
export type HeadText = (rel: string) => Promise<string | null>;

function parseJsoncText(text: string): unknown {
  return parseJsonc(text, [], { allowTrailingComma: true });
}

function workingCopy(packDir: string, rel: string): unknown {
  const path = join(packDir, rel);
  return existsSync(path) ? parseJsoncText(readFileSync(path, "utf8")) : null;
}

/** The binding and surface edits waiting in the pack: HEAD's copy of each file against the working tree's. */
export async function packSideChanges(packDir: string, headText: HeadText): Promise<PackSideChanges> {
  const committed = async (rel: string) => {
    const text = await headText(rel);
    return text === null ? null : parseJsoncText(text);
  };
  const surfacePath = surfaceFileFor(packDir);
  const surfaceRel = surfacePath ? relative(packDir, surfacePath) : null;
  return {
    bindings: bindingChanges(await committed(BINDINGS_FRAGMENT), workingCopy(packDir, BINDINGS_FRAGMENT)),
    surface: surfaceRel ? surfaceChanges(await committed(surfaceRel), workingCopy(packDir, surfaceRel)) : [],
  };
}

/** Runs `git hash-object -- <paths>` in the pack directory and returns what it printed: one id per line, in path order. */
export type HashObjects = (paths: string[]) => Promise<string>;

const HASH_BATCH = 500;

function symlinkBlobId(path: string): string {
  const target = readlinkSync(path, { encoding: "buffer" });
  return createHash("sha1").update(`blob ${target.length}\0`).update(target).digest("hex");
}

/**
 * Each file with git's blob id for what is on disk at its path. hash-object
 * follows a symlink, but git stores a symlink as its link text, so that id is
 * worked out here; anything else that is not a regular file has none.
 */
export async function withHashes<T extends PendingFile>(packDir: string, files: T[], hashObjects: HashObjects): Promise<(T & { hash: string | null })[]> {
  const ids = new Map<string, string | null>();
  const regular: string[] = [];
  for (const path of new Set(files.map((f) => f.path))) {
    let stat;
    try {
      stat = lstatSync(join(packDir, path));
    } catch {
      ids.set(path, null);
      continue;
    }
    if (stat.isFile()) regular.push(path);
    else ids.set(path, stat.isSymbolicLink() ? symlinkBlobId(join(packDir, path)) : null);
  }
  for (let i = 0; i < regular.length; i += HASH_BATCH) {
    const batch = regular.slice(i, i + HASH_BATCH);
    const printed = (await hashObjects(batch)).split("\n").filter((l) => l.trim() !== "");
    if (printed.length !== batch.length) throw new Error(`git hash-object named ${printed.length} of ${batch.length} files`);
    batch.forEach((path, n) => ids.set(path, printed[n]!.trim()));
  }
  return files.map((f) => ({ ...f, hash: ids.get(f.path) ?? null }));
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One sha256 over everything a sync or discard of the pack acts on: the
 * in-scope pending files with their content ids, and the binding and surface
 * edits. `rt skills changes` prints it and the write verbs work it out again
 * from their own read, so a write can refuse a pack that moved after it was
 * shown.
 */
export function pendingSignature(input: { files: HashedFile[] } & PackSideChanges): string {
  const files = input.files
    .map((f) => ({ path: f.path, status: f.status, from: f.from ?? null, hash: f.hash }))
    .sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.from ?? "", b.from ?? "") || byCodeUnit(a.status, b.status));
  const bindings = input.bindings
    .map((b) => ({ engineRef: b.engineRef, slot: b.slot, from: b.from, to: b.to }))
    .sort((a, b) => byCodeUnit(a.engineRef, b.engineRef) || byCodeUnit(a.slot, b.slot));
  const surface = input.surface.map((s) => ({ skill: s.skill, from: s.from, to: s.to })).sort((a, b) => byCodeUnit(a.skill, b.skill));
  return createHash("sha256").update(JSON.stringify({ files, bindings, surface })).digest("hex");
}

export const SIGNATURE_RE = /^[0-9a-f]{64}$/;

export type GitRun = { exitCode: number; stderr: string; timedOut?: boolean };

/** Only git's own wording says the directory is not a repository; any other failure (a bad config, a lock, git missing) is not that. */
export function isNotARepo(res: GitRun): boolean {
  return res.stderr.includes("not a git repository");
}

/** runCapture reports a child that never started or never answered as exit code -1 with no stderr. */
export function describeGitFailure(res: GitRun): string {
  if (res.timedOut) return "git did not answer in time";
  if (res.exitCode === -1) return "git could not run";
  return res.stderr.trim() || `git exited with status ${res.exitCode}`;
}
