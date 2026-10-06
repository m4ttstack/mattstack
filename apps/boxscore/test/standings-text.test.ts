import { afterEach, describe, expect, it } from 'vitest';

import { fixtureLeaderboard } from '../src/server/fixture/index.js';
import {
  isLocked,
  LOCKED_MESSAGE,
  SELF_VALIDATE_NOTE,
  standingsLines,
  standingsOutcome,
} from '../src/server/standings-text.js';

afterEach(() => {
  delete process.env.BOXSCORE_FIXTURE_SCENARIO;
});

describe('standingsLines', () => {
  it('prints ranks and leaders in Team view', () => {
    const text = standingsLines(fixtureLeaderboard(false)).join('\n');
    expect(text).toContain('STANDINGS BY METRIC (1 = best):');
    expect(text).toMatch(/\b1\.\w/);
    expect(text).toContain('LEADERS:');
  });

  it('prints only the viewer, without ranks or leaders, in Self view', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    const text = standingsLines(fixtureLeaderboard(false)).join('\n');
    expect(text).toContain('YOUR NUMBERS:');
    expect(text).not.toContain('null.');
    expect(text).not.toContain('LEADERS:');
    expect(text).not.toContain('...  ');
    expect(text).toContain('1/1 resolved');
  });

  it('flags a locked response', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'locked';
    expect(isLocked(fixtureLeaderboard(false))).toBe(true);
    expect(LOCKED_MESSAGE).toMatch(/couldn't tell who you are/);
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    expect(isLocked(fixtureLeaderboard(false))).toBe(false);
  });
});

describe('standingsOutcome', () => {
  it('validates Team view as before', () => {
    const res = fixtureLeaderboard(false);
    const out = standingsOutcome(res, true);
    expect(out.stdout.slice(0, standingsLines(res).length)).toEqual(
      standingsLines(res)
    );
    expect(out.stdout.join('\n')).toMatch(/VALIDATION: (PASS|FAIL)/);
    expect(out.stdout.join('\n')).not.toContain('skipped');
    expect(out.stderr).toEqual([]);
  });

  it('skips validation in Self view and exits 0', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    const out = standingsOutcome(fixtureLeaderboard(false), true);
    expect(out.stdout.at(-1)).toBe(SELF_VALIDATE_NOTE);
    expect(out.stdout.join('\n')).not.toContain('FAIL');
    expect(out.exitCode).toBe(0);
  });

  it('prints the locked message on stderr and exits 1', () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'locked';
    for (const validate of [false, true])
      expect(standingsOutcome(fixtureLeaderboard(false), validate)).toEqual({
        stdout: [],
        stderr: [LOCKED_MESSAGE],
        exitCode: 1,
      });
  });
});
