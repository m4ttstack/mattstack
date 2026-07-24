import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'gitq');
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

// Legacy constants — used by tests that import directly
export const STACKS_DIR = join(DEFAULT_CONFIG_DIR, 'stacks');
export const SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, 'settings.json');
export const REPOS_PATH = join(DEFAULT_CONFIG_DIR, 'repos.json');
export const OPERATION_LOG_PATH = join(DEFAULT_CONFIG_DIR, 'operation-log.json');
