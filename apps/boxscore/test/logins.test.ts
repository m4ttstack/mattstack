import { describe, expect, it } from 'vitest';

import { loginCanon } from '../src/server/source/logins.js';

describe('loginCanon', () => {
  const canon = loginCanon(['ada']);

  it('returns the known spelling on a case-insensitive match', () => {
    expect(canon('Ada')).toBe('ada');
  });

  it('leaves an unknown login unchanged', () => {
    expect(canon('eve')).toBe('eve');
  });

  it('keeps the first spelling when two known logins differ only in case', () => {
    expect(loginCanon(['Ada', 'ada'])('ADA')).toBe('Ada');
  });

  it('keeps null', () => {
    expect(canon(null)).toBeNull();
  });
});
