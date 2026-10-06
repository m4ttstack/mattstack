import { describe, expect, it } from 'vitest';

import {
  mergeIntegrations,
  mergeRoster,
  teamlessUsernames,
} from '../scripts/import-legacy-settings.js';

describe('mergeRoster', () => {
  it('unions by username, board names win, board order first', () => {
    const board = [
      { username: 'ada', name: 'Ada L' },
      { username: 'bob', name: 'Bob B' },
    ];
    const merged = mergeRoster(board, ['bob', 'eve', 'ada']);
    expect(merged).toEqual([
      { username: 'ada', name: 'Ada L' },
      { username: 'bob', name: 'Bob B' },
      { username: 'eve' },
    ]);
  });
});

describe('mergeRoster with an active team', () => {
  it('puts appended usernames on the active team and leaves existing entries alone', () => {
    const existing = [{ username: 'dev1', teams: ['gadgets'] }];
    expect(mergeRoster(existing, ['dev1', 'dev2'], 'widgets')).toEqual([
      { username: 'dev1', teams: ['gadgets'] },
      { username: 'dev2', teams: ['widgets'] },
    ]);
  });

  it('appends with no teams when there is no active team', () => {
    expect(mergeRoster([], ['dev2'], null)).toEqual([{ username: 'dev2' }]);
  });
});

describe('teamlessUsernames', () => {
  it('names the appended usernames when there is no active team', () => {
    expect(
      teamlessUsernames([{ username: 'dev1' }], ['dev1', 'dev2', 'dev2'], null)
    ).toEqual(['dev2']);
  });

  it('names nobody when an active team takes them', () => {
    expect(teamlessUsernames([], ['dev2'], 'widgets')).toEqual([]);
  });
});

describe('mergeIntegrations', () => {
  it('fills only missing fields and reports no change when both are present', () => {
    const current = {
      forge: { host: 'gitlab.com', provider: 'gitlab' },
      linear: { teamKey: 'CV' },
      slack: { appId: 'A1' },
    };
    const { merged, changed } = mergeIntegrations(current, {
      host: 'https://ignored.example',
      teamKey: 'ZZ',
    });
    expect(changed).toBe(false);
    expect(merged).toEqual(current);
  });

  it('fills a missing linear.teamKey and preserves unrelated blocks', () => {
    const current = { forge: { host: 'gitlab.com' }, slack: { appId: 'A1' } };
    const { merged, changed } = mergeIntegrations(current, { teamKey: 'CV' });
    expect(changed).toBe(true);
    expect(merged).toEqual({
      forge: { host: 'gitlab.com' },
      slack: { appId: 'A1' },
      linear: { teamKey: 'CV' },
    });
  });
});
