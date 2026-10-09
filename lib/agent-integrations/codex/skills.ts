/**
 * Codex's skill resources, read from what Codex itself reports installed.
 * `codex plugin list --json` names each installed plugin's marketplace and
 * version (codex-cli 0.160), and Codex keeps that version under
 * `<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<version>/` with its
 * manifest in `.codex-plugin/plugin.json`. Its local marketplaces are
 * `[marketplaces.<name>]` tables in `config.toml` whose catalog is
 * `<source>/.agents/plugins/marketplace.json`. Nothing here runs or reads
 * Claude.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve, sep } from "path";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveCodexBin } from "../../agent-argv/codex.ts";
import {
  listingFault, PLUGIN_LIST_TIMEOUT_MS, pluginResourceAdapter, spawnRunner,
  type HarnessPluginSource, type SkillRunner,
} from "../../skills/installed-plugins.ts";
import type { PluginListEntry } from "../../skills/sources.ts";
import type { SkillAdapter } from "../contracts.ts";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";
import { harnessEnabled, integrationsEnabled } from "../switch.ts";
import { canonicalCodexProfile } from "./profile.ts";

const HARNESS = "codex";

export type CodexSkillDeps = {
  env?: Record<string, string | undefined>;
  /** A Codex home; unset is CODEX_HOME, else ~/.codex. */
  profile?: string;
  bin?: () => string | null;
  run?: SkillRunner;
  timeoutMs?: number;
};

/** The Codex home a profile names, with the profile's canonical spelling; a bare name names no home. */
export function codexHomeFor(profile: string | undefined, env: Record<string, string | undefined>): Outcome<{ home: string; profile: string }> {
  const canonical = canonicalCodexProfile(profile, env as NodeJS.ProcessEnv);
  if (canonical === LEGACY_DEFAULT_PROFILE) return { ok: true, data: { home: join(env.HOME ?? homedir(), ".codex"), profile: canonical } };
  if (isAbsolute(canonical)) return { ok: true, data: { home: canonical, profile: canonical } };
  return { ok: false, error: { code: "invalid", message: `Codex profile ${canonical} does not name a Codex home folder` } };
}

export function codexPluginCacheRoot(codexHome: string): string {
  return join(codexHome, "plugins", "cache");
}

/** Codex's own user skills folder, which it loads without a plugin. */
export function codexUserSkillsDir(codexHome: string): string {
  return join(codexHome, "skills");
}

type CodexRow = { pluginId?: unknown; name?: unknown; marketplaceName?: unknown; version?: unknown; installed?: unknown; enabled?: unknown };

/** The installed rows of `codex plugin list --json`, each placed at its cache version folder. */
export function parseCodexPluginList(stdout: string, codexHome: string, profile: string): Outcome<PluginListEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: { code: "invalid", message: "codex plugin list printed something that is not JSON" } };
  }
  const installed = (parsed as { installed?: unknown } | null)?.installed;
  if (!Array.isArray(installed)) return { ok: false, error: { code: "invalid", message: "codex plugin list printed no installed list" } };
  const out: PluginListEntry[] = [];
  for (const item of installed as CodexRow[]) {
    if (item?.installed !== true) continue;
    if (typeof item.name !== "string" || typeof item.marketplaceName !== "string" || typeof item.version !== "string") {
      return { ok: false, error: { code: "invalid", message: "codex plugin list printed a row with no name, marketplace or version" } };
    }
    out.push({
      id: typeof item.pluginId === "string" ? item.pluginId : `${item.name}@${item.marketplaceName}`,
      installPath: join(codexPluginCacheRoot(codexHome), item.marketplaceName, item.name, item.version),
      ...(typeof item.enabled === "boolean" && { enabled: item.enabled }),
      version: item.version,
      harness: HARNESS, profile,
    });
  }
  return { ok: true, data: out };
}

