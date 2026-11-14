import { describe, expect, test } from 'bun:test';

import { ForgeNotSupported, gitlabOnly } from '../config.ts';
import type { OwnMrFacts } from '../triage/edge.ts';
import {
  GITHUB_ASKS_SKIP,
  GITHUB_NO_USERNAME,
  triageForgePlan,
  unparsedRedLines,
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
    ).toEqual({
      identity: 'gitlab-token',
      asks: true,
      latch: true,
      lines: [],
    });
  });

  test('owns PRs and runs the latch as the recorded username on a GitHub team', () => {
    expect(triageForgePlan(github, () => 'mkeller')).toEqual({
      identity: { recorded: 'mkeller' },
      asks: false,
      latch: true,
      lines: [GITHUB_ASKS_SKIP],
    });
  });

  test('owns nothing and runs no latch on a GitHub team with no recorded username', () => {
    expect(triageForgePlan(github, () => null)).toEqual({
      identity: null,
      asks: false,
      latch: false,
      lines: [GITHUB_ASKS_SKIP, GITHUB_NO_USERNAME],
    });
  });

  test('names the skips in plain words', () => {
    expect(GITHUB_ASKS_SKIP).toBe(
      'triage: respond asks skip GitHub teams for now'
    );
    expect(GITHUB_NO_USERNAME).toBe(
      'triage: no forge username is recorded for this team, so auto-doctor owns no PRs'
    );
  });
});

describe('unparsedRedLines', () => {
  const base = {
    iid: 4104,
    needsRebase: false,
    author: 'mkeller',
    sourceBranch: 'feature/cart-totals',
    targetBranch: 'main',
    isStacked: false,
  };

  test('names a red PR with no parsed pipeline id and nothing else', () => {
    const mrs: OwnMrFacts[] = [
      {
        ...base,
        mrUrl: 'https://github.test/acme/webapp/pull/4104',
        iid: 4104,
        pipelineId: null,
        pipelineState: 'failed',
      },
      {
        ...base,
        mrUrl: 'https://github.test/acme/webapp/pull/4105',
        iid: 4105,
        pipelineId: 7004106,
        pipelineState: 'failed',
      },
      {
        ...base,
        mrUrl: 'https://github.test/acme/webapp/pull/4106',
        iid: 4106,
        pipelineId: null,
        pipelineState: 'passed',
      },
    ];
    expect(unparsedRedLines(mrs)).toEqual([
      'triage: https://github.test/acme/webapp/pull/4104 has no workflow run id (commit statuses only), auto-doctor skips it',
    ]);
  });
});
