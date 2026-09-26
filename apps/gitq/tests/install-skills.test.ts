import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'install-skills.ts');
const SKILLS = ['gitq:sync', 'gitq:publish', 'gitq:absorb', 'gitq:restructure', 'gitq:track'];

let dest: string;
beforeEach(() => {
  dest = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-skills-')));
});
afterEach(() => {
  rmSync(dest, { recursive: true, force: true });
});

function run() {
  return spawnSync('bun', ['run', SCRIPT, dest], { encoding: 'utf8' });
}

describe('install-skills', () => {
  test('links every skill by frontmatter name', () => {
    const res = run();
    expect(res.status).toBe(0);
    for (const name of SKILLS) {
      const link = join(dest, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toContain(join('skills'));
    }
  });

  test('re-running is idempotent', () => {
    run();
    const res = run();
    expect(res.status).toBe(0);
    expect(lstatSync(join(dest, 'gitq:sync')).isSymbolicLink()).toBe(true);
  });

  test('a non-symlink at a target name is skipped, not clobbered', () => {
    writeFileSync(join(dest, 'gitq:sync'), 'precious');
    const res = run();
    expect(res.status).toBe(0);
    expect(lstatSync(join(dest, 'gitq:sync')).isSymbolicLink()).toBe(false);
    expect(res.stderr).toContain('skip');
  });
});
