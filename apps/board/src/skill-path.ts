// src/skill-path.ts
import { existsSync, readdirSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { HarnessId, Outcome } from '@mattstack/rt-client';

export interface PluginEntry {
  id: string;
  enabled?: boolean;
  installPath: string;
}

export type PluginListRunner = () => Promise<PluginEntry[]>;

// Absolute binary, since the server runs under a minimal launchd env (same
// precedent as HERDR_BIN in herdr.ts -- a bare "claude" isn't on that PATH).
const CLAUDE_BIN =
  process.env.CLAUDE_BIN || join(homedir(), '.local', 'bin', 'claude');

type PluginListResult = { ok: true; plugins: PluginEntry[] } | { ok: false };

/** Runs `<claudeBin> plugin list --json` once, uncached. Exported so its
    failure branches (spawn error, non-zero exit, malformed/non-array JSON)
    are directly testable against a fake binary, without touching the real
    `claude` CLI or the process-lifetime cache. */
export async function runPluginList(
  claudeBin: string
): Promise<PluginListResult> {
  try {
    const proc = Bun.spawn([claudeBin, 'plugin', 'list', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (code !== 0) return { ok: false };
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return { ok: false };
    return { ok: true, plugins: parsed };
  } catch {
    return { ok: false };
  }
}

/** Wrap a one-shot lister in a process-lifetime cache that remembers only
    SUCCESSFUL results. A transient failure (claude not on PATH yet, a hung
    CLI, malformed JSON) must not pin every subsequent resolveSkillPath call
    to the slash-only fallback for the board's lifetime -- it retries next
    time instead. A successful empty list ("[]") still counts as success and
    is cached, since that's a real (if unlikely) answer from the CLI. */
export function makeCachedPluginListRunner(
  run: () => Promise<PluginListResult>
): PluginListRunner {
  let cached: PluginEntry[] | null = null;
  return async () => {
    if (cached) return cached;
    const result = await run();
    if (result.ok) cached = result.plugins;
    return result.ok ? result.plugins : [];
  };
}

/** `claude plugin list --json`, memoized for the life of the process (the
    board only picks up newly (un)installed plugins on restart anyway). */
export const defaultPluginListRunner: PluginListRunner =
  makeCachedPluginListRunner(() => runPluginList(CLAUDE_BIN));

/** Find a SKILL.md directly under `dir`. */
function skillMdIn(dir: string): string | null {
  const path = join(dir, 'SKILL.md');
  return existsSync(path) ? path : null;
}

/** A skill inside one plugin root, in loadAttachment's search order
    (repo-tools lib/skills/sources.ts): skills/<name>/SKILL.md, then
    skills/*<name>/SKILL.md (one category level), then
    attachments/<name>/SKILL.md. */
function skillInPluginRoot(
  installPath: string,
  skillName: string
): string | null {
  const root = realpathSync(installPath);

  const direct = skillMdIn(join(root, 'skills', skillName));
  if (direct) return realpathSync(direct);

  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = skillMdIn(join(skillsDir, entry.name, skillName));
      if (nested) return realpathSync(nested);
    }
  }

  const attachment = skillMdIn(join(root, 'attachments', skillName));
  if (attachment) return realpathSync(attachment);

  return null;
}

/** A "<plugin>:<skill>" name in the first enabled listed plugin whose id
    starts with "<plugin>@"; null for a malformed name or one not found. */
async function pluginSkillPath(
  name: string,
  listPlugins: PluginListRunner
): Promise<string | null> {
  const colon = name.indexOf(':');
  if (colon <= 0 || colon === name.length - 1) return null;
  const pluginPrefix = name.slice(0, colon);
  const skillName = name.slice(colon + 1);

  const plugins = await listPlugins();
  const plugin = plugins.find(
    p => p.enabled !== false && p.id.startsWith(`${pluginPrefix}@`)
  );
  if (!plugin?.installPath) return null;
  return skillInPluginRoot(plugin.installPath, skillName);
}

/**
 * Resolve a fully-qualified skill name ("<plugin>:<skill>", e.g.
 * "acme:board-review") to the absolute path of its SKILL.md, found through
 * `claude plugin list --json` (see pluginSkillPath).
 *
 * Never throws -- any failure (malformed name, no matching plugin, missing
 * install dir, skill not found anywhere) returns null so callers can fall
 * back to the historical slash-invocation form.
 */
export async function resolveSkillPath(
  name: string,
  listPlugins: PluginListRunner = defaultPluginListRunner
): Promise<string | null> {
  try {
    return await pluginSkillPath(name, listPlugins);
  } catch {
    return null;
  }
}

const CODEX_BIN =
  process.env.CODEX_BIN ||
  Bun.which('codex') ||
  join(homedir(), '.local', 'bin', 'codex');

/** The Codex home the board's Codex panes run under. */
export function defaultCodexHome(
  env: Record<string, string | undefined> = process.env
): string {
  return env.CODEX_HOME?.trim() || join(env.HOME ?? homedir(), '.codex');
}

type CodexRow = {
  pluginId?: unknown;
  name?: unknown;
  marketplaceName?: unknown;
  version?: unknown;
  installed?: unknown;
  enabled?: unknown;
};

/** The installed rows of `codex plugin list --json`, each at its cache
    version folder; null when the output is not that shape. Mirrors
    parseCodexPluginList in rt's lib/agent-integrations/codex/skills.ts: the
    board reaches rt only through rt-client, which has no skill inventory. */
export function parseCodexPluginList(
  stdout: string,
  codexHome: string
): PluginEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const installed = (parsed as { installed?: unknown } | null)?.installed;
  if (!Array.isArray(installed)) return null;
  const out: PluginEntry[] = [];
  for (const row of installed as CodexRow[]) {
    if (row?.installed !== true) continue;
    if (
      typeof row.name !== 'string' ||
      typeof row.marketplaceName !== 'string' ||
      typeof row.version !== 'string'
    )
      return null;
    out.push({
      id:
        typeof row.pluginId === 'string'
          ? row.pluginId
          : `${row.name}@${row.marketplaceName}`,
      installPath: join(
        codexHome,
        'plugins',
        'cache',
        row.marketplaceName,
        row.name,
        row.version
      ),
      ...(typeof row.enabled === 'boolean' ? { enabled: row.enabled } : {}),
    });
  }
  return out;
}

