/**
 * Discussion IPC handlers: thread/note reads and mutations for the MR
 * status sub-view. Like `mr:action`, every call routes through the daemon so
 * it owns the single authoritative provider per repo, GitLab or GitHub.
 *
 *   discussions:read     - return cached discussions, lazy-fetch on miss/stale
 *   discussions:refresh  - force re-fetch from the forge
 *   discussions:resolve  - toggle resolved state on a thread
 *   discussions:reply    - post a note into an existing thread
 *   discussions:diffs    - read the MR's file diffs
 *   mr:comment-inline    - post a new positioned (line-anchored) discussion
 *   mr:comment           - post a new top-level note (resolvable discussion or plain note)
 *   mr:note-update       - replace the body of an existing note
 *   mr:review-submit     - post one whole review with its comments, replies, approval and resolves
 *
 * All handlers take `{ repoName, iid }` and look up the cache entry whose
 * `mr.iid` matches. Writes go through `refreshDiscussions` in
 * `discussions-store.ts`, which also emits new-comment notifications.
 *
 * `repoName` is opaque here: it flows straight into `grants()`, the
 * discussions table, and `getRepoContext`. It becomes the serialized repo
 * identity once every caller sends one; this module makes no assumption
 * about its shape.
 */

import {
  EmptyDiscussionError,
  type CommentAnchor,
  type GitHubProvider,
  type GitLabProvider,
  type GitProvider,
  type InlineCommentResult,
  type NoteRef,
  type ReviewComment,
} from "@mattstack/glance";
import { decodeRepo } from "../identity-decoder.ts";
import { getRepoContext, getSelfUsername } from "../freshness.ts";
import { anchorComments, parseReviewSubmit } from "../review-submit.ts";
import { refreshDiscussions, type BroadcastFn, type RefreshResult } from "../discussions-store.ts";
import { getDiscussionsFileStore } from "../discussions-file-store.ts";
import { grants, loadRepoTracking } from "../../repo-tracking.ts";
import { lazyChildLogger } from "../../daemon-logger.ts";
import { checkAnchor } from "../diff-line-kind.ts";
import type { HandlerContext, HandlerMap, CommandResult } from "./types.ts";
import type { Commands, Discussion, ReviewSubmitComment } from "../../../packages/rt-client/src/commands.ts";

const log = lazyChildLogger("discussions");

/** What the thread handlers use of a forge provider; test seam. */
export type ThreadProvider = { baseURL: string }
  & Pick<GitProvider, "createComment" | "createInlineComment" | "replyToDiscussion" | "updateComment"
    | "deleteComment" | "submitReview" | "resolveDiscussion" | "unresolveDiscussion">
  & Partial<Pick<GitProvider, "fetchSingleMR">>
  & Partial<Pick<GitHubProvider, "fetchPullRequestDiffs">>
  & Partial<Pick<GitLabProvider, "restRequest" | "fetchReviewerStates">>;

/** A missing `forge` reads as GitLab. */
export interface ThreadContext {
  forge?: "gitlab" | "github";
  provider: ThreadProvider;
  projectPath: string;
  projectId?: number | null;
}

/**
 * Injectable plumbing for the thread handlers. Every field defaults to the
 * real daemon plumbing; tests override only what a case needs.
 */
export interface DiscussionHandlerSeams {
  repoContext?: (repoName: string, repoPath?: string) => Promise<ThreadContext>;
  diffs?: (
    ctx: ThreadContext, iid: number,
    opts: { reqSignal?: AbortSignal; timeoutMs?: number },
  ) => Promise<{ diffs: MrDiffRow[]; truncated: boolean }>;
  warn?: (obj: object, msg: string) => void;
  refresh?: (repoName: string, iid: number) => Promise<Pick<RefreshResult, "discussions" | "fetchedAt"> | undefined>;
  readCached?: (repoName: string, iid: number) => { discussions: Discussion[]; fetchedAt: number } | undefined;
  selfUsername?: () => string | null;
}

