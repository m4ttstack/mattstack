import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pkgDir = join(import.meta.dir, '..', '..');

describe('built extension bundle', () => {
  test('loads in plain node with only vscode external', () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: pkgDir, encoding: 'utf8' });
    expect(build.status).toBe(0);

    const smoke = spawnSync('node', ['scripts/load-smoke.mjs'], { cwd: pkgDir, encoding: 'utf8' });
    expect(smoke.stderr).toBe('');
    expect(smoke.status).toBe(0);
  }, 120_000);
});
