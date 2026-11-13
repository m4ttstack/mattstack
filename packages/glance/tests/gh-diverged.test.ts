#!/usr/bin/env bun
/**
 * GitHub fetchDivergedCounts and fetchDivergedCount: behind-base counts from
 * a batched GraphQL compare, where one alias's error leaves only that PR out.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { buildDivergedQuery, DIVERGED_BATCH_SIZE } from '../src/githubDiverged.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

const provider = () => new GitHubProvider('https://github.com', 'tok');
const aliasesOf = (query: string) => [...query.matchAll(/\bp(\d+): pullRequest/g)].map(m => Number(m[1]));
const behind = (n: number) => ({ baseRef: { compare: { behindBy: n } } });

describe('buildDivergedQuery', () => {
  test('compares each PR head ref against its base', () => {
    const query = buildDivergedQuery('o', 'r', [12]);
    expect(query).toContain('p12: pullRequest(number: 12)');
    expect(query).toContain('compare(headRef: "refs/pull/12/head")');
    expect(query).toContain('behindBy');
  });

  test('rejects an iid that is not a positive integer', () => {
    expect(() => buildDivergedQuery('o', 'r', [1.5])).toThrow(/positive integers/);
    expect(() => buildDivergedQuery('o', 'r', [0])).toThrow(/positive integers/);
  });
});

describe('GitHubProvider.fetchDivergedCounts', () => {
  test('capability flag is on and the batch size is 25', () => {
    expect(provider().capabilities.canFetchDivergedCount).toBe(true);
    expect(DIVERGED_BATCH_SIZE).toBe(25);
  });

  test('30 iids go in 2 requests of 25 and 5', async () => {
    const sizes: number[] = [];
    stubForge({
      graphql: query => {
        const numbers = aliasesOf(query);
        sizes.push(numbers.length);
        return { repository: Object.fromEntries(numbers.map(n => [`p${n}`, behind(n)])) };
      }
    });
    const out = await provider().fetchDivergedCounts('o/r', Array.from({ length: 30 }, (_, i) => i + 1));
    expect(sizes).toEqual([25, 5]);
    expect(out.size).toBe(30);
    expect(out.get(30)).toBe(30);
  });

  test('maps counts, a deleted base and a missing comparison', async () => {
    stubForge({
      graphql: () => ({
        repository: { p12: behind(3), p13: { baseRef: null }, p14: { baseRef: { compare: null } } }
      })
    });
    const out = await provider().fetchDivergedCounts('o/r', [12, 13, 14]);
    expect(out).toEqual(new Map([[12, 3], [13, null], [14, null]]));
  });

  test('an error under one alias leaves only that PR out', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p12: behind(3), p13: { baseRef: { compare: null } } } },
          errors: [
            {
              type: 'FORBIDDEN',
              message: 'Resource not accessible by integration',
              path: ['repository', 'p13', 'baseRef', 'compare']
            }
          ]
        })
    });
    const out = await provider().fetchDivergedCounts('o/r', [12, 13]);
    expect([...out]).toEqual([[12, 3]]);
  });

  test('a NOT_FOUND alias leaves that PR out', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p12: behind(3), p14: null } },
          errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a PullRequest', path: ['repository', 'p14'] }]
        })
    });
    const out = await provider().fetchDivergedCounts('o/r', [12, 14]);
    expect([...out]).toEqual([[12, 3]]);
  });

  test('an empty list sends no request', async () => {
    const { urls } = stubForge({});
    expect((await provider().fetchDivergedCounts('o/r', [])).size).toBe(0);
    expect(urls.length).toBe(0);
  });

  test('a null repository throws', async () => {
    stubForge({ graphql: () => ({ repository: null }) });
    await expect(provider().fetchDivergedCounts('o/r', [1])).rejects.toThrow();
  });
});

describe('GitHubProvider.fetchDivergedCount', () => {
  test('returns the count', async () => {
    stubForge({ graphql: () => ({ repository: { p12: behind(3) } }) });
    expect(await provider().fetchDivergedCount('o/r', 12)).toBe(3);
  });

  test('returns null when there is no comparison', async () => {
    stubForge({ graphql: () => ({ repository: { p12: { baseRef: null } } }) });
    expect(await provider().fetchDivergedCount('o/r', 12)).toBeNull();
  });

  test('an alias error rejects', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p12: { baseRef: { compare: null } } } },
          errors: [{ type: 'FORBIDDEN', message: 'nope', path: ['repository', 'p12', 'baseRef', 'compare'] }]
        })
    });
    await expect(provider().fetchDivergedCount('o/r', 12)).rejects.toThrow(/could not read the comparison/);
  });

  test('a missing PR rejects', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p12: null } },
          errors: [{ type: 'NOT_FOUND', message: 'Could not resolve', path: ['repository', 'p12'] }]
        })
    });
    await expect(provider().fetchDivergedCount('o/r', 12)).rejects.toThrow(/12/);
  });
});
