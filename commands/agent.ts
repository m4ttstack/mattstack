/**
 * rt agent: hand a prompt to a Claude Code agent and keep the receipt.
 *
 *   rt agent start  [--repo <path>] [--prompt <text> | --prompt-file <path>]
 *                   [--surface herdr|headless] [--provider claude|codex]
 *                   [--model M] [--effort E] [--yolo | --no-yolo]
 *                   [--account A] [--label L] [--caller C]
 *                   [--workspace W] [--tab T] [--extra-args "<tail>"]
 *                   [--bg] [--json]
 *   rt agent resume <id|session-uuid> [--prompt <text>] [--surface herdr|headless]
 *                   [--workspace W] [--tab T] [--json]
 *   rt agent show   <id|session-uuid> [--json]
 *   rt agent list   [--repo <path>] [--json]
 *
 * Thin client over agent:* daemon handlers; the daemon owns spawning,
 * session-uuid minting, and the record. Spec:
 * docs/superpowers/specs/2026-08-25-rt-agent-handoff-design.md
 */

import { readFileSync, realpathSync } from "fs";
import { builtinRegistry } from "../lib/agent-integrations/builtins.ts";
import { integrationsEnabled } from "../lib/agent-integrations/context.ts";
import { BOUND_LAUNCH_CLIENT_TIMEOUT_MS } from "../lib/agent-integrations/timeouts.ts";
import { verbHelpRequested } from "../lib/cli-verb-help.ts";
import { isDaemonRunning } from "../lib/daemon-client.ts";
import { currentRepoIdentity, repoLabel, resolveRepoArg } from "../lib/repo-arg.ts";
import { callerCswapAccount } from "../lib/cswap.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import {
  agentGet, agentIntegrations, agentList, agentResume, agentStart,
  type AgentRecord, type AgentSurface,
} from "../packages/rt-client/src/index.ts";
import type { RtResponse } from "../packages/rt-client/src/index.ts";
import type { IntegrationSummary } from "../packages/rt-client/src/agent-integrations.ts";

const integrations = builtinRegistry();

/**
 * With agent.integrations.enabled on, a start or resume binds its session
 * before the daemon answers, which for Codex includes an initialization turn
 * and a terminal attach, so the client waits that long. Off, the client's
 * own default stands.
 */
export function launchClientOptions(enabled: boolean = integrationsEnabled()): { timeoutMs?: number } {
  return enabled ? { timeoutMs: BOUND_LAUNCH_CLIENT_TIMEOUT_MS } : {};
}

const FLAGS_WITH_VALUES = new Set([
  "--repo", "--prompt", "--prompt-file", "--surface", "--model", "--effort",
  "--account", "--label", "--caller", "--workspace", "--tab", "--extra-args", "--provider",
]);

function fail(msg: string): never {
  out.diagnostic(`rt agent: ${msg}\n`);
  process.exit(1);
}

/** One line an agent may be reading: stdout, byte for byte. */
function say(text: string): void {
  out.payload(`${text}\n`);
}

/** Blocks for a person at a terminal; the frozen text for every other reader. */
function show(blocks: () => Block[], frozen: () => string): void {
  if (out.isHuman()) out.print(...blocks());
  else say(frozen());
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return true;
    if (FLAGS_WITH_VALUES.has(args[i]!)) i++;
  }
  return false;
}

