import { describe, test, expect, afterEach } from 'bun:test';
import {
  setConfigDir,
  getConfigDir,
  getStacksDir,
  getSettingsFilePath,
  getOperationLogFilePath,
  getWorkSlotRoot,
} from '../src/core/config-paths.ts';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';

const CONFIG_PATHS_MODULE = join(import.meta.dir, '..', 'src', 'core', 'config-paths.ts');
// One HOME view now covers both test groups. The app root is derived from
// process.env.HOME (not the syscall-backed homedir(), which bun freezes at
// process start), so the already-imported module below and the fresh bun
// processes the GITQ_CONFIG_DIR block spawns -- which inherit that same env --
// resolve to the same directory: tests/preload.ts's fake mkdtemp HOME.
//
// That is also what keeps the suite off the real machine: the legacy directory
// the one-time migration reads is HOME-derived too, so under the fake HOME it
// does not exist and the migration is a no-op.
const APP_ROOT_DIR = join(process.env.HOME ?? homedir(), '.mattstack', 'gitq');
const DEFAULT_CONFIG_DIR = APP_ROOT_DIR;
const DEFAULT_WORK_SLOT_ROOT = join(APP_ROOT_DIR, 'work');
const SPAWNED_DEFAULT_CONFIG_DIR = DEFAULT_CONFIG_DIR;
const SPAWNED_DEFAULT_WORK_SLOT_ROOT = DEFAULT_WORK_SLOT_ROOT;

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

  test('getOperationLogFilePath derives from config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getOperationLogFilePath()).toBe(join('/tmp/test-config', 'operation-log.json'));
  });

  test('getWorkSlotRoot sits under the app root when the config dir is the default', () => {
    // Set explicitly rather than relying on the ambient default: the suite is
    // meant to be runnable with GITQ_CONFIG_DIR exported to a scratch dir.
    setConfigDir(DEFAULT_CONFIG_DIR);
    expect(getWorkSlotRoot()).toBe(DEFAULT_WORK_SLOT_ROOT);
  });

  test('getWorkSlotRoot derives from an overridden config dir', () => {
    setConfigDir('/tmp/test-config');
    expect(getWorkSlotRoot()).toBe(join('/tmp/test-config', 'work'));
  });

  // An unnormalized spelling of a directory must not produce a second,
  // differently-spelled work-slot root for the same place.
  test('getWorkSlotRoot normalizes the config dir first', () => {
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
    test('unset gives the app root, work slots included', () => {
      const paths = readPathsWith(undefined);
      expect(paths.exported).toBe(SPAWNED_DEFAULT_CONFIG_DIR);
      expect(paths.workSlotRoot).toBe(SPAWNED_DEFAULT_WORK_SLOT_ROOT);
    });

    test('moves the work-slot root out of the app root', () => {
      expect(readPathsWith('/tmp/gitq-sandbox-config').workSlotRoot).toBe(
        join('/tmp/gitq-sandbox-config', 'work'),
      );
    });

    test('set to the app root path is the same as leaving it unset', () => {
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
