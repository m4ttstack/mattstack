import { describe, expect, test } from 'bun:test';
import { createProvider } from '@workforge/glance-sdk';
import type { GitProvider, PullRequest } from '@workforge/glance-sdk';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';

const GITLAB_TOKEN = process.env['GITLAB_TOKEN'];
const GITLAB_BASE_URL = process.env['GITLAB_BASE_URL'] ?? 'https://gitlab.com';

let provider: GitProvider;

describe.skipIf(!GITLAB_TOKEN)('GitLab forge integration', () => {
  provider = GITLAB_TOKEN ? createProvider('gitlab', GITLAB_BASE_URL, GITLAB_TOKEN) : (null as never);

  test('validateToken returns the authenticated user', async () => {
    const user = await provider.validateToken();
    expect(user).toBeDefined();
    expect(typeof user.username).toBe('string');
    expect(user.username.length).toBeGreaterThan(0);
    expect(typeof user.name).toBe('string');
    expect(user.id).toMatch(/^gitlab:/);
  });

  test('fetchPullRequests returns an array of PullRequest objects', async () => {
    const prs = await provider.fetchPullRequests();
    expect(Array.isArray(prs)).toBe(true);

    if (prs.length > 0) {
      assertPullRequestShape(prs[0]!);
    }
  });

  test('discoverStacks returns well-formed DiscoveredStack objects', async () => {
    const stacks = await ForgeSync.discoverStacks(provider);
    expect(Array.isArray(stacks)).toBe(true);

    for (const stack of stacks) {
      expect(typeof stack.root).toBe('string');
      expect(Array.isArray(stack.branches)).toBe(true);
      expect(stack.branches.length).toBeGreaterThan(0);
      expect(stack.mrMap).toBeInstanceOf(Map);

      for (const [branch, pr] of stack.mrMap) {
        expect(typeof branch).toBe('string');
        assertPullRequestShape(pr);
      }
    }
  });

  test('discoverTeamStacks groups MRs by author', async () => {
    const teamStacks = await ForgeSync.discoverTeamStacks(provider);
    expect(Array.isArray(teamStacks)).toBe(true);

    for (const ts of teamStacks) {
      expect(typeof ts.author.username).toBe('string');
      expect(typeof ts.author.name).toBe('string');
      expect(Array.isArray(ts.stacks)).toBe(true);
      expect(ts.stacks.length).toBeGreaterThan(0);
    }
  });

  test('syncStack populates node data and reconciles against a synthetic stack', async () => {
    const prs = await provider.fetchPullRequests();
    const openPRs = prs.filter((pr) => pr.state === 'opened');
    if (openPRs.length === 0) return; // nothing to sync against

    const pr = openPRs[0]!;
    let stack = StackManager.createStack('integration-test', pr.targetBranch);
    stack = StackManager.addNode(stack, pr.sourceBranch, pr.targetBranch);

    const result = await ForgeSync.syncStack(provider, stack);

    expect(result.updatedStack).toBeDefined();
    expect(result.reconcile).toBeDefined();
    expect(Array.isArray(result.newlyMerged)).toBe(true);
    expect(Array.isArray(result.pipelineChanges)).toBe(true);

    const node = StackManager.findNode(result.updatedStack, pr.sourceBranch);
    expect(node).toBeDefined();
    expect(node!.mrIid).toBe(pr.iid);
    expect(node!.status).not.toBe('local-only');
  });

  test('fetchPullRequestByBranch returns a PR for a known source branch', async () => {
    const prs = await provider.fetchPullRequests();
    const openPR = prs.find((pr) => pr.state === 'opened');
    if (!openPR) return;

    const projectPath = process.env['GITLAB_PROJECT_PATH'];
    if (!projectPath) return;

    const found = await provider.fetchPullRequestByBranch(projectPath, openPR.sourceBranch);
    if (found) {
      assertPullRequestShape(found);
      expect(found.sourceBranch).toBe(openPR.sourceBranch);
    }
  });
});

function assertPullRequestShape(pr: PullRequest): void {
  expect(typeof pr.id).toBe('string');
  expect(typeof pr.iid).toBe('number');
  expect(typeof pr.title).toBe('string');
  expect(typeof pr.state).toBe('string');
  expect(['opened', 'merged', 'closed']).toContain(pr.state);
  expect(typeof pr.sourceBranch).toBe('string');
  expect(typeof pr.targetBranch).toBe('string');
  expect(typeof pr.draft).toBe('boolean');
  expect(pr.author).toBeDefined();
  expect(typeof pr.author.username).toBe('string');
  expect(typeof pr.unresolvedThreadCount).toBe('number');
}