function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed: is the rt daemon running?`);
  return res.data;
}

// Daemon-optional: the herdr and read verbs run in-process when the daemon is
// down. Headless is refused inside the fallback. The fallback
// module is imported lazily so a daemon-up call never loads daemon-side code.
async function dispatch<T>(
  command: "agent:start" | "agent:resume" | "agent:get" | "agent:list",
  payload: Record<string, unknown>,
  wrapper: () => Promise<RtResponse<T>>,
): Promise<RtResponse<T>> {
  if (await isDaemonRunning()) return wrapper();
  const { runAgentFallback } = await import("./agent-fallback.ts");
  try {
    return await runAgentFallback<T>(command, payload);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function parseSurface(s: string | undefined): AgentSurface | undefined {
  if (s === undefined) return undefined;
  if (s !== "herdr" && s !== "headless") throw new Error(`invalid surface "${s}": expected herdr or headless`);
  return s;
}

interface StartArgs {
  prompt?: string; surface?: AgentSurface; model?: string; effort?: string;
  account?: string; label?: string; caller?: string; workspace?: string;
  tab?: string; extraArgs?: string; bg?: boolean; provider?: string; yolo?: boolean;
}

function parseStartArgs(args: string[]): StartArgs {
  const prompt = flagValue(args, "--prompt");
  const promptFile = flagValue(args, "--prompt-file");
  if (prompt !== undefined && promptFile !== undefined) throw new Error("pass one of --prompt / --prompt-file, not both");
  const out: StartArgs = {};
  const resolved = promptFile !== undefined ? readFileSync(promptFile, "utf8").trim() : prompt;
  if (resolved !== undefined) out.prompt = resolved;
  const surface = parseSurface(flagValue(args, "--surface"));
  if (surface !== undefined) out.surface = surface;
  const provider = flagValue(args, "--provider");
  if (provider !== undefined) {
    if (!integrations.get(provider)) {
      const known = integrations.list().map((item) => item.id).join(" or ");
      throw new Error(`invalid provider "${provider}": expected ${known}`);
    }
    out.provider = provider;
  }
  for (const [flag, key] of [
    ["--model", "model"], ["--effort", "effort"], ["--account", "account"],
    ["--label", "label"], ["--caller", "caller"], ["--workspace", "workspace"],
    ["--tab", "tab"], ["--extra-args", "extraArgs"],
  ] as const) {
    const v = flagValue(args, flag);
    if (v !== undefined) out[key] = v;
  }
  if (hasFlag(args, "--bg")) {
    if (surface === "headless") throw new Error("--bg is a herdr-surface option");
    out.bg = true;
  }
  // Three states, not two: --yolo forces on, --no-yolo forces off, and
  // omitting both leaves yolo undefined so agent.<provider>.yolo decides.
  const yes = hasFlag(args, "--yolo");
  const no = hasFlag(args, "--no-yolo");
  if (yes && no) throw new Error("pass one of --yolo / --no-yolo, not both");
  if (yes) out.yolo = true;
  else if (no) out.yolo = false;
  return out;
}

function defaultProvider(): string {
  try {
    return getSetting<string>("agent.provider").value ?? "claude";
  } catch {
    return "claude";
  }
}

/** Mirrors agent:start's provider resolution. Only claude inherits: cswap accounts are Claude identities. */
async function withCallerAccount(
  parsed: StartArgs,
  resolveProvider: () => string = defaultProvider,
  resolveAccount: () => Promise<string | undefined> = () => callerCswapAccount(process.env),
): Promise<StartArgs> {
  if (parsed.account) return parsed;
  if ((parsed.provider ?? resolveProvider()) !== "claude") return parsed;
  const account = await resolveAccount();
  return account ? { ...parsed, account } : parsed;
}

function parseResumeArgs(args: string[]): { id: string; prompt?: string; surface?: AgentSurface; workspace?: string; tab?: string } {
  const id = positional(args);
  if (!id) throw new Error("missing id: rt agent resume <id|session-uuid>");
  const out: { id: string; prompt?: string; surface?: AgentSurface; workspace?: string; tab?: string } = { id };
  const prompt = flagValue(args, "--prompt");
  if (prompt !== undefined) out.prompt = prompt;
  const surface = parseSurface(flagValue(args, "--surface"));
  if (surface !== undefined) out.surface = surface;
  const workspace = flagValue(args, "--workspace");
  if (workspace !== undefined) out.workspace = workspace;
  const tab = flagValue(args, "--tab");
  if (tab !== undefined) out.tab = tab;
  return out;
}

async function repoAndCwd(args: string[]): Promise<{ repo: string; cwd: string }> {
  const repoArg = flagValue(args, "--repo");
  if (repoArg) {
    // start/resume need a real cwd, so --repo must be a directory here;
    // list accepts names because it never derives a cwd.
    let cwd: string;
    try {
      cwd = realpathSync(repoArg);
    } catch {
      fail(`--repo must be a directory path for this verb, got "${repoArg}"`);
    }
    return { repo: await resolveRepoArg(repoArg, fail), cwd };
  }
  const identity = currentRepoIdentity();
  if (!identity) fail("not inside a repo: pass --repo <path>");
  return { repo: identity, cwd: process.cwd() };
}

function recordDetails(r: AgentRecord): string[] {
  return [
    `provider ${r.provider}`,
    `session ${r.sessionId}`,
    r.handle && `chat ${r.name ?? r.handle}`,
    r.model && `model ${r.model}`,
    r.account && `account ${r.account}`,
    r.yolo && "yolo",
    r.paneId && `pane ${r.paneId}`,
    r.finishedAt !== undefined && (r.exitCode !== undefined ? `exit ${r.exitCode}` : "finished"),
    r.lastResumedAt !== undefined && "resumed",
  ].filter((value): value is string => Boolean(value));
}

function renderRecord(r: AgentRecord): string {
  return [`${r.id}  ${repoLabel(r.repo)}  ${r.surface}`, ...recordDetails(r)].join("  |  ");
}

function agentListBlocks(records: AgentRecord[]): Block[] {
  if (records.length === 0) return [out.line("skipped", "No agent handoffs yet")];
  return [out.table(records.map((r) => [out.strong(r.id), repoLabel(r.repo), r.surface, out.dim(recordDetails(r).join(" · "))]))];
}

async function runStart(args: string[]): Promise<void> {
  let parsed: StartArgs;
  try {
    parsed = parseStartArgs(args);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const { repo, cwd } = await repoAndCwd(args);
  const payload = { repo, cwd, ...(await withCallerAccount(parsed)) };
  const data = unwrap(await dispatch("agent:start", payload, () => agentStart(payload, launchClientOptions())), "start");
  if (args.includes("--json")) {
    // Deliberately unannotated: a machine consumer needs the raw record, and
    // the session id it carries for codex is provisional (see the note below).
    out.json({ ok: true, agent: data });
    return;
  }
  say(renderRecord(data));
  if (data.provider === "codex") {
    say(`note: codex mints its own session id; the one above is provisional. Capturing the real one needs the rt daemon running (start it with \`rt daemon start\` if it isn't) -- once it is, \`rt agent show ${data.id}\` confirms the real id before resuming.`);
  }
}

