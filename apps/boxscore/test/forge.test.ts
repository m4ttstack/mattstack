import { describe, expect, it } from 'vitest';

import { changeRef, changeUrl } from '../src/shared/forge.js';

describe('changeUrl', () => {
  it('points at a pull request on github', () => {
    expect(changeUrl('github', 'https://github.com', 'o/r', 7)).toBe(
      'https://github.com/o/r/pull/7'
    );
  });

  it('points at a merge request on gitlab, or when the forge is absent', () => {
    const want = 'https://gl.example/g/p/-/merge_requests/7';
    expect(changeUrl(undefined, 'https://gl.example', 'g/p', 7)).toBe(want);
    expect(changeUrl('gitlab', 'https://gl.example', 'g/p', 7)).toBe(want);
  });
});

describe('changeRef', () => {
  it('is #n on github and !n otherwise', () => {
    expect(changeRef('github', 12)).toBe('#12');
    expect(changeRef(undefined, 12)).toBe('!12');
    expect(changeRef('gitlab', 12)).toBe('!12');
  });
});
