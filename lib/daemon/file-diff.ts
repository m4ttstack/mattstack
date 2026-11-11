/**
 * One file's diff in an MR (GitLab) or PR (GitHub), through the repo's own
 * forge, in one forge-neutral shape. The board's review sheet draws it.
 */

import { createHash } from "node:crypto";
import type { ForgeFileDiff, ForgeFileDiffData } from "../../packages/rt-client/src/commands.ts";
import { gitlabFailure, projectApi, readCapped } from "./forge-reads.ts";

/** How to GET from a repo's forge: a provider-relative path in, the raw response out. */
export interface FileDiffContext {
  forge: "gitlab" | "github";
  projectPath: string;
  rest: (path: string) => Promise<Response>;
}

type Failure = { ok: false; error: string };
type Result = { ok: true; data: ForgeFileDiffData } | Failure;

const PAGE_SIZE = 100;
const GITLAB_MAX_PAGES = 50;
/** GitHub lists at most 3000 files for a PR. */
const GITHUB_MAX_PAGES = 30;
/** The bytes one MR's whole listing may take, across every page. */
export const LISTING_MAX_BYTES = 32 * 1024 * 1024;
const HEAD_MAX_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_MRS = 16;

async function forgeFailure(forge: FileDiffContext["forge"], res: Response): Promise<string> {
  if (forge === "gitlab") return gitlabFailure(res);
  return `GitHub returned ${res.status} ${res.statusText}`.trim();
}

/** A GET's JSON, read no further than `max` bytes; `cut` when the body ran past it. */
async function getJson(
  ctx: FileDiffContext,
  path: string,
  max: number,
): Promise<{ ok: true; body: unknown; res: Response; bytes: number; cut: false } | { ok: true; cut: true } | Failure> {
  const res = await ctx.rest(path);
  if (!res.ok) return { ok: false, error: await forgeFailure(ctx.forge, res) };
  const { bytes, truncated } = await readCapped(res, max);
  if (truncated) return { ok: true, cut: true };
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)), res, bytes: bytes.length, cut: false };
  } catch {
    return { ok: false, error: `${ctx.forge === "gitlab" ? "GitLab" : "GitHub"} sent a body that is not JSON for ${path.split("?")[0]}` };
  }
}

/** Every file the listing reached; `truncated` when a page or byte cap stopped it first. */
interface Listing { files: ForgeFileDiff[]; truncated: boolean }

interface GitLabDiffRow {
  old_path?: string; new_path?: string; diff?: string;
  new_file?: boolean; renamed_file?: boolean; deleted_file?: boolean;
  too_large?: boolean; collapsed?: boolean;
}

function gitlabFile(row: GitLabDiffRow, mrWebUrl: string | null): ForgeFileDiff {
  const newPath = row.new_path ?? row.old_path ?? "";
  const text = row.diff ?? "";
  const binary = /^Binary files .* differ\n?$/.test(text);
  const tooLarge = !binary && (row.too_large === true || (row.collapsed === true && text === ""));
  return {
    oldPath: row.old_path ?? newPath,
    newPath,
    renamed: row.renamed_file === true,
    newFile: row.new_file === true,
    deletedFile: row.deleted_file === true,
    binary,
    tooLarge,
    diff: binary || tooLarge ? null : text,
    webUrl: mrWebUrl ? `${mrWebUrl}/diffs#${createHash("sha1").update(newPath).digest("hex")}` : null,
  };
}

interface Head { headSha: string; webUrl: string | null }

async function gitlabHead(ctx: FileDiffContext, iid: number): Promise<({ ok: true } & Head) | Failure> {
  const got = await getJson(ctx, `${projectApi(ctx.projectPath)}/merge_requests/${iid}`, HEAD_MAX_BYTES);
  if (!got.ok) return got;
  if (got.cut) return { ok: false, error: `GitLab sent more than ${HEAD_MAX_BYTES} bytes for !${iid}` };
  const mr = got.body as { sha?: string; diff_refs?: { head_sha?: string } | null; web_url?: string };
  const headSha = mr.diff_refs?.head_sha ?? mr.sha;
  if (!headSha) return { ok: false, error: `GitLab sent no head sha for !${iid}` };
  return { ok: true, headSha, webUrl: mr.web_url ?? null };
}

