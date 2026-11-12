import { describe, expect, test } from 'bun:test';

import { ForgeNotSupported, gitlabOnly } from '../config.ts';
import {
  GITHUB_ASKS_LATCH_SKIP,
  GITHUB_NO_USERNAME,
  triageForgePlan,
} from '../triage/forge-plan.ts';

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

describe('triageForgePlan', () => {
  const gitlab = {
    forge: { kind: 'gitlab', host: 'https://gitlab.example.com' },
  } as const;
  const github = {
    forge: { kind: 'github', host: 'https://github.test' },
  } as const;

  test('runs every pass on a GitLab team and never reads the recorded username', () => {
    expect(
      triageForgePlan(gitlab, () => {
        throw new Error('recorded username read on GitLab');
      })
    ).toEqual({ identity: 'gitlab-token', asksAndLatch: true, lines: [] });
  });

  test('owns PRs as the recorded username on a GitHub team', () => {
    expect(triageForgePlan(github, () => 'mkeller')).toEqual({
      identity: { recorded: 'mkeller' },
      asksAndLatch: false,
      lines: [GITHUB_ASKS_LATCH_SKIP],
    });
  });

  test('owns nothing on a GitHub team with no recorded username', () => {
    expect(triageForgePlan(github, () => null)).toEqual({
      identity: null,
      asksAndLatch: false,
      lines: [GITHUB_ASKS_LATCH_SKIP, GITHUB_NO_USERNAME],
    });
  });

  test('names the skips in plain words', () => {
    expect(GITHUB_ASKS_LATCH_SKIP).toBe(
      'triage: respond asks and the re-review latch skip GitHub teams for now'
    );
    expect(GITHUB_NO_USERNAME).toBe(
      'triage: no forge username is recorded for this team, so auto-doctor owns no PRs'
    );
  });
});
