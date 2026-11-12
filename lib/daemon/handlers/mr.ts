/**
 * MR action IPC handlers — clients dispatch MR mutations through the daemon
 * so the daemon's per-repo provider stays the only path that talks to GitLab.
 * Providers come from freshness.ts (getRepoContext), which serves live-watch
 * and ephemeral repos alike.
 *
 *   mr:action            — merge / rebase / approve / unapprove / etc.
 *   mr:create            - create an MR (draft by default, labels, squash) and write it back
 *   mr:update            - edit title/description (glance) and labels/squash (REST), glance first
 *   mr:fetch-job-detail  — unified detail fetch (returns trace or bridge)
 *   mr:fetch-job-trace   — raw job trace text
 *   mr:commit-parents        - a commit's parent shas (GitLab or GitHub)
 *   mr:pipeline-failed-jobs  - a pipeline's failed jobs (GitLab or GitHub)
 *   mr:by-target             - every MR targeting a branch, live and unscoped (GitLab or GitHub)
 *   mr:get                   - one MR by iid, read from the forge; `refresh` also writes it into the stores (GitLab or GitHub)
 *   mr:merge-queue-status    - whether a PR's target branch has a merge queue and the PR is in it (GitHub)
 *   mr:enqueue               - add a PR to its target branch's merge queue (GitHub)
 *   mr:list-live             - a project's MRs filtered by author, branch, state or text (GitLab or GitHub)
 *   mr:live-by-branch        - the open MR for each named source branch (GitLab or GitHub)
 *   project:labels           - a project's labels, optionally searched (GitLab or GitHub)
 *   pipeline:list            - pipelines for a branch, a commit or an MR (GitLab or GitHub)
 *   forge:get                - one guarded GET against the repo's own forge REST API (GitLab, or GitHub under the repo)
 *   forge:file-diff          - one file's diff in an MR or PR, from the repo's own forge (GitLab or GitHub)
 *
 * Every handler routes by `{ repoName, iid }`. If no provider can be built
 * for the repo (missing token, unparseable remote), the handler returns
 * `{ ok: false, error }` so the client can surface a toast.
 *
 * mr:action write-back (spec §5.4): a mutation only ever tells us the MR
 * changed, not the fresh shape of every field (approvals, pipeline status,
 * ...). Three buckets decide how we get that fresh shape into the stores:
 *   - returned-PR (merge, toggleDraft) — the SDK call itself returns the
 *     fresh PullRequest, so write-back is free (zero extra fetches).
 *   - void (approve, unapprove, rebase, setAutoMerge, cancelAutoMerge,
 *     requestReReview) — one immediate fetchSingleMR follow-up.
 *   - retry (retryPipeline, retryJob) — pipelines are the events blind
 *     spot; one DELAYED follow-up catches the flip to "running" (the
 *     final pass/fail rides the normal 5-min cycle).
 * Follow-up failures log at warn and never fail the action.
 */

import { applyMRWriteback, getCurrentUserId, getRepoContext } from "../freshness.ts";
import type { PullRequest, UpdatePullRequestInput } from "@mattstack/glance";
import { PartialCreateError, ReadBackFailedError } from "@mattstack/glance";
import type { HandlerContext, HandlerMap, CommandResult } from "./types.ts";
import type { MrCreateFailedStep, MrListState, MrTargetSummary } from "../../../packages/rt-client/src/commands.ts";
import { decodeRepo } from "../identity-decoder.ts";
import { createFileDiffReader, fileDiffContextOf, type FileDiffContext } from "../file-diff.ts";
import { LIST_MAX_LIMIT, PIPELINE_MAX_LIMIT, forgeFailure, forgeGet, listLabels, listMrsLive, listPipelines, missingMrReason, type Forge, type SummariesProvider } from "../forge-reads.ts";

type ActionName =
  | "merge" | "rebase" | "approve" | "unapprove"
  | "setAutoMerge" | "cancelAutoMerge"
  | "retryJob" | "retryPipeline"
  | "toggleDraft" | "requestReReview";

export const RETRY_WRITEBACK_DELAY_MS = 5000;

const RETURNED_PR_ACTIONS = new Set<ActionName>(["merge", "toggleDraft"]);
const RETRY_ACTIONS       = new Set<ActionName>(["retryPipeline", "retryJob"]);

/** GitLab's label params are comma-separated, so a comma inside one label would read as two. An empty array is a no-op, not an error. */
function labelsError(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  const bad = !Array.isArray(v) || v.some((l) => typeof l !== "string" || !l.trim() || l.includes(","));
  return bad ? `invalid ${field}` : undefined;
}

