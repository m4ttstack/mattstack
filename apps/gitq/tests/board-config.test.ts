import { describe, test, expect } from 'bun:test';
import { validateBoardConfig } from '../src/server/config.ts';

describe('validateBoardConfig', () => {
  test('fills defaults and infers repo name from path', () => {
    const cfg = validateBoardConfig(JSON.parse('{ "repos": [{ "path": "/Users/x/my-repo" }] }'), 'gitq.board');
    expect(cfg.repos).toEqual([{ path: '/Users/x/my-repo', name: 'my-repo' }]);
    expect(cfg.port).toBe(11008);
    expect(cfg.herdrWorkspace).toBe('gitq');
    // `gitlabHost` is gone, deliberately: MAT-19 made the board resolve each
    // repo's forge from that repo's remote, so a board-wide host could never be
    // right, and the self-hosted override already lives in the
    // `gitq.forges` setting. This assertion used to expect 'https://gitlab.com'.
    expect('gitlabHost' in cfg).toBe(false);
  });

  test('a gitq.board still carrying gitlabHost keeps loading', () => {
    // Someone's stored value has it. An unknown key is ignored rather than
    // rejected, so removing the field is not a breaking change for them.
    const cfg = validateBoardConfig(JSON.parse('{ "repos": [{ "path": "/r" }], "gitlabHost": "https://gitlab.example.com" }'), 'gitq.board');
    expect(cfg.repos[0]!.path).toBe('/r');
    expect('gitlabHost' in cfg).toBe(false);
  });

  test('keeps an explicit name and explicit settings', () => {
    const cfg = validateBoardConfig(JSON.parse('{ "repos": [{ "path": "/r", "name": "custom" }], "port": 7999, "herdrWorkspace": "stacks" }'), 'gitq.board');
    expect(cfg.repos[0]!.name).toBe('custom');
    expect(cfg.port).toBe(7999);
    expect(cfg.herdrWorkspace).toBe('stacks');
  });

  test('throws on a missing or empty repos array', () => {
    expect(() => validateBoardConfig(JSON.parse('{}'), 'gitq.board')).toThrow('non-empty "repos"');
    expect(() => validateBoardConfig(JSON.parse('{ "repos": [] }'), 'gitq.board')).toThrow('non-empty "repos"');
  });

  test('throws on a repo without a path', () => {
    expect(() => validateBoardConfig(JSON.parse('{ "repos": [{ "name": "x" }] }'), 'gitq.board')).toThrow('repos[0]');
  });

  test('throws on a non-number port', () => {
    expect(() => validateBoardConfig(JSON.parse('{ "repos": [{ "path": "/r" }], "port": "7940" }'), 'gitq.board')).toThrow('"port"');
  });
});
