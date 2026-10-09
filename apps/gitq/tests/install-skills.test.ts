import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { setSetting } from '@mattstack/rt-client';
import { claudeOnlyFile } from '../scripts/install-skills.ts';

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

  test('a harness gitq has no skills for is skipped with one line', () => {
    const res = spawnSync('bun', ['run', SCRIPT, '--harness', 'pilot', dest], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stderr.trim()).toBe('skip    pilot: gitq has no skills for pilot');
    expect(readdirSync(dest)).toEqual([]);
  });

  test('no gitq skill file is written for Claude only, so its source is also its Codex build', () => {
    for (const dir of readdirSync(SKILLS_SRC)) expect(claudeOnlyFile(join(SKILLS_SRC, dir))).toBeNull();
  });

  test('a Claude-only variable or a harness fragment anywhere in a skill folder marks it', () => {
    const skill = join(dest, 'fixture-skill');
    mkdirSync(join(skill, 'refs', 'deep'), { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), 'name: x\n');
    writeFileSync(join(skill, 'refs', 'notes.md'), 'plain\n');
    expect(claudeOnlyFile(skill)).toBeNull();
    writeFileSync(join(skill, 'refs', 'deep', 'step.md'), 'before\n{{harness:questions}}\n');
    expect(claudeOnlyFile(skill)).toBe(join('refs', 'deep', 'step.md'));
    rmSync(join(skill, 'refs', 'deep', 'step.md'));
    writeFileSync(join(skill, 'run.sh'), 'cd "${CLAUDE_SKILL_DIR}"\n');
    expect(claudeOnlyFile(skill)).toBe('run.sh');
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

    test('switch on: an id gitq has no skills for is skipped and the rest are linked', () => {
      const res = runIn({ 'agent.integrations.enabled': true, 'agent.integrations': ['pilot', 'codex'] });
      expect(res.status).toBe(0);
      expect(res.stderr.trim()).toBe('skip    pilot: gitq has no skills for pilot');
      for (const name of SKILLS) expect(lstatSync(join(home, 'codex', 'skills', name)).isSymbolicLink()).toBe(true);
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
