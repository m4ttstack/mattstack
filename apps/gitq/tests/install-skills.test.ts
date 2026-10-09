import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { setSetting } from '@mattstack/rt-client';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'install-skills.ts');
const SKILLS_SRC = join(import.meta.dir, '..', 'skills');
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

  test('--harness codex links the same skills into the given Codex skills folder', () => {
    const res = spawnSync('bun', ['run', SCRIPT, '--harness', 'codex', dest], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    for (const name of SKILLS) {
      expect(readlinkSync(join(dest, name))).toBe(join(SKILLS_SRC, name.slice('gitq:'.length)));
    }
  });

  test('a harness gitq has no skills for is refused', () => {
    const res = spawnSync('bun', ['run', SCRIPT, '--harness', 'pilot', dest], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('gitq has no skills for pilot');
  });

  test('no gitq skill names a Claude-only variable, so its source is also its Codex build', () => {
    for (const dir of readdirSync(SKILLS_SRC)) {
      const md = join(SKILLS_SRC, dir, 'SKILL.md');
      if (existsSync(md)) expect(readFileSync(md, 'utf8')).not.toContain('${CLAUDE_');
    }
  });

  describe('with no folder given', () => {
    let home: string;
    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-skills-home-')));
    });
    afterEach(() => {
      rmSync(home, { recursive: true, force: true });
    });
    function runIn(settings: Record<string, unknown> | null) {
      const prev = process.env.HOME;
      process.env.HOME = home;
      try {
        for (const [key, value] of Object.entries(settings ?? {})) setSetting(key, value, 'machine');
      } finally {
        process.env.HOME = prev;
      }
      return spawnSync('bun', ['run', SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, CODEX_HOME: join(home, 'codex') },
      });
    }

    test('switch off: links into Claude Code only, as before', () => {
      const res = runIn(null);
      expect(res.status).toBe(0);
      expect(lstatSync(join(home, '.claude', 'skills', 'gitq:sync')).isSymbolicLink()).toBe(true);
      expect(existsSync(join(home, 'codex'))).toBe(false);
    });

    test('switch on: links into each harness turned on, and only those', () => {
      const res = runIn({ 'agent.integrations.enabled': true, 'agent.integrations': ['codex'] });
      expect(res.status).toBe(0);
      for (const name of SKILLS) expect(lstatSync(join(home, 'codex', 'skills', name)).isSymbolicLink()).toBe(true);
      expect(existsSync(join(home, '.claude'))).toBe(false);
    });
  });

  test('a non-symlink at a target name is skipped, not clobbered', () => {
    writeFileSync(join(dest, 'gitq:sync'), 'precious');
    const res = run();
    expect(res.status).toBe(0);
    expect(lstatSync(join(dest, 'gitq:sync')).isSymbolicLink()).toBe(false);
    expect(res.stderr).toContain('skip');
  });
});
