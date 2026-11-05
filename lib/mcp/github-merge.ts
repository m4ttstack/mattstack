/**
 * mr_merge's GitHub path. It calls GitHub from the MCP server because the
 * daemon's provider context is GitLab-only, and it asks GitHub whether the PR
 * goes through a merge queue so callers never have to know.
 */
import { GitHubProvider, ReadBackFailedError } from "@mattstack/glance";
import { resolveGithubToken } from "../github-token.ts";
import { loadSecrets } from "../linear.ts";
import { parseIdentity } from "../settings/identity.ts";
import { isRepoRegistered } from "../repo-index.ts";
import { registeredIdentityForUrl, resolveMrTarget, resolveRepoTarget, type TargetInput } from "./mr-target.ts";
import { err, ok, type ToolResult } from "./shared.ts";

const GITHUB_HOST = "https://github.com";
const GITHUB_ID_PREFIX = "github.com/";
const PR_URL_RE = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export type GithubTarget = { projectPath: string; iid: number };

export type GithubMergeProvider = Pick<GitHubProvider, "enqueuePullRequest" | "fetchMergeQueueStatus" | "mergePullRequest" | "setAutoMerge">;

export interface GithubMergeOptions {
  squash?: boolean;
  removeSourceBranch?: boolean;
  whenPipelineSucceeds?: boolean;
}

function githubProject(identity: string): string | null {
  const id = parseIdentity(identity)?.id;
  return id?.startsWith(GITHUB_ID_PREFIX) ? id.slice(GITHUB_ID_PREFIX.length) : null;
}

/** mr_merge runs with no permission prompt, so it reaches only repos registered with rt, as the daemon's GitLab path does. null means the target is not on GitHub, or is one the GitLab path should report on. */
export async function resolveGithubTarget(
  input: TargetInput,
  seams: { identityForUrl?: typeof registeredIdentityForUrl; isRegistered?: typeof isRepoRegistered } = {},
): Promise<GithubTarget | { error: string } | null> {
  const { identityForUrl = registeredIdentityForUrl, isRegistered = isRepoRegistered } = seams;
  const url = typeof input.mrUrl === "string" ? PR_URL_RE.exec(input.mrUrl.trim()) : null;
  if (!url) {
    const target = await resolveMrTarget(input);
    const projectPath = target.ok ? githubProject(target.identity) : null;
    if (!target.ok || !projectPath) return null;
    if (!isRegistered(target.identity)) return { error: `${target.identity} is not registered with rt; run rt repos register in its checkout first` };
    return { projectPath, iid: target.iid };
  }

  const projectPath = url[1]!;
  const iid = Number(url[2]);
  if (input.iid !== undefined && input.iid !== iid) return { error: `iid ${String(input.iid)} does not match mrUrl's pull request ${iid}` };
  const found = await identityForUrl("github.com", projectPath);
  if ("error" in found) return { error: found.error };
  if (input.repoName !== undefined) {
    const named = await resolveRepoTarget({ repoName: input.repoName });
    if (!named.ok) return { error: named.error };
    if (named.identity !== found.identity) return { error: `repoName resolves to ${named.identity} but mrUrl names ${found.identity}; pass one of them, or make them agree` };
  }
  return { projectPath, iid };
}

async function realProvider(): Promise<GithubMergeProvider | null> {
  const resolved = await resolveGithubToken((await loadSecrets()).githubToken);
  return resolved ? new GitHubProvider(GITHUB_HOST, resolved.token) : null;
}

export async function mergeOnGitHub(
  target: GithubTarget,
  options: GithubMergeOptions,
  provider: () => Promise<GithubMergeProvider | null> = realProvider,
): Promise<ToolResult> {
  const { projectPath, iid } = target;
  try {
    const github = await provider();
    if (!github) return err("no GitHub token (run: gh auth login)");
    const queue = await github.fetchMergeQueueStatus(projectPath, iid);
    if (queue.enabled) {
      if (options.squash !== undefined || options.removeSourceBranch !== undefined || options.whenPipelineSucceeds !== undefined) {
        return err(`#${iid} goes through a merge queue, which applies its own merge settings and waits for checks itself, so squash, removeSourceBranch and whenPipelineSucceeds cannot apply; call mr_merge without them`);
      }
      if (queue.inQueue) return ok({ queued: true, alreadyQueued: true });
      const entry = await github.enqueuePullRequest(projectPath, iid);
      return ok({ queued: true, position: entry.position, state: entry.state });
    }
    if (options.whenPipelineSucceeds === true) {
      await github.setAutoMerge(projectPath, iid);
      return ok({ autoMerge: true });
    }
    const pr = await github.mergePullRequest(projectPath, iid, {
      ...(options.squash !== undefined && { squash: options.squash }),
      ...(options.removeSourceBranch !== undefined && { shouldRemoveSourceBranch: options.removeSourceBranch }),
    });
    return pr.state === "merged" ? ok({ merged: true }) : ok({ requested: "merge", verified: false, state: pr.state });
  } catch (e) {
    if (e instanceof ReadBackFailedError && e.writeApplied) return ok({ requested: "merge", verified: false });
    return err(e instanceof Error ? e.message : String(e));
  }
}
