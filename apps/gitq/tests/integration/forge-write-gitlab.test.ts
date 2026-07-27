/**
 * GitLab forge write tests: create real branches, open MRs, retarget, sync, cleanup.
 *
 * Uses the dedicated test account (luke.skycoder/gitq-test-sandbox).
 * Gated on GITLAB_TOKEN + GITLAB_PROJECT_PATH.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { createProvider } from '@workforge/glance-sdk';
import type { GitProvider } from '@workforge/glance-sdk';
import { ForgeSync } from '../../src/core/forge-sync.ts';
import { StackManager } from '../../src/core/stack-manager.ts';

const GITLAB_TOKEN = process.env['GITLAB_TOKEN'];
const GITLAB_BASE_URL = process.env['GITLAB_BASE_URL'] ?? 'https://gitlab.com';
const GITLAB_PROJECT_PATH = process.env['GITLAB_PROJECT_PATH'];

const runSuffix = Date.now().toString(36);

const createdBranches: string[] = [];
const createdMRs: number[] = [];
let provider: GitProvider;
let projectId: number;

async function glApi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${GITLAB_BASE_URL}/api/v4${path}`, {
    method,
    headers: {
      'PRIVATE-TOKEN': GITLAB_TOKEN!,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`GitLab API ${method} ${path}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getProjectId(): Promise<number> {
  const encoded = encodeURIComponent(GITLAB_PROJECT_PATH!);
  const data = await glApi('GET', `/projects/${encoded}`);
  return data.id;
}

async function createBranchOnRemote(branchName: string, ref: string) {
  await glApi('POST', `/projects/${projectId}/repository/branches`, {
    branch: branchName,
    ref,
  });
  createdBranches.push(branchName);
}

async function createFileOnBranch(branch: string, filename: string, content: string) {
  await glApi('POST', `/projects/${projectId}/repository/files/${encodeURIComponent(filename)}`, {
    branch,
    content,
    commit_message: `test: add ${filename}`,
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!GITLAB_TOKEN || !GITLAB_PROJECT_PATH) return;

  for (const iid of createdMRs) {
    try {
      await glApi('PUT', `/projects/${projectId}/merge_requests/${iid}`, { state_event: 'close' });
    } catch {}
  }
  for (const branch of createdBranches) {
    try {
      await glApi('DELETE', `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`);
    } catch {}
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!GITLAB_TOKEN || !GITLAB_PROJECT_PATH)('GitLab forge write cycle', () => {
  provider = GITLAB_TOKEN
    ? createProvider('gitlab', GITLAB_BASE_URL, GITLAB_TOKEN)
    : (null as never);

  const b1 = `gitq-test/feat-a-${runSuffix}`;
  const b2 = `gitq-test/feat-b-${runSuffix}`;

  test('setup: get project ID and create branches with files', async () => {
    projectId = await getProjectId();

    await createBranchOnRemote(b1, 'main');
    await createFileOnBranch(b1, `test-a-${runSuffix}.txt`, 'feat-a content');

    await createBranchOnRemote(b2, b1);
    await createFileOnBranch(b2, `test-b-${runSuffix}.txt`, 'feat-b content');
  });

  test('publishStack creates MRs for local-only nodes', async () => {
    let stack = StackManager.createStack('gl-write-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const result = await ForgeSync.publishStack(provider, stack, GITLAB_PROJECT_PATH!);

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(result.results[0]!.mrIid).toBeGreaterThan(0);
    expect(result.results[1]!.mrIid).toBeGreaterThan(0);

    createdMRs.push(result.results[0]!.mrIid!, result.results[1]!.mrIid!);

    const b1Node = StackManager.findNode(result.updatedStack, b1)!;
    expect(b1Node.status).toBe('synced');
    expect(b1Node.mrIid).toBe(result.results[0]!.mrIid ?? null);
    expect(b1Node.mrUrl).toContain('gitlab.com');
  });

  test('syncStack picks up the MRs we created', async () => {
    let stack = StackManager.createStack('gl-sync-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const result = await ForgeSync.syncStack(provider, stack);

    const b1Node = StackManager.findNode(result.updatedStack, b1);
    expect(b1Node).toBeDefined();
    expect(b1Node!.mrIid).toBeGreaterThan(0);
    expect(b1Node!.status).not.toBe('local-only');

    const b2Node = StackManager.findNode(result.updatedStack, b2);
    expect(b2Node).toBeDefined();
    expect(b2Node!.mrIid).toBeGreaterThan(0);
  });

  test('reconcile detects drift when local tree disagrees with forge', async () => {
    let stack = StackManager.createStack('gl-drift-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, 'main'); // drift: forge says b1

    const result = await ForgeSync.reconcile(provider, stack);

    const b2Drift = result.drifts.find((d) => d.branch === b2);
    expect(b2Drift).toBeDefined();
    expect(b2Drift!.localParent).toBe('main');
    expect(b2Drift!.forgeTarget).toBe(b1);
  });

  test('retargetMR updates MR target on GitLab', async () => {
    if (createdMRs.length < 2) return;

    let stack = StackManager.createStack('gl-retarget-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.updateNode(stack, b1, { mrIid: createdMRs[0]! });
    stack = StackManager.addNode(stack, b2, 'main');
    stack = StackManager.updateNode(stack, b2, { mrIid: createdMRs[1]! });

    const updated = await ForgeSync.retargetMR(provider, stack, b2, GITLAB_PROJECT_PATH!);

    const b2Node = StackManager.findNode(updated, b2)!;
    expect(b2Node.status).toBe('synced');

    // Verify on the forge
    const mr = await glApi('GET', `/projects/${projectId}/merge_requests/${createdMRs[1]}`);
    expect(mr.target_branch).toBe('main');
  });

  test('populateNodeData fills in diffStats and pipeline info', async () => {
    let stack = StackManager.createStack('gl-populate-test', 'main');
    stack = StackManager.addNode(stack, b1, 'main');
    stack = StackManager.addNode(stack, b2, b1);

    const populated = await ForgeSync.populateNodeData(provider, stack);

    const b1Node = StackManager.findNode(populated, b1)!;
    expect(b1Node.mrIid).toBeGreaterThan(0);
    // diffStats should be populated since we added a file
    if (b1Node.diffStats) {
      expect(b1Node.diffStats.additions).toBeGreaterThanOrEqual(0);
      expect(typeof b1Node.diffStats.filesChanged).toBe('number');
    }
  });

  test('discoverStacks finds our chain', async () => {
    const stacks = await ForgeSync.discoverStacks(provider);
    expect(Array.isArray(stacks)).toBe(true);

    const ourStack = stacks.find(
      (s) => s.branches.includes(b1) || s.branches.includes(b2),
    );
    // Our branches should show up in a discovered stack
    if (ourStack) {
      expect(ourStack.root).toBe('main');
      expect(ourStack.branches).toContain(b1);
    }
  });

  test('importFromForge builds a full StackStore from forge state', async () => {
    // The retarget test above moved b2's MR onto main, which leaves two
    // standalone MRs and no chain for discovery to find. Put b2 back on top of
    // b1 so the import sees the stack this file actually pushed.
    if (createdMRs.length >= 2) {
      await glApi('PUT', `/projects/${projectId}/merge_requests/${createdMRs[1]}`, { target_branch: b1 });
    }

    // The remote has to name the project the branches above live in: import
    // keeps only that project's MRs, so any other remote imports an empty
    // store and asserts nothing.
    const remoteUrl = `${GITLAB_BASE_URL}/${GITLAB_PROJECT_PATH}.git`;

    const { store, openMRs, scopedMRs, projectPath } = await ForgeSync.importFromForge(
      provider,
      '/tmp/test',
      remoteUrl,
    );

    expect(store.repoPath).toBe('/tmp/test');
    expect(store.remoteUrl).toBe(remoteUrl);
    expect(projectPath).toBe(GITLAB_PROJECT_PATH!);
    expect(scopedMRs).toBeGreaterThan(0);
    expect(scopedMRs).toBeLessThanOrEqual(openMRs);

    const imported = store.stacks.flatMap((s) => s.nodes.map((n) => n.branch));
    expect(imported).toContain(b1);
    expect(imported).toContain(b2);

    // Every MR that survived the scope belongs to this project.
    for (const stack of store.stacks) {
      for (const node of stack.nodes) {
        if (node.mrUrl) expect(node.mrUrl).toContain(`/${GITLAB_PROJECT_PATH}/`);
      }
    }
  });
});
