import { describe, test, expect, afterEach } from 'bun:test';
import {
  setConfigDir,
  getConfigDir,
  getStacksDir,
  getSettingsFilePath,
  getReposFilePath,
  getOperationLogFilePath,
  getWorkSlotRoot,
  GITQ_CONFIG_DIR,
} from '../src/core/config-paths.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATHS_MODULE = join(import.meta.dir, '..', 'src', 'core', 'config-paths.ts');

const originalConfigDir = getConfigDir();

afterEach(() => {
  setConfigDir(originalConfigDir);
});

describe('config-paths', () => {
  test('GITQ_CONFIG_DIR is the default ~/.config/gitq path', () => {
    expect(GITQ_CONFIG_DIR).toBe(join(homedir(), '.config', 'gitq'));
  });

  test('setConfigDir / getConfigDir round-trips', () => {
    setConfigDir('/tmp/test-config');
    expect(getConfigDir()).toBe('/tmp/test-config');
  });

  test('getStacksDir derives from config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getStacksDir()).toBe(join('/tmp/test-config', 'stacks'));
  });

  test('getSettingsFilePath derives from config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getSettingsFilePath()).toBe(join('/tmp/test-config', 'settings.json'));
  });

  test('getReposFilePath derives from config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getReposFilePath()).toBe(join('/tmp/test-config', 'repos.json'));
  });

  test('getOperationLogFilePath derives from config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getOperationLogFilePath()).toBe(join('/tmp/test-config', 'operation-log.json'));
  });

  test('getWorkSlotRoot is the ~/.cache/gitq/work path when the config dir is the default', () => {
    expect(getWorkSlotRoot()).toBe(join(homedir(), '.cache', 'gitq', 'work'));
  });

  test('getWorkSlotRoot derives from an overridden config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getWorkSlotRoot()).toBe(join('/tmp/test-config', 'work'));
  });

  // The env var is read once at module load, so the only honest test of it is a
  // fresh process. Work slots are real git worktrees: if this regresses, setting
  // GITQ_CONFIG_DIR no longer sandboxes what gitq writes to disk.
  test('GITQ_CONFIG_DIR moves the work-slot root out of the real cache dir', () => {
    const read = (env: Record<string, string | undefined>) => {
      const proc = Bun.spawnSync(
        ['bun', '-e', `import { getWorkSlotRoot } from ${JSON.stringify(CONFIG_PATHS_MODULE)}; console.log(getWorkSlotRoot());`],
        { env },
      );
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);
      return proc.stdout.toString().trim();
    };

    expect(read({ ...process.env, GITQ_CONFIG_DIR: '/tmp/gitq-sandbox-config' })).toBe(
      join('/tmp/gitq-sandbox-config', 'work'),
    );
    expect(read({ ...process.env, GITQ_CONFIG_DIR: undefined })).toBe(
      join(homedir(), '.cache', 'gitq', 'work'),
    );
  });
});
