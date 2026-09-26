import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { homedir } from 'node:os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = join(import.meta.dir, '..');

describe('npm bundle', () => {
  test('dist/gitq.js carries rt-client and imports only published packages', () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
    expect(build.status).toBe(0);
    const js = readFileSync(join(ROOT, 'dist', 'gitq.js'), 'utf8');
    expect(js).not.toMatch(/from\s+["']@mattstack\/rt-client/);
    expect(js).not.toMatch(/from\s+["']@mattstack\/settings-kit/);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
      dependencies: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies)) expect(pkg.dependencies[name]).not.toMatch(/^(file|link):/);
    // bin/gitq.mjs is the entry point that actually calls main(); dist/gitq.js
    // only exports it. HOME is the real one (not the preload's temp HOME): a
    // version-manager node shim resolves its own config off HOME, and
    // --version answers before any gitq config read (src/cli/main.ts), so
    // this does not weaken the preload's isolation.
    const smoke = spawnSync('node', [join(ROOT, 'bin', 'gitq.mjs'), '--version'], {
      stdio: 'pipe',
      env: { ...process.env, HOME: homedir() },
    });
    expect(smoke.status).toBe(0);
    expect(smoke.stdout.toString().trim()).toBe(pkg.version);
  }, 15_000);
});
