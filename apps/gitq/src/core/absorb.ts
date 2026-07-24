import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Stack } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { RebaseEngine } from './rebase-engine.ts';
import type { CascadeResult, RebaseResult } from './rebase-engine.ts';
import { toErrorMessage } from './error-utils.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AbsorbAttribution {
  branch: string;
  files: string[];
  success: boolean;
  error?: string;
}

export interface AbsorbResult {
  absorbed: boolean;
  reason?: 'no-changes';
  attributions: AbsorbAttribution[];
  cascadeResult?: CascadeResult;
  updatedStack?: Stack;
}

export interface AbsorbPreview {
  /** Files confidently attributed — the branch's commits touched this file. */
  attributed: Record<string, string[]>;
  /** Files with no branch history match — defaults to currentBranch. */
  unattributed: string[];
  /** The branch unattributed files will go to by default. */
  currentBranch: string;
}

// ── File Attribution ─────────────────────────────────────────────────────────

/**
 * Build a map of branch → set of files that branch's commits touched.
 */
async function buildBranchFileCache(
  cwd: string,
  stack: Stack,
): Promise<{ nodesReversed: ReturnType<typeof StackManager.toposort>; cache: Map<string, Set<string>> }> {
  const nodesReversed = [...StackManager.toposort(stack)].reverse();
  const cache = new Map<string, Set<string>>();
  for (const node of nodesReversed) {
    try {
      const files = await GitShell.getFilesChangedInRange(cwd, node.parent, node.branch);
      cache.set(node.branch, new Set(files));
    } catch {
      cache.set(node.branch, new Set());
    }
  }
  return { nodesReversed, cache };
}

/**
 * For each changed file, walk the stack from leaves to root (reverse topo)
 * and find the deepest branch whose commits touched that file.
 *
 * Files not touched by any stack branch are attributed to `currentBranch`.
 */
async function attributeFiles(
  cwd: string,
  stack: Stack,
  changedFiles: string[],
  currentBranch: string,
): Promise<Map<string, string[]>> {
  const { nodesReversed, cache } = await buildBranchFileCache(cwd, stack);

  const result = new Map<string, string[]>();
  for (const file of changedFiles) {
    let target: string | null = null;
    for (const node of nodesReversed) {
      const branchFiles = cache.get(node.branch);
      if (branchFiles?.has(file)) {
        target = node.branch;
        break;
      }
    }

    if (!target) target = currentBranch;

    const existing = result.get(target) ?? [];
    existing.push(file);
    result.set(target, existing);
  }

  return result;
}

/**
 * Preview absorb: classify files into attributed (branch history match)
 * and unattributed (no branch touched them — fallback to current branch).
 */
async function previewAbsorb(cwd: string, stack: Stack): Promise<AbsorbPreview> {
  const currentBranch = await GitShell.getCurrentBranch(cwd);
  const changedResult = await GitShell.getChangedFiles(cwd);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked]),
  ];

  if (allChanged.length === 0) {
    return { attributed: {}, unattributed: [], currentBranch };
  }

  const { nodesReversed, cache } = await buildBranchFileCache(cwd, stack);

  const attributed: Record<string, string[]> = {};
  const unattributed: string[] = [];

  for (const file of allChanged) {
    let target: string | null = null;
    for (const node of nodesReversed) {
      const branchFiles = cache.get(node.branch);
      if (branchFiles?.has(file)) {
        target = node.branch;
        break;
      }
    }

    if (target) {
      (attributed[target] ??= []).push(file);
    } else {
      unattributed.push(file);
    }
  }

  return { attributed, unattributed, currentBranch };
}

// ── Absorb Orchestration ─────────────────────────────────────────────────────

/**
 * Smart Absorb: distribute uncommitted changes to the correct branches
 * in the stack based on file attribution, then restack via cascade rebase.
 *
 * After amending branches, uses a tombstone-style cascade: each child is
 * rebased using `--onto <new-parent-head> <old-parent-head> <child>` so
 * only the child's own commits are replayed.
 */
