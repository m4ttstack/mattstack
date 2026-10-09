import { describe, expect, it } from 'vitest';

import { repoLabel, repoPath } from './repoLabel';

describe('repo labels', () => {
  it('names a repo by its last segment', () => {
    expect(repoLabel('remote:acme%2Fweb')).toBe('web');
  });

  it('names a repo by group and name, without a forge host', () => {
    expect(repoPath('remote:acme%2Fweb')).toBe('acme/web');
    expect(repoPath('remote:gitlab.com%2Facme%2Fweb')).toBe('acme/web');
    expect(repoPath('legacy-name')).toBe('legacy-name');
  });
});
