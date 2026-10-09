/**
 * Claude's policy adapter. Claude Code loads an enabled plugin's hooks at
 * every session start and has no separate trust step, so the proof is the
 * installation itself: the mattstack plugin's Stop hook (continuation) and
 * the AskUserQuestion hook every `rt agent` launch injects (gate policy),
 * each with the scripts it runs. The revision changes with any of their
 * definitions, script contents, or the Claude Code version. Prepare and
 * verify only read; they never install or edit a hook. A session whose own
 * live mod link carries the policy and stop-gate blocks proves gate policy
 * through the mod, and continuation policy only while the shell Stop hook,
 * the stop gate's backstop, is installed too.
 */

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import type { Capability, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { gateForkHookEntry, resolveGateForkHookPath } from "../../agent-hooks.ts";
import { resolveClaudeBin } from "../../claude-bin.ts";
import { listInstalledPlugins, type PluginListEntry } from "../../skills/sources.ts";
import { warn } from "../../ui/warn.ts";
import type { LaunchRequest, PolicyAdapter, PreparedPolicy } from "../contracts.ts";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";

export type ClaudePolicyDeps = {
  plugins?: () => PluginListEntry[];
  gateForkHookPath?: () => string | null;
  claudeVersion?: () => string | null;
  readFile?: (path: string) => string;
  now?: () => number;
  /** The session's own live mod link carries the policy and stop-gate blocks. */
  modPolicy?: (binding: SessionBinding) => boolean | Promise<boolean>;
};

const PLUGIN = "mattstack";
const STOP_SCRIPT = "pipeline-gate-stop.sh";
const ASK_TOOL = "AskUserQuestion";
const PROBE_TIMEOUT_MS = 10_000;

type Inspection = { revision: string; verified: Capability[] };
type HookEntry = { matcher?: unknown; hooks?: unknown };

function fail<T>(code: "not-ready" | "invalid", message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

function defaultClaudeVersion(): string | null {
  try {
    const raw = execFileSync(resolveClaudeBin() ?? "claude", ["--version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    const version = raw.trim().split(/\s+/)[0];
    return version ? version : null;
  } catch (err) {
    warn("claude-policy", "`claude --version` failed, so Claude Code's policy hooks cannot be fingerprinted", {
      context: { err: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

function entries(value: unknown): HookEntry[] {
  return Array.isArray(value) ? value.filter((e): e is HookEntry => e !== null && typeof e === "object") : [];
}

/** Claude Code reads a matcher as a regex over the tool name; an absent or `*` matcher covers every tool. */
function covers(matcher: unknown, tool: string): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (typeof matcher !== "string") return false;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

function commands(list: HookEntry[]): string[] {
  return list.flatMap((e) => (Array.isArray(e.hooks) ? e.hooks : []))
    .filter((h): h is { type: string; command: string } => typeof h?.command === "string" && h.type === "command")
    .map((h) => h.command);
}

/** The files a hook command runs: its absolute path arguments, quoted or bare, once the plugin root is filled in. */
function scriptsOf(command: string, root: string): string[] {
  const filled = command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  return [...filled.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] ?? m[2]!).filter((t) => t.startsWith("/"));
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function inspect(deps: Required<ClaudePolicyDeps>): Outcome<Inspection> {
  let plugins: PluginListEntry[];
  try {
    plugins = deps.plugins();
  } catch (err) {
    return fail("not-ready", `the installed Claude Code plugins could not be listed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const plugin = plugins.find((p) => p.id.split("@")[0] === PLUGIN && p.enabled !== false);
  if (!plugin) return fail("not-ready", `the ${PLUGIN} plugin is not installed and enabled in Claude Code`);

  let hooks: Record<string, unknown>;
  try {
    const parsed = JSON.parse(deps.readFile(join(plugin.installPath, "hooks", "hooks.json"))) as { hooks?: unknown };
    hooks = parsed.hooks !== null && typeof parsed.hooks === "object" ? parsed.hooks as Record<string, unknown> : {};
  } catch (err) {
    return fail("not-ready", `the ${PLUGIN} plugin's hooks could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const stop = entries(hooks.Stop);
  const ask = entries(hooks.PreToolUse).filter((e) => covers(e.matcher, ASK_TOOL));

  const fingerprints: Record<string, string> = {};
  for (const script of [...commands(stop), ...commands(ask)].flatMap((c) => scriptsOf(c, plugin.installPath))) {
    try {
      fingerprints[script] = sha256(deps.readFile(script));
    } catch {
      return fail("not-ready", `the ${PLUGIN} plugin's hook script ${script} could not be read`);
    }
  }

  const forkPath = deps.gateForkHookPath();
  let gateFork: { entry: unknown; fingerprint: string } | null = null;
  if (forkPath !== null) {
    try {
      gateFork = { entry: gateForkHookEntry(forkPath), fingerprint: sha256(deps.readFile(forkPath)) };
    } catch {
      gateFork = null;
    }
  }

  const verified: Capability[] = [];
  if (Object.keys(fingerprints).some((p) => p.endsWith(`/${STOP_SCRIPT}`)) && commands(stop).some((c) => c.includes(STOP_SCRIPT))) {
    verified.push("continuation-policy");
  }
  if (gateFork !== null) verified.push("gate-policy");

  // A failed probe must not pass for a version change, so it gives no revision at all.
  const claudeCode = deps.claudeVersion();
  if (claudeCode === null) return fail("not-ready", "the Claude Code version probe (`claude --version`) failed, so its policy hooks cannot be fingerprinted");
  const revision = sha256(JSON.stringify({
    stop, ask, gateFork,
    fingerprints: Object.keys(fingerprints).sort().map((p) => [p, fingerprints[p]]),
    claudeCode,
  }));
  return { ok: true, data: { revision, verified } };
}

const POLICY_CAPABILITIES: readonly Capability[] = ["gate-policy", "continuation-policy"];

export function createClaudePolicy(overrides: ClaudePolicyDeps = {}): PolicyAdapter {
  const deps: Required<ClaudePolicyDeps> = {
    plugins: overrides.plugins ?? (() => listInstalledPlugins({ timeoutMs: PROBE_TIMEOUT_MS })),
    gateForkHookPath: overrides.gateForkHookPath ?? (() => resolveGateForkHookPath()),
    claudeVersion: overrides.claudeVersion ?? defaultClaudeVersion,
    readFile: overrides.readFile ?? ((path) => readFileSync(path, "utf8")),
    now: overrides.now ?? Date.now,
    modPolicy: overrides.modPolicy ?? (async (binding) => (await import("./mod-path.ts")).sessionModPolicy(binding).length > 0),
  };

  return {
    verifiesPerSession: true,
    async prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>> {
      const found = inspect(deps);
      if (!found.ok) return found;
      const missing = request.required.filter((c) => POLICY_CAPABILITIES.includes(c) && !found.data.verified.includes(c));
      if (missing.length > 0) return fail("not-ready", `Claude Code has no installed hook for: ${missing.join(", ")}`);
      return {
        ok: true,
        data: {
          id: `claude-policy-${found.data.revision.slice(0, 16)}`, harness: "claude",
          profile: request.selection.options.account ?? LEGACY_DEFAULT_PROFILE, cwd: request.cwd,
          revision: found.data.revision,
        },
      };
    },

    async verify(binding: SessionBinding, prepared: PreparedPolicy) {
      if (binding.native.harness !== "claude" || prepared.harness !== "claude") {
        return fail("invalid", "the Claude policy verifies only a Claude session prepared by it");
      }
      if (binding.native.profile !== prepared.profile) return fail("invalid", "the session belongs to another account than the prepared policy");
      const found = inspect(deps);
      if (!found.ok) return found;
      if (found.data.revision !== prepared.revision) {
        return fail("not-ready", "the Claude Code policy hooks changed after they were prepared");
      }
      // The mod's guard proves gate policy in this very session; its stop gate counts only beside the installed shell Stop hook, its backstop.
      const verified = await deps.modPolicy(binding)
        ? POLICY_CAPABILITIES.filter((c) => c === "gate-policy" || found.data.verified.includes(c))
        : found.data.verified;
      return {
        ok: true,
        data: {
          sessionKey: binding.key, generation: binding.attachment.generation, revision: found.data.revision,
          verified, observedAt: deps.now(), kind: "installation",
        },
      };
    },
  };
}
