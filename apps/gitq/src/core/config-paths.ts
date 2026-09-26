import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { APP_ROOT, LEGACY_CONFIG_DIR } from './app-root.ts';
import { migrateLegacyConfigDir } from './config-migration.ts';

// An empty GITQ_CONFIG_DIR counts as unset: `??` would accept `""` and hang
// every derived path off the cwd, which for a work slot means a git worktree
// created inside the repo gitq is operating on. A relative value is resolved
// against the cwd gitq started in, so it at least stays a fixed location.
const envConfigDir = process.env.GITQ_CONFIG_DIR;
const DEFAULT_CONFIG_DIR = envConfigDir ? resolve(envConfigDir) : APP_ROOT;
let _configDir = DEFAULT_CONFIG_DIR;

// gitq's files moved out of ~/.config/gitq (and its work slots out of
// ~/.cache/gitq/work) into the single app root. Migrating here, at module
// load, is what guarantees it happens before the first read of a derived path.
//
// It runs only when the effective config dir IS the app root: a run pointed
// somewhere else by GITQ_CONFIG_DIR -- a throwaway store, or the test suite --
// asked for that directory and nothing else, and must never be handed a copy
// of the real one.
if (resolve(DEFAULT_CONFIG_DIR) === resolve(APP_ROOT)) {
  const result = migrateLegacyConfigDir(LEGACY_CONFIG_DIR, APP_ROOT);
  if (result.kind === 'migrated') {
    console.warn(`gitq: copied ${result.files} file(s) from ${LEGACY_CONFIG_DIR} to ${APP_ROOT}; the originals were left in place`);
  } else if (result.kind === 'target-occupied') {
    console.warn(`gitq: using ${APP_ROOT}; ${result.legacyDir} also holds gitq files and is being ignored`);
  }
}

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
export function getOperationLogFilePath(): string {
  return join(_configDir, 'operation-log.json');
}

/**
 * Root the per-repo work-slot directories hang off (`<root>/<repoHash>/gitq-1`).
 *
 * Work slots follow the config dir with no carve-out, so a single
 * `GITQ_CONFIG_DIR` (or a `setConfigDir` in tests) moves everything gitq writes
 * for itself, including the git worktrees it creates. It does not move what
 * gitq writes into the repo it operates on (leases, pause files, per-worktree
 * hooks config).
 *
 * Slots created under the old `~/.cache/gitq/work` root are unaffected and need
 * no migration: a slot is recognised by its `gitq-<n>` basename in the repo's
 * own `git worktree list`, never by where it sits, and leases record absolute
 * paths. Only slots created from here on land under the new root.
 */
export function getWorkSlotRoot(): string {
  return join(resolve(_configDir), 'work');
}

// Legacy constants — used by tests that import directly
export const STACKS_DIR = join(DEFAULT_CONFIG_DIR, 'stacks');
export const SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, 'settings.json');
export const OPERATION_LOG_PATH = join(DEFAULT_CONFIG_DIR, 'operation-log.json');
