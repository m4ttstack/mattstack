import { describe, test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT, IS_COMPILED, LEGACY_CONFIG_DIR } from '../src/core/app-root.ts';

const APP_ROOT_MODULE = join(import.meta.dir, '..', 'src', 'core', 'app-root.ts');
const FAKE_HOME = process.env.HOME ?? homedir();

/**
 * Read the env-derived root in a fresh process. GITQ_APP_ROOT is read once at
 * module load, so nothing here may assert on this process's own view of it.
 */
function readAppRootWith(override: string | undefined): { appRoot: string; isCompiled: boolean } {
  const env: Record<string, string | undefined> = { ...process.env };
  if (override === undefined) delete env.GITQ_APP_ROOT;
  else env.GITQ_APP_ROOT = override;
  const script =
    `import * as m from ${JSON.stringify(APP_ROOT_MODULE)};\n` +
    'console.log(JSON.stringify({ appRoot: m.APP_ROOT, isCompiled: m.IS_COMPILED }));';
  const proc = Bun.spawnSync(['bun', '-e', script], { env });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
  return JSON.parse(proc.stdout.toString());
}

describe('app root', () => {
  // One root whichever form is running: a checkout must not get a different
  // one from the compiled binary, or the two would see different stacks.
  test('is ~/.mattstack/gitq, from a checkout as much as compiled', () => {
    expect(IS_COMPILED).toBe(false);
    expect(APP_ROOT).toBe(join(FAKE_HOME, '.mattstack', 'gitq'));
    expect(readAppRootWith(undefined)).toEqual({ appRoot: join(FAKE_HOME, '.mattstack', 'gitq'), isCompiled: false });
  });

  test('GITQ_APP_ROOT wins, normalized', () => {
    expect(readAppRootWith('/tmp/pinned-gitq').appRoot).toBe('/tmp/pinned-gitq');
    expect(readAppRootWith('/tmp/pinned-gitq/./').appRoot).toBe('/tmp/pinned-gitq');
  });

  test('the board config and job dir both hang off it', async () => {
    const { CONFIG_PATH } = await import('../src/server/config.ts');
    const { JOBS_DIR } = await import('../src/server/job-state.ts');
    expect(CONFIG_PATH).toBe(join(APP_ROOT, 'config.json'));
    expect(JOBS_DIR).toBe(join(APP_ROOT, 'state', 'jobs'));
  });

  // HOME-derived, so the suite's fake HOME keeps the one-time migration off
  // the real ~/.config/gitq. A syscall-backed homedir() would read the real one.
  test('the legacy config dir follows HOME too', () => {
    expect(LEGACY_CONFIG_DIR).toBe(join(FAKE_HOME, '.config', 'gitq'));
    expect(LEGACY_CONFIG_DIR.startsWith(homedir())).toBe(false);
  });
});
