import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { childEnv } from "../subprocess.ts";
import { warn } from "../ui/warn.ts";
import { maskProvenanceVersion } from "./base-attachments.ts";
import { HEADER_COMMENTS } from "./compile.ts";
import { LOCK_REL } from "./compiled-lock.ts";
import { isEmittedAttachmentText } from "./emitted.ts";
import { FRONTMATTER_RE } from "./frontmatter-re.ts";
import { maskProvenance } from "./provenance.ts";

/** Bump whenever maskStamps or isVersionOnly changes what they fold, so every cached answer is worked out again. */
export const CLASSIFY_RULE = 2;

const DIRTY_FLAG_RE = /(--mattstack-dirty )[01]\b/g;
const OPENING_LINE_RE = /^Pointers here are `@keys`\..*$/gm;
const UNIT_ID_VERSION_RE = /([a-z0-9][a-z0-9-]*)@\d+(?:\.\d+)*:(?=[a-z0-9])/g;
const MAP_ID_LINE_RE = /^(\s*(?:"id": )?")([a-z0-9][a-z0-9-]*)@\d+(?:\.\d+)*:([a-z0-9][a-z0-9-]*",?)$/gm;
const JSON_STRING_RE = /"(?:[^"\\\n]|\\.)*"/g;
const MIN_ENGINE_RE = /("minEngine"\s*:\s*)"[^"\n]*"/;
const SEAM_LINE_RE = /^<!-- part: /m;
const OPENING_LINE_START = "Pointers here are `@keys`.";

const endsWith = (path: string, rel: string) => path === rel || path.endsWith(`/${rel}`);

