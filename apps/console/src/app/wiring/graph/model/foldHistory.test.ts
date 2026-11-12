import { describe, expect, it } from 'vitest';

import { foldVersionOnly } from './foldHistory';

const commit = (sha: string, versionOnly: boolean) => ({ sha, versionOnly });

describe('foldVersionOnly', () => {
  it('three consecutive version-only commits fold into one', () => {
    const [a, b, c, d, e] = [
      commit('a', false),
      commit('b', true),
      commit('c', true),
      commit('d', true),
      commit('e', false),
    ];

    expect(foldVersionOnly([a, b, c, d, e])).toEqual([
      { kind: 'commit', commit: a },
      { kind: 'fold', commits: [b, c, d] },
      { kind: 'commit', commit: e },
    ]);
  });

  it('a lone version-only commit stays a row', () => {
    const [a, b, c] = [
      commit('a', false),
      commit('b', true),
      commit('c', false),
    ];

    expect(foldVersionOnly([a, b, c])).toEqual([
      { kind: 'commit', commit: a },
      { kind: 'commit', commit: b },
      { kind: 'commit', commit: c },
    ]);
  });

  it('a real commit splits two folds', () => {
    const [a, b, c, d, e] = [
      commit('a', true),
      commit('b', true),
      commit('c', false),
      commit('d', true),
      commit('e', true),
    ];

    expect(foldVersionOnly([a, b, c, d, e])).toEqual([
      { kind: 'fold', commits: [a, b] },
      { kind: 'commit', commit: c },
      { kind: 'fold', commits: [d, e] },
    ]);
  });

  it('answers nothing for no commits', () => {
    expect(foldVersionOnly([])).toEqual([]);
  });
});
