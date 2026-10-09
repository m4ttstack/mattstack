import { randomUUID } from "crypto";
import { relative } from "path";
import { buildAgentArgv } from "../lib/agent-argv/index.ts";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import type { AgentInvocation } from "../lib/agent-argv/types.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { mcpToolsPayload } from "./mcp.ts";
import { checkPack, SkillsUsageError, skillsFailure, type CheckPayload } from "./skills.ts";
import { lintedMarkdownFiles } from "../lib/skills/mcp-lint.ts";
import { pluginEntriesFor, REAL_HOSTS, takeHarnessFlag, type HostChoice } from "../lib/skills/maintain-host.ts";
import type { PluginListEntry } from "../lib/skills/sources.ts";
import { runCapture } from "../lib/subprocess.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const AUDIT_TIMEOUT_MS = 600_000;

// Paths only: a pack runs to tens of thousands of lines, and the prompt is
// fed on stdin, but inlining tens of thousands of lines would still swamp the
// run's context. The run reads the files itself (Read is the one tool it is allowed).
export function buildAuditPrompt(paths: string[], tools: Array<{ name: string; description: string }>): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const fileList = paths.map((p) => `- ${p}`).join("\n");
  return [
    "You are auditing a mattstack skill pack. Agents that load these skills run in Claude Code auto mode, where every shell command a tool could have covered costs a classifier round trip or is blocked outright.",
    "The mattstack MCP server publishes these tools:",
    toolList,
    "Read each file listed under Files with the Read tool (they are relative to your working directory), then report, as a Markdown list with one file:line per finding, three kinds of instruction that no pattern lint can catch:",
    "1. an instruction in plain words (\"push the branch\", \"open the MR\", \"rebase onto main\") that an agent will turn into a shell command a tool covers; name the tool;",
    "2. values carried between code blocks through shell variables ($IID, $RT_RUN_DB, read_token) instead of a tool result passed on explicitly;",
    "3. wrapped commands (cd x && ..., VAR=$(...), pipes, -C <tree>) around an rt, glab or git call.",
    "Anything on this kept list is fine and must not be reported: rt gate answer --by shepherd, rt gate wait, rt events wait, git commit, git add, git fetch, git merge-base, git rebase --continue, git rebase --skip, project tooling such as pnpm. A line carrying <!-- mcp-lint: allow --> is a deliberate don't and must not be reported either.",
    "End with one line: `findings: <n>`.",
    "## Files",
    fileList,
  ].join("\n\n");
}

// The prompt is untrusted skill text. --strict-mcp-config loads no MCP server and
// --tools=Read removes Bash, Write and Edit; --setting-sources=user still loads the
// user allow list. Each flag is one token: a variadic option would swallow the prompt.
const AUDIT_LOCKDOWN = "--tools=Read --allowedTools=Read --strict-mcp-config --permission-mode=dontAsk --setting-sources=user --no-session-persistence";

// The same lockdown for Codex: a read-only sandbox, and no user config.toml, so
// no MCP server, plugin or hook of the user's loads; sign-in still reads CODEX_HOME.
const CODEX_AUDIT_LOCKDOWN = "--sandbox=read-only --ignore-user-config --ephemeral --skip-git-repo-check";

export function buildAuditInvocation(prompt: string, sessionId: string, harness: string = "claude"): AgentInvocation {
  return { headless: true, prompt, session: { kind: "start", sessionId }, yolo: false, extraArgs: harness === "codex" ? CODEX_AUDIT_LOCKDOWN : AUDIT_LOCKDOWN };
}

export function buildAuditRun(prompt: string, sessionId: string, bin: string, packDir: string, harness: string = "claude") {
  const argv = buildAgentArgv(harness, buildAuditInvocation(prompt, sessionId, harness), harness === "codex" ? { codex: bin } : { claude: bin }) as [string, ...string[]];
  return { argv, opts: { cwd: packDir, timeoutMs: AUDIT_TIMEOUT_MS, stderr: "pipe" as const, stdin: prompt } };
}

/** Claude's `-p --output-format json` envelope carries the report as `result`; Codex's `--json` event stream ends with the agent's last message. */
export function auditReport(stdout: string, harness: string = "claude"): string {
  if (harness === "codex") {
    let last: string | null = null;
    for (const line of stdout.split("\n")) {
      try {
        const event = JSON.parse(line) as { type?: unknown; item?: { type?: unknown; text?: unknown } };
        if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") last = event.item.text;
      } catch {
        // a line that is not an event is not the report
      }
    }
    return last ?? stdout;
  }
  try {
    const parsed = JSON.parse(stdout) as { result?: string };
    if (typeof parsed.result === "string") return parsed.result;
  } catch {
    // claude printed plain text, not the -p --output-format json envelope
  }
  return stdout;
}