async function absorb(cwd: string, stack: Stack, excludedFiles?: string[]): Promise<AbsorbResult> {
  const currentBranch = await GitShell.getCurrentBranch(cwd);

  const changedResult = await GitShell.getChangedFiles(cwd);
  const excludeSet = new Set(excludedFiles ?? []);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked]),
  ].filter((f) => !excludeSet.has(f));

  if (allChanged.length === 0) {
    return { absorbed: false, reason: 'no-changes', attributions: [] };
  }

  const fileMap = await attributeFiles(cwd, stack, allChanged, currentBranch);

  // Save file contents to memory before stashing — avoids stash^3 issues
  // with untracked files and is more robust than git checkout stash.
  const fileContents = new Map<string, Buffer>();
  for (const file of allChanged) {
    try {
      const content = await readFile(join(cwd, file));
      fileContents.set(file, content);
    } catch { /* best-effort read */ }
  }

  // Snapshot all branch HEADs BEFORE amending — needed for tombstone cascade.
  const preAmendHeads = new Map<string, string>();
  for (const node of StackManager.toposort(stack)) {
    try {
      const head = await GitShell.getBranchHead(cwd, node.branch);
      preAmendHeads.set(node.branch, head);
    } catch { /* best-effort */ }
  }
  try {
    preAmendHeads.set(stack.root, await GitShell.getBranchHead(cwd, stack.root));
  } catch { /* best-effort */ }

  await GitShell.stash(cwd);

  const attributions: AbsorbAttribution[] = [];
  const nodesInTopoOrder = StackManager.toposort(stack);
  const orderedBranches = nodesInTopoOrder.map((n) => n.branch);
  if (!orderedBranches.includes(currentBranch)) {
    orderedBranches.push(currentBranch);
  }

  let updatedStack = stack;
  let abortNeeded = false;

  for (const branch of orderedBranches) {
    const files = fileMap.get(branch);
    if (!files || files.length === 0) continue;

    try {
      await GitShell.checkoutBranch(cwd, branch);

      for (const file of files) {
        const content = fileContents.get(file);
        if (content) {
          const filePath = join(cwd, file);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, content);
        }
      }

      await GitShell.add(cwd, files);
      await GitShell.amendNoEdit(cwd);

      const newHead = await GitShell.getBranchHead(cwd, branch);
      const node = StackManager.findNode(updatedStack, branch);
      if (node) {
        updatedStack = StackManager.updateNode(updatedStack, branch, {
          lastKnownHead: newHead,
        });
      }

      attributions.push({ branch, files, success: true });
    } catch (err) {
      attributions.push({ branch, files, success: false, error: toErrorMessage(err) });
      abortNeeded = true;
      break;
    }
  }

  if (abortNeeded) {
    try {
      await GitShell.checkoutBranch(cwd, currentBranch);
    } catch { /* cleanup */ }
    try {
      await GitShell.stashPop(cwd);
    } catch { /* cleanup */ }
    return { absorbed: false, attributions };
  }

  await GitShell.checkoutBranch(cwd, currentBranch);

  try {
    await GitShell.stashDrop(cwd);
  } catch { /* already popped or empty */ }

  const affectedBranches = new Set(attributions.filter((a) => a.success).map((a) => a.branch));
  let cascadeResult: CascadeResult | undefined;

  if (affectedBranches.size > 0) {
    cascadeResult = await cascadeAfterAbsorb(cwd, updatedStack, preAmendHeads, affectedBranches);
    if (cascadeResult) {
      updatedStack = cascadeResult.updatedStack;
    }
  }

  const result: AbsorbResult = { absorbed: true, attributions, updatedStack };
  if (cascadeResult) result.cascadeResult = cascadeResult;
  return result;
}

/**
 * Tombstone-style cascade after absorb: for each node whose parent was
 * amended, rebase using `--onto <parent-new-head> <parent-old-head> <branch>`.
 * This correctly replays only the node's own commits.
 */
async function cascadeAfterAbsorb(
  cwd: string,
  stack: Stack,
  preAmendHeads: Map<string, string>,
  amendedBranches: Set<string>,
): Promise<CascadeResult> {
  const allNodes = StackManager.toposort(stack);
  let updatedStack = stack;
  const results: RebaseResult[] = [];

  for (const node of allNodes) {
    if (node.unmanaged) continue;

    const parentAmended = amendedBranches.has(node.parent);
    const selfAmended = amendedBranches.has(node.branch);

    if (!parentAmended && !selfAmended) continue;

    const oldParentHead = preAmendHeads.get(node.parent);
    if (!oldParentHead) continue;

    let newParentHead: string;
    try {
      newParentHead = await GitShell.getBranchHead(cwd, node.parent);
    } catch {
      continue;
    }

    if (oldParentHead === newParentHead) continue;

    const result = await RebaseEngine.rebaseSingle(cwd, newParentHead, oldParentHead, node.branch);
    results.push(result);

    if (!result.success) break;

    try {
      const newHead = await GitShell.getBranchHead(cwd, node.branch);
      updatedStack = StackManager.updateNode(updatedStack, node.branch, {
        lastKnownHead: newHead,
      });
    } catch { /* best-effort */ }

    amendedBranches.add(node.branch);
  }

  return { results, updatedStack, state: 'completed' };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export const AbsorbEngine = {
  attributeFiles,
  previewAbsorb,
  absorb,
};
