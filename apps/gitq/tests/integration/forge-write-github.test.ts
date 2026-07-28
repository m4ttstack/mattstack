/**
 * GitHub forge write tests: create real branches, open PRs, retarget, sync, cleanup.
 *
 * The GitLab twin of this file (forge-write-gitlab.test.ts) covers the same
 * cycle against GitLab. Both forges reach gitq through the same `GitProvider`
 * interface, but they disagree on nearly every detail underneath it: GitHub
 * numbers PRs per repo rather than per project, expresses draft state through
 * a GraphQL mutation, and reports no diff stats at all from its list endpoint.
 * A green GitLab run says nothing about any of that.
 *
 * Uses a dedicated sandbox repo. Gated on GITHUB_TOKEN + GITHUB_REPO, so a
 * normal `bun run test` skips the whole file rather than reaching the network.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { createProvider } from '@workforge/glance-sdk';
import type { GitProvider } from '@workforge/glance-sdk';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';

const GITHUB_TOKEN = process.env['GITHUB_TOKEN'];
const GITHUB_BASE_URL = process.env['GITHUB_BASE_URL'] ?? 'https://github.com';
const GITHUB_REPO = process.env['GITHUB_REPO'];

/** The REST host behind a user-facing GitHub URL, GHES included. */
const API_BASE =
  GITHUB_BASE_URL === 'https://github.com' ? 'https://api.github.com' : `${GITHUB_BASE_URL}/api/v3`;

const runSuffix = Date.now().toString(36);

const createdBranches: string[] = [];
const createdPRs: number[] = [];
let provider: GitProvider;
let baseSha: string;

async function ghApi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN!}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`GitHub API ${method} ${path}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getBaseSha(): Promise<string> {
  const data = await ghApi('GET', `/repos/${GITHUB_REPO}/git/refs/heads/main`);
  return data.object.sha;
}

async function createBranchOnRemote(branchName: string, sha: string) {
  await ghApi('POST', `/repos/${GITHUB_REPO}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha,
  });
  createdBranches.push(branchName);
}

async function createFileOnBranch(branch: string, filename: string, content: string) {
  // GitHub takes file content base64-encoded, unlike GitLab's plain text.
  await ghApi('PUT', `/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filename)}`, {
    message: `test: add ${filename}`,
    content: Buffer.from(content).toString('base64'),
    branch,
  });
}

/** The head sha of a branch, so a child branch starts from its parent's tip. */
async function branchSha(branch: string): Promise<string> {
  const data = await ghApi('GET', `/repos/${GITHUB_REPO}/git/refs/heads/${branch}`);
  return data.object.sha;
}

/**
 * Block until the involvement-mode listing can see every named branch.
 *
 * GitHub's involvement fetch is search-backed and eventually consistent. A PR
 * this file has just created is routinely absent from it: a measured run had
 * both PRs missing at t+3.7s and both present at t+9.7s, while the REST
 * `/pulls` listing had them at t+0.9s. Every ForgeSync entry point below reads
 * through that search, so without this the suite races the index and fails on
 * whichever PR happened not to land yet.
 *
 * Polls the real condition instead of sleeping a guessed interval, because the
 * lag is not a fixed quantity to hardcode.
 */
