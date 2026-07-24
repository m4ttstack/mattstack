import { describe, test, expect, afterEach } from 'bun:test';
import {
  setConfigDir,
  getConfigDir,
  getStacksDir,
  getSettingsFilePath,
  getReposFilePath,
  getOperationLogFilePath,
  GITQ_CONFIG_DIR,
} from '../src/core/config-paths.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
});
