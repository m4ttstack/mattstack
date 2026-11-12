import { describe, expect, test } from 'bun:test';

import { commentUrl } from '../mr-ref.ts';

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
