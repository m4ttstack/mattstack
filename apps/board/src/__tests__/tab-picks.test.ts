import { describe, expect, test } from 'bun:test';

import { parseTabPicks, picksOnTabSwitch } from '../view.ts';

const team = {
  tab: 'team',
  member: 'ed',
  off: ['notPosted' as const],
  ownOff: ['myDrafts' as const],
};

describe('picksOnTabSwitch', () => {
  test('a tab never visited opens on everyone with the filters in force', () => {
    const { picks } = picksOnTabSwitch(team, 'seat', {});
    expect(picks).toEqual({
      member: 'all',
      off: ['notPosted'],
      ownOff: ['myDrafts'],
    });
  });

  test('coming back hands the person and filters you had there', () => {
    const away = picksOnTabSwitch(team, 'seat', {});
    const back = picksOnTabSwitch(
      { tab: 'seat', member: 'all', off: [], ownOff: [] },
      'team',
      away.memory
    );
    expect(back.picks).toEqual({
      member: 'ed',
      off: ['notPosted'],
      ownOff: ['myDrafts'],
    });
    expect(back.memory.seat).toEqual({ member: 'all', off: [], ownOff: [] });
  });
});

describe('parseTabPicks', () => {
  test('drops entries that are not the stored shape', () => {
    expect(
      parseTabPicks({
        team: { member: 'ed', off: ['notPosted', 'bogus'], ownOff: [] },
        noOff: { member: 'ed' },
        bad: { member: 3, off: [], ownOff: [] },
        nil: null,
      })
    ).toEqual({ team: { member: 'ed', off: ['notPosted'], ownOff: [] } });
    expect(parseTabPicks('nope')).toEqual({});
    expect(parseTabPicks(['team'])).toEqual({});
  });
});