function codexSource(deps: CodexSkillDeps): HarnessPluginSource {
  const env = deps.env ?? process.env;
  const run = deps.run ?? spawnRunner;
  const timeoutMs = deps.timeoutMs ?? PLUGIN_LIST_TIMEOUT_MS;
  const bin = deps.bin ?? (() => resolveCodexBinIfPresent());
  const home = () => codexHomeFor(deps.profile, env);
  return {
    harness: HARNESS,
    cacheRoot: () => {
      const h = home();
      return h.ok ? { ok: true, data: codexPluginCacheRoot(h.data.home) } : h;
    },
    list: async () => {
      const h = home();
      if (!h.ok) return h;
      const path = bin();
      if (path === null) return { ok: false, error: { code: "not-ready", message: "Codex is not installed, so its plugins cannot be listed" } };
      const res = await run(path, CODEX_PLUGIN_LIST_ARGS, { env: codexListEnv(env, h.data.home), timeoutMs });
      if (res.status !== 0) return listingFault("codex plugin list", res, timeoutMs);
      return parseCodexPluginList(res.stdout, h.data.home, h.data.profile);
    },
  };
}

export const CODEX_PLUGIN_LIST_ARGS = ["plugin", "list", "--json"];

/** The listing runs against exactly the profile's home, whatever CODEX_HOME the caller inherited. */
export function codexListEnv(env: Record<string, string | undefined>, codexHome: string): Record<string, string | undefined> {
  return { ...env, CODEX_HOME: codexHome };
}

export function resolveCodexBinIfPresent(): string | null {
  const path = resolveCodexBin();
  return existsSync(path) ? path : null;
}

export function createCodexSkills(deps: CodexSkillDeps = {}): SkillAdapter {
  return pluginResourceAdapter(codexSource(deps));
}

/**
 * The installed Codex version folders the MCP read guard may admit: none
 * while the integrations switch is off or Codex is not enabled, and then
 * `roots` is never called, so the guard is unchanged there.
 */
export function codexReadRoots(deps: {
  roots: () => string[]; switchOn?: () => boolean; codexEnabled?: () => boolean;
}): string[] {
  if (!(deps.switchOn ?? integrationsEnabled)()) return [];
  if (!(deps.codexEnabled ?? (() => harnessEnabled()(HARNESS)))()) return [];
  return deps.roots();
}

/** The Codex home pack discovery reads, or null while the switch is off or Codex is not enabled. */
export function codexHomeForPacks(): string | null {
  if (!integrationsEnabled() || !harnessEnabled()(HARNESS)) return null;
  const h = codexHomeFor(undefined, process.env);
  return h.ok ? h.data.home : null;
}

/** Codex's local marketplaces from `config.toml`, by name; a marketplace of any other source type has no folder rt can read. */
export function codexLocalMarketplaces(codexHome: string): { name: string; dir: string }[] {
  let config: Record<string, unknown>;
  try {
    config = Bun.TOML.parse(readFileSync(join(codexHome, "config.toml"), "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const tables = config.marketplaces;
  if (!tables || typeof tables !== "object") return [];
  const out: { name: string; dir: string }[] = [];
  for (const [name, raw] of Object.entries(tables as Record<string, unknown>)) {
    const m = raw as { source_type?: unknown; source?: unknown } | null;
    if (m?.source_type !== "local" || typeof m.source !== "string" || !isAbsolute(m.source)) continue;
    out.push({ name, dir: m.source });
  }
  return out;
}

/** The plugin folders a Codex local marketplace's catalog serves, each inside the marketplace folder. */
export function codexMarketplacePlugins(marketDir: string): { name: string; dir: string }[] {
  let catalog: { plugins?: unknown };
  try {
    catalog = JSON.parse(readFileSync(join(marketDir, ".agents", "plugins", "marketplace.json"), "utf8")) as { plugins?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(catalog.plugins)) return [];
  const out: { name: string; dir: string }[] = [];
  for (const raw of catalog.plugins) {
    const entry = raw as { name?: unknown; source?: { source?: unknown; path?: unknown } } | null;
    if (typeof entry?.name !== "string" || entry.name === "") continue;
    if (entry.source?.source !== "local" || typeof entry.source.path !== "string") continue;
    const dir = resolve(marketDir, entry.source.path);
    const rel = relative(marketDir, dir);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    out.push({ name: entry.name, dir });
  }
  return out;
}
