import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import { toPullRequestFromNode, type GHFillNode } from '../src/githubFill.ts';
import { ghNode } from './helpers/gh-fill-fixture.ts';

function providerWith(responses: unknown[]) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const graphql: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const requests: unknown[] = [];
  (provider as any).octokit = {
    request: async (...args: unknown[]) => {
      requests.push(args);
      return { status: 200, headers: {}, data: {} };
    },
    graphql: async (query: string, variables: Record<string, unknown>) => {
      graphql.push({ query, variables });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  };
  return { provider, graphql, requests };
}

const readPayload = { repository: { pullRequest: { id: 'PR_node', headRefOid: 'abc123' } } };
const updatePayload = { updatePullRequestBranch: { pullRequest: { headRefOid: 'def456' } } };

describe('rebasePullRequest', () => {
  test('sends updatePullRequestBranch with REBASE and the head it read', async () => {
    const { provider, graphql } = providerWith([readPayload, updatePayload]);

    await provider.rebasePullRequest('o/r', 7);

    expect(graphql[0]!.variables).toMatchObject({ owner: 'o', repo: 'r', number: 7 });
    expect(graphql[1]!.query).toContain('updateMethod: REBASE');
    expect(graphql[1]!.variables).toMatchObject({ id: 'PR_node', expectedHeadOid: 'abc123' });
  });

  test('costs two GraphQL requests and no REST', async () => {
    const { provider, graphql, requests } = providerWith([readPayload, updatePayload]);

    await provider.rebasePullRequest('o/r', 7);

    expect(graphql).toHaveLength(2);
    expect(requests).toHaveLength(0);
  });

  test('a missing pull request throws', async () => {
    const { provider } = providerWith([{ repository: { pullRequest: null } }]);

    await expect(provider.rebasePullRequest('o/r', 7)).rejects.toThrow(
      'rebasePullRequest failed: GitHub returned no pull request for o/r!7'
    );
  });

  test('a GraphQL refusal surfaces', async () => {
    const refusal = Object.assign(new Error('refused'), {
      data: { errors: [{ message: 'Cannot update PR branch due to conflicts' }] }
    });
    const { provider } = providerWith([readPayload, refusal]);

    await expect(provider.rebasePullRequest('o/r', 7)).rejects.toThrow(
      'rebasePullRequest failed: GitHub GraphQL returned'
    );
  });

  test('canRebase is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canRebase).toBe(true);
  });

  test('a BEHIND pull request asks for a rebase', () => {
    const node: GHFillNode = ghNode({ number: 7, mergeStateStatus: 'BEHIND' });
    const pr = toPullRequestFromNode(node, {
      roles: ['author'],
      contexts: node.commits.nodes[0]!.commit.statusCheckRollup!.contexts.nodes,
      contextsComplete: true,
      rulesRequired: null
    });

    const props = getMRDashboardProps(pr);

    expect(props.blockers.needsRebase).toBe(true);
    expect(props.rebaseButton.visible).toBe(true);
    expect(props.readiness?.reasons).toContain('behind');
  });
});
