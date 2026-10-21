/**
 * One file's diff in an MR (GitLab) or PR (GitHub), through the repo's own
 * forge, in one forge-neutral shape. The board's review sheet draws it.
 */

import { createHash } from "node:crypto";
import { GitHubProvider } from "@mattstack/glance";
import type { ForgeFileDiff, ForgeFileDiffData } from "../../packages/rt-client/src/commands.ts";
import { forgeTokenFor, isGitHubRemote, parseRemoteUrl } from "../enrich.ts";
import { loadSecrets } from "../linear.ts";
import { runGit } from "../worktree/git-async.ts";
import { gitlabFailure, projectApi } from "./forge-reads.ts";

/** How to GET from a repo's forge: a provider-relative path in, the raw response out. */
export interface FileDiffContext {
  forge: "gitlab" | "github";
  projectPath: string;
  rest: (path: string) => Promise<Response>;
}

type Result = { ok: true; data: ForgeFileDiffData } | { ok: false; error: string };

const PAGE_SIZE = 100;
const GITLAB_MAX_PAGES = 50;
/** GitHub lists at most 3000 files for a PR. */
const GITHUB_MAX_PAGES = 30;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_MRS = 16;

async function forgeFailure(forge: FileDiffContext["forge"], res: Response): Promise<string> {
  if (forge === "gitlab") return gitlabFailure(res);
  return `GitHub returned ${res.status} ${res.statusText}`.trim();
}

async function getJson(ctx: FileDiffContext, path: string): Promise<{ ok: true; body: unknown; res: Response } | { ok: false; error: string }> {
  const res = await ctx.rest(path);
  if (!res.ok) return { ok: false, error: await forgeFailure(ctx.forge, res) };
  return { ok: true, body: await res.json(), res };
}

interface MrFiles { headSha: string; files: ForgeFileDiff[] }

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

async function gitlabHead(ctx: FileDiffContext, iid: number): Promise<{ ok: true; headSha: string; webUrl: string | null } | { ok: false; error: string }> {
  const got = await getJson(ctx, `${projectApi(ctx.projectPath)}/merge_requests/${iid}`);
  if (!got.ok) return got;
  const mr = got.body as { sha?: string; diff_refs?: { head_sha?: string } | null; web_url?: string };
  const headSha = mr.diff_refs?.head_sha ?? mr.sha;
  if (!headSha) return { ok: false, error: `GitLab sent no head sha for !${iid}` };
  return { ok: true, headSha, webUrl: mr.web_url ?? null };
}

async function gitlabFiles(ctx: FileDiffContext, iid: number, webUrl: string | null): Promise<{ ok: true; files: ForgeFileDiff[] } | { ok: false; error: string }> {
  const files: ForgeFileDiff[] = [];
  for (let page = 1; page <= GITLAB_MAX_PAGES; page++) {
    const got = await getJson(ctx, `${projectApi(ctx.projectPath)}/merge_requests/${iid}/diffs?page=${page}&per_page=${PAGE_SIZE}`);
    if (!got.ok) return got;
    if (!Array.isArray(got.body)) return { ok: false, error: "GitLab's MR diffs were not a JSON array" };
    for (const row of got.body as GitLabDiffRow[]) files.push(gitlabFile(row, webUrl));
    const next = got.res.headers.get("x-next-page");
    const more = next === null ? got.body.length === PAGE_SIZE : next.trim() !== "";
    if (!more) break;
  }
  return { ok: true, files };
}

interface GitHubFileRow { filename?: string; previous_filename?: string; status?: string; patch?: string }

function githubFile(row: GitHubFileRow, prUrl: string | null): ForgeFileDiff {
  const newPath = row.filename ?? "";
  const tooLarge = typeof row.patch !== "string";
  return {
    oldPath: row.previous_filename ?? newPath,
    newPath,
    renamed: row.status === "renamed",
    newFile: row.status === "added",
    deletedFile: row.status === "removed",
    binary: false,
    tooLarge,
    diff: tooLarge ? null : row.patch!,
    webUrl: prUrl ? `${prUrl}/files#diff-${createHash("sha256").update(newPath).digest("hex")}` : null,
  };
}

