#!/usr/bin/env bun
/**
 * gitlab.com refuses any GraphQL document it scores over 250, and the score
 * depends on fields, nesting and page sizes in ways only GitLab can compute.
 * A stubbed runQuery never sees the refusal: a `pageInfo` added to the
 * by-branch read took it from 247 to 253 and every unit test stayed green
 * while the daemon's branch refresh failed against the real API.
 *
 * So each document is held to the digest and score the live probe last
 * recorded. Changing a document fails here until it is measured again, and
 * runQuery's parameter type accepts only a registered document, so the
 * typecheck is what keeps an unmeasured one from being sent.
 */
import { describe, expect, test } from 'bun:test';
import { GITLAB_GRAPHQL_DOCUMENTS } from '../src/GitLabProvider.ts';
import budgetJson from './gitlab-complexity-budget.json';
import {
  documentDigest,
  readProbedScore,
  withComplexityProbe,
  type ComplexityBudget,
} from './live/probe/gitlabComplexity.ts';

const budget = budgetJson as ComplexityBudget;
const REMEASURE = 'measure it on gitlab.com: `bun run complexity:gitlab --write` in packages/glance';

describe('GitLab GraphQL complexity budget', () => {
  test('every registered document matches the digest that was measured', () => {
    const changed = Object.entries(GITLAB_GRAPHQL_DOCUMENTS)
      .filter(([label, document]) => budget.documents[label]?.digest !== documentDigest(document))
      .map(([label]) => `${label} changed or was never measured; ${REMEASURE}`);

    expect(changed).toEqual([]);
  });

  test('the budget lists no document the provider no longer sends', () => {
    const stale = Object.keys(budget.documents).filter((label) => !(label in GITLAB_GRAPHQL_DOCUMENTS));

    expect(stale).toEqual([]);
  });

  test('every measured score is within the cap', () => {
    const over = Object.entries(budget.documents)
      .filter(([, entry]) => entry.score > budget.limit)
      .map(([label, entry]) => `${label} scored ${entry.score}, over ${budget.limit}`);

    expect(over).toEqual([]);
  });

  test('the by-branch read is measured with room under the cap', () => {
    expect(budget.documents.GlanceMRByBranches?.score).toBeLessThanOrEqual(budget.limit - 25);
  });
});

describe('complexity probe helpers', () => {
  test('a reformatted document keeps its digest and a changed page size does not', () => {
    const base = 'query Q { project { mergeRequests(first: 50) { nodes { iid } } } }';

    expect(documentDigest(base.replace(/ /g, '\n   '))).toBe(documentDigest(base));
    expect(documentDigest(base.replace('first: 50', 'first: 100'))).not.toBe(documentDigest(base));
  });

  test('the probe field goes into the operation, not a trailing fragment', () => {
    const probed = withComplexityProbe('query Q($a: ID!) { project(fullPath: $a) { id } }\nfragment F on X { id }');

    expect(probed).toContain('query Q($a: ID!) { queryComplexity { score limit } project(');
    expect(probed.match(/queryComplexity/g)).toHaveLength(1);
  });

  test('reads the score from a run and from a refusal', () => {
    expect(readProbedScore({ data: { queryComplexity: { score: 193, limit: 250 } } })).toEqual({ score: 193, limit: 250 });
    expect(
      readProbedScore({ errors: [{ message: 'Query has complexity of 256, which exceeds max complexity of 250' }] }),
    ).toEqual({ score: 256, limit: 250 });
    expect(() => readProbedScore({ errors: [{ message: 'Field does not exist' }] })).toThrow('Field does not exist');
  });
});
