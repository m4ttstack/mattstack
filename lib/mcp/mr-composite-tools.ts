/**
 * GitLab composite tools: each answers in one call what a skill otherwise
 * strings together from several reads. None of them speaks GitHub; each
 * refuses a github.com identity before any daemon call.
 */
import { readProjectMRs, rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands, Discussion } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { joinMrsToWorktrees, type MrMapRow } from "../mr-map.ts";
import { parseIdentity } from "../settings/identity.ts";
import { statusPorcelainAsync } from "../worktree/git-async.ts";
import { realGitRunner, type GitRunner } from "./git-tools.ts";
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";
import { runToolDefs } from "./run-tools.ts";
import { err, MR_TARGET_PROPS, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef, type ToolResult } from "./shared.ts";
import { realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export interface MrCompositeDeps {
  command: typeof rtCommand;
  readMrCache: typeof readProjectMRs;
  runTool: (name: "run_snapshot" | "run_decision" | "run_field_set", input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<ToolResult>;
  git: GitRunner;
  guard: TreeGuardDeps;
  status: (path: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

let runTools: McpToolDef[] | undefined;

export const realMrCompositeDeps: MrCompositeDeps = {
  command: rtCommand,
  readMrCache: readProjectMRs,
  async runTool(name, input, env) {
    runTools ??= runToolDefs();
    const def = runTools.find((t) => t.name === name);
    if (!def) return err(`${name} is not a run tool`);
    return def.handler(input, env);
  },
  git: realGitRunner,
  guard: realTreeGuardDeps,
  status: statusPorcelainAsync,
  sleep: (ms) => Bun.sleep(ms),
};

const READ_TIMEOUT_MS = 30_000;
const NOTE_BODY_CAP = 2000;

export type ThreadPosted = { discussionId: string; found: boolean; posted: boolean; noteId: number | null; via: "body" | "author" | null };
export type ItemPosted = { id: string; posted: boolean; noteId: number | null; discussionId: string | null };
export type PostedNote = { noteId: number; discussionId: string; createdAt: string; path: string | null; line: number | null; body: string };

type ThreadQuery = { discussionId: string; body?: string };
type ItemQuery = { id: string; body?: string; contains?: string; path?: string; line?: number };
type Note = Discussion["notes"][number];

export function githubRefusal(identity: string, tool: string, ghMove: string): string | null {
  const parsed = parseIdentity(identity);
  if (parsed?.kind === "remote" && parsed.id.toLowerCase().startsWith("github.com/")) return `GitLab only: ${tool} does not speak GitHub; ${ghMove}`;
  return null;
}

const isGithubHost = (host: string) => host === "github.com" || host === "www.github.com";

/** Runs before target resolution, which rejects a github.com mrUrl for its shape before githubRefusal could name the gh move. */
export function refuseGithubTarget(input: { repoName?: unknown; mrUrl?: unknown }, tool: string, ghMove: string): string | null {
  const refusal = `GitLab only: ${tool} does not speak GitHub; ${ghMove}`;
  if (typeof input.mrUrl === "string") {
    try {
      if (isGithubHost(new URL(input.mrUrl.trim()).hostname.toLowerCase())) return refusal;
    } catch {
      // not a URL: resolveMrTarget reports the shape error
    }
  }
  if (typeof input.repoName === "string") {
    const name = input.repoName.trim();
    if (githubRefusal(name, tool, ghMove) || /^(remote:)?github\.com(\/|%2f)/i.test(name)) return refusal;
  }
  return null;
}

export function normalizeBody(s: string): string {
  return s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
}

export async function selfUsername(deps: MrCompositeDeps, identity: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const r = await deps.command<Commands["forge:get"]["data"]>("forge:get", { repoName: identity, path: "user" }, { timeoutMs: READ_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "reading the token's user failed") };
  const username = (r.data.body as { username?: unknown } | null)?.username;
  if (typeof username !== "string" || !username) return { ok: false, error: "GitLab's user read carried no username" };
  return { ok: true, username };
}

export function postedMatch(
  discussions: Discussion[],
  q: { by: string; since: number; threads?: ThreadQuery[]; items?: ItemQuery[] },
): { threads: ThreadPosted[]; items: ItemPosted[]; notes: PostedNote[] } {
  const by = q.by.toLowerCase();
  const isMine = (n: Note) => !n.system && n.author.username.toLowerCase() === by && Date.parse(n.createdAt) >= q.since;

  const threads = (q.threads ?? []).map((t): ThreadPosted => {
    const d = discussions.find((x) => x.id === t.discussionId);
    if (!d) return { discussionId: t.discussionId, found: false, posted: false, noteId: null, via: null };
    const want = t.body === undefined ? undefined : normalizeBody(t.body);
    const byBody = want === undefined ? undefined : d.notes.find((n) => !n.system && normalizeBody(n.body) === want);
    if (byBody) return { discussionId: d.id, found: true, posted: true, noteId: byBody.id, via: "body" };
    const byAuthor = d.notes.find(isMine);
    if (byAuthor) return { discussionId: d.id, found: true, posted: true, noteId: byAuthor.id, via: "author" };
    return { discussionId: d.id, found: true, posted: false, noteId: null, via: null };
  });

  const mine = discussions.flatMap((d) => d.notes.filter(isMine).map((n) => ({ d, n })));

  const items = (q.items ?? []).map((it): ItemPosted => {
    const want = it.body === undefined ? undefined : normalizeBody(it.body);
    const hit = mine.find(({ n }) => {
      const textOk = (want !== undefined && normalizeBody(n.body) === want) || (it.contains !== undefined && n.body.includes(it.contains));
      if (!textOk) return false;
      if (it.path !== undefined && n.position?.newPath !== it.path) return false;
      if (it.line !== undefined && n.position?.newLine !== it.line) return false;
      return true;
    });
    return hit ? { id: it.id, posted: true, noteId: hit.n.id, discussionId: hit.d.id } : { id: it.id, posted: false, noteId: null, discussionId: null };
  });

  const notes = mine.map(({ d, n }): PostedNote => ({
    noteId: n.id, discussionId: d.id, createdAt: n.createdAt,
    path: n.position?.newPath ?? null, line: n.position?.newLine ?? null, body: n.body.slice(0, NOTE_BODY_CAP),
  }));

  return { threads, items, notes };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function parseSince(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && ISO_TIME.test(v.trim())) {
    const t = Date.parse(v.trim());
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkThreads(v: unknown): string | ThreadQuery[] {
  if (!Array.isArray(v)) return '"threads" must be an array of {discussionId, body?}';
  for (const [i, t] of v.entries()) {
    if (!isRecord(t) || typeof t.discussionId !== "string" || !t.discussionId) return `threads[${i}] needs a "discussionId" string`;
    if (t.body !== undefined && typeof t.body !== "string") return `threads[${i}].body must be a string`;
  }
  return v as ThreadQuery[];
}

function checkItems(v: unknown): string | ItemQuery[] {
  if (!Array.isArray(v)) return '"items" must be an array of {id, body?, contains?, path?, line?}';
  for (const [i, it] of v.entries()) {
    if (!isRecord(it) || typeof it.id !== "string" || !it.id) return `items[${i}] needs an "id" string`;
    for (const k of ["body", "contains", "path"] as const) {
      if (it[k] !== undefined && typeof it[k] !== "string") return `items[${i}].${k} must be a string`;
    }
    if (it.line !== undefined && !(typeof it.line === "number" && Number.isInteger(it.line) && it.line > 0)) return `items[${i}].line must be a positive integer`;
    if (it.body === undefined && (it.contains === undefined || it.contains === "")) return `items[${i}] needs "body" or a non-empty "contains" to match on`;
  }
  return v as ItemQuery[];
}

const MR_MAP_LIMIT = 200;
const MR_MAP_GH_MOVE = "gh pr list --author @me and the worktree list";

async function defaultBranchOf(deps: MrCompositeDeps, identity: string): Promise<string | null> {
  const r = await deps.command<Commands["forge:get"]["data"]>("forge:get", { repoName: identity, path: "projects/:id" }, { timeoutMs: READ_TIMEOUT_MS });
  const branch = r.ok ? (r.data?.body as { default_branch?: unknown } | null)?.default_branch : undefined;
  return typeof branch === "string" && branch ? branch : null;
}

async function cachedCiStatus(deps: MrCompositeDeps, identity: string): Promise<Map<number, string | null>> {
  const byIid = new Map<number, string | null>();
  try {
    const r = await deps.readMrCache(identity);
    if (!r.ok || !r.data) return byIid;
    for (const entry of Object.values(r.data.mrs ?? {})) byIid.set(entry.pr.iid, entry.pr.pipeline?.status ?? null);
  } catch {
    // ciStatus is best-effort: a cache miss or error reads null
  }
  return byIid;
}

async function isDirty(deps: MrCompositeDeps, path: string | null): Promise<boolean | null> {
  if (path === null) return null;
  try {
    return (await deps.status(path)).trim() !== "";
  } catch {
    return null;
  }
}

export function mrCompositeToolDefs(deps: MrCompositeDeps = realMrCompositeDeps): McpToolDef[] {
  return [
    {
      name: "mr_posted_since",
      description: `GitLab only. Whether this account (or \`by\`) already posted on the MR: one live thread read, nothing posted, nothing judged beyond the match. \`since\` is epoch milliseconds or an ISO time; a note counts when it is at or after \`since\`. \`by\` defaults to "me", the token's own user. \`threads\` [{discussionId, body?}]: posted when the discussion holds a note whose body equals \`body\` (any author, any time; CRLF and trailing spaces ignored), or a note by \`by\` at or after \`since\`; each row is {discussionId, found, posted, noteId, via: "body" | "author" | null}, found false when GitLab no longer returns the discussion. \`items\` [{id, body?, contains?, path?, line?}]: posted when a note by \`by\` at or after \`since\` has that \`body\` or contains that text, and, when \`path\` or \`line\` is given, sits at that new-side position; each row is {id, posted, noteId, discussionId}. Pass \`threads\`, \`items\` or both. Returns {by, since, threads, items, notes}, where \`notes\` is every non-system note by \`by\` at or after \`since\` (body cut at ${NOTE_BODY_CAP} characters). System notes never match. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          since: { type: ["number", "string"], description: "Epoch milliseconds or an ISO time, e.g. 2026-10-16T10:00:00Z." },
          by: { type: "string", description: 'A GitLab username, or "me" (the default) for the token\'s own user.' },
          threads: {
            type: "array",
            items: { type: "object", properties: { discussionId: { type: "string" }, body: { type: "string" } }, required: ["discussionId"], additionalProperties: false },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, body: { type: "string" }, contains: { type: "string" }, path: { type: "string" }, line: { type: "number" } },
              required: ["id"],
              additionalProperties: false,
            },
          },
        },
        required: ["since"],
        additionalProperties: false,
      },
      shellForms: { none: "a posted-already check has no glab verb; a glab api call hits the glab catch-all on mr_view" },
      async handler(input) {
        const since = parseSince(input.since);
        if (since === null) return err('"since" must be epoch milliseconds or an ISO time like 2026-10-16T10:00:00Z');
        if (input.by !== undefined && (typeof input.by !== "string" || !input.by.trim())) return err('"by" must be a GitLab username or "me"');
        if (input.threads === undefined && input.items === undefined) return err('pass "threads", "items" or both');
        const threads = input.threads === undefined ? [] : checkThreads(input.threads);
        if (typeof threads === "string") return err(threads);
        const items = input.items === undefined ? [] : checkItems(input.items);
        if (typeof items === "string") return err(items);

        const early = refuseGithubTarget(input, "mr_posted_since", "read threads with gh");
        if (early) return err(early);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const refused = githubRefusal(target.identity, "mr_posted_since", "read threads with gh");
        if (refused) return err(refused);

        let by = typeof input.by === "string" ? input.by.trim() : "me";
        if (by.toLowerCase() === "me") {
          const self = await selfUsername(deps, target.identity);
          if (!self.ok) return err(self.error);
          by = self.username;
        }
        const r = await deps.command<Commands["discussions:refresh"]["data"]>("discussions:refresh", { repoName: target.identity, iid: target.iid }, { timeoutMs: READ_TIMEOUT_MS });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "thread read failed"));
        return ok({ by, since, ...postedMatch(r.data.discussions, { by, since, threads, items }) });
      },
    },
    {
      name: "mr_resolve_branch",
      description: `GitLab only. An MR to its branch and the registered trees on it, for checkout: one MR read and one worktree list, nothing provisioned. Works on opened, merged and closed MRs. Returns {iid, state, title, author (username), sourceBranch, targetBranch, webUrl, trees: [{name, path}]}, where trees holds the registered worktrees whose branch equals sourceBranch exactly: usually none or one, more only for a duplicate branch. Call worktree_provision to make a tree when trees is empty. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS }, additionalProperties: false },
      shellForms: { none: "a branch-to-tree lookup has no glab verb; glab mr view hits the glab catch-all on mr_view" },
      async handler(input) {
        const early = refuseGithubTarget(input, "mr_resolve_branch", "gh pr view <n> --json headRefName");
        if (early) return err(early);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const refused = githubRefusal(target.identity, "mr_resolve_branch", "gh pr view <n> --json headRefName");
        if (refused) return err(refused);

        const mr = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: target.identity, iid: target.iid }, { timeoutMs: READ_TIMEOUT_MS });
        if (!mr.ok || !mr.data) return err(explainError(mr.error ?? "MR read failed"));
        const list = await deps.command<Commands["worktree:list"]["data"]>("worktree:list", { repoName: target.identity }, { timeoutMs: READ_TIMEOUT_MS });
        if (!list.ok || !list.data) return err(explainError(list.error ?? "worktree list failed"));

        const pr = mr.data.mr;
        const trees = list.data.trees.filter((t) => t.branch === pr.sourceBranch).map((t) => ({ name: t.name, path: t.path }));
        return ok({
          iid: pr.iid, state: pr.state, title: pr.title, author: pr.author.username,
          sourceBranch: pr.sourceBranch, targetBranch: pr.targetBranch, webUrl: pr.webUrl, trees,
        });
      },
    },
    {
      name: "mr_map",
      description: `GitLab only. A repo's open MRs joined to the local worktrees holding their branches, read live from GitLab on every call. Lists every author's MRs unless \`author\` is passed (a username, or "me" for the token's own user). Each row is {ref, iid, title, author, sourceBranch, targetBranch, draft, stacked, worktree, dirty, mrState, ciStatus}: stacked is whether targetBranch is not the project's default branch (null when the default branch could not be read); worktree is the path of the registered tree whose branch equals sourceBranch exactly (the last one when two share it), or null; dirty is whether that tree has uncommitted changes (null with no tree or on a git error); ciStatus is the pipeline status from the daemon's synced MR list, null when that list lacks the MR. Returns {rows, complete}, where complete false means the repo has more than ${MR_MAP_LIMIT} open MRs and only the first ${MR_MAP_LIMIT} are listed. \`repo\` is a legacy alias for repoName; pass one, not both. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          repo: { type: "string", description: "Legacy alias for repoName; pass one, not both." },
          author: { type: "string", description: 'A GitLab username, or "me" for the token\'s own user. Omit for every author.' },
        },
        additionalProperties: false,
      },
      shellForms: { none: "joins a live GitLab MR list to the local worktrees; no shell command is equivalent" },
      async handler(input) {
        if (input.repoName !== undefined && input.repo !== undefined) return err("pass repoName, not both repoName and repo");
        if (input.repo !== undefined && typeof input.repo !== "string") return err('"repo" must be a string');
        if (input.author !== undefined && (typeof input.author !== "string" || !input.author.trim())) return err('"author" must be a GitLab username or "me"');
        const targetInput = { repoName: input.repoName ?? input.repo, mrUrl: input.mrUrl };

        const early = refuseGithubTarget(targetInput, "mr_map", MR_MAP_GH_MOVE);
        if (early) return err(early);
        const target = await resolveRepoTarget(targetInput);
        if (!target.ok) return err(target.error);
        const refused = githubRefusal(target.identity, "mr_map", MR_MAP_GH_MOVE);
        if (refused) return err(refused);
        const identity = target.identity;

        const listPayload: Record<string, unknown> = { repoName: identity, state: "opened", limit: MR_MAP_LIMIT };
        if (typeof input.author === "string") listPayload.author = input.author.trim();
        const [list, trees, defaultBranch, ci] = await Promise.all([
          deps.command<Commands["mr:list-live"]["data"]>("mr:list-live", listPayload, { timeoutMs: READ_TIMEOUT_MS }),
          deps.command<Commands["worktree:list"]["data"]>("worktree:list", { repoName: identity }, { timeoutMs: READ_TIMEOUT_MS }),
          defaultBranchOf(deps, identity),
          cachedCiStatus(deps, identity),
        ]);
        if (!list.ok || !list.data) return err(explainError(list.error ?? "MR list read failed"));
        if (!trees.ok || !trees.data) return err(explainError(trees.error ?? "worktree list failed"));

        const joined = joinMrsToWorktrees(
          list.data.mrs,
          (trees.data.trees ?? []).map((t) => ({ path: t.path, branch: t.branch })),
          { defaultBranch, ciStatus: (iid) => ci.get(iid) ?? null },
        );
        const rows = await Promise.all(joined.map(async (row): Promise<MrMapRow> => {
          const { mrState, ciStatus, ...head } = row;
          return { ...head, dirty: await isDirty(deps, row.worktree), mrState, ciStatus };
        }));
        return ok({ rows, complete: !list.data.truncated });
      },
    },
  ];
}
