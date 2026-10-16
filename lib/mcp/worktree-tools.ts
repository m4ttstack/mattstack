import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands, WorktreeTreeRef } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { isRepoRegistered } from "../repo-index.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, REPO_NAME_RULE, type McpToolDef } from "./shared.ts";

const PROVISION_TIMEOUT_MS = 300_000;
const DISPOSE_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 30_000;
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

function attachedReason(t: WorktreeTreeRef): string {
  if (t.treeKind === "main") return "main-checkout";
  return t.state === "disposable" ? "disposable" : (t.state ?? t.treeKind);
}

export interface WorktreeToolDeps {
  command: typeof rtCommand;
  runTools?: () => McpToolDef[];
  resolveRepo?: (repoName: unknown) => Promise<{ identity: string } | { error: string; unknown: boolean }>;
}

/** Whether the caller asked for any of the structured provision behaviors; a call that did not gets today's plain text. */
function optedIn(input: Record<string, unknown>): boolean {
  return input.codes === true || input.precheck === true || input.reuse === true || input.runDb !== undefined || input.budget !== undefined;
}

async function defaultResolveRepo(repoName: unknown): Promise<{ identity: string } | { error: string; unknown: boolean }> {
  const t = await resolveRepoTarget({ repoName });
  if (t.ok) return { identity: t.identity };
  return { error: t.error, unknown: await isUnknownRepo(repoName) };
}

async function isUnknownRepo(repoName: unknown): Promise<boolean> {
  if (typeof repoName !== "string" || !repoName.trim()) return false;
  const res = await tryResolveRepoArg(repoName.trim());
  if (res.kind === "none") return true;
  return res.kind === "resolved" && !isRepoRegistered(res.identity);
}

export function worktreeToolDefs(deps: WorktreeToolDeps = { command: rtCommand }): McpToolDef[] {
  const resolveRepo = deps.resolveRepo ?? defaultResolveRepo;
  async function repo(input: Record<string, unknown>): Promise<{ identity: string } | { error: string }> {
    const bad = checkRequired(input, [{ name: "repoName", type: "string" }]);
    if (bad) return { error: bad };
    const t = await resolveRepoTarget({ repoName: input.repoName });
    return t.ok ? { identity: t.identity } : { error: t.error };
  }
  /** Every structured refusal leaves through here. */
  function refuse(refusal: ProvisionRefusal) {
    return err(JSON.stringify(refusal));
  }
  async function provision(payload: Commands["worktree:provision"]["payload"], opted: boolean) {
    const res = await deps.command<Commands["worktree:provision"]["data"]>("worktree:provision", payload, { timeoutMs: PROVISION_TIMEOUT_MS });
    if (res.ok) return ok({ kind: "provisioned", ...res.data });
    const raw = res.error ?? "request failed";
    return opted ? refuse(parseProvisionError(raw)) : err(explainError(raw));
  }
  return [
    {
      name: "worktree_provision",
      description: `Claim a worktree for a ticket or branch (from the on-deck pool, or freshly created) and get back its path; then enter it with EnterWorktree in path mode. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...REPO_PROP, ticket: { type: "string" }, ticketTitle: { type: "string" }, branch: { type: "string" }, disposal: { type: "string", enum: ["merge", "job"] }, owner: { type: "string" }, codes: { type: "boolean", description: "Refusals come back as JSON text with a machine-readable code instead of prose." },
          precheck: { type: "boolean", description: "Only report the branch a provision would use and the trees already on it; nothing is created. Not with reuse." },
          reuse: { type: "boolean", description: "Return the tree already on the branch (an unmanaged or claimed one) instead of provisioning; provisions only when none is. Not with precheck." },
        },
        required: ["repoName"],
        additionalProperties: false,
      },
      shellForms: ["rt worktree provision", "git worktree add"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ticket", type: "string" }, { name: "ticketTitle", type: "string" }, { name: "branch", type: "string" }, { name: "disposal", type: "string" }, { name: "owner", type: "string" }, { name: "codes", type: "boolean" }, { name: "precheck", type: "boolean" }, { name: "reuse", type: "boolean" }]);
        if (bad) return err(bad);
        if (typeof input.ticket !== "string" && typeof input.branch !== "string") return err("pass a ticket (with an optional ticketTitle) or a branch");
        if (input.disposal !== undefined && input.disposal !== "merge" && input.disposal !== "job") return err('"disposal" must be merge or job');
        if (input.precheck === true && input.reuse === true) return err("precheck and reuse are separate calls");
        const badRepo = checkRequired(input, [{ name: "repoName", type: "string" }]);
        if (badRepo) return err(badRepo);
        const opted = optedIn(input);
        const r = await resolveRepo(input.repoName);
        if ("error" in r) {
          return opted && r.unknown ? refuse({ kind: "refused", code: "repo-unknown", error: r.error }) : err(r.error);
        }
        if (input.precheck === true || input.reuse === true) {
          const checkPayload: Commands["worktree:provision-check"]["payload"] = { repoName: r.identity };
          for (const k of ["ticket", "ticketTitle", "branch"] as const) if (typeof input[k] === "string") checkPayload[k] = input[k] as string;
          const check = await deps.command<Commands["worktree:provision-check"]["data"]>("worktree:provision-check", checkPayload, { timeoutMs: CHECK_TIMEOUT_MS });
          if (!check.ok || !check.data) return refuse(parseProvisionError(check.error ?? "request failed"));
          if (input.precheck === true) return ok({ kind: "precheck", ...check.data });
          const { attached, base, localBranch } = check.data;
          if (attached.length > 1) return refuse({ kind: "refused", code: "branch-duplicated", trees: attached.map((t) => t.tree), error: explainError("branch-duplicated") });
          const only = attached[0];
          if (only) {
            if (!isReusable(only)) return refuse({ kind: "refused", code: "branch-attached", tree: only.tree, reason: attachedReason(only), error: explainError(`branch-attached:${only.tree}`) });
            const { tree, path, branch, treeKind, state, owner, disposal } = only;
            return ok({ kind: "reused", tree, path, branch, treeKind, ...(state ? { state } : {}), ...(owner ? { owner } : {}), ...(disposal ? { disposal } : {}) });
          }
          if (localBranch && typeof input.branch !== "string") {
            const resume: Commands["worktree:provision"]["payload"] = { repoName: r.identity, branch: base };
            if (typeof input.owner === "string") resume.owner = input.owner;
            if (input.disposal === "merge" || input.disposal === "job") resume.disposal = input.disposal;
            return provision(resume, opted);
          }
        }
        const payload: Commands["worktree:provision"]["payload"] = { repoName: r.identity };
        for (const k of ["ticket", "ticketTitle", "branch", "owner"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (input.disposal === "merge" || input.disposal === "job") payload.disposal = input.disposal;
        return provision(payload, opted);
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
