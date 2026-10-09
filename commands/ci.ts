/**
 * rt ci: the CI attendant lease and pipeline watch, as a human/headless CLI.
 *
 *   rt ci lease claim <mr-url> [--holder watch-ci|doctor] [--branch <b>] [--json]
 *   rt ci lease heartbeat <mr-url> [--json]
 *   rt ci lease release <mr-url> [--json]
 *   rt ci lease show <mr-url> [--json]
 *   rt ci watch <mr-url> --sha <sha> [--max-wait <s>] [--interval <s>] [--prior-pipeline <id>] [--json]
 *
 * `rt ci watch` invokes the ci_watch MCP tool in-process (ciToolDefs), so
 * the CLI and the agent-facing tool share one watchPipeline code path. It
 * passes cliOwner as the tool's owner function, so a human's watch
 * heartbeats the same user:<login> lease `rt ci lease claim` claimed.
 *
 * With agent.integrations.enabled on, a command run inside a bound agent
 * session acts as that binding, with the owner the MCP tools use
 * (ciLeaseOwner); anything no binding names keeps cliOwner.
 */
import { userInfo } from "node:os";
import {
  CiLeaseError, claimCiLease, heartbeatCiLease, leaseOwner, ownsCiLease, readCiLease, releaseCiLease,
  type CiLeaseCaller, type CiLeaseHolder,
} from "../packages/rt-client/src/index.ts";
import type { CallerContext, SessionBinding } from "../packages/rt-client/src/agent-integrations.ts";
import { bindingLeaseCaller, ciToolDefs, isHttpsMrUrl, ownerFromEnv, type CiWatchToolDeps } from "../lib/mcp/ci-tools.ts";
import * as out from "../lib/ui/out.ts";

export function cliOwner(env: NodeJS.ProcessEnv): string {
  return ownerFromEnv(env) ?? `user:${env.USER || userInfo().username}`;
}

export type CiCliDeps = {
  /** The binding this command's own session evidence names; undefined for a person, a script or an unbound session. */
  binding?: (env: NodeJS.ProcessEnv) => SessionBinding | undefined;
};

/**
 * The bound caller with the switch on, else null. No `--session` is read:
 * rt ci takes no such flag, so only the session the command runs in counts.
 */
async function cliCaller(env: NodeJS.ProcessEnv, deps: CiCliDeps): Promise<CallerContext | null> {
  const { integrationsEnabled } = await import("../lib/agent-integrations/switch.ts");
  if (!integrationsEnabled()) return null;
  const resolve = deps.binding ?? (await import("../lib/agent-integrations/context.ts")).resolveCliBinding.bind(null, []);
  const binding = resolve(env);
  return binding ? { binding } : null;
}

async function leaseCaller(env: NodeJS.ProcessEnv, deps: CiCliDeps): Promise<CiLeaseCaller> {
  const caller = await cliCaller(env, deps);
  return caller ? bindingLeaseCaller(caller) : cliOwner(env);
}

function claimOwner(caller: CiLeaseCaller): { owner: string; alsoOwns?: (token: string) => boolean } {
  return typeof caller === "string" ? { owner: caller } : caller;
}

/** A value that starts with `--` is the next flag, never this flag's value. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v === undefined || v.startsWith("--") ? undefined : v;
}

/** True when `name` is present with no value after it, so `flag`'s undefined means "no value given" rather than "flag absent" (a defaulted flag must not conflate the two). */
function danglingFlag(args: string[], name: string): boolean {
  return args.includes(name) && flag(args, name) === undefined;
}

function requireValues(args: string[], json: boolean, names: readonly string[]): void {
  for (const name of names) {
    if (danglingFlag(args, name)) emit(json, { error: `${name} requires a value` }, `${name} requires a value`, 2);
  }
}

function positional(args: string[]): string | undefined {
  return args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--json"));
}

/** json always goes to stdout regardless of exit code, so a --json caller can still parse a failure; plain text follows the exit code (0 to stdout, non-zero to stderr). */
function emit(json: boolean, body: unknown, text: string, code = 0): never {
  if (json) out.json(body);
  else if (code === 0) out.payload(`${text}\n`);
  else out.diagnostic(`${text}\n`);
  process.exit(code);
}

function mrArg(args: string[], json: boolean, verb: string): string {
  const mr = positional(args);
  if (!mr || !isHttpsMrUrl(mr)) {
    const usage = `usage: rt ci lease ${verb} <mr-url>`;
    emit(json, { error: usage }, `${usage} (an https MR or PR URL)`, 2);
  }
  return mr;
}

function guard<T>(json: boolean, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof CiLeaseError) emit(json, { error: e.message }, e.message, 1);
    throw e;
  }
}