async function gitlabFiles(ctx: FileDiffContext, iid: number, webUrl: string | null): Promise<({ ok: true } & Listing) | Failure> {
  const files: ForgeFileDiff[] = [];
  let budget = LISTING_MAX_BYTES;
  for (let page = 1; page <= GITLAB_MAX_PAGES; page++) {
    const got = await getJson(ctx, `${projectApi(ctx.projectPath)}/merge_requests/${iid}/diffs?page=${page}&per_page=${PAGE_SIZE}`, budget);
    if (!got.ok) return got;
    if (got.cut) return { ok: true, files, truncated: true };
    if (!Array.isArray(got.body)) return { ok: false, error: "GitLab's MR diffs were not a JSON array" };
    budget -= got.bytes;
    for (const row of got.body as GitLabDiffRow[]) files.push(gitlabFile(row, webUrl));
    const next = got.res.headers.get("x-next-page");
    const more = next === null ? got.body.length === PAGE_SIZE : next.trim() !== "";
    if (!more) return { ok: true, files, truncated: false };
  }
  return { ok: true, files, truncated: true };
}

interface GitHubFileRow {
  filename?: string; previous_filename?: string; status?: string; patch?: string;
  additions?: number; deletions?: number; changes?: number;
}

/** Extensions GitHub's file list cannot tell from an empty file: it sends
    no patch and counts no lines for both. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "avif", "heic", "psd",
  "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "wav", "ogg", "webm", "m4a", "flac",
  "so", "dylib", "dll", "exe", "bin", "o", "a", "class", "wasm", "pyc",
  "sqlite", "db", "keystore", "p12",
]);

function binaryByName(path: string): boolean {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext !== undefined && BINARY_EXTENSIONS.has(ext);
}

/**
 * GitHub leaves `patch` out for a binary file, for a text diff too big to
 * send, and for a change with no lines at all. A held-back text diff still
 * counts its lines. With none counted: a modified file is binary; a rename
 * or a mode-only ("changed") file has no diff to show; an added or removed
 * file is empty unless its name says binary.
 */
function githubFile(row: GitHubFileRow, prUrl: string | null): ForgeFileDiff {
  const newPath = row.filename ?? "";
  const hasPatch = typeof row.patch === "string";
  const lineChanges = row.changes ?? (row.additions ?? 0) + (row.deletions ?? 0);
  const noLines = !hasPatch && lineChanges === 0;
  const binary = noLines && (row.status === "modified" || ((row.status === "added" || row.status === "removed") && binaryByName(newPath)));
  const tooLarge = !hasPatch && lineChanges > 0;
  return {
    oldPath: row.previous_filename ?? newPath,
    newPath,
    renamed: row.status === "renamed",
    newFile: row.status === "added",
    deletedFile: row.status === "removed",
    binary,
    tooLarge,
    diff: hasPatch ? row.patch! : noLines && !binary ? "" : null,
    webUrl: prUrl ? `${prUrl}/files#diff-${createHash("sha256").update(newPath).digest("hex")}` : null,
  };
}

async function githubHead(ctx: FileDiffContext, n: number): Promise<({ ok: true } & Head) | Failure> {
  const got = await getJson(ctx, `/repos/${ctx.projectPath}/pulls/${n}`, HEAD_MAX_BYTES);
  if (!got.ok) return got;
  if (got.cut) return { ok: false, error: `GitHub sent more than ${HEAD_MAX_BYTES} bytes for #${n}` };
  const pr = got.body as { head?: { sha?: string }; html_url?: string };
  if (!pr.head?.sha) return { ok: false, error: `GitHub sent no head sha for #${n}` };
  return { ok: true, headSha: pr.head.sha, webUrl: pr.html_url ?? null };
}

