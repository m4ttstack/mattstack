import { describe, expect, test } from 'bun:test';

import { parseTabPicks, picksOnTabSwitch } from '../view.ts';

describe('picksOnTabSwitch', () => {
  test('a tab never visited opens on everyone', () => {
    const { picks } = picksOnTabSwitch(
      { tab: 'team', member: 'ed' },
      'seat',
      {}
    );
    expect(picks.member).toBe('all');
  });

  test('coming back hands the person you had there', () => {
    const away = picksOnTabSwitch({ tab: 'team', member: 'ed' }, 'seat', {});
    const back = picksOnTabSwitch(
      { tab: 'seat', member: 'all' },
      'team',
      away.memory
    );
    expect(back.picks.member).toBe('ed');
    expect(back.memory.seat).toEqual({ member: 'all' });
  });
});

describe('parseTabPicks', () => {
  test('drops entries that are not the stored shape', () => {
    expect(
      parseTabPicks({ team: { member: 'ed' }, bad: { member: 3 }, nil: null })
    ).toEqual({ team: { member: 'ed' } });
    expect(parseTabPicks('nope')).toEqual({});
    expect(parseTabPicks(['team'])).toEqual({});
  });
});
