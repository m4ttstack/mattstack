import { describe, expect, test } from 'bun:test';

import { ForgeNotSupported, gitlabOnly } from '../config.ts';

describe('gitlabOnly', () => {
  test('returns the host for a GitLab forge', () => {
    expect(
      gitlabOnly({
        forge: { kind: 'gitlab', host: 'https://gitlab.example.com' },
      })
    ).toBe('https://gitlab.example.com');
  });

  test('throws ForgeNotSupported for a GitHub forge', () => {
    let caught: unknown;
    try {
      gitlabOnly({ forge: { kind: 'github', host: 'https://github.test' } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForgeNotSupported);
    expect((caught as Error).message).toBe('Not available on GitHub yet');
  });
});
