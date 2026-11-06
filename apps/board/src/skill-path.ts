// src/skill-path.ts
import { existsSync, readdirSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface PluginEntry {
  id: string;
  enabled?: boolean;
  installPath: string;
}

/** Why Claude Code could not answer `plugin list`. */
export type ClaudeFailure =
  | { kind: 'missing'; claudeBin: string }
  | { kind: 'failed'; claudeBin: string; detail: string };

/** `fromCache` marks a list served from the cache rather than fetched. */
export type PluginListResult =
  | { ok: true; plugins: PluginEntry[]; fromCache?: boolean }
  | { ok: false; failure: ClaudeFailure };

/** `fresh` skips any cached list, for a lookup that missed against it. */
export type PluginListRunner = (opts?: {
  fresh?: boolean;
}) => Promise<PluginListResult>;

const PRIMARY_CLAUDE_BIN = join(homedir(), '.local', 'bin', 'claude');

/** Where Claude Code may live: PATH, then ~/.local/bin, then the install
    paths lib/claude-bin.ts falls back to, the order rt's pane launcher
    uses. The server runs under a minimal launchd env, so PATH alone is not
    enough. An explicit CLAUDE_BIN is the only place looked. */
export function claudeBinCandidates(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.CLAUDE_BIN) return [env.CLAUDE_BIN];
  const onPath = Bun.which('claude', { PATH: env.PATH ?? '' });
  return [
    ...(onPath ? [onPath] : []),
    PRIMARY_CLAUDE_BIN,
    join(homedir(), '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
}

const PLUGIN_LIST_TIMEOUT_MS = 15_000;

/** Runs `<claudeBin> plugin list --json` once, uncached, against the first
    candidate that exists. Exported so its failure branches are directly
    testable against a fake binary. */
export async function runPluginList(
  candidates: string | string[],
  timeoutMs: number = PLUGIN_LIST_TIMEOUT_MS
): Promise<PluginListResult> {
  const list = typeof candidates === 'string' ? [candidates] : candidates;
  const claudeBin = list.find(path => existsSync(path));
  if (!claudeBin)
    return {
      ok: false,
      failure: { kind: 'missing', claudeBin: list[0] ?? PRIMARY_CLAUDE_BIN },
    };
  const failed = (detail: string): PluginListResult => ({
    ok: false,
    failure: { kind: 'failed', claudeBin, detail },
  });
  try {
    const proc = Bun.spawn([claudeBin, 'plugin', 'list', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A child of claude can hold stdout open after claude itself is killed,
    // so the deadline races the read instead of waiting for it to close.
    const answered = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!answered) {
      proc.kill();
      return failed(`did not answer in ${timeoutMs / 1000}s`);
    }
    const [out, err, code] = answered;
    if (code !== 0) {
      const firstLine = err.trim().split('\n')[0]?.trim();
      return failed(
        firstLine ? `exited ${code}: ${firstLine}` : `exited ${code}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      return failed('printed an unreadable plugin list');
    }
    if (!Array.isArray(parsed))
      return failed('printed an unreadable plugin list');
    return { ok: true, plugins: parsed as PluginEntry[] };
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}

/** Wrap a one-shot lister in a process-lifetime cache that remembers only
    SUCCESSFUL results, so a transient failure retries next time. A
    successful empty list still counts and is cached. `fresh` refetches and
    replaces the cache, which is how a plugin installed after the board
    started becomes visible without a restart. */
export function makeCachedPluginListRunner(
  run: () => Promise<PluginListResult>
): PluginListRunner {
  let cached: PluginEntry[] | null = null;
  return async opts => {
    if (cached && !opts?.fresh)
      return { ok: true, plugins: cached, fromCache: true };
    const result = await run();
    if (result.ok) cached = result.plugins;
    return result;
  };
}

export const defaultPluginListRunner: PluginListRunner =
  makeCachedPluginListRunner(() => runPluginList(claudeBinCandidates()));

/** Why a `<plugin>:<skill>` name did not resolve to a SKILL.md. */
export type SkillPathFailure =
  | { reason: 'bad-name' }
  | { reason: 'claude-missing'; claudeBin: string }
  | { reason: 'claude-failed'; claudeBin: string; detail: string }
  | { reason: 'plugin-not-installed'; plugin: string }
  | { reason: 'plugin-unreadable'; plugin: string; detail: string }
  | { reason: 'plugin-disabled'; plugin: string; pluginId: string }
  | { reason: 'skill-missing'; plugin: string; skill: string };

export type SkillPathResolution =
  { ok: true; path: string } | { ok: false; failure: SkillPathFailure };

function skillMdIn(dir: string): string | null {
  const path = join(dir, 'SKILL.md');
  return existsSync(path) ? path : null;
}

function findSkillMd(root: string, skillName: string): string | null {
  const direct = skillMdIn(join(root, 'skills', skillName));
  if (direct) return direct;
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = skillMdIn(join(skillsDir, entry.name, skillName));
      if (nested) return nested;
    }
  }
  return skillMdIn(join(root, 'attachments', skillName));
}

function lookup(
  plugins: PluginEntry[],
  plugin: string,
  skill: string
): SkillPathResolution {
  const matching = plugins.filter(p => p.id.startsWith(`${plugin}@`));
  const enabled = matching.find(p => p.enabled !== false);
  if (!enabled) {
    const disabled = matching[0];
    return {
      ok: false,
      failure: disabled
        ? { reason: 'plugin-disabled', plugin, pluginId: disabled.id }
        : { reason: 'plugin-not-installed', plugin },
    };
  }
  if (!enabled.installPath || !existsSync(enabled.installPath))
    return { ok: false, failure: { reason: 'plugin-not-installed', plugin } };
  const found = findSkillMd(realpathSync(enabled.installPath), skill);
  if (found) return { ok: true, path: realpathSync(found) };
  return { ok: false, failure: { reason: 'skill-missing', plugin, skill } };
}

function fromClaudeFailure(f: ClaudeFailure): SkillPathFailure {
  return f.kind === 'missing'
    ? { reason: 'claude-missing', claudeBin: f.claudeBin }
    : { reason: 'claude-failed', claudeBin: f.claudeBin, detail: f.detail };
}

/**
 * Resolve a fully-qualified skill name ("<plugin>:<skill>", e.g.
 * "acme:board-review") to the absolute path of its SKILL.md, mirroring
 * loadAttachment's search order (repo-tools lib/skills/sources.ts):
 * skills/<name>/SKILL.md, then skills/*<name>/SKILL.md (one category level),
 * then attachments/<name>/SKILL.md. The plugin is the first enabled entry of
 * `claude plugin list --json` whose id starts with "<plugin>@".
 *
 * Never throws: every failure comes back as a reason the launch can show.
 * A miss against a cached plugin list is retried once against a fresh one;
 * a Claude failure on that retry keeps the first miss as the reason.
 */
export async function resolveSkillPath(
  name: string,
  listPlugins: PluginListRunner = defaultPluginListRunner
): Promise<SkillPathResolution> {
  const parts = name.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { ok: false, failure: { reason: 'bad-name' } };
  const [plugin, skill] = parts as [string, string];

  const attempt = async (
    fresh: boolean
  ): Promise<SkillPathResolution & { fromCache?: boolean }> => {
    let listed: PluginListResult;
    try {
      listed = await listPlugins(fresh ? { fresh: true } : undefined);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      listed = {
        ok: false,
        failure: { kind: 'failed', claudeBin: PRIMARY_CLAUDE_BIN, detail },
      };
    }
    if (!listed.ok)
      return { ok: false, failure: fromClaudeFailure(listed.failure) };
    try {
      return {
        ...lookup(listed.plugins, plugin, skill),
        fromCache: listed.fromCache,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        failure: { reason: 'plugin-unreadable', plugin, detail },
      };
    }
  };

  const first = await attempt(false);
  if (first.ok || !first.fromCache) return strip(first);
  const retried = await attempt(true);
  if (!retried.ok && retried.failure.reason.startsWith('claude-'))
    return strip(first);
  return strip(retried);
}

function strip(
  r: SkillPathResolution & { fromCache?: boolean }
): SkillPathResolution {
  return r.ok ? { ok: true, path: r.path } : { ok: false, failure: r.failure };
}

function tildePath(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

/** launch-error.ts caps a row's message at this length; the fix sentence
    has to fit inside it. */
const ROW_MAX = 240;
const DETAIL_MIN = 20;

function clipTo(detail: string, max: number): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function reasonAndFix(
  skill: string,
  failure: SkillPathFailure,
  home: string,
  detailMax: number
): [string, string] {
  const clip = (detail: string) => clipTo(detail, detailMax);
  switch (failure.reason) {
    case 'bad-name':
      return [
        `"${skill}" isn't a plugin:skill name`,
        "Fix the lane's skill binding.",
      ];
    case 'claude-missing':
      return [
        `Claude Code isn't at ${tildePath(failure.claudeBin, home)}`,
        'Open Setup status to install it.',
      ];
    case 'claude-failed':
      return [
        `Claude Code at ${tildePath(failure.claudeBin, home)} couldn't list its plugins (${clip(failure.detail)})`,
        'Open Setup status to check it.',
      ];
    case 'plugin-not-installed':
      return [
        `the ${failure.plugin} plugin isn't installed`,
        "Install it, then launch again (rt skills sync installs your team's).",
      ];
    case 'plugin-unreadable':
      return [
        `the ${failure.plugin} plugin's folder couldn't be read (${clip(failure.detail)})`,
        'Reinstall it, then launch again.',
      ];
    case 'plugin-disabled':
      return [
        `the ${failure.plugin} plugin is turned off`,
        `Run claude plugin enable ${failure.pluginId}, then launch again.`,
      ];
    case 'skill-missing':
      return [
        `the ${failure.plugin} plugin has no ${failure.skill} skill`,
        "Run rt skills sync, or fix the lane's skill binding.",
      ];
  }
}

/** The row text for a launch refused because `skill` did not resolve: the
    reason, then the fix. */
export function skillBindMessage(
  skill: string,
  failure: SkillPathFailure,
  home: string = process.env.HOME ?? homedir()
): string {
  const render = (detailMax: number) => {
    const [why, fix] = reasonAndFix(skill, failure, home, detailMax);
    return `Couldn't load ${skill}: ${why}. ${fix}`;
  };
  const full = render(Infinity);
  if (full.length <= ROW_MAX || !('detail' in failure)) return full;
  const detailLen = failure.detail.replace(/\s+/g, ' ').trim().length;
  return render(Math.max(DETAIL_MIN, detailLen - (full.length - ROW_MAX)));
}

/** Thrown by a launch whose domain skill did not resolve, before any pane
    opens. Its message is the row text. */
export class SkillBindError extends Error {
  constructor(
    readonly skill: string,
    readonly failure: SkillPathFailure
  ) {
    super(skillBindMessage(skill, failure));
    this.name = 'SkillBindError';
  }
}
