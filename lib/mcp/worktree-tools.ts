import { basename, isAbsolute } from "node:path";
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands, WorktreeTreeRef } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { isRepoRegistered } from "../repo-index.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { runToolDefs } from "./run-tools.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, REPO_NAME_RULE, type McpToolDef } from "./shared.ts";

const PROVISION_TIMEOUT_MS = 300_000;
const DISPOSE_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 30_000;
const RUN_DB_ERROR = '"runDb" must be the absolute path of a run\'s state.db';
const REPO_PROP = { repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." } };

export interface ProvisionRefusal {
  kind: "refused";
  code: string;
  error: string;
  tree?: string;
  trees?: string[];
  step?: string;
  detail?: string;
  reason?: string;
  owner?: string;
  claimedAt?: string;
  budget?: Record<string, unknown>;
}

/** Classifies a daemon error string; the daemon's strings never change, so this is the only place that reads them. */
export function parseProvisionError(raw: string): ProvisionRefusal {
  const error = explainError(raw);
  const refusal = (code: string, extra: Partial<ProvisionRefusal> = {}): ProvisionRefusal => ({ kind: "refused", code, error, ...extra });
  if (raw === "busy" || raw === "repo-unknown" || raw === "branch-unresolved" || raw === "branch-duplicated" || raw === "claim-write-failed" || raw === "handoff-write-failed") return refusal(raw);
  if (raw.startsWith("branch-attached:")) return refusal("branch-attached", { tree: raw.slice("branch-attached:".length) });
  if (raw.startsWith("checkout-failed:")) return refusal("checkout-failed", { detail: raw.slice("checkout-failed:".length) });
  if (raw.startsWith("create-failed:")) {
    const [step, ...rest] = raw.slice("create-failed:".length).split("\n");
    const detail = rest.join("\n");
    return refusal("create-failed", { step, ...(detail ? { detail } : {}) });
  }
  if (raw.startsWith("unsafe git ref")) return refusal("unsafe-ref", { detail: raw });
  if (raw.startsWith("rt daemon unreachable at ")) return refusal("daemon-unreachable", { detail: raw });
  if (/^daemon at version .* does not know "/.test(raw)) return refusal("daemon-outdated", { detail: raw });
  return refusal("error", { detail: raw });
}

function isReusable(t: WorktreeTreeRef): boolean {
  return t.treeKind === "unmanaged" || (t.treeKind === "ephemeral" && t.state === "claimed");
}

/** The owners a caller answers to: the owner it passed, and its herd's claim (the daemon writes `herd:<id>` on a herd's trees). */
function callerOwners(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Set<string> {
  const mine = new Set<string>();
  if (typeof input.owner === "string" && input.owner) mine.add(input.owner);
  if (env.HERD_ID) mine.add(`herd:${env.HERD_ID}`);
  return mine;
}

function heldRefusal(t: WorktreeTreeRef & { owner: string }): ProvisionRefusal {
  const since = t.claimedAt ? ` since ${t.claimedAt}` : "";
  return {
    kind: "refused", code: "tree-held", tree: t.tree, owner: t.owner, ...(t.claimedAt ? { claimedAt: t.claimedAt } : {}),
    error: `worktree ${t.tree} is held by ${t.owner}${since}; reuse it only after the human picks it, by calling again with takeOver: true`,
  };
}

function attachedReason(t: WorktreeTreeRef): string {
  if (t.treeKind === "main") return "main-checkout";
  return t.state === "disposable" ? "disposable" : (t.state ?? t.treeKind);
}

export interface WorktreeToolDeps {
  command: typeof rtCommand;
  runTools?: () => McpToolDef[];
  resolveRepo?: (repoName: unknown) => Promise<{ identity: string } | { error: string; unknown: () => Promise<boolean> }>;
}

/** Whether the caller asked for any of the structured provision behaviors; a call that did not gets today's plain text. */
function optedIn(input: Record<string, unknown>): boolean {
  return input.codes === true || input.precheck === true || input.reuse === true || input.runDb !== undefined || input.budget !== undefined;
}

interface RunContext {
  env: NodeJS.ProcessEnv;
  runDb?: string;
  stage: string;
  budget?: { key: string; limit: number };
}

/** Reads runDb, stage and budget; returns the input error, or the context the run hooks use. */
function runContext(input: Record<string, unknown>, env: NodeJS.ProcessEnv): RunContext | { error: string } {
  const bad = checkOptional(input, [{ name: "runDb", type: "string" }, { name: "stage", type: "string" }]);
  if (bad) return { error: bad };
  const runDb = input.runDb as string | undefined;
  const stage = input.stage as string | undefined;
  if (stage !== undefined && stage.trim() === "") return { error: '"stage" must be a non-empty string' };
  if (runDb !== undefined && (!isAbsolute(runDb) || basename(runDb) !== "state.db")) return { error: RUN_DB_ERROR };
  const ctx: RunContext = { env, stage: stage ?? "provision" };
  if (runDb !== undefined) ctx.runDb = runDb;
  if (input.budget !== undefined) {
    const b = input.budget as { key?: unknown; limit?: unknown } | null;
    if (typeof b !== "object" || b === null || Array.isArray(b) || typeof b.key !== "string" || b.key === "" || typeof b.limit !== "number" || !Number.isInteger(b.limit) || b.limit < 1) {
      return { error: '"budget" must be {key: a non-empty string, limit: an integer of 1 or more}' };
    }
    if (runDb === undefined) return { error: '"budget" needs "runDb"' };
    ctx.budget = { key: b.key, limit: b.limit };
  }
  return ctx;
}

async function defaultResolveRepo(repoName: unknown): Promise<{ identity: string } | { error: string; unknown: () => Promise<boolean> }> {
  const t = await resolveRepoTarget({ repoName });
  if (t.ok) return { identity: t.identity };
  return { error: t.error, unknown: () => isUnknownRepo(repoName) };
}

async function isUnknownRepo(repoName: unknown): Promise<boolean> {
  if (typeof repoName !== "string" || !repoName.trim()) return false;
  const res = await tryResolveRepoArg(repoName.trim());
  if (res.kind === "none") return true;
  return res.kind === "resolved" && !isRepoRegistered(res.identity);
}

export function worktreeToolDefs(deps: WorktreeToolDeps = { command: rtCommand }): McpToolDef[] {
  const resolveRepo = deps.resolveRepo ?? defaultResolveRepo;
  const runTool = (name: string): McpToolDef | undefined => (deps.runTools ?? runToolDefs)().find((t) => t.name === name);
  async function repo(input: Record<string, unknown>): Promise<{ identity: string } | { error: string }> {
    const bad = checkRequired(input, [{ name: "repoName", type: "string" }]);
    if (bad) return { error: bad };
    const t = await resolveRepoTarget({ repoName: input.repoName });
    return t.ok ? { identity: t.identity } : { error: t.error };
  }
  const pickBudget = ({ key, spent, limit, remaining, exhausted }: Record<string, unknown>) => ({ key, spent, limit, remaining, exhausted });
  /** Every structured refusal leaves through here, and is where a budget is charged. */
  async function refuse(refusal: ProvisionRefusal, ctx: RunContext) {
    if (ctx.budget && ctx.runDb) {
      const tool = runTool("run_budget");
      if (!tool) refusal.budget = { error: "run_budget is not available on this rt" };
      else {
        const r = await tool.handler({ runDb: ctx.runDb, key: ctx.budget.key, limit: ctx.budget.limit, stage: ctx.stage }, ctx.env);
        refusal.budget = r.ok ? pickBudget(r.body as Record<string, unknown>) : { error: r.error };
      }
    }
    return err(JSON.stringify(refusal));
  }
  /** Writes the tree's branch then its path onto the run; the first failure stops the writes and leaves the tree in the result. */
  async function record(body: { branch?: string; path?: string; [k: string]: unknown }, ctx: RunContext) {
    if (!ctx.runDb) return ok(body);
    const tool = runTool("run_field_set");
    if (!tool) return ok({ ...body, recordError: "run_field_set is not available" });
    if (typeof body.branch !== "string" || typeof body.path !== "string") return ok({ ...body, recordError: "the tree has no branch or path to record" });
    for (const [key, value] of [["branch", body.branch], ["worktree", body.path]] as const) {
      const r = await tool.handler({ runDb: ctx.runDb, key, value, stage: ctx.stage }, ctx.env);
      if (!r.ok) return ok({ ...body, recordError: r.error });
    }
    return ok({ ...body, recorded: true });
  }
  async function provision(payload: Commands["worktree:provision"]["payload"], opted: boolean, ctx: RunContext) {
    const res = await deps.command<Commands["worktree:provision"]["data"]>("worktree:provision", payload, { timeoutMs: PROVISION_TIMEOUT_MS });
    if (res.ok) return record({ kind: "provisioned", ...res.data }, ctx);
    const raw = res.error ?? "request failed";
    return opted ? refuse(parseProvisionError(raw), ctx) : err(explainError(raw));
  }
  return [
    {
      name: "worktree_provision",
      description: [
        "Claim a worktree for a ticket or branch (from the on-deck pool, or freshly created) and get back its path; then enter it with EnterWorktree in path mode.",
        'A success says what happened in "kind": "provisioned" (a tree was claimed or created), "reused" (an existing tree was returned) or "precheck" (nothing was created; see precheck). A refusal comes back as an error, "refused" in the JSON form.',
        "Options, all off by default. A call that uses none of them gets plain-text refusals, as always. Using any of codes, precheck, reuse, runDb or budget makes every refusal JSON text with a code (stage alone does not).",
        "codes: refusals as JSON with a code. The codes are branch-attached, branch-duplicated, branch-unresolved, tree-held, busy, repo-unknown, create-failed, checkout-failed, claim-write-failed, handoff-write-failed, unsafe-ref, daemon-unreachable, daemon-outdated and error.",
        "precheck: report the branch a provision would use and the trees already on it, and create nothing.",
        "reuse: hand back the tree already on the branch when it is claimed or not managed by rt, instead of provisioning. In ticket mode a local branch that survives its tree is checked out again. Provisions as usual when there is nothing to reuse.",
        'A claimed tree whose owner is neither the owner passed nor this herd ("herd:<HERD_ID>") is held by someone else: reuse refuses it with tree-held, naming the owner and claimedAt. takeOver: true reuses it anyway; pass it only when a human picked that tree. The owner is asserted by the caller, never checked, so it guards a caller that follows its skill, not a deliberate one.',
        'runDb and stage: write the tree\'s branch and worktree path to that run (stage defaults to "provision"). The result says recorded, or recordError when a write failed. Precheck and refusals write nothing.',
        "budget {key, limit}, with runDb: each refusal is counted through run_budget, and the result's budget shows what is spent and left. The stage must already be started on the run (run_stage start), or budget holds an error instead of a count; it also holds an error when run_budget is missing.",
        REPO_NAME_RULE,
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: { ...REPO_PROP, ticket: { type: "string" }, ticketTitle: { type: "string" }, branch: { type: "string" }, disposal: { type: "string", enum: ["merge", "job"] }, owner: { type: "string" }, codes: { type: "boolean", description: "Refusals come back as JSON text with a machine-readable code instead of prose." },
          precheck: { type: "boolean", description: "Only report the branch a provision would use and the trees already on it; nothing is created. Not with reuse." },
          reuse: { type: "boolean", description: "Return the tree already on the branch (an unmanaged or claimed one) instead of provisioning; provisions only when none is. Not with precheck." },
          takeOver: { type: "boolean", description: "With reuse: reuse a tree another owner holds instead of refusing tree-held. Only after a human picked that tree." },
          runDb: { type: "string", description: "Absolute path of a run's state.db; the tree's branch and worktree path are written to that run." },
          stage: { type: "string", description: 'The run stage those writes and the budget belong to. Default "provision".' },
          budget: { type: "object", properties: { key: { type: "string" }, limit: { type: "integer", minimum: 1 } }, required: ["key", "limit"], additionalProperties: false, description: "Count each refusal against this limit through run_budget. Needs runDb." },
        },
        required: ["repoName"],
        additionalProperties: false,
      },
      shellForms: ["rt worktree provision", "git worktree add"],
      async handler(input, env) {
        const bad = checkOptional(input, [{ name: "ticket", type: "string" }, { name: "ticketTitle", type: "string" }, { name: "branch", type: "string" }, { name: "disposal", type: "string" }, { name: "owner", type: "string" }, { name: "codes", type: "boolean" }, { name: "precheck", type: "boolean" }, { name: "reuse", type: "boolean" }, { name: "takeOver", type: "boolean" }]);
        if (bad) return err(bad);
        if (input.takeOver !== undefined && input.reuse !== true) return err("takeOver only goes with reuse");
        const ctx = runContext(input, env);
        if ("error" in ctx) return err(ctx.error);
        if (typeof input.ticket !== "string" && typeof input.branch !== "string") return err("pass a ticket (with an optional ticketTitle) or a branch");
        if (input.disposal !== undefined && input.disposal !== "merge" && input.disposal !== "job") return err('"disposal" must be merge or job');
        if (input.precheck === true && input.reuse === true) return err("precheck and reuse are separate calls");
        const badRepo = checkRequired(input, [{ name: "repoName", type: "string" }]);
        if (badRepo) return err(badRepo);
        const opted = optedIn(input);
        const r = await resolveRepo(input.repoName);
        if ("error" in r) {
          return opted && (await r.unknown()) ? refuse({ kind: "refused", code: "repo-unknown", error: r.error }, ctx) : err(r.error);
        }
        if (input.precheck === true || input.reuse === true) {
          const checkPayload: Commands["worktree:provision-check"]["payload"] = { repoName: r.identity };
          for (const k of ["ticket", "ticketTitle", "branch"] as const) if (typeof input[k] === "string") checkPayload[k] = input[k] as string;
          const check = await deps.command<Commands["worktree:provision-check"]["data"]>("worktree:provision-check", checkPayload, { timeoutMs: CHECK_TIMEOUT_MS });
          if (!check.ok || !check.data) return refuse(parseProvisionError(check.error ?? "request failed"), ctx);
          if (input.precheck === true) return ok({ kind: "precheck", ...check.data });
          const { attached, base, localBranch } = check.data;
          if (attached.length > 1) return refuse({ kind: "refused", code: "branch-duplicated", trees: attached.map((t) => t.tree), error: explainError("branch-duplicated") }, ctx);
          const only = attached[0];
          if (only) {
            if (!isReusable(only)) return refuse({ kind: "refused", code: "branch-attached", tree: only.tree, reason: attachedReason(only), error: explainError(`branch-attached:${only.tree}`) }, ctx);
            if (only.state === "claimed" && only.owner && input.takeOver !== true && !callerOwners(input, env).has(only.owner)) {
              return refuse(heldRefusal({ ...only, owner: only.owner }), ctx);
            }
            const { tree, path, branch, treeKind, state, owner, disposal } = only;
            return record({ kind: "reused", tree, path, branch, treeKind, ...(state ? { state } : {}), ...(owner ? { owner } : {}), ...(disposal ? { disposal } : {}) }, ctx);
          }
          if (localBranch && typeof input.branch !== "string") {
            const resume: Commands["worktree:provision"]["payload"] = { repoName: r.identity, branch: base };
            if (typeof input.owner === "string") resume.owner = input.owner;
            if (input.disposal === "merge" || input.disposal === "job") resume.disposal = input.disposal;
            return provision(resume, opted, ctx);
          }
        }
        const payload: Commands["worktree:provision"]["payload"] = { repoName: r.identity };
        for (const k of ["ticket", "ticketTitle", "branch", "owner"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (input.disposal === "merge" || input.disposal === "job") payload.disposal = input.disposal;
        return provision(payload, opted, ctx);
      },
    },
    {
      name: "worktree_dispose",
      description: `Dispose a worktree by its tree name; it goes to the restorable trash. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string", description: "The tree name as worktree list prints it." } }, required: ["repoName", "tree"], additionalProperties: false },
      shellForms: ["rt worktree dispose"],
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:dispose"]["data"]>("worktree:dispose", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: DISPOSE_TIMEOUT_MS }));
      },
    },
    {
      name: "worktree_stop_holders",
      description: `End the processes rt ties to a worktree (dev servers, watchers), and only those. There is no general kill tool. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string" } }, required: ["repoName", "tree"], additionalProperties: false },
      shellForms: [{ id: "pkill", pattern: /\bpkill\b|\bkill\s+(-\w+\s+)?\$/, example: "pkill -f <path>", note: "ends only the processes rt ties to the tree" }],
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:stop-holders"]["data"]>("worktree:stop-holders", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: 60_000 }));
      },
    },
  ];
}