/** The manifest's values with only the top-level version masked, then its layout with every string emptied, so a nested version or a reformat still reads as a change. */
function maskManifestVersion(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  return `${JSON.stringify({ ...parsed, version: "*" })}\n${text.replace(JSON_STRING_RE, '""')}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Which targets the lock records, with the plugins each was compiled from, and which bases: losing one loses a
 * run's provenance. The versions and shas are stamps, and so is whether a mattstack sha is kept, which follows
 * where mattstack was compiled from.
 */
function maskLock(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(parsed)) return text;
  const keysOf = (v: unknown) => (isRecord(v) ? Object.keys(v).sort() : []);
  const targets = isRecord(parsed.targets) ? parsed.targets : {};
  return JSON.stringify({ targets: Object.keys(targets).sort().map((t) => [t, keysOf(targets[t])]), bases: keysOf(parsed.bases) });
}

function isPointerMapText(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed.id === "string" && typeof parsed.dir === "string" && Array.isArray(parsed.covers) && isRecord(parsed.keys);
  } catch {
    return false;
  }
}

/** Compile marks its output with its header or a seam; a file it copies carries neither, only its line opening the body. */
function isCompilerOutput(text: string): boolean {
  if (HEADER_COMMENTS.some((h) => text.includes(h)) || SEAM_LINE_RE.test(text)) return true;
  const head = text.match(FRONTMATTER_RE)?.[0] ?? "";
  return text.slice(head.length).trimStart().startsWith(OPENING_LINE_START);
}

/**
 * A file's text with every version stamp an old or current compile, bump or sync writes masked, so two texts that
 * differ only in stamps compare equal. An authored file is compared as written: a run flag or a version in it is
 * the author's.
 */
export function maskStamps(path: string, text: string): string {
  if (endsWith(path, LOCK_REL)) return maskLock(text);
  if (endsWith(path, ".claude-plugin/plugin.json")) return maskManifestVersion(text);
  if (endsWith(path, "pack/requires.json")) return text.replace(MIN_ENGINE_RE, '$1"*"');
  if (path.split("/").pop() === "compiled.json") {
    if (!isEmittedAttachmentText(text) && !isPointerMapText(text)) return text;
    return maskProvenanceVersion(text).replace(MAP_ID_LINE_RE, "$1$2@*:$3");
  }
  if (!isCompilerOutput(text)) return text;
  return maskProvenance(text)
    .replace(DIRTY_FLAG_RE, "$1*")
    .replace(OPENING_LINE_RE, (line) => line.replace(UNIT_ID_VERSION_RE, "$1@*:"));
}

export type FileChange = { path: string; before: string | null; after: string | null };

export function isVersionOnly(changes: FileChange[]): boolean {
  if (changes.length === 0) return false;
  return changes.every((c) => c.before !== null && c.after !== null && maskStamps(c.path, c.before) === maskStamps(c.path, c.after));
}

type Cache = { rule: number; shas: Record<string, boolean> };

function readCache(path: string): Cache {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Cache>;
    if (raw.rule === CLASSIFY_RULE && raw.shas && typeof raw.shas === "object" && !Array.isArray(raw.shas)) return { rule: CLASSIFY_RULE, shas: raw.shas };
  } catch {
    // a missing or unreadable cache is an empty one
  }
  return { rule: CLASSIFY_RULE, shas: {} };
}

/** The cache only saves work, so a write that fails is logged and the answer still goes back. */
function writeCache(path: string, cache: Cache): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(cache) + "\n");
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // the folder the tmp file would sit in may not exist at all
    }
    warn("history-classify", `could not save the history classify cache: ${err instanceof Error ? err.message : String(err)}`, { context: { path } });
  }
}

function git(repoDir: string, args: string[], stdin?: string): Buffer | null {
  const r = Bun.spawnSync(["git", "-C", repoDir, ...args], { env: childEnv(), stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? Buffer.from(r.stdout) : null;
}

type RawEntry = { srcMode: string; dstMode: string; src: string; dst: string; status: string; path: string };

function parseRaw(out: string): RawEntry[] {
  const fields = out.split("\0");
  const entries: RawEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [srcMode, dstMode, src, dst, status] = fields[i]!.replace(/^:/, "").split(" ");
    entries.push({ srcMode: srcMode!, dstMode: dstMode!, src: src!, dst: dst!, status: status!, path: fields[i + 1]! });
  }
  return entries;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Each blob's text by sha; null when any is missing or is not UTF-8 text, since such a change cannot be shown to be a stamp. */
function readBlobs(repoDir: string, shas: string[]): Map<string, string> | null {
  const out = git(repoDir, ["cat-file", "--batch"], shas.map((s) => `${s}\n`).join(""));
  if (out === null) return null;
  const texts = new Map<string, string>();
  let at = 0;
  for (const sha of shas) {
    const eol = out.indexOf(0x0a, at);
    if (eol < 0) return null;
    const [, type, size] = out.subarray(at, eol).toString().split(" ");
    if (type !== "blob") return null;
    const start = eol + 1;
    const end = start + Number(size);
    try {
      texts.set(sha, decoder.decode(out.subarray(start, end)));
    } catch {
      return null;
    }
    at = end + 1;
  }
  return texts;
}

/** true or false once git has answered for good; null when git could not read the commit, which is not worth remembering. */
function classifyOne(repoDir: string, sha: string): boolean | null {
  const parents = git(repoDir, ["rev-list", "--parents", "-n", "1", sha, "--"]);
  if (parents === null) return null;
  const [, ...ofCommit] = parents.toString().trim().split(" ");
  if (ofCommit.length !== 1) return false;
  const raw = git(repoDir, ["diff-tree", "-r", "--no-renames", "-z", ofCommit[0]!, sha]);
  if (raw === null) return null;
  const entries = parseRaw(raw.toString());
  if (entries.length === 0) return false;
  if (entries.some((e) => e.status !== "M" || e.srcMode !== e.dstMode)) return false;
  const blobs = readBlobs(repoDir, [...new Set(entries.flatMap((e) => [e.src, e.dst]))]);
  if (blobs === null) return false;
  return isVersionOnly(entries.map((e) => ({ path: e.path, before: blobs.get(e.src)!, after: blobs.get(e.dst)! })));
}

const SHA_RE = /^[0-9a-f]{4,64}$/;
const FULL_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isCommitSha(value: string): boolean {
  return SHA_RE.test(value);
}

/** A full oid names one commit for good, so it needs no git; a prefix or a hex-named ref is resolved, since it could name a different commit later. */
function fullOid(repoDir: string, sha: string): string | null {
  if (FULL_OID_RE.test(sha)) return sha;
  return git(repoDir, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`])?.toString().trim() || null;
}

/** Answers worked out between cache writes; a caller that gives up mid-run keeps all but the last few. */
export const SAVE_EVERY = 25;

/**
 * The input shas whose commits changed nothing but version stamps, in input order and as given. The whole commit
 * counts, so a change outside the pack keeps it unfolded. A commit never changes, so its answer is cached by full oid.
 */
export function classifyCommits(repoDir: string, shas: string[], cachePath: string, classifyStep: typeof classifyOne = classifyOne): string[] {
  const cache = readCache(cachePath);
  let unsaved = 0;
  const oids = new Map<string, string>();
  for (const sha of new Set(shas)) {
    if (!isCommitSha(sha)) continue;
    const oid = fullOid(repoDir, sha);
    if (oid === null) continue;
    oids.set(sha, oid);
    if (Object.hasOwn(cache.shas, oid)) continue;
    const answer = classifyStep(repoDir, oid);
    if (answer === null) continue;
    cache.shas[oid] = answer;
    if (++unsaved >= SAVE_EVERY) {
      writeCache(cachePath, cache);
      unsaved = 0;
    }
  }
  if (unsaved > 0) writeCache(cachePath, cache);
  return shas.filter((sha) => oids.has(sha) && cache.shas[oids.get(sha)!] === true);
}
