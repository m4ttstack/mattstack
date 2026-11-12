import { describe, expect, test } from 'bun:test';

import { commentUrl, forgeNoun, mrNoun, mrNouns } from '../mr-ref.ts';

const PR = 'https://github.com/acme/webapp/pull/12';
const MR = 'https://gitlab.example.com/g/p/-/merge_requests/12';
const gh = { iid: 12, webUrl: PR, provider: 'github' as const };
const gl = { iid: 12, webUrl: MR, provider: 'gitlab' as const };

describe('commentUrl', () => {
  test('GitLab keeps #note_<id> whatever the discussion id', () => {
    expect(commentUrl(gl, 'abc123', 301)).toBe(`${MR}#note_301`);
    expect(commentUrl(gl, 'gh-review-thread-1', 301)).toBe(`${MR}#note_301`);
  });

  test('GitHub anchors by discussion id shape', () => {
    expect(commentUrl(gh, 'gh-issue-comment-9', 9)).toBe(
      `${PR}#issuecomment-9`
    );
    expect(commentUrl(gh, 'gh-review-thread-40', 41)).toBe(
      `${PR}#discussion_r41`
    );
    expect(commentUrl(gh, 'gh-review-77', 77)).toBe(
      `${PR}#pullrequestreview-77`
    );
  });

  test('an unknown GitHub id shape gets the bare PR', () => {
    expect(commentUrl(gh, 'fx-thread-1', 5)).toBe(PR);
  });

  test('no webUrl gives null', () => {
    expect(commentUrl({ iid: 12 }, 'gh-issue-comment-9', 9)).toBeNull();
  });
});

describe('the forge noun', () => {
  test('a GitHub row says PR, a GitLab row MR', () => {
    expect(mrNoun(gh)).toBe('PR');
    expect(mrNoun(gl)).toBe('MR');
    expect(mrNouns(gh)).toBe('PRs');
    expect(mrNouns(gl)).toBe('MRs');
    expect(forgeNoun(gh)).toBe('pull request');
    expect(forgeNoun(gl)).toBe('merge request');
  });

  test('a board forge names the noun for board-wide copy', () => {
    expect(mrNoun('github')).toBe('PR');
    expect(mrNoun('gitlab')).toBe('MR');
    expect(mrNouns('github')).toBe('PRs');
    expect(forgeNoun('github')).toBe('pull request');
  });

  test('no row and no forge reads as GitLab; a gate subject can decide', () => {
    expect(mrNoun()).toBe('MR');
    expect(mrNoun(undefined, `mr:${PR}`)).toBe('PR');
    expect(forgeNoun(undefined, `mr:${PR}`)).toBe('pull request');
  });
});
