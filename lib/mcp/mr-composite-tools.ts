/**
 * GitLab composite tools: each answers in one call what a skill otherwise
 * strings together from several reads. None of them speaks GitHub; each
 * refuses a github.com identity before any daemon call.
 */
import { readProjectMRs, rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands, Discussion, GateRow } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { joinMrsToWorktrees, type MrMapRow } from "../mr-map.ts";
import { parseIdentity } from "../settings/identity.ts";
import { statusPorcelainAsync } from "../worktree/git-async.ts";
import { gitPush, realGitRunner, type GitRunner } from "./git-tools.ts";
import { resolveMrTarget, resolveRepoTarget, type MrTarget, type TargetInput } from "./mr-target.ts";
import { runToolDefs } from "./run-tools.ts";
import { checkRequired, err, MR_TARGET_PROPS, MR_WRITE_TIMEOUT_MS, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export interface MrCompositeDeps {
  command: typeof rtCommand;
  readMrCache: typeof readProjectMRs;
  runTool: (name: "run_snapshot" | "run_decision" | "run_field_set", input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<ToolResult>;
  git: GitRunner;
  guard: TreeGuardDeps;
  status: (path: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  resolveMr?: (input: TargetInput) => Promise<MrTarget>;
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
  resolveMr: resolveMrTarget,
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

/** GitLab's 409 text inside "createPullRequest failed: 409 ..." when the source branch already has an open MR. */
export const EXISTING_MR = /already exists/i;

export type OpenMr = { iid: number; url: string | null; targetBranch: string; draft: boolean; title: string };

export async function findOpenMrForBranch(
  deps: Pick<MrCompositeDeps, "command">,
  identity: string,
  sourceBranch: string,
): Promise<{ ok: true; mr: OpenMr | null } | { ok: false; error: string }> {
  const r = await deps.command<Commands["mr:live-by-branch"]["data"]>("mr:live-by-branch", { repoName: identity, branches: [sourceBranch] }, { timeoutMs: READ_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "open MR lookup failed") };
  const pr = r.data.byBranch[sourceBranch];
  if (!pr) return { ok: true, mr: null };
  return { ok: true, mr: { iid: pr.iid, url: pr.webUrl, targetBranch: pr.targetBranch, draft: pr.draft, title: pr.title } };
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
    const r = await deps.readMrCache(identity, undefined, { timeoutMs: READ_TIMEOUT_MS });
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

export const REBASE_POLL_MS = 5_000;
export const REBASE_DEFAULT_WAIT_S = 90;
export const REBASE_MAX_WAIT_S = 600;

export type RebaseWaitResult =
  | { status: "rebased"; sha: string | null; previousSha: string | null }
  | { status: "failed"; mergeError: string | null; conflicts: boolean; sha: string | null }
  | { status: "current" | "unchanged"; sha: string | null }
  | { status: "pending"; sha: string | null; rebaseInProgress: boolean; lastError?: string };

/** GitLab rebases asynchronously and mr:action replies before it finishes, so
    the budget is the sleeps added up: a slow poll never ends the wait early. */
export async function waitForRebase(
  deps: Pick<MrCompositeDeps, "command" | "sleep">,
  target: { identity: string; iid: number },
  previousSha: string | null,
  opts: { maxWaitMs: number; pollMs: number; signal?: AbortSignal; progress?: () => void },
): Promise<RebaseWaitResult> {
  let sha = previousSha;
  let rebaseInProgress = false;
  let lastError: string | undefined;
  let settledNull = 0;
  let slept = 0;

  while (!opts.signal?.aborted) {
    opts.progress?.();
    const r = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: target.identity, iid: target.iid }, { timeoutMs: READ_TIMEOUT_MS });
    if (!r.ok || !r.data) {
      lastError = explainError(r.error ?? "MR read failed");
      settledNull = 0;
    } else {
      lastError = undefined;
      const pr = r.data.mr;
      sha = pr.sha;
      rebaseInProgress = pr.rebaseInProgress;
      if (sha !== previousSha) return { status: "rebased", sha, previousSha };
      if (!rebaseInProgress) {
        if (pr.mergeError || pr.conflicts) return { status: "failed", mergeError: pr.mergeError, conflicts: pr.conflicts, sha };
        if (pr.divergedCommitsCount === 0) return { status: "current", sha };
        settledNull = pr.divergedCommitsCount === null ? settledNull + 1 : 0;
        if (settledNull >= 2) return { status: "unchanged", sha };
      } else {
        settledNull = 0;
      }
    }
    if (slept + opts.pollMs > opts.maxWaitMs) break;
    await deps.sleep(opts.pollMs);
    slept += opts.pollMs;
  }
  return { status: "pending", sha, rebaseInProgress, ...(lastError !== undefined && { lastError }) };
}

export interface SnapshotField { key: string; value: string; at: number; run_id?: string; produced_by?: string }
export interface SnapshotDecision { contract: string; scope: string; selection: string; decided_by: string; decided_at: number; run_id?: string }
export interface RunSnapshot { ok?: boolean; error?: string; run: Record<string, unknown> | null; stages?: unknown[]; fields: SnapshotField[]; decisions: SnapshotDecision[] }

export interface PostAction { threadId: string; verb: "fix" | "override" | "reply"; post: boolean; resolve: boolean; body: string | null }
export interface RespondPostPlan {
  mrUrl: string;
  branch: string | null;
  startedAt: number;
  planDecidedAt: number;
  actions: PostAction[];
  postDecision: { selection: Record<string, unknown>; decidedBy: string } | null;
  heldResume: string[] | null;
}

type RespondScope = "respond-plan" | "respond-post";
export type GateSource = { gate: string | null; source: { context?: unknown; questions: unknown[] }; at: number };
type SourceThread = { threadId: string; questionId: string; card: Record<string, unknown> | null };
type PostEntry = { post: boolean; resolve: boolean; text?: string; note?: string };

export const RESPOND_POST_GH_MOVE = "reply to and resolve the threads with gh";
const GATE_CONTRACT = "gate@1";
const PLAN_VERBS = ["reply", "fix", "skip"] as const;
const POST_VERBS = ["post", "resolve"] as const;
const RETIRED_KEY = /^(replies|replies-\d+|disposition)$/;

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

const sourceKey = (scope: RespondScope) => `extra.gate-source.${scope}`;

function readGateSource(fields: SnapshotField[], scope: RespondScope): { ok: true; field: GateSource | null } | { ok: false; error: string } {
  const row = fields.find((f) => f.key === sourceKey(scope));
  if (!row) return { ok: true, field: null };
  const bad = { ok: false as const, error: `the run's ${sourceKey(scope)} field is not a gate_open source of the shape {gate, source: {context, questions}}` };
  if (typeof row.value !== "string" || typeof row.at !== "number" || !Number.isFinite(row.at)) return bad;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return bad;
  }
  if (!isRecord(parsed) || !isRecord(parsed.source) || !Array.isArray(parsed.source.questions)) return bad;
  const gate = parsed.gate;
  if (gate !== null && !(typeof gate === "string" && gate)) return bad;
  return { ok: true, field: { gate, source: parsed.source as GateSource["source"], at: row.at } };
}

export function gateSourceField(fields: SnapshotField[], scope: RespondScope): GateSource | null {
  const r = readGateSource(fields, scope);
  return r.ok ? r.field : null;
}

const optionValue = (o: unknown): string | null => (typeof o === "string" ? o : isRecord(o) && typeof o.value === "string" ? o.value : null);

function splitPick(value: string): { verb: string; threadId: string } | null {
  const i = value.indexOf(":");
  if (i <= 0 || i === value.length - 1) return null;
  return { verb: value.slice(0, i), threadId: value.slice(i + 1) };
}

/** A registry answer is a bare value, an array of values, or {value, note, text}; a write-in names no option and reads null. */
function pickValues(a: unknown): string[] | null {
  if (typeof a === "string") return [a];
  if (Array.isArray(a)) return a.every((v) => typeof v === "string") ? (a as string[]) : null;
  if (isRecord(a) && (typeof a.value === "string" || Array.isArray(a.value))) return pickValues(a.value);
  return null;
}

const pickText = (a: unknown): string | undefined => (isRecord(a) && typeof a.text === "string" ? a.text : undefined);
const pickNote = (a: unknown): string | undefined => (isRecord(a) && typeof a.note === "string" && a.note.trim() ? a.note : undefined);

function parseContext(c: unknown): Record<string, unknown> | null {
  if (isRecord(c)) return c;
  if (typeof c !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(c);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sourceThreads(scope: RespondScope, questions: unknown[], verbs: readonly string[]): SourceThread[] {
  const threads: SourceThread[] = [];
  for (const q of questions) {
    if (!isRecord(q) || typeof q.id !== "string" || !Array.isArray(q.options)) refuse(`the ${scope} gate source has a question that is not {id, options}`);
    const question = q as { id: string; options: unknown[]; context?: unknown };
    const picks = question.options.map((o) => splitPick(optionValue(o) ?? ""));
    if (picks.every((p) => p === null || !verbs.includes(p.verb))) continue;
    const ids = new Set(picks.map((p) => (p && verbs.includes(p.verb) ? p.threadId : null)));
    if (ids.size !== 1 || ids.has(null)) refuse(`the ${scope} gate source's question ${question.id} does not name exactly one thread in its option values`);
    const threadId = picks[0]!.threadId;
    if (threads.some((t) => t.threadId === threadId)) refuse(`the ${scope} gate source asks about ${threadId} twice`);
    threads.push({ threadId, questionId: question.id, card: parseContext(question.context) });
  }
  return threads;
}

const gateDecision = (snapshot: RunSnapshot, scope: RespondScope) => snapshot.decisions.find((x) => x.contract === GATE_CONTRACT && x.scope === scope);

/** A respond-post source counts as offered this round only when it was written at or after the respond-plan decision; an older one is last round's and acts on nothing. */
export function postSourceIsCurrent(snapshot: RunSnapshot, post: { at: number }): boolean {
  const d = gateDecision(snapshot, "respond-plan");
  return d !== undefined && typeof d.decided_at === "number" && post.at >= d.decided_at;
}

function freshDecision(snapshot: RunSnapshot, scope: RespondScope, threshold: number): SnapshotDecision {
  const d = gateDecision(snapshot, scope);
  if (!d || typeof d.decided_at !== "number" || d.decided_at < threshold) refuse(`${scope} has no decision recorded since its gate opened; if the gate is answered, record it with gate_record, then call again`);
  return d!;
}

function parseSelection(scope: RespondScope, d: SnapshotDecision): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(d.selection);
  } catch {
    return refuse(`the ${scope} decision's selection is not JSON`);
  }
  if (!isRecord(parsed)) refuse(`the ${scope} decision's selection is not a JSON object`);
  return parsed as Record<string, unknown>;
}

/** The registry row answers for a gate the source names; a hand-back source (gate null) has none, and its recorded decision is the answer. */
function registryRow(scope: RespondScope, src: GateSource, row: GateRow | null): GateRow | null {
  if (src.gate === null) return null;
  if (!row || row.id !== src.gate) refuse(`the ${scope} gate ${src.gate} was not read from the registry`);
  return row;
}

function answeredProceed(scope: RespondScope, row: GateRow): Record<string, unknown> {
  if (row.status !== "answered" || !row.answer) refuse(`the ${scope} gate ${row.id} is ${row.status}, not answered`);
  const answers = row.answer!.answers as Record<string, unknown>;
  if ("next" in answers || row.questions.some((q) => q.id === "next")) {
    const next = pickValues(answers.next);
    if (!next || next.length === 0) refuse(`the ${scope} gate has no next answer, so it never proceeded`);
    if (next!.length !== 1 || next![0] !== "proceed") refuse(`the ${scope} gate's next answer is ${next!.join(", ")}, not proceed`);
  }
  return answers;
}

/** The prose forms gate-ctx.sh renders: thread@1 ends on a `Will post as reply: <text>` line; reply@1 is one `<file> REPLY|FIX[ · <sha>]: <text>` card. */
function shownInProse(ctx: string, text: string, shape: "thread@1" | "reply@1"): boolean {
  if (shape === "thread@1") {
    const marker = `Will post as reply: ${text}`;
    return ctx === marker || ctx.endsWith(`\n${marker}`);
  }
  if (!ctx.endsWith(`: ${text}`)) return false;
  const head = ctx.slice(0, ctx.length - text.length - 2);
  return /^[^\n]* (?:REPLY|FIX(?: · [^\s:]+)?)$/.test(head);
}

/** The text the human was shown: a structured context's reply, or a prose context whose card marker line carries it whole. */
function shownInRegistry(row: GateRow, threadId: string, text: string, shape: "thread@1" | "reply@1"): boolean {
  const q = row.questions.find((x) => x.options.some((o) => splitPick(optionValue(o) ?? "")?.threadId === threadId));
  const ctx = q?.context;
  if (typeof ctx !== "string" || !ctx.trim()) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx);
  } catch {
    return shownInProse(ctx, text, shape);
  }
  if (!isRecord(parsed) || parsed["gate-ctx"] !== shape) return false;
  if (shape === "thread@1") return isRecord(parsed.reply) && parsed.reply.kind === "verbatim" && parsed.reply.text === text;
  return parsed.thread === threadId && parsed.text === text;
}

