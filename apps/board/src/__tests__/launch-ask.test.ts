import { describe, expect, test } from 'bun:test';

import { resolveLaunchRepo, type BoardConfig } from '../config.ts';
import { makeRepoForMrUrl } from '../peer/launch-ask.ts';

const cfg = {
  forge: { kind: 'gitlab', host: 'https://gitlab.example.com' },
  projects: [],
  rtRepos: { 'g/p': 'gl-g-p' },
} as unknown as BoardConfig;

describe('makeRepoForMrUrl', () => {
  const repoFor = makeRepoForMrUrl(cfg);
  test('uses the configured rt repo for a known project', () => {
    const url = 'https://gitlab.example.com/g/p/-/merge_requests/7';
    expect(repoFor(url)).toBe(
      resolveLaunchRepo('gl-g-p', cfg.forge.host, 'g/p', url)
    );
  });
  test('derives the identity for an unknown project', () => {
    const url = 'https://gitlab.example.com/x/y/-/merge_requests/7';
    expect(repoFor(url)).toBe(
      resolveLaunchRepo(null, cfg.forge.host, 'x/y', url)
    );
  });
});

describe('makeRepoForMrUrl on GitHub', () => {
  const gh = {
    forge: { kind: 'github', host: 'https://github.com' },
    projects: ['acme/widgets'],
    rtRepos: {},
  } as unknown as BoardConfig;
  test('derives the identity from the configured spelling', () => {
    expect(makeRepoForMrUrl(gh)('https://github.com/Acme/Widgets/pull/7')).toBe(
      'remote:github.com%2Facme%2Fwidgets'
    );
  });
});