async function githubHead(ctx: FileDiffContext, n: number): Promise<{ ok: true; headSha: string; webUrl: string | null } | { ok: false; error: string }> {
  const got = await getJson(ctx, `/repos/${ctx.projectPath}/pulls/${n}`);
  if (!got.ok) return got;
  const pr = got.body as { head?: { sha?: string }; html_url?: string };
  if (!pr.head?.sha) return { ok: false, error: `GitHub sent no head sha for #${n}` };
  return { ok: true, headSha: pr.head.sha, webUrl: pr.html_url ?? null };
}

async function githubFiles(ctx: FileDiffContext, n: number, webUrl: string | null): Promise<{ ok: true; files: ForgeFileDiff[] } | { ok: false; error: string }> {
  const files: ForgeFileDiff[] = [];
  for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
    const got = await getJson(ctx, `/repos/${ctx.projectPath}/pulls/${n}/files?per_page=${PAGE_SIZE}&page=${page}`);
    if (!got.ok) return got;
    if (!Array.isArray(got.body)) return { ok: false, error: "GitHub's PR files were not a JSON array" };
    for (const row of got.body as GitHubFileRow[]) files.push(githubFile(row, webUrl));
    if (got.body.length < PAGE_SIZE) break;
  }
  return { ok: true, files };
}

/**
 * Reads one file's diff. The MR's head is asked for on every call; the
 * whole file list is kept per repo, MR and head for a short while, so the
 * findings on one MR's files cost one diff listing between pushes.
 */
export function createFileDiffReader(opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; files: ForgeFileDiff[] }>();

  return async function readFileDiff(repo: string, ctx: FileDiffContext, iid: number, path: string): Promise<Result> {
    const head = ctx.forge === "gitlab" ? await gitlabHead(ctx, iid) : await githubHead(ctx, iid);
    if (!head.ok) return head;
    const key = `${repo}\n${iid}\n${head.headSha}`;
    let entry = cache.get(key);
    if (!entry || now() - entry.at > CACHE_TTL_MS) {
      const listed = ctx.forge === "gitlab" ? await gitlabFiles(ctx, iid, head.webUrl) : await githubFiles(ctx, iid, head.webUrl);
      if (!listed.ok) return listed;
      entry = { at: now(), files: listed.files };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > CACHE_MAX_MRS) cache.delete(cache.keys().next().value!);
    }
    const file = entry.files.find((f) => f.newPath === path) ?? entry.files.find((f) => f.oldPath === path) ?? null;
    return { ok: true, data: { forge: ctx.forge, headSha: head.headSha, file } };
  };
}

/**
 * The repo's forge from its origin remote: a GitHub remote gets a glance
 * GitHubProvider with the token rt uses for GitHub (the gh session when no
 * githubToken is stored); anything else is the daemon's GitLab context.
 */
export async function defaultFileDiffContext(
  repoPath: string | undefined,
  gitlabContext: () => Promise<{ provider: { restRequest: (method: string, path: string, body?: unknown, op?: string) => Promise<Response> }; projectPath: string }>,
): Promise<FileDiffContext> {
  const origin = repoPath ? await runGit(repoPath, ["config", "--get", "remote.origin.url"]) : null;
  const remoteUrl = origin && origin.exitCode === 0 ? origin.stdout.trim() : undefined;
  if (isGitHubRemote(remoteUrl)) {
    const remote = parseRemoteUrl(remoteUrl!);
    if (!remote) throw new Error("could not parse the origin URL");
    const picked = await forgeTokenFor(remoteUrl, await loadSecrets());
    if (!picked?.token) throw new Error("no GitHub token (run: gh auth login)");
    const provider = new GitHubProvider(remote.host, picked.token);
    return { forge: "github", projectPath: remote.projectPath, rest: (p) => provider.restRequest("GET", p) };
  }
  const { provider, projectPath } = await gitlabContext();
  return { forge: "gitlab", projectPath, rest: (p) => provider.restRequest("GET", p, undefined, "forge:file-diff") };
}