function optionalText(where: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !v.trim()) refuse(`${where} must be a non-empty string`);
  return v as string;
}

/** Returns the threads whose answer carried a note: the skill makes those overrides, so none of them posts its card text. */
function checkPlanAgainstRegistry(answers: Record<string, unknown>, threads: SourceThread[], verbs: Record<string, string>, texts: Record<string, string>, codeChanges: unknown): Set<string> {
  const regVerb = new Map<string, string>();
  const regText = new Map<string, string>();
  const noted = new Set<string>();
  for (const [qid, a] of Object.entries(answers)) {
    if (qid === "next" || qid === "code-changes") continue;
    const values = pickValues(a);
    if (!values) refuse(`the respond-plan gate's answer to ${qid} names no option`);
    for (const v of values!) {
      const p = splitPick(v);
      if (!p || !(PLAN_VERBS as readonly string[]).includes(p.verb)) refuse(`the respond-plan gate's answer ${v} is not a reply, fix or skip pick`);
      if (regVerb.has(p!.threadId)) refuse(`the respond-plan gate's answer picks more than one verb for ${p!.threadId}`);
      regVerb.set(p!.threadId, p!.verb);
      const text = pickText(a);
      if (p!.verb === "reply" && text !== undefined) regText.set(p!.threadId, text);
      if (pickNote(a) !== undefined) noted.add(p!.threadId);
    }
  }
  for (const id of regVerb.keys()) {
    if (!threads.some((t) => t.threadId === id)) refuse(`the respond-plan gate's answer names ${id}, which its gate source never asked about`);
  }
  for (const { threadId } of threads) {
    const reg = regVerb.get(threadId);
    if (reg !== verbs[threadId]) refuse(`the respond-plan decision for ${threadId} does not match the gate's answer: the decision says ${verbs[threadId]}, the gate ${reg ?? "nothing"}`);
    if (reg === "reply" && regText.get(threadId) !== texts[threadId]) refuse(`the respond-plan decision for ${threadId} does not match the gate's answer text`);
  }
  if ("code-changes" in answers) {
    const reg = pickValues(answers["code-changes"]);
    if (!reg || reg.length !== 1 || reg[0] !== codeChanges) refuse(`the respond-plan decision's code-changes does not match the gate's answer`);
  }
  return noted;
}

