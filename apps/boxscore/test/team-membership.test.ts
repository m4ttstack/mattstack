import { describe, expect, it } from 'vitest';

import { joinedOf } from '../src/server/config/team.js';

describe('joinedOf', () => {
  it('is null with no team', () => {
    expect(joinedOf([], () => false)).toBeNull();
  });
  it('is not joined for a created team', () => {
    expect(joinedOf(['acme'], () => false)).toEqual({ joined: false });
  });
  it('is joined when any of two teams was joined', () => {
    expect(joinedOf(['acme', 'beta'], t => t === 'beta')).toEqual({
      joined: true,
    });
  });
});
