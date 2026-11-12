#!/usr/bin/env bun
/**
 * GitHub fetchApprovalRules: codeowner approval rules from GitHub's own
 * evaluation, where one PR's GraphQL error marks only that PR unknown.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { RateLimitedError } from '../src/errors.ts';
import { rulesFromNode, type GHApprovalNode } from '../src/githubApprovalRules.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

type Request = GHApprovalNode['reviewRequests']['nodes'][number];
type Review = GHApprovalNode['latestOpinionatedReviews']['nodes'][number];

const teamRequest = (slug: string, asCodeOwner = true): Request => ({
  asCodeOwner,
  requestedReviewer: { __typename: 'Team', combinedSlug: slug }
});
const userRequest = (login: string, asCodeOwner = true): Request => ({
  asCodeOwner,
  requestedReviewer: { __typename: 'User', login }
});
const teamReview = (state: string, slugs: string[], totalCount = slugs.length): Review => ({
  state,
  author: { login: 'bob' },
  onBehalfOf: { totalCount, nodes: slugs.map(combinedSlug => ({ combinedSlug })) }
});

function node(over: {
  number?: number;
  isDraft?: boolean;
  updatedAt?: string;
  baseRefName?: string;
  requests?: Request[];
  requestsTotal?: number;
  reviews?: Review[];
  reviewsTotal?: number;
} = {}): GHApprovalNode {
  const requests = over.requests ?? [];
  const reviews = over.reviews ?? [];
  return {
    number: over.number ?? 1,
    isDraft: over.isDraft ?? false,
    updatedAt: over.updatedAt ?? '2026-01-02T00:00:00Z',
    baseRefName: over.baseRefName ?? 'main',
    reviewRequests: { totalCount: over.requestsTotal ?? requests.length, nodes: requests },
    latestOpinionatedReviews: { totalCount: over.reviewsTotal ?? reviews.length, nodes: reviews }
  };
}

describe('rulesFromNode', () => {
  test('codeowner requests give one lowercased rule per owner, sorted, and ignore other requests', () => {
    expect(
      rulesFromNode(node({ requests: [teamRequest('Org/Platform'), userRequest('Alice'), userRequest('carol', false)] }))
    ).toEqual({
      rules: [
        { type: 'CODE_OWNER', section: '@alice', approved: false },
        { type: 'CODE_OWNER', section: '@org/platform', approved: false }
      ]
    });
  });

  test('an approval on behalf of a team merges with its pending request into one approved rule', () => {
    expect(
      rulesFromNode(node({ requests: [teamRequest('org/platform')], reviews: [teamReview('APPROVED', ['org/platform'])] }))
    ).toEqual({ rules: [{ type: 'CODE_OWNER', section: '@org/platform', approved: true }] });
  });

  test('changes requested on behalf of a team is not approved', () => {
    expect(rulesFromNode(node({ reviews: [teamReview('CHANGES_REQUESTED', ['org/platform'])] }))).toEqual({
      rules: [{ type: 'CODE_OWNER', section: '@org/platform', approved: false }]
    });
  });

  test('a user owner approval with no team adds no rule', () => {
    expect(rulesFromNode(node({ reviews: [teamReview('APPROVED', [])] }))).toEqual({ rules: [] });
  });

  test('overflowed review requests are unknown', () => {
    expect(rulesFromNode(node({ requests: [teamRequest('org/a')], requestsTotal: 101 }))).toHaveProperty(
      'unknownReason'
    );
  });

  test('overflowed latest reviews are unknown', () => {
    expect(rulesFromNode(node({ reviews: [teamReview('APPROVED', ['org/a'])], reviewsTotal: 21 }))).toHaveProperty(
      'unknownReason'
    );
  });

  test('an overflowed onBehalfOf is unknown', () => {
    expect(rulesFromNode(node({ reviews: [teamReview('APPROVED', ['org/a'], 6)] }))).toHaveProperty('unknownReason');
  });

  test('a codeowner request with a null reviewer is unknown, but a plain request with one is not', () => {
    expect(rulesFromNode(node({ requests: [{ asCodeOwner: true, requestedReviewer: null }] }))).toHaveProperty(
      'unknownReason'
    );
    expect(rulesFromNode(node({ requests: [{ asCodeOwner: false, requestedReviewer: null }] }))).toEqual({ rules: [] });
  });
});

describe('GitHubProvider.fetchApprovalRules', () => {
  const provider = () => new GitHubProvider('https://github.com', 'tok');
  const aliasesOf = (query: string) => [...query.matchAll(/\bp(\d+): pullRequest/g)].map(m => Number(m[1]));

  test('both updatedAfter and iids throws before any request', async () => {
    const { urls } = stubForge({});
    await expect(
      provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z', iids: [1] })
    ).rejects.toThrow(/mutually exclusive/);
    expect(urls.length).toBe(0);
  });

  test('capability flag is on', () => {
    expect(provider().capabilities.canFetchApprovalRules).toBe(true);
  });

  describe('iids mode', () => {
    test('60 numbers go in 2 requests of 50 and 10, and a draft is kept', async () => {
      const sizes: number[] = [];
      stubForge({
        graphql: query => {
          const numbers = aliasesOf(query);
          sizes.push(numbers.length);
          return {
            repository: Object.fromEntries(
              numbers.map(n => [`p${n}`, node({ number: n, isDraft: n === 1, requests: [teamRequest('org/a')] })])
            )
          };
        }
      });
      const out = await provider().fetchApprovalRules({
        projectPath: 'o/r',
        iids: Array.from({ length: 60 }, (_, i) => i + 1)
      });
      expect(sizes).toEqual([50, 10]);
      expect(out.length).toBe(60);
      expect(out[0]).toEqual({ iid: 1, rules: [{ type: 'CODE_OWNER', section: '@org/a', approved: false }] });
    });

    test('an error under one alias marks only that PR unknown', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({
            data: {
              repository: {
                p7: node({ number: 7, requests: [{ asCodeOwner: true, requestedReviewer: null }] }),
                p8: node({ number: 8, requests: [teamRequest('org/a')] }),
                p9: null
              }
            },
            errors: [
              {
                type: 'FORBIDDEN',
                message: 'Resource not accessible by integration',
                path: ['repository', 'p7', 'reviewRequests', 'nodes', 0, 'requestedReviewer']
              },
              {
                type: 'NOT_FOUND',
                message: 'Could not resolve to a PullRequest with the number of 9.',
                path: ['repository', 'p9']
              }
            ]
          })
      });
      const out = await provider().fetchApprovalRules({ projectPath: 'o/r', iids: [7, 8, 9] });
      expect(out.map(r => r.iid)).toEqual([7, 8]);
      expect(out[0]!.rules).toEqual([]);
      expect(out[0]!.unknownReason).toMatch(/Resource not accessible/);
      expect(out[1]).toEqual({ iid: 8, rules: [{ type: 'CODE_OWNER', section: '@org/a', approved: false }] });
    });

    test('a null repository throws', async () => {
      stubForge({ graphql: () => ({ repository: null }) });
      await expect(provider().fetchApprovalRules({ projectPath: 'o/r', iids: [1] })).rejects.toThrow();
    });

    test('a rate limit throws RateLimitedError', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] })
      });
      const err = await provider()
        .fetchApprovalRules({ projectPath: 'o/r', iids: [1] })
        .then(
          () => null,
          (e: unknown) => e
        );
      expect(err).toBeInstanceOf(RateLimitedError);
    });

    test('an empty iids list makes no request', async () => {
      const { urls } = stubForge({});
      expect(await provider().fetchApprovalRules({ projectPath: 'o/r', iids: [] })).toEqual([]);
      expect(urls.length).toBe(0);
    });
  });

  describe('updatedAfter mode', () => {
    const page = (nodes: Array<GHApprovalNode | null>, hasNextPage = false, endCursor: string | null = null) => ({
      repository: { pullRequests: { pageInfo: { hasNextPage, endCursor }, nodes } }
    });

    test('drafts and excluded target branches are left out', async () => {
      stubForge({
        graphql: () =>
          page([
            node({ number: 1 }),
            node({ number: 2, isDraft: true }),
            node({ number: 3, baseRefName: 'release' })
          ])
      });
      const out = await provider().fetchApprovalRules({
        projectPath: 'o/r',
        updatedAfter: '2026-01-01T00:00:00Z',
        excludeTargetBranches: ['release']
      });
      expect(out.map(r => r.iid)).toEqual([1]);
    });

    test('the walk stops at the first node older than updatedAfter without asking for the next page', async () => {
      const { urls } = stubForge({
        graphql: () =>
          page(
            [
              node({ number: 1, updatedAt: '2026-01-03T00:00:00Z' }),
              node({ number: 2, updatedAt: '2025-12-01T00:00:00Z' }),
              node({ number: 3, updatedAt: '2025-11-01T00:00:00Z' })
            ],
            true,
            'c1'
          )
      });
      const out = await provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' });
      expect(out.map(r => r.iid)).toEqual([1]);
      expect(urls.length).toBe(1);
    });

    test('pages follow the cursor until the last page', async () => {
      const afters: unknown[] = [];
      stubForge({
        graphql: (_query, variables) => {
          afters.push(variables.after);
          return variables.after === null ? page([node({ number: 1 })], true, 'c1') : page([node({ number: 2 })]);
        }
      });
      const out = await provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' });
      expect(out.map(r => r.iid)).toEqual([1, 2]);
      expect(afters).toEqual([null, 'c1']);
    });

    test('a non-advancing cursor throws', async () => {
      stubForge({ graphql: () => page([node({ number: 1 })], true, null) });
      await expect(
        provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' })
      ).rejects.toThrow(/non-advancing cursor/);
    });

    test('pageSize above the cap, and the default, send first: 50', async () => {
      const firsts: unknown[] = [];
      stubForge({
        graphql: (_query, variables) => {
          firsts.push(variables.first);
          return page([]);
        }
      });
      await provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z', pageSize: 80 });
      await provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' });
      expect(firsts).toEqual([50, 50]);
    });

    test('a non-positive or fractional pageSize throws', async () => {
      stubForge({ graphql: () => page([]) });
      for (const pageSize of [0, 1.5]) {
        await expect(
          provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z', pageSize })
        ).rejects.toThrow(/pageSize/);
      }
    });

    test('an error under one node marks only that node unknown', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({
            data: page([
              node({ number: 1 }),
              node({ number: 2 }),
              node({ number: 3, requests: [{ asCodeOwner: true, requestedReviewer: null }] })
            ]),
            errors: [
              {
                type: 'FORBIDDEN',
                message: 'SAML enforcement',
                path: ['repository', 'pullRequests', 'nodes', 2, 'reviewRequests', 'nodes', 0, 'requestedReviewer']
              }
            ]
          })
      });
      const out = await provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' });
      expect(out.map(r => [r.iid, r.unknownReason === undefined])).toEqual([
        [1, true],
        [2, true],
        [3, false]
      ]);
      expect(out[2]!.rules).toEqual([]);
    });

    test('a null node with errors throws', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({
            data: page([node({ number: 1 }), null]),
            errors: [{ type: 'FORBIDDEN', message: 'nope', path: ['repository', 'pullRequests', 'nodes', 1] }]
          })
      });
      await expect(
        provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' })
      ).rejects.toThrow();
    });

    test('an error that names no node throws', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({
            data: page([node({ number: 1 })]),
            errors: [{ type: 'INTERNAL', message: 'boom', path: ['repository'] }]
          })
      });
      await expect(
        provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' })
      ).rejects.toThrow(/boom/);
    });

    test('a rate limit throws RateLimitedError', async () => {
      stubForge({
        graphql: () =>
          jsonResponse({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] })
      });
      await expect(
        provider().fetchApprovalRules({ projectPath: 'o/r', updatedAfter: '2026-01-01T00:00:00Z' })
      ).rejects.toBeInstanceOf(RateLimitedError);
    });
  });
});