async function runResume(args: string[]): Promise<void> {
  let parsed: { id: string; prompt?: string; surface?: AgentSurface };
  try {
    parsed = parseResumeArgs(args);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const data = unwrap(await dispatch("agent:resume", parsed, () => agentResume(parsed, launchClientOptions())), "resume");
  if (args.includes("--json")) {
    out.json({ ok: true, agent: data });
    return;
  }
  say(renderRecord(data));
}

async function runShow(args: string[]): Promise<void> {
  const id = positional(args);
  if (!id) fail("missing id: rt agent show <id|session-uuid>");
  const data = unwrap(await dispatch("agent:get", { id }, () => agentGet({ id })), "show");
  if (args.includes("--json")) {
    out.json({ ok: true, agent: data });
    return;
  }
  say(renderRecord(data));
}

async function runList(args: string[]): Promise<void> {
  const repoArg = flagValue(args, "--repo");
  const repo = repoArg ? await resolveRepoArg(repoArg, fail) : currentRepoIdentity();
  const data = unwrap(await dispatch("agent:list", repo ? { repo } : {}, () => agentList(repo ? { repo } : {})), "list");
  if (args.includes("--json")) {
    out.json({ ok: true, agents: data.agents });
    return;
  }
  show(
    () => agentListBlocks(data.agents),
    () => (data.agents.length === 0 ? "no agent handoffs recorded" : data.agents.map(renderRecord).join("\n")),
  );
}

const secondsAgo = (ms: number): string => `${Math.round(ms / 1000)}s ago`;

function integrationsBlocks(summaries: IntegrationSummary[]): Block[] {
  return summaries.flatMap((s): Block[] => {
    const status = !s.enabled ? "off" : s.readiness.ready ? "done" : "pending";
    const hint = !s.enabled ? "turned off" : s.readiness.ready ? "ready" : s.readiness.reason;
    const blocks: Block[] = [out.line(status, s.label, hint)];
    const links = s.diagnostics?.claudeLinks;
    if (links) {
      blocks.push(links.length === 0
        ? out.line("skipped", "No Claude sessions have a mod linked")
        : out.table(
          links.map((l) => [out.strong(l.sessionId), l.claudeCode, l.blocks.join(", "), out.dim(secondsAgo(l.lastHeartbeatAgoMs))]),
          ["Session", "Claude Code", "Blocks", "Heartbeat"],
        ));
    }
    if (s.diagnostics?.experimentalApi !== undefined) {
      blocks.push(out.kv("Experimental API", s.diagnostics.experimentalApi ? "negotiated" : "not negotiated"));
    }
    return blocks;
  });
}

export async function agentIntegrationsReport(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  if (!(await isDaemonRunning())) fail("the rt daemon is not running, so there are no live links to report");
  const data = unwrap(await agentIntegrations({ mode: "herdr" }), "integrations");
  if (json) {
    out.json({ ok: true, integrations: data.integrations });
    return;
  }
  out.print(...integrationsBlocks(data.integrations));
}

const USAGE = "usage: rt agent <start|resume|show|list> ...";

/** Stdout usage printer, shared by the --help guard below (fail() covers the error path). */
function usage(): void {
  say(USAGE);
}

const VERBS: Record<string, (args: string[]) => Promise<void>> = {
  start: runStart, resume: runResume, show: runShow, list: runList,
};

const VERB_HINTS: Record<string, string> = {
  start: "hand a prompt to a new agent",
  resume: "resume a handoff",
  show: "show a handoff / session",
  list: "list handoffs",
  integrations: "show which integrations are on",
};

async function pickAgentVerb(): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({
    message: "rt agent",
    options: [...Object.keys(VERBS), "integrations"].map((v) => ({ value: v, label: v, hint: VERB_HINTS[v] ?? "" })),
  });
}

export async function agent(args: string[]): Promise<void> {
  let [verb, ...rest] = args;
  if (!verb) {
    // Non-TTY / --json callers keep the usage error and exit code; only an
    // interactive terminal gets the verb picker.
    if (process.stdin.isTTY && !args.includes("--json") && !process.env.RT_BATCH) {
      const picked = await pickAgentVerb();
      if (!picked) process.exit(0);
      verb = picked;
    } else {
      fail(USAGE);
    }
  }
  if (verbHelpRequested(rest)) {
    usage();
    return;
  }
  if (verb === "integrations") return agentIntegrationsReport(rest);
  const handler = VERBS[verb];
  if (!handler) fail(`unknown verb "${verb}": ${USAGE}`);
  await handler(rest);
}

export const __test__ = { parseStartArgs, parseResumeArgs, withCallerAccount, renderRecord, agentListBlocks, integrationsBlocks };
