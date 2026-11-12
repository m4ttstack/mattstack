/**
 * mr_merge's GitHub path. Every forge call goes through daemon verbs, so only
 * the daemon holds the token, and it asks GitHub whether the PR goes through
 * a merge queue so callers never have to know. The queue wait loop stays here.
 */
import { MergeReadBackFailedError, ReadBackFailedError, type GitProvider, type MergeQueueStatus } from "@mattstack/glance";
import { DAEMON_UNREACHABLE_PREFIX, rtCommand, type Commands } from "../../packages/rt-client/src/index.ts";
import { parseIdentity } from "../settings/identity.ts";
import { isRepoRegistered } from "../repo-index.ts";
import { abortableSleep } from "./ci-tools.ts";
import { parsePrUrl, registeredIdentityForUrl, resolveMrTarget, type TargetInput } from "./mr-target.ts";
import { err, MR_WRITE_TIMEOUT_MS, ok, type ToolResult } from "./shared.ts";

export const MERGE_WAIT_DEFAULT_SECONDS = 1500;
// Below Claude Code's 1800 s MCP idle timeout, for a client that sends no progress token.
export const MERGE_WAIT_MAX_SECONDS = 1500;
const MERGE_WAIT_POLL_MS = 20_000;

const GITHUB_ID_PREFIX = "github.com/";

export type GithubTarget = { projectPath: string; iid: number; identity: string };

export type GithubMergeProvider = Required<Pick<GitProvider, "enqueuePullRequest" | "fetchMergeQueueStatus" | "mergePullRequest" | "setAutoMerge">>;

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
  provider?: (target: GithubTarget) => Promise<GithubMergeProvider | null>;
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
    await seams.sleep(Math.min(MERGE_WAIT_POLL_MS, deadline - seams.now()), seams.signal);
    if (seams.signal?.aborted) break;
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
  const url = typeof input.mrUrl === "string" ? parsePrUrl(input.mrUrl) : null;
  if (!url) {
    const target = await resolveMrTarget(input);
    const projectPath = target.ok ? githubProject(target.identity) : null;
    if (!target.ok || !projectPath) return null;
    if (!isRegistered(target.identity)) return { error: `${target.identity} is not registered with rt; run rt repos register in its checkout first` };
    return { projectPath, iid: target.iid, identity: target.identity };
  }

  const target = await resolveMrTarget(input, { github: true, identityForUrl });
  if (!target.ok) return { error: target.error };
  return { projectPath: url.projectPath, iid: target.iid, identity: target.identity };
}

type DaemonCommand = typeof rtCommand;

/** The daemon's catch prefixes the forge's text with `Error: `; the in-process path this replaced returned it bare. */
function daemonError(error: string | undefined, cmd: string): Error {
  return new Error((error ?? `${cmd} failed`).replace(/^Error: /, ""));
}

async function daemonData<K extends keyof Commands>(command: DaemonCommand, cmd: K, payload: Commands[K]["payload"]): Promise<Commands[K]["data"] | undefined> {
  const res = await command<Commands[K]["data"]>(cmd, payload as Record<string, unknown>, { timeoutMs: MR_WRITE_TIMEOUT_MS });
  if (!res.ok) throw daemonError(res.error, cmd);
  return res.data;
}

/** The provider seam over daemon verbs for one repo. Its projectPath arguments are ignored: the daemon finds the repo from `identity`. */
export function daemonMergeProvider(identity: string, command: DaemonCommand = rtCommand): GithubMergeProvider {
  return {
    async fetchMergeQueueStatus(_projectPath, iid) {
      const status = await daemonData(command, "mr:merge-queue-status", { repoName: identity, iid });
      if (!status) throw new Error("mr:merge-queue-status returned no status");
      return status;
    },
    async enqueuePullRequest(_projectPath, iid, input) {
      const entry = await daemonData(command, "mr:enqueue", { repoName: identity, iid, ...(input?.expectedHeadSha !== undefined && { expectedHeadSha: input.expectedHeadSha }) });
      if (!entry) throw new Error("mr:enqueue returned no queue entry");
      return entry as { position: number; state: string };
    },
    async setAutoMerge(_projectPath, iid) {
      const res = await command("mr:action", { repoName: identity, iid, action: "setAutoMerge", args: [] }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
      if (!res.ok) throw daemonError(res.error, "mr:action");
    },
    async mergePullRequest(projectPath, iid, input) {
      const merged = await command<Commands["mr:action"]["data"]>("mr:action", { repoName: identity, iid, action: "merge", args: [input ?? {}] }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
      // With no answer the daemon may still be merging, so whether the write landed is unknown: only a merged read-back overrides the error.
      const unanswered = !merged.ok && merged.error?.startsWith(DAEMON_UNREACHABLE_PREFIX) === true;
      if (!merged.ok && !unanswered) throw daemonError(merged.error, "mr:action");
      const back = await command<Commands["mr:get"]["data"]>("mr:get", { repoName: identity, iid, refresh: true }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
      if (unanswered) {
        if (back.ok && back.data?.mr?.state === "merged") return back.data.mr;
        throw new Error(merged.error);
      }
      const note = merged.data?.sourceBranchNotDeleted;
      const queued = merged.data?.queued;
      const cleanup = typeof note === "string" ? { sourceBranchNotDeleted: note } : {};
      if (!back.ok || !back.data?.mr) {
        const what = queued ? `Queued #${iid}` : `Merged #${iid}`;
        throw new MergeReadBackFailedError(`${what} but could not read it back: ${back.error ?? "mr:get returned no pull request"}`, {
          operation: "mergePullRequest", projectPath, iid, writeApplied: true, ...cleanup, ...(queued && { queued }),
        });
      }
      return { ...back.data.mr, ...cleanup, ...(queued && { queued }) };
    },
  };
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
    const github = await (seams.provider ?? (async (t: GithubTarget) => daemonMergeProvider(t.identity)))(target);
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
    const cleanup = pr.sourceBranchNotDeleted === undefined ? {} : { sourceBranchNotDeleted: pr.sourceBranchNotDeleted };
    if (pr.state === "merged") return ok({ merged: true, ...cleanup });
    if (pr.queued) return ok({ queued: true, position: pr.queued.position, state: pr.queued.state });
    return ok({ requested: "merge", verified: false, state: pr.state, ...cleanup });
  } catch (e) {
    if (e instanceof MergeReadBackFailedError && e.queued) return ok({ queued: true, position: e.queued.position, state: e.queued.state });
    if (e instanceof ReadBackFailedError && e.writeApplied) {
      const note = e instanceof MergeReadBackFailedError ? e.sourceBranchNotDeleted : undefined;
      return ok({ requested: "merge", verified: false, ...(note !== undefined && { sourceBranchNotDeleted: note }) });
    }
    return err(e instanceof Error ? e.message : String(e));
  }
}