export function auditJsonPayload(
  resolved: { pack: string; packDir: string },
  files: string[],
  report: string,
  claudeExit: number,
): { pack: string; packDir: string; files: string[]; report: string; advisory: true; claudeExit: number } {
  return { pack: resolved.pack, packDir: resolved.packDir, files, report, advisory: true, claudeExit };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export type AuditInputsResult =
  | { ok: true; resolved: CheckPayload; bin: string }
  | { ok: false; failure: out.FailureInput };

/**
 * Everything skillsAudit needs before it spawns the harness, as data rather
 * than thrown errors: checkPack's SkillsUsageError (unknown --pack, a
 * --pack-dir that does not exist, an ambiguous non-TTY pick) is exactly as
 * much a "no pack resolves" outcome as the no-flags case, so it is caught here
 * rather than left to crash the process with a stack trace. Anything else
 * checkPack throws is a real bug and propagates.
 */
export async function resolveAuditInputs(
  args: string[],
  resolveBin: () => string | null = resolveClaudeBin,
  label: string = "Claude Code",
  pluginEntries?: PluginListEntry[],
): Promise<AuditInputsResult> {
  const pack = flag(args, "--pack");
  const packDir = flag(args, "--pack-dir");
  if (!pack && !packDir) return { ok: false, failure: usageFailure("Which pack?", "rt skills audit --pack <name>") };
  let resolved: CheckPayload;
  try {
    resolved = await checkPack({ ...(pack ? { pack } : {}), ...(packDir ? { packDir } : {}), ...(pluginEntries ? { pluginEntries } : {}) });
  } catch (err) {
    if (err instanceof SkillsUsageError) return { ok: false, failure: skillsFailure(err) };
    throw err;
  }
  const bin = resolveBin();
  if (!bin) {
    const session = label === "Claude Code" ? "a Claude session, so Claude" : `a ${label} session, so ${label}`;
    return {
      ok: false,
      failure: { title: `The audit needs ${label}, and rt could not find it`, why: `The audit runs as ${session} has to be installed and signed in.` },
    };
  }
  return { ok: true, resolved, bin };
}

export type AuditDeps = HostChoice & {
  run: typeof runCapture;
};

const REAL_AUDIT: AuditDeps = { ...REAL_HOSTS, run: runCapture };

export async function skillsAudit(args: string[], _ctx: CommandContext = {}, deps: AuditDeps = REAL_AUDIT): Promise<void> {
  const json = args.includes("--json");
  const taken = takeHarnessFlag(args);
  if (!taken.ok) {
    out.fail(usageFailure("Which harness?", "rt skills audit --pack <name> --harness <claude|codex>"));
    process.exit(2);
  }
  const chosen = await deps.select(taken.harness);
  if (!chosen.ok) {
    out.fail({ title: chosen.error.message });
    process.exit(2);
  }
  const host = deps.hostFor(chosen.data);
  let entries: PluginListEntry[] | undefined;
  try {
    entries = host.bin ? await pluginEntriesFor(host) : undefined;
  } catch (err) {
    out.fail({ title: `rt could not read what ${host.label} has installed`, why: err instanceof Error ? err.message : String(err) });
    process.exit(2);
  }
  const inputs = await resolveAuditInputs(taken.rest, () => host.bin, host.label, entries);
  if (!inputs.ok) {
    out.fail(inputs.failure);
    process.exit(2);
  }
  const { resolved, bin } = inputs;
  const files = lintedMarkdownFiles(resolved.packDir).map((p) => relative(resolved.packDir, p));
  const prompt = buildAuditPrompt(files, mcpToolsPayload().tools.map((t) => ({ name: t.name, description: t.description })));
  const run = buildAuditRun(prompt, randomUUID(), bin, resolved.packDir, host.harness);
  const r = await deps.run(run.argv, host.env ? { ...run.opts, env: { ...process.env, ...host.env } } : run.opts);
  const text = auditReport(r.stdout, host.harness);
  const who = host.harness === "claude" ? "Claude" : host.label;
  if (r.exitCode !== 0) out.note(out.line("warn", `${who} exited with code ${r.exitCode}`, r.stderr.trim().split("\n").slice(-3).join(" ")));
  if (json) {
    out.json(auditJsonPayload(resolved, files, text, r.exitCode));
    return;
  }
  out.print(out.section(`Audit of ${resolved.pack}`, "advisory, never a gate", out.paragraph(text)));
}
