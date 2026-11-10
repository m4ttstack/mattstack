import { describe, expect, test } from 'bun:test';
import {
  buildContextsPageQuery,
  buildFillQuery,
  parseFillAliases
} from '../src/githubFill.ts';
import { ghNode, stubForge, useForgeStub } from './helpers/gh-fill-fixture.ts';

useForgeStub();

describe('buildFillQuery', () => {
  test('one alias per number, isRequired inlined', () => {
    const q = buildFillQuery('o', 'r', [7, 12], { listWeight: false });
    expect(q).toContain('p7: pullRequest(number: 7)');
    expect(q).toContain('p12: pullRequest(number: 12)');
    expect(q).toContain('isRequired(pullRequestNumber: 7)');
    expect(q).toContain('isRequired(pullRequestNumber: 12)');
    expect(parseFillAliases(q)).toEqual([7, 12]);
  });

  test('listWeight drops only body', () => {
    const full = buildFillQuery('o', 'r', [1], { listWeight: false });
    const list = buildFillQuery('o', 'r', [1], { listWeight: true });
    expect(full).toContain(' body ');
    expect(list).not.toContain(' body ');
    for (const token of [
      'statusCheckRollup',
      'latestReviews',
      'latestOpinionatedReviews',
      'branchProtectionRule'
    ]) {
      expect(list).toContain(token);
    }
  });

  test('review requests select users only, never teams (a team field can need read:org)', () => {
    const q = buildFillQuery('o', 'r', [1], { listWeight: false });
    expect(q).toContain('... on User { login databaseId name avatarUrl }');
    expect(q).not.toContain('on Team');
  });

  test('owner and repo are passed as string literals safely', () => {
    const q = buildFillQuery('o', 'we"ird', [1], { listWeight: false });
    expect(q).toContain('name: "we\\"ird"');
  });
});

describe('buildContextsPageQuery', () => {
  test('contexts page query', () => {
    const q = buildContextsPageQuery('o', 'r', 5, 'CUR');
    expect(q).toContain('after: "CUR"');
    expect(q).toContain('isRequired(pullRequestNumber: 5)');
    expect(parseFillAliases(q)).toEqual([5]);
  });
});

describe('fixture', () => {
  test('stubForge answers aliases and records urls', async () => {
    const { urls } = stubForge({
      fill: (nums) => ({ [nums[0]!]: ghNode({ number: nums[0] }) })
    });
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: buildFillQuery('o', 'r', [3, 4], { listWeight: false })
      })
    });
    const json = (await res.json()) as {
      data: { repository: Record<string, unknown> };
    };
    expect(Object.keys(json.data.repository)).toEqual(['p3', 'p4']);
    expect(json.data.repository.p4).toBeNull();
    expect(urls).toEqual(['https://api.github.com/graphql']);
  });
});