function checkPostAgainstRegistry(answers: Record<string, unknown>, offered: SourceThread[], entries: Record<string, PostEntry>) {
  const reg = new Map<string, { post: boolean; resolve: boolean; text?: string }>(offered.map((t) => [t.threadId, { post: false, resolve: false }]));
  for (const [qid, a] of Object.entries(answers)) {
    if (qid === "next") continue;
    const values = pickValues(a);
    if (!values) refuse(`the respond-post gate's answer to ${qid} names no option`);
    for (const v of values!) {
      const p = splitPick(v);
      if (!p || !(POST_VERBS as readonly string[]).includes(p.verb)) refuse(`the respond-post gate's answer ${v} is not a post or resolve pick`);
      const slot = reg.get(p!.threadId);
      if (!slot) refuse(`the respond-post gate's answer names ${p!.threadId}, which its gate source never offered`);
      slot![p!.verb as "post" | "resolve"] = true;
    }
    const text = pickText(a);
    if (text === undefined) continue;
    for (const v of values!) {
      const p = splitPick(v)!;
      if (p.verb === "post") reg.get(p.threadId)!.text = text;
    }
  }
  for (const { threadId } of offered) {
    const r = reg.get(threadId)!;
    const d = entries[threadId]!;
    for (const k of POST_VERBS) {
      if (r[k] !== d[k]) refuse(`the respond-post decision for ${threadId} does not match the gate's answer: the decision has ${k} ${d[k]}, the gate ${k} ${r[k]}`);
    }
    if (r.text !== d.text) refuse(`the respond-post decision for ${threadId} does not match the gate's answer text`);
  }
}

