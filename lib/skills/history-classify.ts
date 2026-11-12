import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { childEnv } from "../subprocess.ts";
import { maskProvenanceVersion } from "./base-attachments.ts";
import { LOCK_REL } from "./compiled-lock.ts";
import { maskProvenance } from "./provenance.ts";

/** Bump whenever maskStamps or isVersionOnly changes what they fold, so every cached answer is worked out again. */
export const CLASSIFY_RULE = 1;

const DIRTY_FLAG_RE = /(--mattstack-dirty )[01]\b/g;
const OPENING_LINE_RE = /^Pointers here are `@keys`\..*$/gm;
const UNIT_ID_VERSION_RE = /([a-z0-9][a-z0-9-]*)@\d+(?:\.\d+)*:(?=[a-z0-9])/g;
const MAP_ID_LINE_RE = /^(\s*(?:"id": )?")([a-z0-9][a-z0-9-]*)@\d+(?:\.\d+)*:([a-z0-9][a-z0-9-]*",?)$/gm;
const MANIFEST_VERSION_RE = /^(\s*"version"\s*:\s*)"[^"\n]*"/m;
const MIN_ENGINE_RE = /("minEngine"\s*:\s*)"[^"\n]*"/;

const endsWith = (path: string, rel: string) => path === rel || path.endsWith(`/${rel}`);

/** A file's text with every version stamp an old or current compile, bump or sync writes masked, so two texts that differ only in stamps compare equal. */
export function maskStamps(path: string, text: string): string {
  if (endsWith(path, LOCK_REL)) return "<compiled lock>";
  if (endsWith(path, ".claude-plugin/plugin.json")) return text.replace(MANIFEST_VERSION_RE, '$1"*"');
  if (endsWith(path, "pack/requires.json")) return text.replace(MIN_ENGINE_RE, '$1"*"');
  if (path.split("/").pop() === "compiled.json") return maskProvenanceVersion(text).replace(MAP_ID_LINE_RE, "$1$2@*:$3");
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

function writeCache(path: string, cache: Cache): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache) + "\n");
  renameSync(tmp, path);
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

export function isCommitSha(value: string): boolean {
  return SHA_RE.test(value);
}

/**
 * The input shas whose commits changed nothing but version stamps, in input order. The whole commit counts, so a change
 * outside the pack keeps it unfolded. A commit never changes, so its answer is cached under the sha as given.
 */
export function classifyCommits(repoDir: string, shas: string[], cachePath: string): string[] {
  const cache = readCache(cachePath);
  let learned = false;
  for (const sha of new Set(shas)) {
    if (Object.hasOwn(cache.shas, sha) || !isCommitSha(sha)) continue;
    const answer = classifyOne(repoDir, sha);
    if (answer === null) continue;
    cache.shas[sha] = answer;
    learned = true;
  }
  if (learned) writeCache(cachePath, cache);
  return shas.filter((sha) => cache.shas[sha] === true);
}
