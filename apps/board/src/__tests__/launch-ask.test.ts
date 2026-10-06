import { describe, expect, test } from 'bun:test';

import { resolveLaunchRepo, type BoardConfig } from '../config.ts';
import { makeRepoForMrUrl } from '../peer/launch-ask.ts';

const cfg = {
  gitlabHost: 'https://gitlab.example.com',
  rtRepos: { 'g/p': 'gl-g-p' },
} as unknown as BoardConfig;

describe('makeRepoForMrUrl', () => {
  const repoFor = makeRepoForMrUrl(cfg);
  test('uses the configured rt repo for a known project', () => {
    const url = 'https://gitlab.example.com/g/p/-/merge_requests/7';
    expect(repoFor(url)).toBe(
      resolveLaunchRepo('gl-g-p', cfg.gitlabHost, 'g/p', url)
    );
  });
  test('derives the identity for an unknown project', () => {
    const url = 'https://gitlab.example.com/x/y/-/merge_requests/7';
    expect(repoFor(url)).toBe(
      resolveLaunchRepo(null, cfg.gitlabHost, 'x/y', url)
    );
  });
});
