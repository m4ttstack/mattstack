/**
 * Claude Code's skill resources: its CLI's plugin listing, its plugin cache
 * and its settings file. Everything that knows where Claude keeps plugins
 * lives here, so a Codex-only machine reaches none of it.
 */

import { execFileSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveClaudeBin } from "../../claude-bin.ts";
import {
  listingFault, MAINTAIN_TIMEOUT_MS, PLUGIN_LIST_TIMEOUT_MS, pluginResourceAdapter, spawnRunner,
  type HarnessPluginCli, type RunResult, type SkillRunner,
} from "../../skills/installed-plugins.ts";
import type { PluginListEntry } from "../../skills/sources.ts";
import type { SkillAdapter } from "../contracts.ts";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";

const HARNESS = "claude";

export function listInstalledPlugins(opts: { timeoutMs?: number } = {}): PluginListEntry[] {
  const bin = resolveClaudeBin() ?? "claude";
  const raw = execFileSync(bin, ["plugin", "list", "--json"], { encoding: "utf8", ...(opts.timeoutMs !== undefined && { timeout: opts.timeoutMs }) });
  return JSON.parse(raw) as PluginListEntry[];
}

/** The settings file whose `extraKnownMarketplaces` name Claude's directory marketplaces. */
export function claudeSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(configDir, "settings.json");
}

/** Claude's own user skills folder, which it loads without a plugin. */
export function claudeUserSkillsDir(home: string): string {
  return join(home, ".claude", "skills");
}

/** The plugin cache of the Claude config folder `env` selects: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudePluginCacheRoot(env: Record<string, string | undefined>): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".claude"), "plugins", "cache");
}

export type ClaudeSkillDeps = {
  env?: Record<string, string | undefined>;
  /** The Claude account the listing runs under; the ambient config folder is `default`. */
  profile?: string;
  bin?: () => string | null;
  run?: SkillRunner;
  timeoutMs?: number;
  maintainTimeoutMs?: number;
};

/** Anchored to the CLI's own "already ..." phrasings so a failing call that merely mentions the word does not read as success. */
function claudeAlreadyDone(res: RunResult): boolean {
  return /already (on disk|added|installed|exists)/i.test(`${res.stdout}\n${res.stderr}`);
}

function claudePluginCli(deps: { bin: () => string | null; run: SkillRunner; env: Record<string, string | undefined>; timeoutMs: number }): HarnessPluginCli {
  return {
    label: "Claude Code",
    bin: deps.bin,
    run: deps.run,
    env: () => deps.env,
    timeoutMs: deps.timeoutMs,
    marketplaces: async (call) => {
      const res = await call(["plugin", "marketplace", "list", "--json"]);
      if (res.status !== 0) return null;
      try {
        const parsed: unknown = JSON.parse(res.stdout);
        if (!Array.isArray(parsed)) return null;
        return new Set(parsed.map((m) => (m as { name?: unknown })?.name).filter((n): n is string => typeof n === "string"));
      } catch {
        return null;
      }
    },
    alreadyDone: claudeAlreadyDone,
    addMarketplace: (dir) => ["plugin", "marketplace", "add", dir],
    install: (plugin) => ["plugin", "install", plugin],
    refreshMarketplace: (name) => ["plugin", "marketplace", "update", name],
    update: (plugin, opts) => ["plugin", "update", plugin, ...(opts.scope ? ["--scope", opts.scope] : []), ...(opts.assumeYes ? ["-y"] : [])],
  };
}

/** Claude's rows as its CLI printed them, tagged with harness and profile; anything not shaped like a row is a fault. */
export function parseClaudePluginList(stdout: string, profile: string): Outcome<PluginListEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: { code: "invalid", message: "claude plugin list printed something that is not JSON" } };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: { code: "invalid", message: "claude plugin list did not print a list" } };
  const out: PluginListEntry[] = [];
  for (const item of parsed) {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || typeof row.installPath !== "string") {
      return { ok: false, error: { code: "invalid", message: "claude plugin list printed a row with no id or install path" } };
    }
    out.push({
      id: row.id, installPath: row.installPath,
      ...(typeof row.enabled === "boolean" && { enabled: row.enabled }),
      ...(typeof row.scope === "string" && { scope: row.scope }),
      ...(typeof row.version === "string" && { version: row.version }),
      harness: HARNESS, profile,
    });
  }
  return { ok: true, data: out };
}

export function createClaudeSkills(deps: ClaudeSkillDeps = {}): SkillAdapter {
  const env = deps.env ?? process.env;
  const profile = deps.profile ?? LEGACY_DEFAULT_PROFILE;
  const run = deps.run ?? spawnRunner;
  const timeoutMs = deps.timeoutMs ?? PLUGIN_LIST_TIMEOUT_MS;
  const bin = deps.bin ?? resolveClaudeBin;
  return pluginResourceAdapter({
    harness: HARNESS,
    cacheRoot: () => ({ ok: true, data: claudePluginCacheRoot(env) }),
    skillsDir: () => ({ ok: true, data: claudeUserSkillsDir(env.HOME ?? "") }),
    cli: claudePluginCli({ bin, run, env, timeoutMs: deps.maintainTimeoutMs ?? MAINTAIN_TIMEOUT_MS }),
    list: async () => {
      const path = bin();
      if (path === null) return { ok: false, error: { code: "not-ready", message: "Claude Code is not installed, so its plugins cannot be listed" } };
      const res = await run(path, ["plugin", "list", "--json"], { env, timeoutMs });
      if (res.status !== 0) return listingFault("claude plugin list", res, timeoutMs);
      return parseClaudePluginList(res.stdout, profile);
    },
  });
}
