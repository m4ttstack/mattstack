import { describe, test, expect } from 'bun:test';
import { parseConfig } from '../src/server/config.ts';

describe('parseConfig', () => {
  test('fills defaults and infers repo name from path', () => {
    const cfg = parseConfig('{ "repos": [{ "path": "/Users/x/my-repo" }] }');
    expect(cfg.repos).toEqual([{ path: '/Users/x/my-repo', name: 'my-repo' }]);
    expect(cfg.port).toBe(11008);
    expect(cfg.herdrWorkspace).toBe('gitq');
    expect(cfg.gitlabHost).toBe('https://gitlab.com');
  });

  test('keeps an explicit name and explicit settings', () => {
    const cfg = parseConfig(
      '{ "repos": [{ "path": "/r", "name": "custom" }], "port": 7999, "herdrWorkspace": "stacks" }',
    );
    expect(cfg.repos[0]!.name).toBe('custom');
    expect(cfg.port).toBe(7999);
    expect(cfg.herdrWorkspace).toBe('stacks');
  });

  test('throws on invalid JSON', () => {
    expect(() => parseConfig('{nope')).toThrow('not valid JSON');
  });

  test('throws on a missing or empty repos array', () => {
    expect(() => parseConfig('{}')).toThrow('non-empty "repos"');
    expect(() => parseConfig('{ "repos": [] }')).toThrow('non-empty "repos"');
  });

  test('throws on a repo without a path', () => {
    expect(() => parseConfig('{ "repos": [{ "name": "x" }] }')).toThrow('repos[0]');
  });

  test('throws on a non-number port', () => {
    expect(() => parseConfig('{ "repos": [{ "path": "/r" }], "port": "7940" }')).toThrow('"port"');
  });
});