function readPostEntries(selection: Record<string, unknown>, offered: SourceThread[]): Record<string, PostEntry> {
  if (Object.keys(selection).some((k) => RETIRED_KEY.test(k)) || !isRecord(selection.threads)) {
    refuse("the respond-post decision is in the retired shape (replies, disposition, or no threads object); record it as {threads: {<threadId>: {post, resolve}}}");
  }
  const threads = selection.threads as Record<string, unknown>;
  const entries: Record<string, PostEntry> = {};
  for (const [id, e] of Object.entries(threads)) {
    if (!offered.some((t) => t.threadId === id)) refuse(`the respond-post decision names ${id}, which its gate source never offered`);
    if (!isRecord(e) || typeof e.post !== "boolean" || typeof e.resolve !== "boolean") refuse(`the respond-post decision's entry for ${id} is not {post, resolve} booleans`);
    const entry = e as Record<string, unknown>;
    const text = optionalText(`the respond-post decision's text for ${id}`, entry.text);
    const note = entry.note === undefined || typeof entry.note === "string" ? (entry.note as string | undefined) : refuse(`the respond-post decision's note for ${id} must be a string`);
    entries[id] = { post: entry.post as boolean, resolve: entry.resolve as boolean, ...(text !== undefined && { text }), ...(note !== undefined && { note }) };
  }
  for (const { threadId } of offered) {
    if (!entries[threadId]) refuse(`the respond-post decision has no entry for offered thread ${threadId}, so it does not match what was offered`);
  }
  return entries;
}

function readMrUrl(fields: SnapshotField[]): string {
  const mr = fields.find((f) => f.key === "mr")?.value;
  if (typeof mr !== "string" || !mr.trim()) return refuse("the run has no mr field, so there is no MR to post to");
  const gh = refuseGithubTarget({ mrUrl: mr }, "respond_post_execute", RESPOND_POST_GH_MOVE);
  if (gh) refuse(gh);
  try {
    const u = new URL(mr.trim());
    if (u.protocol !== "https:") throw new Error("not https");
  } catch {
    refuse(`the run's mr field is not an MR URL: ${mr}`);
  }
  return mr.trim();
}