async function githubFiles(ctx: FileDiffContext, n: number, webUrl: string | null): Promise<({ ok: true } & Listing) | Failure> {
  const files: ForgeFileDiff[] = [];
  let budget = LISTING_MAX_BYTES;
  for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
    const got = await getJson(ctx, `/repos/${ctx.projectPath}/pulls/${n}/files?per_page=${PAGE_SIZE}&page=${page}`, budget);
    if (!got.ok) return got;
    if (got.cut) return { ok: true, files, truncated: true };
    if (!Array.isArray(got.body)) return { ok: false, error: "GitHub's PR files were not a JSON array" };
    budget -= got.bytes;
    for (const row of got.body as GitHubFileRow[]) files.push(githubFile(row, webUrl));
    if (got.body.length < PAGE_SIZE) return { ok: true, files, truncated: false };
  }
  return { ok: true, files, truncated: true };
}

/**
 * Reads one file's diff. The MR's head is asked for on every call. The
 * listing for a repo, MR and head is shared while it is in flight and kept
 * for a short while after, so the findings on one MR (which a review sheet
 * asks for all at once) cost one listing between pushes. A failed listing
 * is dropped, so the next call asks again.
 */
export function createFileDiffReader(opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; listing: Promise<({ ok: true } & Listing) | Failure> }>();

  return async function readFileDiff(repo: string, ctx: FileDiffContext, iid: number, path: string): Promise<Result> {
    const head = ctx.forge === "gitlab" ? await gitlabHead(ctx, iid) : await githubHead(ctx, iid);
    if (!head.ok) return head;
    for (const [k, e] of cache) if (now() - e.at > CACHE_TTL_MS) cache.delete(k);
    const key = `${repo}\n${iid}\n${head.headSha}`;
    let entry = cache.get(key);
    if (!entry || now() - entry.at > CACHE_TTL_MS) {
      const listing = ctx.forge === "gitlab" ? gitlabFiles(ctx, iid, head.webUrl) : githubFiles(ctx, iid, head.webUrl);
      const made = { at: now(), listing };
      entry = made;
      cache.delete(key);
      cache.set(key, made);
      while (cache.size > CACHE_MAX_MRS) cache.delete(cache.keys().next().value!);
      void listing.then(
        (l) => { if (!l.ok && cache.get(key) === made) cache.delete(key); },
        () => { if (cache.get(key) === made) cache.delete(key); },
      );
    }
    const listed = await entry.listing;
    if (!listed.ok) return listed;
    // A respond thread names its file by basename alone, so a path with no
    // exact match takes the one changed file ending in it; two such files
    // are ambiguous and match nothing, and a truncated listing may hide a
    // second one, so it matches nothing either.
    const bySuffix =
      path.includes("/") || listed.truncated ? [] : listed.files.filter((f) => f.newPath.endsWith(`/${path}`));
    const file =
      listed.files.find((f) => f.newPath === path) ??
      listed.files.find((f) => f.oldPath === path) ??
      (bySuffix.length === 1 ? bySuffix[0]! : null);
    return { ok: true, data: { forge: ctx.forge, headSha: head.headSha, truncated: listed.truncated, file } };
  };
}

/** A repo context as getRepoContext builds it; a context with no forge is GitLab's. */
export interface FileDiffRepoContext {
  forge?: "gitlab" | "github";
  provider: { restRequest: (method: string, path: string, body?: unknown, op?: string) => Promise<Response> };
  projectPath: string;
}

/** The GETs this read makes, through the provider the repo's own context carries. */
export function fileDiffContextOf(repo: FileDiffRepoContext): FileDiffContext {
  return {
    forge: repo.forge === "github" ? "github" : "gitlab",
    projectPath: repo.projectPath,
    rest: (p) => repo.provider.restRequest("GET", p, undefined, "forge:file-diff"),
  };
}
