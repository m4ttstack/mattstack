import { afterEach, describe, expect, it } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
  readSettings,
  type RosterEntry,
} from '../src/server/config/index.js';

const store = (values: Record<string, unknown>, roster: RosterEntry[] = []) => {
  __setSettingReader(<T>(key: string) => values[key] as T | undefined);
  __setRosterReader(() => roster);
};

afterEach(() => {
  __setSettingReader(null);
  __setRosterReader(null);
});

describe('readSettings', () => {
  it('maps every key and derives users from roster minus hiddenMembers', () => {
    store(
      {
        'boxscore.hiddenMembers': ['eve'],
        'boxscore.projects': ['g/p'],
        'boxscore.linearDoneStates': ['Done'],
        'boxscore.sizeBand': { tooSmall: 5, tooLarge: 300 },
        'boxscore.excludeFilePatterns': ['**/*.json'],
        'boxscore.ignoredMrs': ['g/p!9'],
        'boxscore.botPatterns': ['-bot$'],
        'boxscore.defaultRange': '7d',
        'mattstack.integrations': {
          forge: { host: 'gitlab.example', provider: 'gitlab' },
        },
        'rt.integrations': { forgeHost: 'gitlab.example' },
      },
      [
        { username: 'ada', name: 'Ada L' },
        { username: 'bob' },
        { username: 'eve', name: 'Eve M' },
      ]
    );
    const s = readSettings();
    expect(s.users).toEqual(['ada', 'bob']);
    expect(s.roster).toHaveLength(3);
    expect(s.projects).toEqual(['g/p']);
    expect(s.doneStates).toEqual(['Done']);
    expect(s.sizeBand).toEqual({ tooSmall: 5, tooLarge: 300 });
    expect(s.excludeFilePatterns).toEqual(['**/*.json']);
    expect(s.ignoredMrs).toEqual(['g/p!9']);
    expect(s.botPatterns).toEqual(['-bot$']);
    expect(s.defaultRange).toBe('7d');
    expect(s.baseUrl).toBe('https://gitlab.example');
  });

  it('keeps only org roster entries that carry a string username', () => {
    store({
      'mattstack.roster': [
        'dev1',
        null,
        { username: 5 },
        { name: 'no handle' },
        { username: 'dev2', teams: ['gadgets'] },
      ],
    });
    expect(readSettings().orgRoster).toEqual([
      { username: 'dev2', teams: ['gadgets'] },
    ]);
  });

  it('reads a non-list org roster as empty', () => {
    store({ 'mattstack.roster': { username: 'dev1' } });
    expect(readSettings().orgRoster).toEqual([]);
  });

  it('applies fallbacks when every key is unset', () => {
    store({});
    const s = readSettings();
    expect(s.projects).toEqual([]);
    expect(s.users).toEqual([]);
    expect(s.doneStates).toEqual([]);
    expect(s.sizeBand).toEqual({ tooSmall: 10, tooLarge: 400 });
    expect(s.excludeFilePatterns).toEqual([]);
    expect(s.ignoredMrs).toEqual([]);
    expect(s.botPatterns).toEqual([]);
    expect(s.defaultRange).toBe('30d');
    expect(s.baseUrl).toBe('');
  });

  it('reads a declared gitlab.com written as a URL with a trailing slash', () => {
    store({
      'mattstack.integrations': { forge: { host: 'https://gitlab.com/' } },
    });
    expect(readSettings().baseUrl).toBe('https://gitlab.com');
  });

  it('reads fresh on every call (no module cache)', () => {
    store({ 'boxscore.projects': ['a/b'] });
    expect(readSettings().projects).toEqual(['a/b']);
    store({ 'boxscore.projects': ['c/d'] });
    expect(readSettings().projects).toEqual(['c/d']);
  });

  it("users are the active team's members, never the org roster setting", () => {
    store(
      {
        'mattstack.roster': [
          { username: 'dev1', teams: ['widgets'] },
          { username: 'dev2', teams: ['gadgets'] },
        ],
      },
      [{ username: 'dev1' }]
    );
    const s = readSettings();
    expect(s.users).toEqual(['dev1']);
    expect(s.roster).toEqual([{ username: 'dev1' }]);
  });

  it('refuses the store-backed readers under vitest', () => {
    __setRosterReader(() => []);
    __setSettingReader(null);
    expect(() => readSettings()).toThrow('inject a setting reader');
    __setRosterReader(null);
    expect(() => readSettings()).toThrow('inject a roster reader');
  });

  it('passes boxscore.roles through raw, {} when unset', () => {
    store({ 'boxscore.roles': { ada: 'team' } });
    expect(readSettings().roles).toEqual({ ada: 'team' });
    store({});
    expect(readSettings().roles).toEqual({});
  });
});

describe('readSettings: which GitLab host gets the token', () => {
  const declared = (host: string) => ({
    'mattstack.integrations': { forge: { host, provider: 'gitlab' } },
  });

  it('leaves GitLab unconfigured when only the team declares a host', () => {
    store(declared('gitlab.team.example'));
    const s = readSettings();
    expect(s.baseUrl).toBe('');
    expect(s.declaredHost).toBe('gitlab.team.example');
  });

  it('uses the host the person confirmed', () => {
    store({
      ...declared('gitlab.corp.example'),
      'rt.integrations': { forgeHost: 'gitlab.corp.example' },
    });
    expect(readSettings().baseUrl).toBe('https://gitlab.corp.example');
  });

  it('uses the confirmed host, never a different team-declared one', () => {
    store({
      ...declared('gitlab.team.example'),
      'rt.integrations': { forgeHost: 'gitlab.corp.example' },
    });
    expect(readSettings().baseUrl).toBe('https://gitlab.corp.example');
  });

  it('trusts a declared gitlab.com with no confirmed host', () => {
    store(declared('gitlab.com'));
    expect(readSettings().baseUrl).toBe('https://gitlab.com');
  });

  it('never treats a confirmed github.com as a GitLab host', () => {
    store({
      ...declared('gitlab.team.example'),
      'rt.integrations': { forgeHost: 'github.com' },
    });
    expect(readSettings().baseUrl).toBe('');
  });

  it('ignores a confirmed host that is not a bare hostname', () => {
    store({ 'rt.integrations': { forgeHost: 'https://gitlab.corp.example/x' } });
    expect(readSettings().baseUrl).toBe('');
  });
});
