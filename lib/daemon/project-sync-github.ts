import type { FetchPullRequestsWarning, GitHubProvider, MergeRequestIndexRow, PullRequest } from "@mattstack/glance";
import { fetchDeltaFrom, type DeltaProvider } from "./project-sync.ts";
import type { ProjectMRStore } from "./project-mrs-store.ts";
import { authorListed } from "./scope-authors.ts";
import { lazyChildLogger } from "../daemon-logger.ts";

// freshness.ts imports this module and project-sync.ts imports freshness.ts:
// imported bindings are only dereferenced at call time so the cycle loads safely.
const log = lazyChildLogger("project-sync-github");

export type GitHubSyncProvider = Pick<GitHubProvider, "fetchPullRequests" | "fetchSingleMR">;

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

function indexRow(pr: PullRequest, projectPath: string, scopeAuthors: readonly string[] | undefined): MergeRequestIndexRow {
  const username = pr.author?.username ?? null;
  const scoped = scopeAuthors && authorListed(scopeAuthors, pr)
    ? scopeAuthors.find((a) => a.toLowerCase() === username?.toLowerCase()) ?? username
    : username;
  return {
    iid: pr.iid,
    projectPath,
    title: pr.title,
    state: pr.state,
    createdAt: pr.createdAt ?? "",
    updatedAt: pr.updatedAt ?? "",
    mergedAt: pr.mergedAt ?? null,
    authorUsername: scoped,
    sourceBranch: pr.sourceBranch,
    labels: [],
  };
}

/** GitHub has no merged-PR index read, so the index rows come from a terminal-state listing whose PRs are kept for reuse. */
export function githubFetchDelta(
  ctx: GitHubSyncContext,
  updatedAfter: string,
  stored: ProjectMRStore | undefined,
): Promise<PullRequest[]> {
  const { provider, projectPath } = ctx;
  const terminalRead = new Map<number, PullRequest>();
  const adapter: DeltaProvider = {
    fetchPullRequests: (opts) => strict(projectPath, (onWarning) => provider.fetchPullRequests({ ...opts, onWarning })),
    fetchMergeRequestIndex: async () => {
      const prs = await strict(projectPath, (onWarning) =>
        provider.fetchPullRequests({ projectPath, state: ["merged", "closed"], updatedAfter, listWeight: true, onWarning }));
      for (const pr of prs) terminalRead.set(pr.iid, pr);
      return prs.map((pr) => indexRow(pr, projectPath, stored?.scope?.authors));
    },
    fetchSingleMR: async (_pp: string, iid: number) => terminalRead.get(iid) ?? githubFetchSingle(ctx, iid),
  };
  return fetchDeltaFrom(adapter, projectPath, updatedAfter, stored, []);
}
