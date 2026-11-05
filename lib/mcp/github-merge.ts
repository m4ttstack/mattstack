/**
 * mr_merge's GitHub path. It calls GitHub from the MCP server because the
 * daemon's provider context is GitLab-only, and it asks GitHub whether the PR
 * goes through a merge queue so callers never have to know.
 */
import { GitHubProvider, ReadBackFailedError, type MergeQueueStatus } from "@mattstack/glance";
import { resolveGithubToken } from "../github-token.ts";
import { loadSecrets } from "../linear.ts";
import { parseIdentity } from "../settings/identity.ts";
import { isRepoRegistered } from "../repo-index.ts";
import { abortableSleep } from "./ci-tools.ts";
import { registeredIdentityForUrl, resolveMrTarget, resolveRepoTarget, type TargetInput } from "./mr-target.ts";
import { err, ok, type ToolResult } from "./shared.ts";

export const MERGE_WAIT_DEFAULT_SECONDS = 1500;
// Below Claude Code's 1800 s MCP idle timeout, for a client that sends no progress token.
export const MERGE_WAIT_MAX_SECONDS = 1500;
const MERGE_WAIT_POLL_MS = 20_000;

const GITHUB_HOST = "https://github.com";
const GITHUB_ID_PREFIX = "github.com/";
const PR_URL_RE = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export type GithubTarget = { projectPath: string; iid: number };

export type GithubMergeProvider = Pick<GitHubProvider, "enqueuePullRequest" | "fetchMergeQueueStatus" | "mergePullRequest" | "setAutoMerge">;

export interface GithubMergeOptions {
  squash?: boolean;
  removeSourceBranch?: boolean;
  whenPipelineSucceeds?: boolean;
  /** Hold until a queued PR lands or is dropped. */
  wait?: boolean;
  /** Enter the queue again after a drop. */
  requeue?: boolean;
  maxWaitSeconds?: number;
}

export interface GithubMergeSeams {
  provider?: () => Promise<GithubMergeProvider | null>;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  progress?: () => void;
}

function droppedResult(removal: NonNullable<MergeQueueStatus["lastRemoval"]>): ToolResult {
  return ok({ dropped: true, reason: removal.reason, at: removal.at });
}

/** A removal that predates this wait says nothing about it, and GitHub can report a just-queued PR as out of the queue for a moment. */
async function waitForQueue(
  github: GithubMergeProvider,
  target: GithubTarget,
  priorRemovalAt: string | undefined,
  maxWaitSeconds: number,
  seams: Required<Pick<GithubMergeSeams, "now" | "sleep">> & Pick<GithubMergeSeams, "signal" | "progress">,
): Promise<ToolResult> {
  const deadline = seams.now() + maxWaitSeconds * 1000;
  let lastError: string | undefined;
  while (seams.now() < deadline && !seams.signal?.aborted) {
    await seams.sleep(MERGE_WAIT_POLL_MS, seams.signal);
    seams.progress?.();
    try {
      const status = await github.fetchMergeQueueStatus(target.projectPath, target.iid);
      lastError = undefined;
      if (status.merged) return ok({ merged: true });
      const removal = status.lastRemoval;
      if (removal?.reason === "merged") return ok({ merged: true });
      if (!status.inQueue && removal && removal.at !== priorRemovalAt) return droppedResult(removal);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return ok({ queued: true, timedOut: true, ...(lastError && { lastError }) });
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
  seams: GithubMergeSeams = {},
): Promise<ToolResult> {
  const { projectPath, iid } = target;
  const clock = { now: seams.now ?? Date.now, sleep: seams.sleep ?? abortableSleep, signal: seams.signal, progress: seams.progress };
  const maxWait = options.maxWaitSeconds ?? MERGE_WAIT_DEFAULT_SECONDS;
  try {
    const github = await (seams.provider ?? realProvider)();
    if (!github) return err("no GitHub token (run: gh auth login)");
    const queue = await github.fetchMergeQueueStatus(projectPath, iid);
    if (queue.merged || queue.lastRemoval?.reason === "merged") return ok({ merged: true });
    if (queue.enabled) {
      if (options.squash !== undefined || options.removeSourceBranch !== undefined || options.whenPipelineSucceeds !== undefined) {
        return err(`#${iid} goes through a merge queue, which applies its own merge settings and waits for checks itself, so squash, removeSourceBranch and whenPipelineSucceeds cannot apply; call mr_merge without them`);
      }
      const priorRemovalAt = queue.lastRemoval?.at;
      if (queue.inQueue) {
        if (options.wait) return await waitForQueue(github, target, priorRemovalAt, maxWait, clock);
        return ok({ queued: true, alreadyQueued: true });
      }
      if (queue.lastRemoval && !options.requeue) return droppedResult(queue.lastRemoval);
      const entry = await github.enqueuePullRequest(projectPath, iid);
      if (options.wait) return await waitForQueue(github, target, priorRemovalAt, maxWait, clock);
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
