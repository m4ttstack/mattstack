import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  formatRunsUrl,
  parseRunsUrl,
  runsHomeHref,
  useRunsUrl,
} from './useRunsUrl';

describe('runs url', () => {
  it('reads the defaults from an empty or unknown query', () => {
    expect(parseRunsUrl('')).toEqual({
      filter: 'all',
      repo: null,
      pipeline: null,
      view: 'lanes',
      day: null,
    });
    expect(parseRunsUrl('?filter=nope&view=grid').filter).toBe('all');
    expect(parseRunsUrl('?day=2026-02-30').day).toBeNull();
    expect(parseRunsUrl('?pipeline=accessibility').pipeline).toBe(
      'accessibility'
    );
  });

  it('round-trips a filter, a repo, a pipeline, the timeline view and its day', () => {
    const url = {
      filter: 'waiting',
      repo: 'remote:acme%2Fweb',
      pipeline: 'accessibility',
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
        pipeline: null,
        view: 'lanes',
        day: null,
      })
    ).toBe('?x=1');
  });

  it('links home to the runs page as it was last seen, without foreign keys', () => {
    history.replaceState(null, '', '/?filter=live&repo=acme&gate=g1');
    const { unmount } = renderHook(() => useRunsUrl());
    unmount();
    history.replaceState(null, '', '/runs/acme/r1');
    expect(runsHomeHref()).toBe('/?filter=live&repo=acme');
  });
});
