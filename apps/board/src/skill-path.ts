// src/skill-path.ts
import { existsSync, readdirSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import {
  codexHomeFor,
  type HarnessId,
  type Outcome,
} from '@mattstack/rt-client';

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

/** Resolved per launch, so a codex installed after the board started is found. */
export function codexBin(
  env: Record<string, string | undefined> = process.env,
  which: (cmd: string) => string | null = cmd => Bun.which(cmd)
): string {
  return (
    env.CODEX_BIN ||
    which('codex') ||
    join(env.HOME || homedir(), '.local', 'bin', 'codex')
  );
}

/** Bounded: a hung codex CLI must not hold a launch forever. Equal to rt's
    PLUGIN_LIST_TIMEOUT_MS; a parity test in rt pins the two together. */
export const CODEX_PLUGIN_LIST_TIMEOUT_MS = 10_000;

export { codexHomeFor };

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
    parseCodexPluginList in rt's lib/agent-integrations/codex/skills.ts (a
    parity test there holds the two together): the board reaches rt only
    through rt-client, which has no skill inventory. */
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

export type CodexPluginLister = () => Promise<Outcome<PluginEntry[]>>;

const listFault = (message: string): Outcome<PluginEntry[]> => ({
  ok: false,
  error: { code: 'not-ready', message },
});

/** Runs `<codexBin> plugin list --json` against exactly `codexHome`, once,
    killed after `timeoutMs`. Every failure says why. */
export async function runCodexPluginList(
  codexBin: string,
  codexHome: string,
  timeoutMs: number = CODEX_PLUGIN_LIST_TIMEOUT_MS
): Promise<Outcome<PluginEntry[]>> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([codexBin, 'plugin', 'list', '--json'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    return listFault(
      `codex plugin list could not start: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(done => {
    timer = setTimeout(() => done('timeout'), timeoutMs);
  });
  try {
    // A child the CLI started can hold stdout open past the kill, so the
    // timeout wins the race rather than waiting for the pipe to close.
    const finished = await Promise.race([
      Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        proc.exited,
      ]),
      timeout,
    ]);
    if (finished === 'timeout') {
      proc.kill();
      return listFault(
        `codex plugin list did not answer within ${timeoutMs}ms`
      );
    }
    const [out, code] = finished;
    if (code !== 0) return listFault(`codex plugin list exited ${code}`);
    const plugins = parseCodexPluginList(out, codexHome);
    return plugins
      ? { ok: true, data: plugins }
      : listFault('codex plugin list printed something the board cannot read');
  } finally {
    clearTimeout(timer);
  }
}

/** Remembers only a successful listing, so a transient failure retries. */
export function makeCachedCodexPluginLister(
  run: CodexPluginLister
): CodexPluginLister {
  let cached: PluginEntry[] | null = null;
  return async () => {
    if (cached) return { ok: true, data: cached };
    const result = await run();
    if (result.ok) cached = result.data;
    return result;
  };
}

export const defaultCodexPluginLister: CodexPluginLister =
  makeCachedCodexPluginLister(async () => {
    const home = codexHomeFor();
    return home.ok ? runCodexPluginList(codexBin(), home.data) : home;
  });

export interface AgentSkillDeps {
  /** Unset is $HOME. */
  home?: string;
  /** Unset is codexHomeFor's answer for the board's environment. */
  codexHome?: string;
  listClaudePlugins?: PluginListRunner;
  listCodexPlugins?: CodexPluginLister;
}

const fault = (
  code: 'not-ready' | 'unsupported' | 'transient',
  message: string
): Outcome<string> => ({ ok: false, error: { code, message } });

async function codexSkill(
  skill: string,
  deps: AgentSkillDeps,
  home: string
): Promise<Outcome<string>> {
  let codexHome = deps.codexHome;
  if (codexHome === undefined) {
    const found = codexHomeFor({ ...process.env, HOME: home });
    if (!found.ok) return found;
    codexHome = found.data;
  }
  const linked = skillMdIn(join(codexHome, 'skills', skill));
  if (linked) return { ok: true, data: realpathSync(linked) };
  const listed = await (deps.listCodexPlugins ?? defaultCodexPluginLister)();
  if (!listed.ok)
    return fault(
      'not-ready',
      `The board could not look up ${skill} for codex: ${listed.error.message}`
    );
  const fromPlugin = await pluginSkillPath(skill, async () => listed.data);
  return fromPlugin
    ? { ok: true, data: fromPlugin }
    : fault('not-ready', `The ${skill} skill is not installed for codex`);
}

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
  try {
    if (harness === 'codex') return await codexSkill(skill, deps, home);
    if (harness !== 'claude')
      return fault(
        'unsupported',
        `The board cannot find skills for ${harness}`
      );
    const linked = skillMdIn(join(home, '.claude', 'skills', skill));
    if (linked) return { ok: true, data: realpathSync(linked) };
    const fromPlugin = await pluginSkillPath(
      skill,
      deps.listClaudePlugins ?? defaultPluginListRunner
    );
    return fromPlugin
      ? { ok: true, data: fromPlugin }
      : fault('not-ready', `The ${skill} skill is not installed for claude`);
  } catch (err) {
    return fault(
      'transient',
      `Looking up ${skill} for ${harness} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Resolves a skill name for the harness a pane runs. No harness means the
    integrations switch is off; with no harness or Claude a skill that
    cannot be found is null, and any other harness throws its reason. */
export type HarnessSkillResolver = (
  name: string,
  harness?: HarnessId
) => Promise<string | null>;

/**
 * The resolver a launch hands dispatchPrompt. No harness and Claude both
 * keep the historical Claude plugin lookup; any other harness reads only
 * its own target and refuses rather than dropping the path, since its
 * wrapper would otherwise fall back to a Claude lookup.
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
    if (!found.ok) throw new Error(found.error.message);
    return found.data;
  };
}

export const resolveDispatchSkill: HarnessSkillResolver = agentSkillResolver();