function plan(snapshot: RunSnapshot, gates: { plan: GateRow | null; post: GateRow | null }): RespondPostPlan {
  if (!isRecord(snapshot) || snapshot.ok === false || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.decisions)) {
    refuse(`the run snapshot did not read${typeof snapshot?.error === "string" ? `: ${snapshot.error}` : ""}`);
  }
  const fields = snapshot.fields;
  const mrUrl = readMrUrl(fields);
  const branchValue = fields.find((f) => f.key === "branch")?.value;
  const branch = typeof branchValue === "string" && branchValue.trim() ? branchValue.trim() : null;
  const startedAt = snapshot.run?.started_at;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) refuse("the run has no started_at, so the posted-already read has no start time");

  const planRead = readGateSource(fields, "respond-plan");
  if (!planRead.ok) return refuse(planRead.error);
  if (!planRead.field) return refuse(`the run has no ${sourceKey("respond-plan")} field: open the respond-plan gate with gate_open {runDb} so its decision can be checked`);
  const planSrc = planRead.field;
  const planRow = registryRow("respond-plan", planSrc, gates.plan);
  const planDecision = freshDecision(snapshot, "respond-plan", planRow ? planRow.openedAt : planSrc.at);
  const planAnswers = planRow ? answeredProceed("respond-plan", planRow) : null;
  const planSel = parseSelection("respond-plan", planDecision);

  if (!isRecord(planSel.threads)) refuse("the respond-plan decision has no threads object");
  const verbs = planSel.threads as Record<string, unknown>;
  for (const [id, v] of Object.entries(verbs)) {
    if (typeof v !== "string" || !(PLAN_VERBS as readonly string[]).includes(v)) refuse(`the respond-plan decision's verb for ${id} is not reply, fix or skip`);
  }
  const texts: Record<string, string> = {};
  if (planSel.texts !== undefined) {
    if (!isRecord(planSel.texts)) refuse("the respond-plan decision's texts is not an object");
    for (const [id, t] of Object.entries(planSel.texts as Record<string, unknown>)) texts[id] = optionalText(`the respond-plan decision's text for ${id}`, t)!;
  }
  const overrides = planSel.overrides ?? [];
  if (!Array.isArray(overrides) || !overrides.every((o) => typeof o === "string")) refuse("the respond-plan decision's overrides is not a list of thread ids");

  const planThreads = sourceThreads("respond-plan", planSrc.source.questions, PLAN_VERBS);
  for (const { threadId } of planThreads) {
    if (verbs[threadId] === undefined) refuse(`the respond-plan decision has no entry for ${threadId}, so it does not match what was asked`);
  }
  for (const id of Object.keys(verbs)) {
    if (!planThreads.some((t) => t.threadId === id)) refuse(`the respond-plan decision names ${id}, which its gate source never asked about`);
  }
  const noted = planAnswers ? checkPlanAgainstRegistry(planAnswers, planThreads, verbs as Record<string, string>, texts, planSel["code-changes"]) : new Set<string>();
  if (planSel.notes !== undefined) {
    if (!isRecord(planSel.notes)) refuse("the respond-plan decision's notes is not an object");
    for (const id of Object.keys(planSel.notes as Record<string, unknown>)) noted.add(id);
  }
  const codeChanges = planSel["code-changes"];
  if (codeChanges === "revise") refuse("respond-plan was answered revise, so nothing from it acts; re-adjudicate and open a new respond-plan gate");

  const postRead = readGateSource(fields, "respond-post");
  if (!postRead.ok) return refuse(postRead.error);
  const postSrc = postRead.field && postSourceIsCurrent(snapshot, postRead.field) ? postRead.field : null;
  const actions: PostAction[] = [];
  let postDecision: RespondPostPlan["postDecision"] = null;
  let heldResume: string[] | null = null;
  let offered: SourceThread[] = [];

  if (!postSrc) {
    const late = snapshot.decisions.find((d) => d.contract === GATE_CONTRACT && d.scope === "respond-post" && d.decided_at >= planDecision.decided_at);
    if (late) refuse(`respond-post has a decision recorded after the respond-plan decision but no ${sourceKey("respond-post")} field this round: open respond-post with gate_open {runDb}`);
  } else {
    const postRow = registryRow("respond-post", postSrc, gates.post);
    const decision = freshDecision(snapshot, "respond-post", postRow ? postRow.openedAt : postSrc.at);
    const postAnswers = postRow ? answeredProceed("respond-post", postRow) : null;
    const selection = parseSelection("respond-post", decision);
    offered = sourceThreads("respond-post", postSrc.source.questions, POST_VERBS);
    const entries = readPostEntries(selection, offered);
    if (postAnswers) checkPostAgainstRegistry(postAnswers, offered, entries);

    for (const { threadId, card } of offered) {
      const planVerb = verbs[threadId];
      if (planVerb !== "fix" && planVerb !== "reply") refuse(`offered thread ${threadId} is ${planVerb ?? "missing"} in the respond-plan decision, so it has nothing to post`);
      const cardOk = card?.["gate-ctx"] === "reply@1";
      if (planVerb === "fix" && codeChanges !== "approve") {
        refuse(`offered thread ${threadId} is a fix row but respond-plan's code-changes is ${typeof codeChanges === "string" ? codeChanges : "missing"}, not approve, so no approved fix backs its reply`);
      }
      if (cardOk && card!.verb !== planVerb) refuse(`offered thread ${threadId}'s card says ${String(card!.verb)} but the respond-plan decision says ${planVerb}`);
      const entry = entries[threadId]!;
      let body: string | null = null;
      if (entry.post) {
        if (entry.text !== undefined) body = entry.text;
        else {
          const cardText = cardOk && typeof card!.text === "string" && card!.text.trim() ? (card!.text as string) : null;
          if (cardText === null) refuse(`${threadId} is picked to post but has no reply text in the decision or on its card`);
          if (postRow && !shownInRegistry(postRow, threadId, cardText!, "reply@1")) refuse(`${threadId}'s card text is not in the respond-post gate's question context, so the human may never have seen it`);
          body = cardText;
        }
      }
      actions.push({ threadId, verb: planVerb === "fix" ? "fix" : "override", post: entry.post, resolve: entry.resolve, body });
    }
    postDecision = { selection, decidedBy: decision.decided_by };
    if (selection.held !== undefined) {
      if (!Array.isArray(selection.held) || !selection.held.every((h) => typeof h === "string")) refuse("the respond-post decision's held is not a list of thread ids");
      heldResume = selection.held as string[];
    }
  }

  for (const { threadId, card } of planThreads) {
    if (verbs[threadId] !== "reply" || (overrides as string[]).includes(threadId) || offered.some((t) => t.threadId === threadId)) continue;
    let body = texts[threadId];
    if (body === undefined) {
      if (noted.has(threadId)) refuse(`${threadId} is a reply row whose answer carries a note but no edited text; make it an override and offer it at respond-post`);
      const reply = card?.["gate-ctx"] === "thread@1" && isRecord(card.reply) ? card.reply : null;
      const text = reply && typeof reply.text === "string" && reply.text.trim() ? reply.text : null;
      if (!reply || reply.kind !== "verbatim" || text === null) {
        refuse(`${threadId} is a reply row with no edited text and its card shows no verbatim reply; make it an override and offer it at respond-post`);
      }
      if (planRow && !shownInRegistry(planRow, threadId, text!, "thread@1")) refuse(`${threadId}'s card text is not in the respond-plan gate's question context, so the human may never have seen it; make it an override and offer it at respond-post`);
      body = text!;
    }
    actions.push({ threadId, verb: "reply", post: true, resolve: false, body });
  }

  for (const id of heldResume ?? []) {
    if (!actions.some((a) => a.threadId === id)) refuse(`the respond-post decision holds ${id}, which is neither offered nor a reply row`);
  }

  return { mrUrl, branch, startedAt: startedAt as number, planDecidedAt: planDecision.decided_at, actions, postDecision, heldResume };
}