export async function ciLeaseClaim(args: string[], deps: CiCliDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json, "claim");
  if (danglingFlag(args, "--holder")) emit(json, { error: "--holder requires a value: watch-ci or doctor" }, "--holder requires a value: watch-ci or doctor", 2);
  requireValues(args, json, ["--branch"]);
  const holder = (flag(args, "--holder") ?? "watch-ci") as CiLeaseHolder;
  if (holder !== "watch-ci" && holder !== "doctor") emit(json, { error: "--holder must be watch-ci or doctor" }, "--holder must be watch-ci or doctor", 2);
  const branch = flag(args, "--branch");
  const caller = await leaseCaller(process.env, deps);
  const r = guard(json, () => claimCiLease({ mrUrl, ...claimOwner(caller), holder, ...(branch && { branch }) }));
  if (r.claimed) emit(json, r, `claimed ${mrUrl}${r.previousOwner ? ` (took over from ${r.previousOwner})` : ""}`);
  emit(json, r, `held by ${leaseOwner(r.holder)} (${r.holder.holder})`, 3);
}

export async function ciLeaseHeartbeat(args: string[], deps: CiCliDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json, "heartbeat");
  const caller = await leaseCaller(process.env, deps);
  const r = guard(json, () => heartbeatCiLease(mrUrl, caller));
  if (r.ok) emit(json, r, "heartbeat recorded");
  emit(json, r, r.reason === "lost" ? `lost: held by ${leaseOwner(r.holder)}` : "no lease", 3);
}

export async function ciLeaseRelease(args: string[], deps: CiCliDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json, "release");
  const caller = await leaseCaller(process.env, deps);
  const r = guard(json, () => releaseCiLease(mrUrl, caller));
  if (r.released) emit(json, r, "released");
  // not-owner is a refusal, exit 3, matching claim and heartbeat; none is
  // idempotent (nothing to release) and stays exit 0.
  if (r.reason === "not-owner") emit(json, r, `not yours: held by ${leaseOwner(r.holder)}`, 3);
  emit(json, r, "no lease");
}

export async function ciLeaseShow(args: string[], deps: CiCliDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json, "show");
  const r = guard(json, () => readCiLease(mrUrl));
  const mine = r.lease !== null && ownsCiLease(r.lease, await leaseCaller(process.env, deps));
  emit(json, { ...r, mine }, r.lease ? `${leaseOwner(r.lease)} (${r.lease.holder}), heartbeat ${new Date(r.lease.heartbeatAt).toISOString()}` : "none", r.lease ? 0 : 1);
}

export async function ciWatch(args: string[]): Promise<void> {
  await runCiWatch(args);
}

export async function runCiWatch(args: string[], watch: Partial<CiWatchToolDeps> = {}, deps: CiCliDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = positional(args);
  requireValues(args, json, ["--sha", "--max-wait", "--interval", "--prior-pipeline"]);
  const sha = flag(args, "--sha");
  if (!mrUrl || !isHttpsMrUrl(mrUrl) || !sha) {
    emit(json, { error: "usage: rt ci watch <mr-url> --sha <sha>" }, "usage: rt ci watch <mr-url> --sha <sha>", 2);
  }
  const caller = await cliCaller(process.env, deps);
  const tool = ciToolDefs({
    owner: cliOwner,
    caller: async () => (caller ? { ok: true, data: caller } : null),
    watch,
  }).find((t) => t.name === "ci_watch")!;
  const input: Record<string, unknown> = { mrUrl, sha };
  for (const [f, k] of [["--max-wait", "maxWaitSeconds"], ["--interval", "intervalSeconds"], ["--prior-pipeline", "priorPipelineId"]] as const) {
    const v = flag(args, f);
    if (v !== undefined) input[k] = Number(v);
  }

  // Ctrl-C aborts the in-flight sleep rather than killing the process, so
  // watchPipeline still returns its normal "aborted" state/lease shape
  // instead of leaving the lease heartbeat mid-cycle.
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  let r: Awaited<ReturnType<typeof tool.handler>>;
  try {
    r = await tool.handler(input, process.env, controller.signal);
  } finally {
    process.off("SIGINT", onSignal);
  }

  if (!r.ok) emit(json, { error: r.error }, r.error ?? "watch failed", 1);
  const body = r.body as { state: string; next: string };
  // 130 matches the SIGINT convention lib/cli-logger.ts already reads as "cancelled".
  if (body.state === "aborted") emit(json, body, `${body.state}: ${body.next}`, 130);
  emit(json, body, `${body.state}: ${body.next}`, body.state === "success" || body.state === "success_with_warnings" ? 0 : 1);
}
