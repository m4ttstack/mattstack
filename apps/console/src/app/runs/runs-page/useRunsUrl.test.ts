import { describe, expect, it } from 'vitest';

import { formatRunsUrl, parseRunsUrl } from './useRunsUrl';

describe('runs url', () => {
  it('reads the defaults from an empty or unknown query', () => {
    expect(parseRunsUrl('')).toEqual({
      filter: 'all',
      repo: null,
      view: 'lanes',
      day: null,
    });
    expect(parseRunsUrl('?filter=nope&view=grid').filter).toBe('all');
    expect(parseRunsUrl('?day=2026-02-30').day).toBeNull();
  });

  it('round-trips a filter, a repo, the timeline view and its day', () => {
    const url = {
      filter: 'waiting',
      repo: 'remote:acme%2Fweb',
      view: 'timeline',
      day: '2026-10-07',
    } as const;
    expect(parseRunsUrl(formatRunsUrl('', url))).toEqual(url);
  });

  it('leaves the defaults and other keys alone', () => {
    expect(
      formatRunsUrl('?x=1&filter=live', {
        filter: 'all',
        repo: null,
        view: 'lanes',
        day: null,
      })
    ).toBe('?x=1');
  });
});
