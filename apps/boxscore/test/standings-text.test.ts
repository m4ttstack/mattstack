import { afterEach, describe, expect, it } from 'vitest';

import { fixtureLeaderboard } from '../src/server/fixture/index.js';
import {
  isLocked,
  LOCKED_MESSAGE,
  standingsLines,
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