function trimmedLabels(v: unknown[]): string[] {
  return v.map((l) => String(l).trim());
}

/** glance types neither squash nor add/remove-labels, so they ride its raw REST door. */
async function putMergeRequest(
  provider: { restRequest: (method: string, path: string, body?: unknown, op?: string) => Promise<Response> },
  projectPath: string,
  iid: number,
  body: Record<string, unknown>,
  op: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await provider.restRequest("PUT", `/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}`, body, op);
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `GitLab returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const MR_LIST_STATES: readonly MrListState[] = ["opened", "merged", "closed", "all"];
const BY_TARGET_PER_PAGE = 100;
const BY_TARGET_MAX_PAGES = 20;
const BY_TARGET_LIMIT = BY_TARGET_MAX_PAGES * BY_TARGET_PER_PAGE;

/** A partial listing must never pass for the whole answer, so every failure, and running past the cap, is an error. */
async function listMrsByTarget(
  provider: SummariesProvider,
  projectPath: string,
  targetBranch: string,
  state: MrListState,
  forge: Forge,
): Promise<{ ok: true; mrs: MrTargetSummary[] } | { ok: false; error: string }> {
  try {
    const { rows, truncated } = await provider.fetchPullRequestSummaries(projectPath, { state, targetBranch, limit: BY_TARGET_LIMIT });
    if (truncated) return { ok: false, error: `more than ${BY_TARGET_LIMIT} MRs target ${targetBranch}; the listing stopped before the end` };
    return { ok: true, mrs: rows };
  } catch (err) {
    return { ok: false, error: forgeFailure(err, forge) };
  }
}

/** A context with no `forge` reads as GitLab. */
type HandlerRepoContext = { forge?: "gitlab" | "github"; provider: any; projectPath: string; projectId?: number | null };

const forgeOf = (c: HandlerRepoContext): Forge => (c.forge === "github" ? "github" : "gitlab");

/** GitLab's reply stays String(err), byte for byte; GitHub's names a rate limit's wait. */
const failureText = (err: unknown, forge: Forge): string => (forge === "github" ? forgeFailure(err, "github") : String(err));

const GITHUB_REASON_MAX_CHARS = 200;

type FillWarning = { status?: number; message: string };

const GITHUB_SQUASH_REFUSAL = "GitHub picks squash at merge time; leave out squash";
const NO_MERGE_QUEUE = "unsupported: this forge has no merge queue";

export interface MRHandlerOverrides {
  getContext?:  (repoName: string) => Promise<HandlerRepoContext>;
  writeback?:   (repoName: string, projectPath: string, pr: PullRequest) => void;
  fetchSingle?: (provider: any, projectPath: string, iid: number, github?: boolean, onWarning?: (w: FillWarning) => void) => Promise<PullRequest | null>;
  retryDelayMs?: number;
  fileDiffContext?: (repoName: string) => Promise<FileDiffContext>;
}

// "mr:action" keeps its pre-existing `{ok:true}` wire reply verbatim, with
// `data` only for a merge that left its source branch, so it stays on the
// loose `Promise<any>` escape hatch (same trick as endpoint.ts/repos.ts); the
// two job-detail verbs already envelope as {ok,data} and get the standard
// CommandResult carve-out.
export function createMRHandlers(
  ctx: Pick<HandlerContext, "repoIndex" | "cache" | "log">,
  broadcast: (type: string, data: any) => void,
  overrides: MRHandlerOverrides = {},
): { "mr:action": (payload: any, signal?: AbortSignal) => Promise<any> }
  & { "mr:create": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:create">> }
  & { "mr:update": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:update">> }
  & { "mr:fetch-job-detail": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:fetch-job-detail">> }
  & { "mr:fetch-job-trace": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:fetch-job-trace">> }
  & { "mr:commit-parents": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:commit-parents">> }
  & { "mr:pipeline-failed-jobs": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:pipeline-failed-jobs">> }
  & { "mr:by-target": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:by-target">> }
  & { "mr:get": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:get">> }
  & { "mr:merge-queue-status": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:merge-queue-status">> }
  & { "mr:enqueue": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:enqueue">> }
  & { "mr:list-live": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:list-live">> }
  & { "mr:live-by-branch": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:live-by-branch">> }
  & { "project:labels": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"project:labels">> }
  & { "pipeline:list": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"pipeline:list">> }
  & { "forge:get": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"forge:get">> }
  & { "forge:file-diff": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"forge:file-diff">> }
  & HandlerMap {
  const getContext = overrides.getContext
    ?? ((repoName: string) => getRepoContext(repoName, ctx.repoIndex()[repoName]));
  const storeWriteback = overrides.writeback
    ?? ((repoName: string, projectPath: string, pr: PullRequest) =>
        applyMRWriteback({ ctx, broadcast }, repoName, projectPath, pr));
  const fetchSingle = overrides.fetchSingle
    ?? ((provider: any, projectPath: string, iid: number, github?: boolean, onWarning?: (w: FillWarning) => void) =>
        (github && onWarning
          ? provider.fetchSingleMR(projectPath, iid, null, onWarning)
          : provider.fetchSingleMR(projectPath, iid, github ? null : getCurrentUserId())));
  const retryDelayMs = overrides.retryDelayMs ?? RETRY_WRITEBACK_DELAY_MS;
  const fileDiffContext = overrides.fileDiffContext
    ?? (async (repoName: string) => fileDiffContextOf(await contextFor(repoName)));
  const readFileDiff = createFileDiffReader();

  function contextFor(repoName: string): Promise<HandlerRepoContext> {
    return getContext(repoName);
  }

  /** The batch maps a pull request it found but could not fill to null too, so each null is checked against the open pull requests on that branch before it reads as "no PR". */
  async function liveByBranchOnGitHub(provider: any, projectPath: string, branches: string[]): Promise<CommandResult<"mr:live-by-branch">> {
    const found: Map<string, PullRequest | null> = await provider.fetchPullRequestsByBranches(projectPath, branches.map((b) => b.trim()));
    const byBranch: Record<string, PullRequest | null> = {};
    const unfilled: string[] = [];
    for (const branch of branches) {
      byBranch[branch] = found.get(branch.trim()) ?? null;
      if (!byBranch[branch]) unfilled.push(branch);
    }
    for (const branch of unfilled) {
      const open = await provider.fetchPullRequestSummaries(projectPath, { state: "opened", sourceBranch: branch.trim(), limit: 1 });
      const hit = (open.rows as MrTargetSummary[])[0];
      if (!hit) continue;
      const pr = await fetchSingle(provider, projectPath, hit.iid, true);
      if (!pr) return { ok: false, error: `GitHub has pull request #${hit.iid} open on ${branch} in ${projectPath} but could not read it; try again` };
      byBranch[branch] = pr;
    }
    return { ok: true, data: { byBranch } };
  }

  /**
   * `decodeRepo` validates the wire SHAPE only. A well-formed identity the
   * index does not carry would reach `getRepoContext` and come back as its raw
   * index error, so a caller could not tell "I do not know that repo" from a
   * provider fault. `hooks:repair` answers that case explicitly; these verbs
   * now match it.
   */
  function decodeIndexedRepo(payload: unknown): { ok: true; repo: string } | { ok: false; error: string } {
    const decoded = decodeRepo(payload);
    if (!decoded.ok) return { ok: false, error: decoded.error };
    if (!ctx.repoIndex()[decoded.repo]) return { ok: false, error: "repo-unknown" };
    return { ok: true, repo: decoded.repo };
  }

  return {
    "mr:action": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; action?: ActionName; args?: any[] } | undefined;
      const iid      = p?.iid;
      const action   = p?.action;
      const args     = p?.args ?? [];

      if (typeof iid !== "number" || !action) {
        return { ok: false, error: "missing repoName/iid/action" };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(repoName);
        const { provider, projectPath } = c;
        forge = forgeOf(c);
        const github = forge === "github";
        if (github && action === "rebase" && !provider.capabilities?.canRebase) {
          return { ok: false, error: "GitHub cannot rebase a pull request; rebase the branch with git and push" };
        }
        let returnedPr: PullRequest | null = null;
        let sourceBranchNotDeleted: string | undefined;
        try {
          switch (action) {
            case "merge": {
              const merged = await provider.mergePullRequest(projectPath, iid, args[0]);
              returnedPr = merged;
              sourceBranchNotDeleted = merged?.sourceBranchNotDeleted;
              break;
            }
            case "rebase":           await provider.rebasePullRequest(projectPath, iid);                  break;
            case "approve":          await provider.approvePullRequest(projectPath, iid);                 break;
            case "unapprove":        await provider.unapprovePullRequest(projectPath, iid);               break;
            case "setAutoMerge":     await provider.setAutoMerge(projectPath, iid);                       break;
            case "cancelAutoMerge":  await provider.cancelAutoMerge(projectPath, iid);                    break;
            case "retryPipeline":    await provider.retryPipeline(projectPath, args[0]);                  break;
            case "retryJob":         await provider.retryJob(projectPath, args[0]);                       break;
            case "toggleDraft":      returnedPr = await provider.updatePullRequest(projectPath, iid, { draft: args[0] }); break;
            case "requestReReview":  await provider.requestReReview(projectPath, iid, args[0]);           break;
            default:
              return { ok: false, error: `unsupported action: ${action}` };
          }
        } catch (err) {
          // The two returned-PR actions read the MR back after mutating it, and
          // that read can fail over a mutation that already landed -- GitLab's
          // GraphQL times out on the dashboard fragment often enough to matter.
          // Reporting those as failed put a toast in front of the user for a
          // merge or draft flip that had actually happened, and invited them to
          // do it again. `writeApplied` is the SDK saying the write is on the
          // forge and only describing it failed (glance 0.19.0, MAT-169).
          //
          // `returnedPr` stays null, which drops through to the same follow-up
          // fetch the void actions use, so the stores still get a fresh shape.
          if (!(err instanceof ReadBackFailedError && err.writeApplied)) throw err;
          ctx.log.warn({ err, repo: repoName, iid, action }, "action landed but its read-back failed; recovering via follow-up fetch");
        }

        const done = sourceBranchNotDeleted ? { ok: true, data: { sourceBranchNotDeleted } } : { ok: true };

        const followUp = async () => {
          try {
            const pr = await fetchSingle(provider, projectPath, iid, github);
            if (pr) storeWriteback(repoName, projectPath, pr);
          } catch (err) {
            ctx.log.warn({ err, repo: repoName, iid, action }, "write-back follow-up failed");
          }
        };

        if (RETURNED_PR_ACTIONS.has(action) && returnedPr) {
          // The mutation already succeeded; a failing write-back must not
          // misreport it as failed. Same never-fail contract as followUp.
          try {
            storeWriteback(repoName, projectPath, returnedPr);
          } catch (err) {
            ctx.log.warn({ err, repo: repoName, iid, action }, "write-back failed");
          }
        } else if (RETRY_ACTIONS.has(action)) {
          // Pipelines are the events blind spot: one delayed fetch catches
          // the flip to "running"; the final pass/fail rides the 5-min cycle.
          setTimeout(() => { followUp(); }, retryDelayMs);
        } else {
          await followUp();
        }
        return done;
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:create": async (payload) => {
      const p = payload as { sourceBranch?: unknown; targetBranch?: unknown; title?: unknown; description?: unknown; draft?: unknown; labels?: unknown; squash?: unknown } | undefined;
      const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
      const sourceBranchInput = p?.sourceBranch, targetBranchInput = p?.targetBranch, titleInput = p?.title;
      if (!nonBlank(sourceBranchInput) || !nonBlank(targetBranchInput) || !nonBlank(titleInput)) {
        return { ok: false, error: "missing repoName/sourceBranch/targetBranch/title" };
      }
      // Trimmed once here so the same-branch guard and the provider call see identical values;
      // untrimmed " main" vs "main" would pass the guard and reach GitLab as a bad branch name.
      const sourceBranch = sourceBranchInput.trim();
      const targetBranch = targetBranchInput.trim();
      const title = titleInput.trim();
      if (p?.description !== undefined && typeof p.description !== "string") return { ok: false, error: "invalid description" };
      if (p?.draft !== undefined && typeof p.draft !== "boolean") return { ok: false, error: "invalid draft" };
      const labelsBad = labelsError(p?.labels, "labels");
      if (labelsBad) return { ok: false, error: labelsBad };
      if (p?.squash !== undefined && typeof p.squash !== "boolean") return { ok: false, error: "invalid squash" };
      if (sourceBranch === targetBranch) return { ok: false, error: "sourceBranch and targetBranch are the same" };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;
      const labels = p && Array.isArray(p.labels) && p.labels.length > 0 ? trimmedLabels(p.labels) : undefined;
      const squash = p && typeof p.squash === "boolean" ? p.squash : undefined;

      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(repoName);
        const { provider, projectPath } = c;
        forge = forgeOf(c);
        if (forge === "github" && squash !== undefined) return { ok: false, error: GITHUB_SQUASH_REFUSAL };
        let iid: number;
        let url: string | null;
        let failedSteps: MrCreateFailedStep[] | undefined;
        try {
          const pr: PullRequest = await provider.createPullRequest({
            projectPath, title, sourceBranch, targetBranch,
            draft: p?.draft !== false,
            ...(typeof p?.description === "string" && { description: p.description }),
            ...(labels && { labels }),
          });
          try {
            storeWriteback(repoName, projectPath, pr);
          } catch (err) {
            ctx.log.warn({ err, repo: repoName, iid: pr.iid }, "mr:create write-back failed");
          }
          iid = pr.iid;
          url = pr.webUrl;
        } catch (err) {
          // The MR exists once glance reports writeApplied; ok:false here would
          // invite a second create.
          if (!(err instanceof ReadBackFailedError && err.writeApplied)) throw err;
          iid = err.iid;
          url = null;
          if (err instanceof PartialCreateError) {
            ctx.log.warn({ err, repo: repoName, iid, steps: err.failedSteps.map((s) => s.step) }, "mr:create landed but a follow-up step failed");
            failedSteps = err.failedSteps.map((s) => ({ step: s.step, message: s.message }));
            url = err.pullRequest?.webUrl ?? `${provider.baseURL}/${projectPath}/pull/${iid}`;
            if (err.pullRequest) {
              try {
                storeWriteback(repoName, projectPath, err.pullRequest);
              } catch (writebackErr) {
                ctx.log.warn({ err: writebackErr, repo: repoName, iid }, "mr:create write-back failed");
              }
            }
          } else {
            ctx.log.warn({ err, repo: repoName, iid: err.iid }, "mr:create landed but its read-back failed");
          }
        }
        if (failedSteps) return { ok: true, data: { iid, url, failedSteps } };
        if (squash === undefined) return { ok: true, data: { iid, url } };
        const set = await putMergeRequest(provider, projectPath, iid, { squash }, "mr:create squash");
        if (set.ok) return { ok: true, data: { iid, url, squashApplied: true } };
        ctx.log.warn({ repo: repoName, iid, error: set.error }, "mr:create landed but its squash write failed");
        return { ok: true, data: { iid, url, squashApplied: false, squashError: set.error } };
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:update": async (payload) => {
      const p = payload as { iid?: unknown; title?: unknown; description?: unknown; addLabels?: unknown; removeLabels?: unknown; squash?: unknown } | undefined;
      const iid = p?.iid;
      if (typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0) return { ok: false, error: "missing repoName/iid" };
      if (p?.title !== undefined && (typeof p.title !== "string" || !p.title.trim())) return { ok: false, error: "invalid title" };
      if (p?.description !== undefined && typeof p.description !== "string") return { ok: false, error: "invalid description" };
      const labelsBad = labelsError(p?.addLabels, "addLabels") ?? labelsError(p?.removeLabels, "removeLabels");
      if (labelsBad) return { ok: false, error: labelsBad };
      if (p?.squash !== undefined && typeof p.squash !== "boolean") return { ok: false, error: "invalid squash" };

      const edit: UpdatePullRequestInput = {};
      if (typeof p?.title === "string") edit.title = p.title.trim();
      if (typeof p?.description === "string") edit.description = p.description;
      const put: Record<string, unknown> = {};
      const putFields: string[] = [];
      if (p && Array.isArray(p.addLabels) && p.addLabels.length > 0) { put.add_labels = trimmedLabels(p.addLabels).join(","); putFields.push("addLabels"); }
      if (p && Array.isArray(p.removeLabels) && p.removeLabels.length > 0) { put.remove_labels = trimmedLabels(p.removeLabels).join(","); putFields.push("removeLabels"); }
      if (p && typeof p.squash === "boolean") { put.squash = p.squash; putFields.push("squash"); }
      const editFields = Object.keys(edit);
      if (editFields.length + putFields.length === 0) return { ok: false, error: "nothing to update" };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(repoName);
        const { provider, projectPath } = c;
        forge = forgeOf(c);
        const github = forge === "github";
        if (github && putFields.includes("squash")) return { ok: false, error: GITHUB_SQUASH_REFUSAL };
        const applied: string[] = [];
        let returnedPr: PullRequest | null = null;
        if (editFields.length > 0) {
          try {
            returnedPr = await provider.updatePullRequest(projectPath, iid, edit);
          } catch (err) {
            if (!(err instanceof ReadBackFailedError && err.writeApplied)) {
              const rest = putFields.length > 0 ? `; ${putFields.join("/")} not attempted` : "";
              return { ok: false, error: `${editFields.join("/")} did not land: ${failureText(err, forge)}${rest}` };
            }
            ctx.log.warn({ err, repo: repoName, iid }, "mr:update landed but its read-back failed");
          }
          applied.push(...editFields);
        }
        if (github) {
          const labelWrites: Array<[string, () => Promise<void>]> = [];
          if (p && Array.isArray(p.addLabels) && p.addLabels.length > 0) {
            const labels = trimmedLabels(p.addLabels);
            labelWrites.push(["addLabels", () => provider.addPullRequestLabels(projectPath, iid, labels)]);
          }
          if (p && Array.isArray(p.removeLabels) && p.removeLabels.length > 0) {
            const labels = trimmedLabels(p.removeLabels);
            labelWrites.push(["removeLabels", () => provider.removePullRequestLabels(projectPath, iid, labels)]);
          }
          for (const [field, write] of labelWrites) {
            try {
              await write();
            } catch (err) {
              const landed = applied.length > 0 ? `${applied.join("/")} landed; ` : "";
              const failed = putFields.slice(putFields.indexOf(field)).join("/");
              return { ok: false, error: `${landed}${failed} did not: ${forgeFailure(err, "github")}; retrying with only the failed fields is safe` };
            }
            applied.push(field);
          }
          let pr = returnedPr;
          if (!pr) {
            try {
              pr = await fetchSingle(provider, projectPath, iid, true);
            } catch (err) {
              ctx.log.warn({ err, repo: repoName, iid }, "mr:update read for the pull request URL failed");
            }
          }
          try {
            if (pr) storeWriteback(repoName, projectPath, pr);
          } catch (err) {
            ctx.log.warn({ err, repo: repoName, iid }, "mr:update write-back failed");
          }
          return { ok: true, data: { iid, url: pr?.webUrl ?? `${provider.baseURL}/${projectPath}/pull/${iid}`, applied } };
        }
        if (putFields.length > 0) {
          const res = await putMergeRequest(provider, projectPath, iid, put, "mr:update");
          if (!res.ok) {
            const landed = applied.length > 0 ? `${applied.join("/")} landed; ` : "";
            return { ok: false, error: `${landed}${putFields.join("/")} did not: ${res.error}; retrying with only the failed fields is safe` };
          }
          applied.push(...putFields);
        }
        // Same never-fail contract as mr:action's write-back: the edit is on the forge already.
        try {
          if (returnedPr) {
            storeWriteback(repoName, projectPath, returnedPr);
          } else {
            const pr = await fetchSingle(provider, projectPath, iid);
            if (pr) storeWriteback(repoName, projectPath, pr);
          }
        } catch (err) {
          ctx.log.warn({ err, repo: repoName, iid }, "mr:update write-back failed");
        }
        return { ok: true, data: { iid, url: `${provider.baseURL}/${projectPath}/-/merge_requests/${iid}`, applied } };
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:fetch-job-detail": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; jobId?: number; pipelineId?: number } | undefined;
      const iid        = p?.iid;
      const jobId      = p?.jobId;
      const pipelineId = p?.pipelineId;

      if (typeof iid !== "number" || typeof jobId !== "number") {
        return { ok: false, error: "missing repoName/iid/jobId" };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(repoName);
        forge = forgeOf(c);
        const detail = await c.provider.fetchJobDetail(c.projectPath, jobId, pipelineId);
        return { ok: true, data: detail };
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:fetch-job-trace": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; jobId?: number } | undefined;
      const iid      = p?.iid;
      const jobId    = p?.jobId;

      if (typeof iid !== "number" || typeof jobId !== "number") {
        return { ok: false, error: "missing repoName/iid/jobId" };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;

      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(repoName);
        forge = forgeOf(c);
        const trace = await c.provider.fetchJobTrace(c.projectPath, jobId);
        return { ok: true, data: trace };
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:commit-parents": async (payload) => {
      const p = payload as { iid?: number; sha?: string } | undefined;
      if (typeof p?.iid !== "number" || typeof p.sha !== "string") {
        return { ok: false, error: "missing repoName/iid/sha" };
      }
      if (!/^[0-9a-f]{7,40}$/i.test(p.sha)) return { ok: false, error: '"sha" must be 7 to 40 hex characters' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        forge = forgeOf(c);
        return { ok: true, data: await c.provider.fetchCommitParents(c.projectPath, p.sha) };
      } catch (err) {
        return { ok: false, error: forgeFailure(err, forge) };
      }
    },

    "mr:pipeline-failed-jobs": async (payload) => {
      const p = payload as { iid?: number; pipelineId?: number } | undefined;
      if (typeof p?.iid !== "number" || typeof p.pipelineId !== "number") {
        return { ok: false, error: "missing repoName/iid/pipelineId" };
      }
      if (!(Number.isInteger(p.pipelineId) && p.pipelineId > 0)) return { ok: false, error: '"pipelineId" must be a positive integer' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        forge = forgeOf(c);
        return { ok: true, data: await c.provider.fetchPipelineFailedJobs(c.projectPath, p.pipelineId) };
      } catch (err) {
        return { ok: false, error: forgeFailure(err, forge) };
      }
    },

    "mr:by-target": async (payload) => {
      const p = payload as { targetBranch?: unknown; state?: unknown } | undefined;
      if (typeof p?.targetBranch !== "string" || !p.targetBranch.trim()) return { ok: false, error: "missing repoName/targetBranch" };
      const state = p.state ?? "opened";
      if (!MR_LIST_STATES.includes(state as MrListState)) return { ok: false, error: `"state" must be one of ${MR_LIST_STATES.join(", ")}` };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const c = await contextFor(decoded.repo);
        const listed = await listMrsByTarget(c.provider, c.projectPath, p.targetBranch.trim(), state as MrListState, forgeOf(c));
        return listed.ok ? { ok: true, data: { mrs: listed.mrs } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:get": async (payload) => {
      const p = payload as { iid?: unknown; refresh?: unknown } | undefined;
      if (typeof p?.iid !== "number") return { ok: false, error: "missing repoName/iid" };
      if (!(Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        const { provider, projectPath } = c;
        forge = forgeOf(c);
        const github = forge === "github";
        let warning: FillWarning | undefined;
        const mr = github
          ? await fetchSingle(provider, projectPath, p.iid, true, (w) => { warning = w; })
          : await fetchSingle(provider, projectPath, p.iid, false);
        if (mr && p.refresh === true) storeWriteback(decoded.repo, projectPath, mr);
        if (mr) return { ok: true, data: { mr, fetchedAt: Date.now() } };
        if (github) {
          const miss = `GitHub has no pull request #${p.iid} in ${projectPath}, or the token cannot read it`;
          if (!warning) return { ok: false, error: miss };
          const reason = `${warning.status ?? ""} ${warning.message}`.trim().slice(0, GITHUB_REASON_MAX_CHARS);
          return { ok: false, error: `${miss} (GitHub said: ${reason})` };
        }
        return { ok: false, error: await missingMrReason(provider, projectPath, p.iid) };
      } catch (err) {
        return { ok: false, error: failureText(err, forge) };
      }
    },

    "mr:merge-queue-status": async (payload) => {
      const p = payload as { iid?: unknown } | undefined;
      if (typeof p?.iid !== "number") return { ok: false, error: "missing repoName/iid" };
      if (!(Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        forge = forgeOf(c);
        if (!c.provider.capabilities?.canEnqueue) return { ok: false, error: NO_MERGE_QUEUE };
        return { ok: true, data: await c.provider.fetchMergeQueueStatus(c.projectPath, p.iid) };
      } catch (err) {
        return { ok: false, error: forgeFailure(err, forge) };
      }
    },

    "mr:enqueue": async (payload) => {
      const p = payload as { iid?: unknown; expectedHeadSha?: unknown } | undefined;
      if (typeof p?.iid !== "number") return { ok: false, error: "missing repoName/iid" };
      if (!(Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      if (p.expectedHeadSha !== undefined && typeof p.expectedHeadSha !== "string") return { ok: false, error: '"expectedHeadSha" must be a string' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        forge = forgeOf(c);
        if (!c.provider.capabilities?.canEnqueue) return { ok: false, error: NO_MERGE_QUEUE };
        const entry = await c.provider.enqueuePullRequest(c.projectPath, p.iid, p.expectedHeadSha === undefined ? {} : { expectedHeadSha: p.expectedHeadSha });
        return { ok: true, data: { position: entry.position, state: entry.state } };
      } catch (err) {
        return { ok: false, error: forgeFailure(err, forge) };
      }
    },

    "mr:list-live": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      for (const name of ["author", "sourceBranch", "targetBranch", "search"] as const) {
        if (p[name] !== undefined && typeof p[name] !== "string") return { ok: false, error: `"${name}" must be a string` };
      }
      const state = p.state ?? "opened";
      if (!MR_LIST_STATES.includes(state as MrListState)) return { ok: false, error: `"state" must be one of ${MR_LIST_STATES.join(", ")}` };
      if (p.limit !== undefined && !(typeof p.limit === "number" && Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= LIST_MAX_LIMIT)) {
        return { ok: false, error: `"limit" must be an integer from 1 to ${LIST_MAX_LIMIT}` };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const c = await contextFor(decoded.repo);
        const text = (name: string) => (typeof p[name] === "string" && (p[name] as string).trim() ? (p[name] as string).trim() : undefined);
        const listed = await listMrsLive(c.provider, c.projectPath, {
          author: text("author"), sourceBranch: text("sourceBranch"), targetBranch: text("targetBranch"), search: text("search"),
          state: state as MrListState, limit: p.limit as number | undefined,
        }, forgeOf(c));
        return listed.ok ? { ok: true, data: { mrs: listed.mrs, truncated: listed.truncated } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:live-by-branch": async (payload) => {
      const p = payload as { branches?: unknown } | undefined;
      const branches = p?.branches;
      if (!Array.isArray(branches) || branches.length === 0 || branches.some((b) => typeof b !== "string" || !b.trim())) {
        return { ok: false, error: '"branches" must name at least one branch' };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      let forge: Forge = "gitlab";
      try {
        const c = await contextFor(decoded.repo);
        const { provider, projectPath } = c;
        forge = forgeOf(c);
        if (forge === "github") return await liveByBranchOnGitHub(provider, projectPath, branches as string[]);
        const byBranch: Record<string, PullRequest | null> = {};
        for (const branch of branches as string[]) {
          const listed = await listMrsLive(provider, projectPath, { sourceBranch: branch.trim(), state: "opened", limit: 1 });
          if (!listed.ok) return { ok: false, error: listed.error };
          const hit = listed.mrs[0];
          if (!hit) {
            byBranch[branch] = null;
            continue;
          }
          const mr = await fetchSingle(provider, projectPath, hit.iid);
          if (!mr) return { ok: false, error: await missingMrReason(provider, projectPath, hit.iid) };
          byBranch[branch] = mr;
        }
        return { ok: true, data: { byBranch } };
      } catch (err) {
        return { ok: false, error: forgeFailure(err, forge) };
      }
    },

    "project:labels": async (payload) => {
      const p = payload as { search?: unknown } | undefined;
      if (p?.search !== undefined && typeof p.search !== "string") return { ok: false, error: '"search" must be a string' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const c = await contextFor(decoded.repo);
        const listed = await listLabels(c.provider, c.projectPath, p?.search?.trim() || undefined, forgeOf(c));
        return listed.ok ? { ok: true, data: { labels: listed.labels } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "pipeline:list": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      for (const name of ["ref", "sha"] as const) {
        if (p[name] !== undefined && typeof p[name] !== "string") return { ok: false, error: `"${name}" must be a string` };
      }
      if (p.iid !== undefined && !(typeof p.iid === "number" && Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      if (p.limit !== undefined && !(typeof p.limit === "number" && Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= PIPELINE_MAX_LIMIT)) {
        return { ok: false, error: `"limit" must be an integer from 1 to ${PIPELINE_MAX_LIMIT}` };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const c = await contextFor(decoded.repo);
        const listed = await listPipelines(c.provider, c.projectPath, {
          ref: p.ref as string | undefined, sha: p.sha as string | undefined, iid: p.iid as number | undefined, limit: p.limit as number | undefined,
        }, forgeOf(c));
        return listed.ok ? { ok: true, data: { pipelines: listed.pipelines } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "forge:get": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (p.query !== undefined && (typeof p.query !== "object" || p.query === null || Array.isArray(p.query))) return { ok: false, error: '"query" must be an object' };
      for (const [k, v] of Object.entries((p.query ?? {}) as Record<string, unknown>)) {
        if (!["string", "number", "boolean"].includes(typeof v)) return { ok: false, error: `"query.${k}" must be a string, number or boolean` };
      }
      for (const name of ["page", "perPage"] as const) {
        const v = p[name];
        if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 1 && (name === "page" || v <= 100))) {
          return { ok: false, error: name === "page" ? '"page" must be a positive integer' : '"perPage" must be an integer from 1 to 100' };
        }
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const c = await contextFor(decoded.repo);
        return await forgeGet(c.provider, c.projectPath, {
          path: p.path, query: p.query as Record<string, string | number | boolean> | undefined, page: p.page as number | undefined, perPage: p.perPage as number | undefined,
        }, forgeOf(c));
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "forge:file-diff": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (!(typeof p.iid === "number" && Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      if (typeof p.path !== "string" || p.path === "") return { ok: false, error: '"path" must be a non-empty string' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        return await readFileDiff(decoded.repo, await fileDiffContext(decoded.repo), p.iid, p.path);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
