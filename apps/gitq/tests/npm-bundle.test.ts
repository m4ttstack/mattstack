import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
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
    const deps = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies as Record<string, string>;
    for (const name of Object.keys(deps)) expect(deps[name]).not.toMatch(/^(file|link):/);
    const smoke = spawnSync('node', [join(ROOT, 'dist', 'gitq.js'), '--version'], { stdio: 'pipe' });
    expect(smoke.status).toBe(0);
  }, 15_000);
});