async function waitForInvolvementIndex(branches: string[], timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const prs = await provider.fetchPullRequests();
    const seen = new Set(prs.map((p) => p.sourceBranch));
    const missing = branches.filter((b) => !seen.has(b));
    if (missing.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`involvement listing still missing ${missing.join(', ')} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;

  // PRs first: GitHub closes a PR automatically when its head branch goes, but
  // only for a branch it still has, and the order matters for the retargeted one.
  for (const number of createdPRs) {
    try {
      await ghApi('PATCH', `/repos/${GITHUB_REPO}/pulls/${number}`, { state: 'closed' });
    } catch {}
  }
  // Children before parents: deleting a branch another open PR targets is
  // refused, and the loop must not leave the first failure to strand the rest.
  for (const branch of [...createdBranches].reverse()) {
    try {
      await ghApi('DELETE', `/repos/${GITHUB_REPO}/git/refs/heads/${branch}`);
    } catch {}
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!GITHUB_TOKEN || !GITHUB_REPO)('GitHub forge write cycle', () => {
  provider = GITHUB_TOKEN
    ? createProvider('github', GITHUB_BASE_URL, GITHUB_TOKEN)
    : (null as never);

  const b1 = `gitq-test/feat-a-${runSuffix}`;
  const b2 = `gitq-test/feat-b-${runSuffix}`;

  test('setup: create branches with files', async () => {
    baseSha = await getBaseSha();

    await createBranchOnRemote(b1, baseSha);
    await createFileOnBranch(b1, `test-a-${runSuffix}.txt`, 'feat-a content');

    // From b1's tip, not baseSha: a PR needs commits between head and base, and
    // b2 branched off main would carry b1's commit into its own diff.
    await createBranchOnRemote(b2, await branchSha(b1));
    await createFileOnBranch(b2, `test-b-${runSuffix}.txt`, 'feat-b content');
  });

  test('publishStack creates PRs for local-only nodes', async () => {
    let stack = StackManager.createStack('gh-write-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const result = await ForgeSync.publishStack(provider, stack, GITHUB_REPO!);

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(result.results[0]!.mrIid).toBeGreaterThan(0);
    expect(result.results[1]!.mrIid).toBeGreaterThan(0);

    createdPRs.push(result.results[0]!.mrIid!, result.results[1]!.mrIid!);

    const b1Node = StackManager.findNode(result.updatedStack, b1)!;
    expect(b1Node.status).toBe('synced');
    expect(b1Node.mrIid).toBe(result.results[0]!.mrIid ?? null);
    expect(b1Node.mrUrl).toContain('github.com');

    // The stack shape has to reach GitHub, not just the local tree: b2's PR
    // targets b1, which is the whole point of publishing in topological order.
    const b2Pr = await ghApi('GET', `/repos/${GITHUB_REPO}/pulls/${result.results[1]!.mrIid}`);
    expect(b2Pr.base.ref).toBe(b1);
    expect(b2Pr.draft).toBe(true);
  });

  test('syncStack picks up the PRs we created', async () => {
    // The first test that reads through the involvement search, so the first
    // that has to let it catch up. Later tests inherit the settled index.
    await waitForInvolvementIndex([b1, b2]);

    let stack = StackManager.createStack('gh-sync-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const result = await ForgeSync.syncStack(provider, stack, GITHUB_REPO!);

    const b1Node = StackManager.findNode(result.updatedStack, b1);
    expect(b1Node).toBeDefined();
    expect(b1Node!.mrIid).toBeGreaterThan(0);
    expect(b1Node!.status).not.toBe('local-only');

    const b2Node = StackManager.findNode(result.updatedStack, b2);
    expect(b2Node).toBeDefined();
    expect(b2Node!.mrIid).toBeGreaterThan(0);
  });

  test('reconcile detects drift when local tree disagrees with forge', async () => {
    let stack = StackManager.createStack('gh-drift-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, 'main'); // drift: forge says b1

    const result = await ForgeSync.reconcile(provider, stack, GITHUB_REPO!);

    const b2Drift = result.drifts.find((d) => d.branch === b2);
    expect(b2Drift).toBeDefined();
    expect(b2Drift!.localParent).toBe('main');
    expect(b2Drift!.forgeTarget).toBe(b1);
  });

  test('retargetMR updates the PR base on GitHub', async () => {
    if (createdPRs.length < 2) return;

    let stack = StackManager.createStack('gh-retarget-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.updateNode(stack, b1, { mrIid: createdPRs[0]! });
    stack = StackManager.addNode(stack, b2, 'main');
    stack = StackManager.updateNode(stack, b2, { mrIid: createdPRs[1]! });

    const updated = await ForgeSync.retargetMR(provider, stack, b2, GITHUB_REPO!);

    const b2Node = StackManager.findNode(updated, b2)!;
    expect(b2Node.status).toBe('synced');

    // Verify on the forge
    const pr = await ghApi('GET', `/repos/${GITHUB_REPO}/pulls/${createdPRs[1]}`);
    expect(pr.base.ref).toBe('main');
  });

  test('populateNodeData reports an unresolved thread count GitHub can stand behind', async () => {
    let stack = StackManager.createStack('gh-populate-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const populated = await ForgeSync.populateNodeData(provider, stack, GITHUB_REPO!);

    const b1Node = StackManager.findNode(populated, b1)!;
    expect(b1Node.mrIid).toBeGreaterThan(0);

    // The reason `unresolvedThreads` is `number | null` rather than a number:
    // GitHub returns null when its review-thread query fails or the PR carries
    // more threads than one page, and rendering that as zero would claim every
    // thread is resolved. Assert the contract holds against the live forge,
    // since GitHub is the only provider that ever produces the null.
    expect(b1Node.unresolvedThreads === null || typeof b1Node.unresolvedThreads === 'number').toBe(true);

    // GitHub's list endpoint carries no diff stats at all (only the single-PR
    // endpoint does), so a null here is the documented shape, not a failure.
    if (b1Node.diffStats) {
      expect(b1Node.diffStats.additions).toBeGreaterThanOrEqual(0);
      expect(typeof b1Node.diffStats.filesChanged).toBe('number');
    }
  });

  test('discoverStacks finds our chain, which needs GitHub to supply repo and author', async () => {
    // Restore the chain the retarget test flattened, so there is one to find.
    if (createdPRs.length >= 2) {
      await ghApi('PATCH', `/repos/${GITHUB_REPO}/pulls/${createdPRs[1]}`, { base: b1 });
    }

    const stacks = await ForgeSync.discoverStacks(provider);
    expect(Array.isArray(stacks)).toBe(true);

    // Not an `if (found)` guard like the GitLab twin's: discovery buckets by
    // (repositoryId, author.username) since MAT-22, and a PR missing either one
    // is put in a bucket of its own, which can never reach the two-branch
    // minimum. A GitHubProvider that left either field unset would return an
    // empty list here while every other test in this file still passed.
    const ourStack = stacks.find((s) => s.branches.includes(b1) || s.branches.includes(b2));
    expect(ourStack).toBeDefined();
    expect(ourStack!.root).toBe('main');
    expect(ourStack!.branches).toContain(b1);
    expect(ourStack!.branches).toContain(b2);
  });

  test('importFromForge builds a full StackStore from forge state', async () => {
    const remoteUrl = `${GITHUB_BASE_URL}/${GITHUB_REPO}.git`;

    const { store, openMRs, scopedMRs, projectPath } = await ForgeSync.importFromForge(
      provider,
      '/tmp/test',
      remoteUrl,
    );

    expect(store.repoPath).toBe('/tmp/test');
    expect(store.remoteUrl).toBe(remoteUrl);
    expect(projectPath).toBe(GITHUB_REPO!);
    expect(scopedMRs).toBeGreaterThan(0);
    expect(scopedMRs).toBeLessThanOrEqual(openMRs);

    const imported = store.stacks.flatMap((s) => s.nodes.map((n) => n.branch));
    expect(imported).toContain(b1);
    expect(imported).toContain(b2);

    // Every PR that survived the scope belongs to this repo. Compared
    // case-insensitively, as the scope itself is.
    const wanted = `/${GITHUB_REPO!.toLowerCase()}/`;
    for (const stack of store.stacks) {
      for (const node of stack.nodes) {
        if (node.mrUrl) expect(node.mrUrl.toLowerCase()).toContain(wanted);
      }
    }
  });
});
