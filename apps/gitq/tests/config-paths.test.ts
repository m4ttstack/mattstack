import { describe, test, expect, afterEach } from 'bun:test';
import {
  setConfigDir,
  getConfigDir,
  getStacksDir,
  getSettingsFilePath,
  getReposFilePath,
  getOperationLogFilePath,
  getWorkSlotRoot,
} from '../src/core/config-paths.ts';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';

const CONFIG_PATHS_MODULE = join(import.meta.dir, '..', 'src', 'core', 'config-paths.ts');
// Two HOME views are in play here, and each test group must match the one
// its own code path actually uses:
//  - In-process assertions (below, outside the GITQ_CONFIG_DIR describe)
//    exercise config-paths.ts's already-imported module, whose HOME_CONFIG_DIR
//    was computed from homedir() once at import time. Bun's homedir() reads
//    HOME only at process start, so it stays this real value even after
//    tests/preload.ts mutates process.env.HOME at runtime -- these constants
//    must match that frozen-real value.
//  - The GITQ_CONFIG_DIR describe block spawns a FRESH bun process per case,
//    which inherits process.env.HOME (the preload's fake mkdtemp) as its
//    OWN process-start HOME, so ITS homedir() resolves under the fake one.
const DEFAULT_CONFIG_DIR = join(homedir(), '.config', 'gitq');
const DEFAULT_WORK_SLOT_ROOT = join(homedir(), '.cache', 'gitq', 'work');
const SPAWNED_DEFAULT_CONFIG_DIR = join(process.env.HOME ?? homedir(), '.config', 'gitq');
const SPAWNED_DEFAULT_WORK_SLOT_ROOT = join(process.env.HOME ?? homedir(), '.cache', 'gitq', 'work');

const originalConfigDir = getConfigDir();

afterEach(() => {
  setConfigDir(originalConfigDir);
});

/**
 * Read the env-derived paths in a fresh process. `GITQ_CONFIG_DIR` is read once
 * at module load, and running the suite itself with the variable exported to a
 * scratch dir is the documented safe way to run it, so nothing here may assert
 * on this process's own view of the environment.
 */
function readPathsWith(
  configDirEnv: string | undefined,
  cwd?: string,
): { configDir: string; workSlotRoot: string; exported: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  if (configDirEnv === undefined) delete env.GITQ_CONFIG_DIR;
  else env.GITQ_CONFIG_DIR = configDirEnv;
  const script =
    `import * as cfg from ${JSON.stringify(CONFIG_PATHS_MODULE)};\n` +
    'console.log(JSON.stringify({ configDir: cfg.getConfigDir(), workSlotRoot: cfg.getWorkSlotRoot(), exported: cfg.GITQ_CONFIG_DIR }));';
  const proc = Bun.spawnSync(['bun', '-e', script], cwd === undefined ? { env } : { env, cwd });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
  return JSON.parse(proc.stdout.toString());
}

describe('config-paths', () => {
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
    // Set explicitly rather than relying on the ambient default: the suite is
    // meant to be runnable with GITQ_CONFIG_DIR exported to a scratch dir.
    setConfigDir(DEFAULT_CONFIG_DIR);
    expect(getWorkSlotRoot()).toBe(DEFAULT_WORK_SLOT_ROOT);
  });

  test('getWorkSlotRoot derives from an overridden config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getWorkSlotRoot()).toBe(join('/tmp/test-config', 'work'));
  });

  // The default is matched by value, so an unnormalized spelling of the same
  // directory must not silently move the root somewhere else.
  test('getWorkSlotRoot normalizes both sides before matching the default', () => {
    setConfigDir(`${DEFAULT_CONFIG_DIR}/`);
    expect(getWorkSlotRoot()).toBe(DEFAULT_WORK_SLOT_ROOT);
    setConfigDir(`${DEFAULT_CONFIG_DIR}/./`);
    expect(getWorkSlotRoot()).toBe(DEFAULT_WORK_SLOT_ROOT);
  });

  test('getWorkSlotRoot is absolute even for a relative config dir', () => {
    setConfigDir('rel-cfg');
    expect(getWorkSlotRoot()).toBe(join(process.cwd(), 'rel-cfg', 'work'));
  });

  // Work slots are real git worktrees: if any of this regresses, GITQ_CONFIG_DIR
  // no longer sandboxes what gitq writes to disk.
  describe('GITQ_CONFIG_DIR', () => {
    test('unset gives ~/.config/gitq and the historical cache root', () => {
      const paths = readPathsWith(undefined);
      expect(paths.exported).toBe(SPAWNED_DEFAULT_CONFIG_DIR);
      expect(paths.workSlotRoot).toBe(SPAWNED_DEFAULT_WORK_SLOT_ROOT);
    });

    test('moves the work-slot root out of the real cache dir', () => {
      expect(readPathsWith('/tmp/gitq-sandbox-config').workSlotRoot).toBe(
        join('/tmp/gitq-sandbox-config', 'work'),
      );
    });

    test('set to the default path keeps the historical cache root', () => {
      // The special case is value equality, not set-ness. Documented as such.
      expect(readPathsWith(SPAWNED_DEFAULT_CONFIG_DIR).workSlotRoot).toBe(SPAWNED_DEFAULT_WORK_SLOT_ROOT);
    });

    test('empty counts as unset', () => {
      const paths = readPathsWith('');
      expect(paths.configDir).toBe(SPAWNED_DEFAULT_CONFIG_DIR);
      expect(paths.workSlotRoot).toBe(SPAWNED_DEFAULT_WORK_SLOT_ROOT);
    });

    test('a relative value becomes an absolute path under the cwd', () => {
      // Left relative, `work` would be a bare relative dir and a work slot could
      // land inside whatever tree gitq happens to be running in.
      const cwd = realpathSync(tmpdir());
      const paths = readPathsWith('rel-cfg', cwd);
      expect(paths.configDir).toBe(join(cwd, 'rel-cfg'));
      expect(paths.workSlotRoot).toBe(join(cwd, 'rel-cfg', 'work'));
    });
  });
});
