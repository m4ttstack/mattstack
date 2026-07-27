import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/** Where gitq keeps things when nothing overrides the config dir. */
const HOME_CONFIG_DIR = join(homedir(), '.config', 'gitq');
const HOME_WORK_SLOT_ROOT = join(homedir(), '.cache', 'gitq', 'work');

// An empty GITQ_CONFIG_DIR counts as unset: `??` would accept `""` and hang
// every derived path off the cwd, which for a work slot means a git worktree
// created inside the repo gitq is operating on. A relative value is resolved
// against the cwd gitq started in, so it at least stays a fixed location.
const envConfigDir = process.env.GITQ_CONFIG_DIR;
const DEFAULT_CONFIG_DIR = envConfigDir ? resolve(envConfigDir) : HOME_CONFIG_DIR;
let _configDir = DEFAULT_CONFIG_DIR;

/** Deterministic hash of a repo path → config filename. */
export function repoHash(repoPath: string): string {
  return createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
}

export function setConfigDir(dir: string): void {
  _configDir = dir;
}

export function getConfigDir(): string {
  return _configDir;
}

export const GITQ_CONFIG_DIR = DEFAULT_CONFIG_DIR;

export function getStacksDir(): string {
  return join(_configDir, 'stacks');
}
export function getSettingsFilePath(): string {
  return join(_configDir, 'settings.json');
}
export function getReposFilePath(): string {
  return join(_configDir, 'repos.json');
}
export function getOperationLogFilePath(): string {
  return join(_configDir, 'operation-log.json');
}
export function getGeneratedPatternsDir(): string {
  return join(_configDir, 'generated');
}

/**
 * Root the per-repo work-slot directories hang off (`<root>/<repoHash>/gitq-1`).
 *
 * Work slots follow the config dir, so a single `GITQ_CONFIG_DIR` (or a
 * `setConfigDir` in tests) sandboxes everything gitq writes, including the git
 * worktrees it creates. The rule is value equality, not set-ness: a config dir
 * that resolves to `~/.config/gitq` keeps the historical `~/.cache/gitq/work`
 * location, out of the config dir, so slots already leased there stay exactly
 * where they are — whether the variable is unset or set to that same path.
 * Both sides are resolved so a trailing slash cannot move the root.
 */
export function getWorkSlotRoot(): string {
  const configDir = resolve(_configDir);
  return configDir === resolve(HOME_CONFIG_DIR) ? HOME_WORK_SLOT_ROOT : join(configDir, 'work');
}

// Legacy constants — used by tests that import directly
export const STACKS_DIR = join(DEFAULT_CONFIG_DIR, 'stacks');
export const SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, 'settings.json');
export const REPOS_PATH = join(DEFAULT_CONFIG_DIR, 'repos.json');
export const OPERATION_LOG_PATH = join(DEFAULT_CONFIG_DIR, 'operation-log.json');
