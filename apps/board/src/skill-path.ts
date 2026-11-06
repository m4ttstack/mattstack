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

export type PluginListResult =
  { ok: true; plugins: PluginEntry[] } | { ok: false; failure: ClaudeFailure };

/** `fresh` skips any cached list, for a lookup that missed against it. */
export type PluginListRunner = (opts?: {
  fresh?: boolean;
}) => Promise<PluginListResult>;

// Absolute binary, since the server runs under a minimal launchd env (same
// precedent as HERDR_BIN in herdr.ts -- a bare "claude" isn't on that PATH).
const CLAUDE_BIN =
  process.env.CLAUDE_BIN || join(homedir(), '.local', 'bin', 'claude');

/** Runs `<claudeBin> plugin list --json` once, uncached. Exported so its
    failure branches are directly testable against a fake binary. */
export async function runPluginList(
  claudeBin: string
): Promise<PluginListResult> {
  if (!existsSync(claudeBin))
    return { ok: false, failure: { kind: 'missing', claudeBin } };
  const failed = (detail: string): PluginListResult => ({
    ok: false,
    failure: { kind: 'failed', claudeBin, detail },
  });
  try {
    const proc = Bun.spawn([claudeBin, 'plugin', 'list', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (code !== 0) return failed(`exited ${code}`);
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
    if (cached && !opts?.fresh) return { ok: true, plugins: cached };
    const result = await run();
    if (result.ok) cached = result.plugins;
    return result;
  };
}

export const defaultPluginListRunner: PluginListRunner =
  makeCachedPluginListRunner(() => runPluginList(CLAUDE_BIN));

/** Why a `<plugin>:<skill>` name did not resolve to a SKILL.md. */
export type SkillPathFailure =
  | { reason: 'bad-name' }
  | { reason: 'claude-missing'; claudeBin: string }
  | { reason: 'claude-failed'; claudeBin: string; detail: string }
  | { reason: 'plugin-not-installed'; plugin: string }
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
 * A miss against a cached plugin list is retried once against a fresh one.
 */
export async function resolveSkillPath(
  name: string,
  listPlugins: PluginListRunner = defaultPluginListRunner
): Promise<SkillPathResolution> {
  const parts = name.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { ok: false, failure: { reason: 'bad-name' } };
  const [plugin, skill] = parts as [string, string];

  const attempt = async (fresh: boolean): Promise<SkillPathResolution> => {
    let listed: PluginListResult;
    try {
      listed = await listPlugins(fresh ? { fresh: true } : undefined);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      listed = {
        ok: false,
        failure: { kind: 'failed', claudeBin: CLAUDE_BIN, detail },
      };
    }
    if (!listed.ok)
      return { ok: false, failure: fromClaudeFailure(listed.failure) };
    try {
      return lookup(listed.plugins, plugin, skill);
    } catch {
      return { ok: false, failure: { reason: 'plugin-not-installed', plugin } };
    }
  };

  const first = await attempt(false);
  if (first.ok || first.failure.reason.startsWith('claude-')) return first;
  return attempt(true);
}

function tildePath(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

function reasonAndFix(
  skill: string,
  failure: SkillPathFailure,
  home: string
): [string, string] {
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
        `Claude Code at ${tildePath(failure.claudeBin, home)} couldn't list its plugins (${failure.detail})`,
        'Open Setup status to check it.',
      ];
    case 'plugin-not-installed':
      return [
        `the ${failure.plugin} plugin isn't installed`,
        'Run rt skills sync, then launch again.',
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
  const [why, fix] = reasonAndFix(skill, failure, home);
  return `Couldn't load ${skill}: ${why}. ${fix}`;
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
