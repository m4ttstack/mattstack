import { describe, expect, test } from 'bun:test';
import { daemonPort } from '../daemonAddress';

describe('daemonPort', () => {
  test('RT_API_PORT wins over the setting', () => {
    expect(daemonPort({ RT_API_PORT: '9500' }, () => 9600)).toBe(9500);
  });

  test('the rt.apiPort setting comes next', () => {
    expect(daemonPort({}, () => 9600)).toBe(9600);
  });

  test('falls back to 9401 when neither is set or readable', () => {
    expect(daemonPort({}, () => undefined)).toBe(9401);
    expect(daemonPort({}, () => { throw new Error('store unreadable'); })).toBe(9401);
  });

  test('ignores a value that is not a port', () => {
    expect(daemonPort({ RT_API_PORT: 'abc' }, () => 70000)).toBe(9401);
  });
});