const ANCHOR_HINT = " (an unchanged line needs both line and oldLine; a removed line needs oldLine)";

function withAnchorHint(err: unknown): string {
  const text = String(err);
  return text.includes("line_code") ? text + ANCHOR_HINT : text;
}

/** Discussions are stable per push; 2min TTL keeps reads fast without going stale. */
const DISCUSSIONS_TTL_MS = 2 * 60 * 1000;

/** GitLab's page size for this endpoint; a full page means there may be more. */
const DIFFS_PAGE_SIZE = 100;
const DIFFS_FETCH_TIMEOUT_MS = 30_000;
/** The anchor read plus the post must fit inside the MCP client's 30s write budget. */
const ANCHOR_DIFFS_TIMEOUT_MS = 8_000;
const REVIEW_DIFFS_TIMEOUT_MS = 15_000;

export interface MrDiffRow {
  newPath: string;
  oldPath?: string;
  diff: string;
  collapsed?: boolean;
  tooLarge?: boolean;
}

/**
 * Every other outbound read in the daemon carries a bound (linear.ts,
 * notifier.ts, park.ts); this one once had none, so a stalled connection
 * left the promise pending indefinitely. `reqSignal` is the client's own
 * request signal (handlers/types.ts's Handler(payload, signal?)) so a client
 * giving up actually cancels the in-flight request instead of orphaning it.
 * `truncated` reports a full page rather than silently dropping files past it.
 */
