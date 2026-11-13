import type { FetchPullRequestsWarning, GitHubProvider, MRApprovalRules, PullRequest } from "@mattstack/glance";
import { fetchDeltaFrom, type DeltaProvider } from "./project-sync.ts";
import type { ProjectMRStore } from "./project-mrs-store.ts";
import { authorListed } from "./scope-authors.ts";
import { lazyChildLogger } from "../daemon-logger.ts";

// freshness.ts imports this module and project-sync.ts imports freshness.ts:
// imported bindings are only dereferenced at call time so the cycle loads safely.
const log = lazyChildLogger("project-sync-github");

export type GitHubSyncProvider = Pick<
  GitHubProvider,
  "fetchPullRequests" | "fetchSingleMR" | "fetchMergeRequestIndex" | "fetchApprovalRules" | "fetchCodeownerSections" | "fetchDivergedCounts"
>;

export interface GitHubSyncContext {
  provider: GitHubSyncProvider;
  projectPath: string;
}

/** A `contexts` warning keeps its PR (pending checks); any other warning means PRs are missing. */
async function strict<T>(
  projectPath: string,
  read: (onWarning: (warning: FetchPullRequestsWarning) => void) => Promise<T>,
): Promise<T> {
  let failure: FetchPullRequestsWarning | null = null;
  const result = await read((warning) => {
    if (warning.source === "contexts") {
      log.debug({ projectPath, warning }, "GitHub checks page unread");
      return;
    }
    failure ??= warning;
  });
  if (failure) throw new Error(`GitHub read incomplete: ${(failure as FetchPullRequestsWarning).message}`);
  return result;
}

export async function githubFetchOpen(ctx: GitHubSyncContext, authors: readonly string[] | null): Promise<PullRequest[]> {
  const { provider, projectPath } = ctx;
  const prs = await strict(projectPath, (onWarning) =>
    provider.fetchPullRequests({ projectPath, state: "opened", listWeight: true, onWarning }));
  return authors ? prs.filter((pr) => authorListed(authors, pr)) : prs;
}

export async function readSingleStrict(
  provider: Pick<GitHubProvider, "fetchSingleMR">,
  projectPath: string,
  iid: number,
): Promise<PullRequest | null> {
  return strict(projectPath, (onWarning) => provider.fetchSingleMR(projectPath, iid, null, onWarning));
}

export function githubFetchSingle(ctx: GitHubSyncContext, iid: number): Promise<PullRequest | null> {
  return readSingleStrict(ctx.provider, ctx.projectPath, iid);
}

export function githubFetchRules(ctx: GitHubSyncContext, opts: { updatedAfter?: string; iids?: number[] }): Promise<MRApprovalRules[]> {
  return ctx.provider.fetchApprovalRules({ projectPath: ctx.projectPath, ...opts });
}

export function githubFetchKnownSections(ctx: GitHubSyncContext): Promise<string[] | null> {
  return ctx.provider.fetchCodeownerSections({ projectPath: ctx.projectPath });
}

/** fetchDeltaFrom compares authors exactly, so a GitHub login takes the scope's spelling when it matches case-insensitively. */
function scopeSpelling(username: string | null, scopeAuthors: readonly string[] | undefined): string | null {
  if (!username || !scopeAuthors) return username;
  const lower = username.toLowerCase();
  return scopeAuthors.find((a) => a.toLowerCase() === lower) ?? username;
}

export function githubFetchDelta(
  ctx: GitHubSyncContext,
  updatedAfter: string,
  stored: ProjectMRStore | undefined,
): Promise<PullRequest[]> {
  const { provider, projectPath } = ctx;
  const scopeAuthors = stored?.scope?.authors;
  const adapter: DeltaProvider = {
    fetchPullRequests: (opts) => strict(projectPath, (onWarning) => provider.fetchPullRequests({ ...opts, onWarning })),
    fetchMergeRequestIndex: async (opts) => {
      const rows = await provider.fetchMergeRequestIndex({ projectPaths: opts.projectPaths, updatedAfter: opts.updatedAfter, states: opts.states, excludeTargetBranches: opts.excludeTargetBranches });
      return rows.map((row) => ({ ...row, authorUsername: scopeSpelling(row.authorUsername, scopeAuthors) }));
    },
    fetchSingleMR: (_pp: string, iid: number) => githubFetchSingle(ctx, iid),
  };
  return fetchDeltaFrom(adapter, projectPath, updatedAfter, stored, []);
}
