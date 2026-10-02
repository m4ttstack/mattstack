import { describe, expect, test } from 'bun:test';

import { switchboardTokenBanner } from '../peer/runtime.ts';

describe('switchboardTokenBanner', () => {
  test('shows only on a Mac in a team whose board is not peering and holds no token', () => {
    expect(
      switchboardTokenBanner({ inTeam: true, peering: false, missing: true })
    ).toBe(true);
  });

  test('a Mac in no team never shows it', () => {
    expect(
      switchboardTokenBanner({ inTeam: false, peering: false, missing: true })
    ).toBe(false);
  });

  test('a peering board or an unread token never shows it', () => {
    expect(
      switchboardTokenBanner({ inTeam: true, peering: true, missing: true })
    ).toBe(false);
    expect(
      switchboardTokenBanner({ inTeam: true, peering: false, missing: false })
    ).toBe(false);
  });
});