export async function fetchMrDiffs(
  ctx: ThreadContext,
  iid: number,
  opts: { reqSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ diffs: MrDiffRow[]; truncated: boolean }> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DIFFS_FETCH_TIMEOUT_MS);
  const signal = opts.reqSignal ? AbortSignal.any([timeout, opts.reqSignal]) : timeout;
  const { provider, projectPath } = ctx;
  if (ctx.forge === "github") {
    if (!provider.fetchPullRequestDiffs) throw new Error("fetchMrDiffs: the GitHub provider cannot read pull request files");
    return provider.fetchPullRequestDiffs(projectPath, iid, { signal });
  }
  if (!provider.restRequest) throw new Error("fetchMrDiffs: the GitLab provider cannot make REST requests");
  const path = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}/diffs?per_page=${DIFFS_PAGE_SIZE}`;
  const res = await provider.restRequest("GET", path, undefined, "fetchMrDiffs", { signal });
  if (!res.ok) throw new Error(`GitLab diffs API: ${res.status}`);
  const raw = (await res.json()) as Array<{ new_path: string; old_path?: string; diff: string; collapsed?: boolean; too_large?: boolean }>;
  return {
    diffs: raw.map((d) => ({ newPath: d.new_path, oldPath: d.old_path, diff: d.diff, collapsed: d.collapsed, tooLarge: d.too_large })),
    truncated: raw.length >= DIFFS_PAGE_SIZE,
  };
}

function mrWebUrl(ctx: ThreadContext, iid: number): string {
  const base = `${ctx.provider.baseURL}/${ctx.projectPath}`;
  return ctx.forge === "github" ? `${base}/pull/${iid}` : `${base}/-/merge_requests/${iid}`;
}

/** GitLab answers a non-GET on a moved project's old path with 404, so its writes go by numeric id. */
function writeRef(ctx: ThreadContext): string {
  return ctx.forge !== "github" && ctx.projectId != null ? String(ctx.projectId) : ctx.projectPath;
}

/** Reads by project path, never `writeRef`: GitLab's fetchSingleMR queries GraphQL by full path and finds no MR for a numeric id. */
async function readHeadSha(ctx: ThreadContext, iid: number): Promise<{ ok: true; sha: string } | { ok: false; reason: string }> {
  const { fetchSingleMR } = ctx.provider;
  if (!fetchSingleMR) return { ok: false, reason: "the provider cannot read the MR" };
  try {
    const mr = await fetchSingleMR.call(ctx.provider, ctx.projectPath, iid, null);
    if (!mr) return { ok: false, reason: "no MR" };
    return mr.sha ? { ok: true, sha: mr.sha } : { ok: false, reason: "no head sha" };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

const GITHUB_THREAD_KINDS: Array<[prefix: string, kind: NonNullable<NoteRef["kind"]>]> = [
  ["gh-review-thread-", "diff"],
  ["gh-issue-comment-", "general"],
  ["gh-review-", "review"],
];

/**
 * The kinds of every cached thread holding the note. More than one means the
 * id names comments in separate GitHub id spaces, and a kind-less edit would
 * patch whichever the forge probe finds first.
 */
function githubNoteKinds(discussions: Discussion[], noteId: number): Set<NoteRef["kind"]> {
  const kinds = new Set<NoteRef["kind"]>();
  for (const d of discussions) {
    if (!d.notes.some((n) => n.id === noteId)) continue;
    kinds.add(GITHUB_THREAD_KINDS.find(([prefix]) => d.id.startsWith(prefix))?.[1]);
  }
  return kinds;
}

/**
 * GitHub takes one side per comment: a caller's old line goes LEFT, anything
 * else goes RIGHT, so an old line the diff filled in never reaches it.
 */
function githubReviewComment(c: ReviewSubmitComment): ReviewComment {
  const side = c.oldLine !== undefined ? { oldLine: c.oldLine } : { line: c.line };
  return { body: c.body, path: c.path, ...side, ...(c.oldPath !== undefined ? { oldPath: c.oldPath } : {}) };
}

export function createDiscussionHandlers(
  ctx: Pick<HandlerContext, "cache" | "repoIndex">,
  broadcast: BroadcastFn,
  seams: DiscussionHandlerSeams = {},
): { "discussions:read": (payload: unknown) => Promise<{ ok: true; data: Commands["discussions:read"]["data"] } | { ok: false; error: string }> }
  & { "discussions:refresh": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:refresh">> }
  & { "discussions:resolve": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:resolve">> }
  & { "discussions:diffs": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:diffs">> }
  & { "discussions:reply": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"discussions:reply">> }
  & { "mr:comment-inline": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:comment-inline">> }
  & { "mr:comment": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:comment">> }
  & { "mr:note-update": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:note-update">> }
  & { "mr:review-submit": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:review-submit">> }
  & HandlerMap {
  const deps = { ctx, broadcast };
  const repoContextFn = seams.repoContext ?? ((repoName: string, repoPath?: string): Promise<ThreadContext> => getRepoContext(repoName, repoPath));
  const diffsFn = seams.diffs ?? fetchMrDiffs;
  const warnFn = seams.warn ?? ((obj: object, msg: string) => log.warn(obj, msg));
  const refreshFn = seams.refresh ?? ((repoName: string, iid: number) => refreshDiscussions(deps, repoName, iid));
  const readCachedFn = seams.readCached ?? ((repoName: string, iid: number) => getDiscussionsFileStore().read(repoName, iid));
  const selfUsernameFn = seams.selfUsername ?? getSelfUsername;

  return {
    // `force` is a legacy daemon-client-only escape hatch (lib/daemon-client.ts),
    // not part of the typed rt-client catalog -- extended onto the base
    // payload type rather than added to Commands so the public contract
    // stays what rt-client actually sends.
    "discussions:read": async (
      rawPayload: unknown,
    ): Promise<{ ok: true; data: Commands["discussions:read"]["data"] } | { ok: false; error: string }> => {
      const payload = rawPayload as (Commands["discussions:read"]["payload"] & { force?: boolean }) | undefined;
      const iid   = payload?.iid;
      const force = payload?.force === true;
      if (!payload?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      // Hard cutover: the discussions table is identity-keyed now;
      // a bare legacy name resolves nothing rather than reading a row that
      // no longer exists under that key.
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: true, data: { discussions: [], fetchedAt: 0, stale: true } };
      }
      const repoName = decoded.repo;

      const granted = grants(loadRepoTracking(), repoName).caches.has("discussions");
      const cached = getDiscussionsFileStore().read(repoName, iid);

      // Granted repos: events + sweep own freshness, a hit never refetches.
      // Ungranted repos: the 2-min TTL keeps on-demand reads honest.
      const fresh = !force && cached !== undefined &&
        (granted || Date.now() - cached.fetchedAt < DISCUSSIONS_TTL_MS);

      if (fresh) {
        return { ok: true, data: { discussions: cached.discussions, fetchedAt: cached.fetchedAt, stale: false } };
      }
      try {
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt, stale: false } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:refresh": async (payload) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;
      try {
        const res = await refreshDiscussions(deps, repoName, iid);
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:resolve": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; discussionId?: string; resolved?: boolean } | undefined;
      const iid          = p?.iid;
      const discussionId = p?.discussionId;
      const resolved     = p?.resolved !== false; // default: mark resolved

      if (!p?.repoName || typeof iid !== "number" || !discussionId) {
        return { ok: false, error: "missing repoName/iid/discussionId" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        if (resolved) {
          await repoCtx.provider.resolveDiscussion(repoCtx.projectPath, iid, discussionId);
        } else {
          await repoCtx.provider.unresolveDiscussion(repoCtx.projectPath, iid, discussionId);
        }
        const res = await refreshFn(repoName, iid);
        if (!res) return { ok: false, error: "discussions refresh returned nothing" };
        return { ok: true, data: { discussions: res.discussions, fetchedAt: res.fetchedAt } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:diffs": async (payload, signal) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number") {
        return { ok: false, error: "missing repoName/iid" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const { diffs, truncated } = await diffsFn(repoCtx, iid, { reqSignal: signal });
        return { ok: true, data: { diffs, truncated } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "discussions:reply": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; discussionId?: string; body?: string } | undefined;
      const iid          = p?.iid;
      const discussionId = p?.discussionId;
      const body         = p?.body;

      if (!p?.repoName || typeof iid !== "number" || !discussionId || typeof body !== "string" || !body.trim()) {
        return { ok: false, error: "missing repoName/iid/discussionId/body" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const created = await repoCtx.provider.replyToDiscussion(writeRef(repoCtx), iid, discussionId, body);
        // A refresh failure must never turn a landed reply into ok:false: the
        // caller would retry and post it twice.
        const refreshed = await refreshFn(repoName, iid).catch((err) => {
          log.warn({ err, repoName, iid }, "discussions:reply: post-reply discussions refresh failed");
          return undefined;
        }) as { discussions?: Discussion[]; fetchedAt?: number } | undefined;
        if (refreshed?.discussions) {
          return { ok: true, data: { discussions: refreshed.discussions, fetchedAt: refreshed.fetchedAt ?? Date.now(), noteId: created.noteId } };
        }
        let cached: { discussions: Discussion[]; fetchedAt: number } | undefined;
        try {
          cached = readCachedFn(repoName, iid);
        } catch (err) {
          log.warn({ err, repoName, iid }, "discussions:reply: cached discussions unreadable after a failed refresh");
        }
        return { ok: true, data: { discussions: cached?.discussions ?? [], fetchedAt: cached?.fetchedAt ?? 0, noteId: created.noteId } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:comment-inline": async (payload, signal) => {
      const p = payload as {
        repoName?: string; iid?: number; body?: string; path?: string; line?: number;
        oldPath?: string; oldLine?: number;
      } | undefined;
      const iid  = p?.iid;
      const body = p?.body;
      const path = p?.path;
      const line = p?.line;

      if (!p?.repoName || typeof iid !== "number" || typeof body !== "string" || !body.trim() ||
          typeof path !== "string" || !path ||
          typeof line !== "number" || !Number.isInteger(line) || line <= 0) {
        return { ok: false, error: "missing repoName/iid/body/path/line" };
      }
      const oldLineOk = p?.oldLine === undefined || (Number.isInteger(p.oldLine) && p.oldLine > 0);
      const oldPathOk = p?.oldPath === undefined || (typeof p.oldPath === "string" && p.oldPath.length > 0);
      if (!oldLineOk || !oldPathOk) {
        return { ok: false, error: "invalid oldPath/oldLine" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;
      const position = { path, line, oldPath: p?.oldPath, oldLine: p?.oldLine };
      const callerOldLine = p?.oldLine;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const forgeName = repoCtx.forge === "github" ? "GitHub" : "GitLab";

        if (position.oldLine === undefined) {
          let page: Awaited<ReturnType<typeof diffsFn>> | undefined;
          try {
            page = await diffsFn(repoCtx, iid, {
              reqSignal: signal,
              timeoutMs: ANCHOR_DIFFS_TIMEOUT_MS,
            });
          } catch (err) {
            if (signal?.aborted) return { ok: false, error: "request aborted before the comment was posted" };
            warnFn({ err, repoName, iid }, "mr:comment-inline: diff read failed, posting the anchor unverified");
          }
          if (page) {
            const anchor = checkAnchor(page, path, line);
            const refusal = `line ${line} of ${path} is not in this MR's diff, so ${forgeName} cannot anchor a comment there`;
            if (anchor.kind === "no-file") return { ok: false, error: `${refusal}; this file has no diff in this MR` };
            if (anchor.kind === "outside") {
              const hint = anchor.nearest.length > 0
                ? `; lines in the diff near it: ${anchor.nearest.join(", ")}`
                : "; the file has no new-side lines, so pass oldLine to comment on a removed line";
              return { ok: false, error: refusal + hint };
            }
            if (anchor.oldPath && position.oldPath === undefined) position.oldPath = anchor.oldPath;
            if (anchor.oldLine !== undefined) position.oldLine = anchor.oldLine;
          }
        }

        // GitHub takes one side: a caller's old line goes LEFT, anything else
        // goes RIGHT, so an old line the diff filled in is dropped there.
        const github = repoCtx.forge === "github";
        const commentAnchor: CommentAnchor = github && callerOldLine !== undefined
          ? { path, oldLine: callerOldLine }
          : { path, line };
        if (position.oldPath !== undefined) commentAnchor.oldPath = position.oldPath;
        if (!github && position.oldLine !== undefined) commentAnchor.oldLine = position.oldLine;

        const postOnce = () => repoCtx.provider.createInlineComment(writeRef(repoCtx), iid, body, commentAnchor);

        // Awaited (not fire-and-forget): a caller reading discussions right
        // after this resolves must see its own just-posted comment. A refresh
        // throw is swallowed here so it can never turn a verified post into
        // ok:false, which would make a caller retry and duplicate the comment.
        const succeed = async (discussionId: string, noteId: number): Promise<CommandResult<"mr:comment-inline">> => {
          await refreshFn(repoName, iid).catch((err) =>
            log.warn({ err, repoName, iid }, "mr:comment-inline: post-comment discussions refresh failed"));
          return { ok: true, data: { discussionId, noteId, verified: true } };
        };

        if (signal?.aborted) return { ok: false, error: "request aborted before the comment was posted" };
        let first: InlineCommentResult;
        try {
          first = await postOnce();
        } catch (err) {
          if (err instanceof EmptyDiscussionError) return { ok: false, error: "GitLab created a discussion with no notes" };
          throw err;
        }

        if (github || first.anchored) {
          return succeed(first.discussionId, first.noteId);
        }

        // The first note landed as a general note (GitLab silently dropped the
        // position). It must be deleted before the retry: leaving it would
        // strand a duplicate, unpositioned copy of the comment on the MR.
        try {
          await repoCtx.provider.deleteComment(writeRef(repoCtx), iid, { id: first.noteId });
        } catch (err) {
          return { ok: false, error: `could not delete stray note ${first.noteId}: ${String(err)}` };
        }

        let second: InlineCommentResult;
        try {
          second = await postOnce();
        } catch (err) {
          if (err instanceof EmptyDiscussionError) return { ok: false, error: "GitLab created a retry discussion with no notes" };
          return {
            ok: false,
            error: `first attempt degraded (note ${first.noteId} type ${first.noteType}, deleted); `
              + `retry failed: ${withAnchorHint(err)}`,
          };
        }

        if (second.anchored) {
          return succeed(second.discussionId, second.noteId);
        }

        try {
          await repoCtx.provider.deleteComment(writeRef(repoCtx), iid, { id: second.noteId });
        } catch (err) {
          return { ok: false, error: `could not delete stray note ${second.noteId}: ${String(err)}` };
        }

        return {
          ok: false,
          error: `GitLab dropped the position twice (note ${first.noteId} type ${first.noteType}, `
            + `note ${second.noteId} type ${second.noteType}); both general notes were deleted`,
        };
      } catch (err) {
        return { ok: false, error: withAnchorHint(err) };
      }
    },

    "mr:comment": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; body?: string; resolvable?: unknown } | undefined;
      const iid  = p?.iid;
      const body = p?.body;
      if (!p?.repoName || typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0 ||
          typeof body !== "string" || !body.trim()) {
        return { ok: false, error: "missing repoName/iid/body" };
      }
      if (p.resolvable !== undefined && typeof p.resolvable !== "boolean") {
        return { ok: false, error: "invalid resolvable" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const created = await repoCtx.provider.createComment(writeRef(repoCtx), iid, body, { resolvable: p.resolvable !== false });

        // A refresh failure must never turn a landed note into ok:false: the
        // caller would retry and post it twice.
        await refreshFn(repoName, iid).catch((err) =>
          log.warn({ err, repoName, iid }, "mr:comment: post-comment discussions refresh failed"));

        const { noteId, discussionId, resolvable } = created;
        const mrUrl = mrWebUrl(repoCtx, iid);
        const url = repoCtx.forge === "github" ? created.url : `${mrUrl}#note_${noteId}`;
        return { ok: true, data: { noteId, discussionId, resolvable, url, mrUrl } };
      } catch (err) {
        if (err instanceof EmptyDiscussionError) {
          return { ok: false, error: `GitLab created discussion ${err.discussionId} with no notes` };
        }
        return { ok: false, error: String(err) };
      }
    },

    "mr:note-update": async (payload) => {
      const p = payload as { repoName?: string; iid?: number; noteId?: number; body?: string } | undefined;
      const iid = p?.iid;
      const noteId = p?.noteId;
      const body = p?.body;
      if (!p?.repoName || typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0 ||
          typeof noteId !== "number" || !Number.isInteger(noteId) || noteId <= 0 ||
          typeof body !== "string" || !body.trim()) {
        return { ok: false, error: "missing repoName/iid/noteId/body" };
      }
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const note: NoteRef = { id: noteId };
        if (repoCtx.forge === "github") {
          let cached: { discussions: Discussion[] } | undefined;
          try {
            cached = readCachedFn(repoName, iid);
          } catch (err) {
            warnFn({ err, repoName, iid }, "mr:note-update: cached discussions unreadable, editing with no note kind");
          }
          const kinds = githubNoteKinds(cached?.discussions ?? [], noteId);
          if (kinds.size > 1) {
            return { ok: false, error: `note ${noteId} matches more than one comment on this pull request; edit it on GitHub` };
          }
          const [kind] = kinds;
          if (kind) note.kind = kind;
        }
        await repoCtx.provider.updateComment(writeRef(repoCtx), iid, note, body);

        await refreshFn(repoName, iid).catch((err) =>
          log.warn({ err, repoName, iid }, "mr:note-update: post-edit discussions refresh failed"));
        return { ok: true, data: { noteId } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:review-submit": async (payload, signal) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0) {
        return { ok: false, error: "missing repoName/iid" };
      }
      const parsed = parseReviewSubmit(payload);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const mrUrl = mrWebUrl(repoCtx, iid);

        let input = parsed.input;
        if (input.comments.some((c) => c.oldLine === undefined)) {
          let page: Awaited<ReturnType<typeof diffsFn>> | undefined;
          try {
            page = await diffsFn(repoCtx, iid, {
              reqSignal: signal,
              timeoutMs: REVIEW_DIFFS_TIMEOUT_MS,
            });
          } catch (err) {
            if (signal?.aborted) return { ok: false, error: "request aborted before the review was posted" };
            warnFn({ err, repoName, iid }, "mr:review-submit: diff read failed, posting the anchors unverified");
          }
          if (page) {
            const anchored = anchorComments(page, input.comments);
            if (anchored.badAnchors.length > 0) {
              return { ok: true, data: { published: false, reason: "bad-anchors", badAnchors: anchored.badAnchors, mrUrl } };
            }
            input = { ...input, comments: anchored.comments };
          }
        }

        const { expectedHeadSha, ...review } = input;
        if (expectedHeadSha !== undefined) {
          const head = await readHeadSha(repoCtx, iid);
          if (signal?.aborted) return { ok: false, error: "request aborted before the review was posted" };
          if (!head.ok) return { ok: false, error: `could not read the MR's head to check expectedHeadSha; nothing was posted (${head.reason})` };
          if (head.sha.toLowerCase() !== expectedHeadSha.toLowerCase()) {
            return { ok: true, data: { published: false, reason: "head-moved", expectedHeadSha, headSha: head.sha, mrUrl } };
          }
        }

        const github = repoCtx.forge === "github";
        const comments: ReviewComment[] = github ? parsed.input.comments.map(githubReviewComment) : review.comments;
        const outcome = await repoCtx.provider.submitReview(writeRef(repoCtx), iid, { ...review, comments });
        if (!outcome.published) return { ok: true, data: { ...outcome, mrUrl } };
        const { reviewId, reviewerState: reviewState, ...published } = outcome;

        // Everything below describes a review that already landed, so none of
        // it may answer ok:false: the caller would submit the review again.
        if (github) {
          await refreshFn(repoName, iid).catch((err) =>
            log.warn({ err, repoName, iid }, "mr:review-submit: post-review discussions refresh failed"));
          return { ok: true, data: { ...published, reviewerState: reviewState, summaryNoteId: reviewId, mrUrl } };
        }

        const self = selfUsernameFn();
        const refreshed = await refreshFn(repoName, iid).catch((err) => {
          log.warn({ err, repoName, iid }, "mr:review-submit: post-review discussions refresh failed");
          return undefined;
        });
        let summaryNoteId: number | null = null;
        for (const d of refreshed?.discussions ?? []) {
          for (const n of d.notes) {
            if (n.body === parsed.input.summary && (!self || n.author?.username === self) && n.id > (summaryNoteId ?? 0)) {
              summaryNoteId = n.id;
            }
          }
        }
        const { provider } = repoCtx;
        const readStates = async () => {
          if (!provider.fetchReviewerStates) throw new Error("the GitLab provider cannot read reviewer states");
          return provider.fetchReviewerStates(writeRef(repoCtx), iid);
        };
        const states = await readStates().catch((err) => {
          log.warn({ err, repoName, iid }, "mr:review-submit: reviewer state read failed");
          return [];
        });
        const reviewerState = self ? states.find((s) => s.username === self)?.state ?? null : null;
        return { ok: true, data: { ...published, reviewerState, summaryNoteId, mrUrl } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