/** Pure: everything acted on comes from the snapshot and the registry rows, never from the caller. Any doubt refuses before an outward move. */
export function planRespondPost(snapshot: RunSnapshot, gates: { plan: GateRow | null; post: GateRow | null }): { ok: true; plan: RespondPostPlan } | { ok: false; error: string } {
  try {
    return { ok: true, plan: plan(snapshot, gates) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    return { ok: false, error: `respond_post_execute could not read the run's decisions: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface RespondPostResult {
  mr: string;
  pushed: { branch: string } | null;
  posted: string[];
  alreadyPosted: Array<{ threadId: string; noteId: number }>;
  resolved: string[];
  alreadyResolved: string[];
  held: Array<{ threadId: string; kind: "read" | "mismatch" | "push" | "reply" | "resolve"; error: string }>;
  recorded: boolean;
  hold: "held" | null;
  writeErrors?: string[];
}

type HeldKind = RespondPostResult["held"][number]["kind"];
type Target = { identity: string; iid: number };
type ThreadsRead = { ok: true; discussions: Discussion[] } | { ok: false; error: string };

async function readGateRow(deps: MrCompositeDeps, id: string): Promise<{ ok: true; row: GateRow } | { ok: false; error: string }> {
  const r = await deps.command<Commands["gate:wait"]["data"]>("gate:wait", { id, waitMs: 0 }, { timeoutMs: READ_TIMEOUT_MS });
  if (!r.ok && r.error === "not-found") return { ok: false, error: `gate ${id} is no longer in the registry (swept or never opened); re-open respond-plan/respond-post with gate_open {runDb}` };
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? `reading gate ${id} failed`) };
  if (r.data.status === "timeout") return { ok: false, error: `gate ${id} is still open; answer it before running respond_post_execute` };
  return { ok: true, row: r.data.row };
}

async function readThreads(deps: MrCompositeDeps, t: Target): Promise<ThreadsRead> {
  const r = await deps.command<Commands["discussions:refresh"]["data"]>("discussions:refresh", { repoName: t.identity, iid: t.iid }, { timeoutMs: READ_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "thread read failed") };
  return { ok: true, discussions: r.data.discussions };
}

const gitOutput = (r: { code: number; stdout: string; stderr: string }) => (r.code === 0 ? JSON.stringify(r.stdout.trim()) : `exit ${r.code}: ${JSON.stringify(r.stderr.trim() || r.stdout.trim())}`);

type ExpectedBranch = { branch: string; mismatch: string | null; notOpen: string | null };

/** The branch a fix reply claims: the run's branch field, which must also be the MR's source branch, or the MR's source branch when the run has none. */
async function expectedBranch(deps: MrCompositeDeps, t: Target, fromRun: string | null): Promise<({ ok: true } & ExpectedBranch) | { ok: false; error: string }> {
  const r = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: t.identity, iid: t.iid }, { timeoutMs: READ_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "MR read failed") };
  const { sourceBranch: source, state } = r.data.mr;
  const notOpen = state === "opened" ? null : `MR !${t.iid} is ${state}, so a fix push would not reach it`;
  if (fromRun === null) return { ok: true, branch: source, mismatch: null, notOpen };
  return { ok: true, branch: fromRun, mismatch: source === fromRun ? null : `the run's branch is ${fromRun} but the MR's source branch is ${source}`, notOpen };
}

/** Acts only on the recorded decisions planRespondPost checked. A doubt found from the run, the registry or the tree refuses before GitLab is read; a failed GitLab read, and any step that fails after it, holds the threads instead. */
export async function executeRespondPost(
  deps: MrCompositeDeps,
  input: { runDb: string; tree: string; stage: string },
  env: NodeJS.ProcessEnv,
  progress?: () => void,
): Promise<ToolResult> {
  const { runDb, tree, stage } = input;
  const snap = await deps.runTool("run_snapshot", { runDb }, env);
  if (!snap.ok) return err(snap.error ?? "run_snapshot failed");
  const snapshot = snap.body as RunSnapshot;
  const fields = isRecord(snapshot) && Array.isArray(snapshot.fields) ? snapshot.fields : [];
  const mrField = fields.find((f) => f.key === "mr")?.value;
  const gh = refuseGithubTarget({ mrUrl: mrField }, "respond_post_execute", RESPOND_POST_GH_MOVE);
  if (gh) return err(gh);

  const gates: { plan: GateRow | null; post: GateRow | null } = { plan: null, post: null };
  for (const [scope, slot] of [["respond-plan", "plan"], ["respond-post", "post"]] as const) {
    const src = gateSourceField(fields, scope);
    if (!src?.gate) continue;
    if (scope === "respond-post" && !postSourceIsCurrent(snapshot, src)) continue;
    const id = src.gate;
    const g = await readGateRow(deps, id);
    if (!g.ok) return err(g.error);
    gates[slot] = g.row;
  }
  const planned = planRespondPost(snapshot, gates);
  if (!planned.ok) return err(planned.error);
  const plan = planned.plan;

  const resolved = await (deps.resolveMr ?? resolveMrTarget)({ mrUrl: plan.mrUrl });
  if (!resolved.ok) return err(resolved.error);
  const ghIdentity = githubRefusal(resolved.identity, "respond_post_execute", RESPOND_POST_GH_MOVE);
  if (ghIdentity) return err(ghIdentity);
  const target: Target = { identity: resolved.identity, iid: resolved.iid };

  const resume = plan.heldResume === null ? null : new Set(plan.heldResume);
  const acting = plan.actions.filter((a) => (a.post || a.resolve) && (resume === null || resume.has(a.threadId)));
  const fixRows = acting.filter((a) => a.verb === "fix");
  let treePath: string | null = null;
  if (fixRows.length > 0) {
    const t = checkRegisteredTree(tree, deps.guard);
    if (!t.ok) return err(t.error);
    if (t.repoName !== target.identity) return err(`tree ${tree} is a checkout of ${t.repoName}, not of the MR's repo ${target.identity}, so a fix push from it would not reach the MR`);
    treePath = t.path;
  }

  const result: RespondPostResult = { mr: plan.mrUrl, pushed: null, posted: [], alreadyPosted: [], resolved: [], alreadyResolved: [], held: [], recorded: false, hold: null };
  const heldIds = new Set<string>();
  const hold = (threadId: string, kind: HeldKind, error: string) => {
    result.held.push({ threadId, kind, error });
    heldIds.add(threadId);
  };
  const writeError = (e: string) => {
    result.writeErrors = [...(result.writeErrors ?? []), e];
  };
  const setHold = async () => {
    if (result.held.length === 0) return;
    const r = await deps.runTool("run_field_set", { runDb, key: "hold", value: "held", stage }, env);
    progress?.();
    result.hold = r.ok ? "held" : null;
    if (!r.ok) writeError(`setting the hold field failed: ${r.error ?? "run_field_set failed"}`);
  };

  const failRead = async (error: string) => {
    for (const a of acting) hold(a.threadId, "read", error);
    await setHold();
    return ok(result);
  };

  if (acting.length > 0) {
    const self = await selfUsername(deps, target.identity);
    progress?.();
    if (!self.ok) return failRead(self.error);
    const read = await readThreads(deps, target);
    progress?.();
    if (!read.ok) return failRead(read.error);
    const missing = acting.filter((a) => !read.discussions.some((d) => d.id === a.threadId)).map((a) => a.threadId);
    if (missing.length > 0) return failRead(`GitLab no longer returns thread ${missing.join(", ")}`);
    let branch: ExpectedBranch | null = null;
    if (treePath !== null) {
      const b = await expectedBranch(deps, target, plan.branch);
      progress?.();
      if (!b.ok) return failRead(b.error);
      branch = b;
    }
    const by = self.username;
    const since = Math.max(plan.startedAt, plan.planDecidedAt);
    const discussions = read.discussions;
    const postedBefore = new Map(
      postedMatch(discussions, { by, since, threads: acting.filter((a) => a.post).map((a) => ({ discussionId: a.threadId, ...(a.body !== null && { body: a.body }) })) })
        .threads.map((t) => [t.discussionId, t]),
    );

    if (branch?.notOpen) {
      for (const a of fixRows) hold(a.threadId, "mismatch", branch.notOpen);
    } else if (treePath !== null && branch !== null) {
      const want = branch.branch;
      const sym = await deps.git(["symbolic-ref", "--quiet", "HEAD"], treePath);
      const pushRef = await deps.git(["rev-parse", "--abbrev-ref", "@{push}"], treePath);
      // gitPush sends to @{u}'s remote, which a triangular setup (remote.pushDefault) can make differ from @{push}.
      const upstream = await deps.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], treePath);
      const onOrigin = (r: { code: number; stdout: string }) => r.code === 0 && r.stdout.trim() === `origin/${want}`;
      const matches = sym.code === 0 && sym.stdout.trim() === `refs/heads/${want}` && onOrigin(pushRef) && onOrigin(upstream);
      if (branch.mismatch !== null || !matches) {
        const why = `${branch.mismatch ? `${branch.mismatch}; ` : ""}expected HEAD on ${want} pushing to and tracking origin/${want}, but git symbolic-ref --quiet HEAD printed ${gitOutput(sym)}, git rev-parse --abbrev-ref @{push} printed ${gitOutput(pushRef)} and git rev-parse --abbrev-ref --symbolic-full-name @{u} printed ${gitOutput(upstream)}${upstream.code !== 0 ? `; the branch has no upstream, so push it once with git_push {setUpstream: true} and call again` : ""}`;
        for (const a of fixRows) hold(a.threadId, "mismatch", why);
      } else {
        let pushed = await gitPush(treePath, {}, deps.git);
        progress?.();
        if (!pushed.ok) {
          pushed = await gitPush(treePath, {}, deps.git);
          progress?.();
        }
        const landedOn = pushed.ok ? (pushed.body as { upstream?: unknown } | null)?.upstream : undefined;
        if (pushed.ok && landedOn === `origin/${want}`) result.pushed = { branch: want };
        else if (pushed.ok) for (const a of fixRows) hold(a.threadId, "push", `git push went to ${String(landedOn)}, not origin/${want}, so the fix is not on the MR's branch`);
        else for (const a of fixRows) hold(a.threadId, "push", pushed.error ?? "git push failed");
      }
    }

    const reply = (a: PostAction) =>
      deps.command<Commands["discussions:reply"]["data"]>("discussions:reply", { repoName: target.identity, iid: target.iid, discussionId: a.threadId, body: a.body! }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
    for (const a of acting) {
      if (!a.post || heldIds.has(a.threadId)) continue;
      const before = postedBefore.get(a.threadId);
      if (before?.posted && before.noteId !== null) {
        result.alreadyPosted.push({ threadId: a.threadId, noteId: before.noteId });
        continue;
      }
      const first = await reply(a);
      progress?.();
      if (first.ok) {
        result.posted.push(a.threadId);
        continue;
      }
      const firstError = explainError(first.error ?? "reply failed");
      // The error may have come after GitLab stored the note, so only a re-read that shows no reply makes a second post safe.
      const reread = await readThreads(deps, target);
      progress?.();
      if (!reread.ok) {
        hold(a.threadId, "reply", `${firstError}; the re-read to check whether it landed also failed (${reread.error}), so it was not retried`);
        continue;
      }
      const landed = postedMatch(reread.discussions, { by, since, threads: [{ discussionId: a.threadId, body: a.body! }] }).threads[0];
      if (landed?.posted) {
        result.posted.push(a.threadId);
        continue;
      }
      const second = await reply(a);
      progress?.();
      if (second.ok) result.posted.push(a.threadId);
      else hold(a.threadId, "reply", explainError(second.error ?? "reply failed"));
    }

    const resolve = (a: PostAction) =>
      deps.command<Commands["discussions:resolve"]["data"]>("discussions:resolve", { repoName: target.identity, iid: target.iid, discussionId: a.threadId, resolved: true }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
    for (const a of acting) {
      if (!a.resolve || heldIds.has(a.threadId)) continue;
      if (discussions.find((d) => d.id === a.threadId)?.resolved === true) {
        result.alreadyResolved.push(a.threadId);
        continue;
      }
      let r = await resolve(a);
      progress?.();
      if (!r.ok) {
        r = await resolve(a);
        progress?.();
      }
      if (r.ok) result.resolved.push(a.threadId);
      else hold(a.threadId, "resolve", explainError(r.error ?? "resolve failed"));
    }
  }

  if (plan.postDecision) {
    const selection: Record<string, unknown> = { ...plan.postDecision.selection };
    delete selection.held;
    if (heldIds.size > 0) selection.held = [...heldIds];
    const r = await deps.runTool("run_decision", { runDb, contract: GATE_CONTRACT, scope: "respond-post", selection, decidedBy: plan.postDecision.decidedBy }, env);
    progress?.();
    result.recorded = r.ok;
    if (!r.ok) writeError(`re-recording the respond-post decision failed: ${r.error ?? "run_decision failed"}`);
  }
  await setHold();
  return ok(result);
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
      name: "respond_post_execute",
      description: "GitLab only. Receive-review's post side in one call: it acts only on the respond-plan and respond-post decisions recorded on the run, which must carry the gate-source fields `gate_open {runDb}` writes, after checking each against its gate source and registry answer, and refuses before anything moves when one is missing, stale or does not match. It reads the threads once, so a reply already on GitLab counts as alreadyPosted and a resolved thread as alreadyResolved; it pushes the run's branch from `tree` (never forced) only when a fix row is picked, the MR is still opened, and HEAD, @{push} and @{u} all name that branch on origin; `tree` must be a checkout of the MR's repo and is checked only when a push is due; then it posts the replies and resolves the threads. Pushes, replies and resolves are each retried once, and a reply that errored is re-read first so it never posts twice. Threads it could not finish come back in held[] with the hold field set to held under `stage`, for the skill's off-script gates; the respond-post decision is re-recorded with those ids as `held`, and a later call acts only on them. Returns {mr, pushed, posted, alreadyPosted, resolved, alreadyResolved, held, recorded, hold, writeErrors?}, where writeErrors carries the text of a failed re-record or hold write. One caller per run at a time: nothing stops two panes running it on the same run at once. On GitHub it refuses; reply to and resolve the threads with gh.",
      inputSchema: {
        type: "object",
        properties: {
          runDb: { type: "string", description: "The runDb run_start returned." },
          tree: { type: "string", description: "Absolute path of the registered worktree root a fix push goes from." },
          stage: { type: "string", description: "The stage the hold field is written under." },
        },
        required: ["runDb", "tree", "stage"],
        additionalProperties: false,
      },
      shellForms: { none: "composes git_push, mr_reply_thread and mr_resolve_thread; no single shell command is equivalent" },
      async handler(input, env, _signal, progress) {
        const bad = checkRequired(input, [{ name: "runDb", type: "string" }, { name: "tree", type: "string" }, { name: "stage", type: "string" }]);
        if (bad) return err(bad);
        return executeRespondPost(deps, { runDb: input.runDb as string, tree: input.tree as string, stage: input.stage as string }, env, progress);
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