/** Runs `<codexBin> plugin list --json` against exactly `codexHome`, once. */
export async function runCodexPluginList(
  codexBin: string,
  codexHome: string
): Promise<PluginListResult> {
  try {
    const proc = Bun.spawn([codexBin, 'plugin', 'list', '--json'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (code !== 0) return { ok: false };
    const plugins = parseCodexPluginList(out, codexHome);
    return plugins ? { ok: true, plugins } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const defaultCodexPluginListRunner: PluginListRunner =
  makeCachedPluginListRunner(() =>
    runCodexPluginList(CODEX_BIN, defaultCodexHome())
  );

export interface AgentSkillDeps {
  /** Unset is $HOME. */
  home?: string;
  /** Unset is $CODEX_HOME, else <home>/.codex. */
  codexHome?: string;
  listClaudePlugins?: PluginListRunner;
  listCodexPlugins?: PluginListRunner;
}

const fault = (
  code: 'not-ready' | 'unsupported' | 'transient',
  message: string
): Outcome<string> => ({ ok: false, error: { code, message } });

/**
 * The installed artifact of `skill` in `harness`'s own target: the skill
 * linked into that harness's skills folder (where setup links the board's
 * wrappers built for that harness), else a "<plugin>:<skill>" name in that
 * harness's own plugin listing. A harness reads only its own inventory, so
 * a Codex lookup never runs Claude.
 */
export async function resolveAgentSkill(
  harness: HarnessId,
  skill: string,
  deps: AgentSkillDeps = {}
): Promise<Outcome<string>> {
  const home = deps.home ?? process.env.HOME ?? homedir();
  let skillsDir: string;
  let listPlugins: PluginListRunner;
  if (harness === 'claude') {
    skillsDir = join(home, '.claude', 'skills');
    listPlugins = deps.listClaudePlugins ?? defaultPluginListRunner;
  } else if (harness === 'codex') {
    const codexHome =
      deps.codexHome ?? defaultCodexHome({ ...process.env, HOME: home });
    skillsDir = join(codexHome, 'skills');
    listPlugins = deps.listCodexPlugins ?? defaultCodexPluginListRunner;
  } else {
    return fault('unsupported', `The board cannot find skills for ${harness}`);
  }
  try {
    const linked = skillMdIn(join(skillsDir, skill));
    if (linked) return { ok: true, data: realpathSync(linked) };
    const fromPlugin = await pluginSkillPath(skill, listPlugins);
    if (fromPlugin) return { ok: true, data: fromPlugin };
    return fault(
      'not-ready',
      `The ${skill} skill is not installed for ${harness}`
    );
  } catch (err) {
    return fault(
      'transient',
      `Looking up ${skill} for ${harness} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Resolves a skill name for the harness a pane runs, or null when it
    cannot be found. No harness means the integrations switch is off. */
export type HarnessSkillResolver = (
  name: string,
  harness?: HarnessId
) => Promise<string | null>;

/**
 * The resolver a launch hands dispatchPrompt. No harness and Claude both
 * keep the historical Claude plugin lookup; any other harness reads only
 * its own target.
 */
export function agentSkillResolver(
  deps: AgentSkillDeps = {}
): HarnessSkillResolver {
  return async (name, harness) => {
    if (harness === undefined || harness === 'claude')
      return resolveSkillPath(
        name,
        deps.listClaudePlugins ?? defaultPluginListRunner
      );
    const found = await resolveAgentSkill(harness, name, deps);
    return found.ok ? found.data : null;
  };
}

export const resolveDispatchSkill: HarnessSkillResolver = agentSkillResolver();
