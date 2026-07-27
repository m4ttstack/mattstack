import type { GitProvider, PullRequest, CreatePullRequestInput } from '@workforge/glance-sdk';
import type { Stack, StackStore, PipelineStatus } from './types.ts';
import { StackManager } from './stack-manager.ts';
import { GitShell } from './git-shell.ts';
import { toErrorMessage } from './error-utils.ts';
import {
  indexBySource,
  discoverStacksFromPRs,
  filterPRsToProject,
  normalizePipelineStatus,
  mapDiffStats,
  projectPathFromRemoteUrl,
  projectPathFromWebUrl,
  type DiscoveredStack,
} from './forge-helpers.ts';

// ── Types ────────────────────────────────────────────────────────────────────

/** A drift record: local tree says parent should be X, but forge MR targets Y. */
export interface DriftRecord {
  branch: string;
  localParent: string;
  forgeTarget: string;
  mrIid: number;
}

/** Result of reconciling local state against forge state. */
export interface ReconcileResult {
  /** Branches where forge target ≠ local parent. */
  drifts: DriftRecord[];
  /** Branches that exist locally but have no MR on forge. */
  localOnly: string[];
  /** MRs on forge that target branches in our stack but aren't tracked locally. */
  unmatchedMRs: PullRequest[];
}

export type { DiscoveredStack };

/** What publish did to an already-published MR. */
export type PublishChange = 'target' | 'metadata';

/** Per-node result when publishing (creating or updating MRs for) a stack. */
export interface PublishNodeResult {
  branch: string;
  success: boolean;
  mrIid?: number;
  mrUrl?: string | undefined;
  error?: string;
  /** Whether the MR was opened by this run or was already there and got updated. */
  action: 'created' | 'updated';
  /** Which parts of an existing MR changed. Only set when `action` is 'updated'. */
  changes?: PublishChange[];
  /** The branch the MR targets after this run: the nearest live ancestor of the node's parent. */
  targetBranch?: string;
}

/** Why publish refused to touch a node's MR. */
export type PublishSkipReason = 'mr-not-open' | 'mr-unreadable' | 'source-branch-mismatch';

/** A node publish deliberately left alone, and what it saw on the forge. */
export interface PublishSkip {
  branch: string;
  /** The iid the node carries locally: the MR publish would have written to it. */
  mrIid: number;
  reason: PublishSkipReason;
  /** One line of what publish saw, for the human output. */
  detail: string;
}

/** Result of a bulk publish operation. */
export interface PublishResult {
  results: PublishNodeResult[];
  /** Published nodes publish would not write to. Never a failure on its own. */
  skipped: PublishSkip[];
  updatedStack: Stack;
}

/** A pipeline status transition detected during sync. */
export interface PipelineChange {
  branch: string;
  from: PipelineStatus;
  to: PipelineStatus;
}

/** A branch whose MR disappeared from the forge during sync. */
export interface DeletedBranch {
  branch: string;
  /** Why the branch vanished. 'merged' = MR found with state merged. */
  reason: 'merged' | 'closed' | 'deleted';
  mrIid: number | null;
  /** Enriched display name resolved from Linear/MR title. Set by the UI layer. */
  displayName?: string;
}

/** Author info for team stack visibility. */
export interface TeamStackAuthor {
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** A team member's stack chains, as discovered from forge MRs. */
export interface TeamStack {
  author: TeamStackAuthor;
  stacks: DiscoveredStack[];
}

/** Result of a background sync refresh (populateNodeData + reconcile in one pass). */
export interface SyncResult {
  updatedStack: Stack;
  reconcile: ReconcileResult;
  /** Branches whose status changed to 'merged' during this sync (were not merged before). */
  newlyMerged: string[];
  /** Pipeline status transitions detected during this sync. */
  pipelineChanges: PipelineChange[];
  /** Branches that were previously synced but no longer have a matching MR on the remote. */
  deletedBranches: DeletedBranch[];
}

// ── ForgeSync ────────────────────────────────────────────────────────────────

/**
 * Syncs local stack state with a GitHub/GitLab forge.
 *
 * Uses `@workforge/glance-sdk` GitProvider to fetch MR data and reconcile
 * with the local StackStore.
 */
export const ForgeSync = {
  /**
   * Discover stack-like MR chains from the forge.
   *
   * Fetches the open MRs of one project, then walks `targetBranch` chains to
   * find trees of related MRs.
   *
   * @param projectPath - Scope discovery to one forge project ("group/project").
   *   Omit it only when the caller has no repo in hand: the fetch returns every
   *   MR the token user is involved in, across every project on the instance,
   *   and an unscoped result can only be trusted as far as
   *   `discoverStacksFromPRs` keeps repos apart.
   */
  async discoverStacks(provider: GitProvider, projectPath?: string | null): Promise<DiscoveredStack[]> {
    const allPRs = await fetchPRsForProject(provider, projectPath);
    const openPRs = allPRs.filter((pr) => pr.state === 'opened');
    return discoverStacksFromPRs(openPRs);
  },

  /**
   * Reconcile local stack state against MRs fetched from the forge.
   *
   * Detects drifts, local-only branches, and unmatched MRs.
   *
   * @param prefetchedPRs - Optional pre-fetched PR list to avoid a redundant API call.
   */
  async reconcile(provider: GitProvider, stack: Stack, prefetchedPRs?: PullRequest[]): Promise<ReconcileResult> {
    const allPRs = prefetchedPRs ?? (await provider.fetchPullRequests());
    const prBySource = indexBySource(allPRs);

    const drifts: DriftRecord[] = [];
    const localOnly: string[] = [];

    const trackedBranches = new Set(stack.nodes.map((n) => n.branch));
    trackedBranches.add(stack.root);

    for (const node of stack.nodes) {
      const pr = prBySource.get(node.branch);

      if (!pr) {
        localOnly.push(node.branch);
        continue;
      }

      if (pr.targetBranch !== node.parent) {
        drifts.push({
          branch: node.branch,
          localParent: node.parent,
          forgeTarget: pr.targetBranch,
          mrIid: pr.iid,
        });
      }
    }

    const unmatchedMRs: PullRequest[] = [];
    for (const pr of allPRs) {
      if (pr.state === 'opened' && trackedBranches.has(pr.targetBranch) && !trackedBranches.has(pr.sourceBranch)) {
        unmatchedMRs.push(pr);
      }
    }

    return { drifts, localOnly, unmatchedMRs };
  },

  /**
   * Populate stack nodes with data from forge MRs.
   *
   * @param prefetchedPRs - Optional pre-fetched PR list to avoid a redundant API call.
   * @param cwd - Optional repo path for resolving local branch HEADs (used to
   *   capture `lastKnownHead` tombstones when a branch is detected as merged).
   */
  async populateNodeData(
    provider: GitProvider,
    stack: Stack,
    prefetchedPRs?: PullRequest[],
    cwd?: string,
  ): Promise<Stack> {
    const allPRs = prefetchedPRs ?? (await provider.fetchPullRequests());
    const prBySource = indexBySource(allPRs);

    let updated = stack;

    for (const node of stack.nodes) {
      const pr = prBySource.get(node.branch);
      if (!pr) continue;

      const status =
        pr.state === 'merged'
          ? ('merged' as const)
          : pr.targetBranch !== node.parent
            ? ('drift' as const)
            : ('synced' as const);

      let lastKnownHead: string | undefined;
      if (status === 'merged' && !node.lastKnownHead) {
        if (cwd) {
          try {
            lastKnownHead = await GitShell.getBranchHead(cwd, node.branch);
          } catch {
            /* branch may be deleted */
          }
        }
        if (!lastKnownHead && pr.sha) lastKnownHead = pr.sha;
      }

      updated = StackManager.updateNode(updated, node.branch, {
        mrIid: pr.iid,
        mrUrl: pr.webUrl,
        mrTitle: pr.title || null,
        diffStats: mapDiffStats(pr.diffStats),
        pipelineStatus: normalizePipelineStatus(pr.pipeline?.status),
        unresolvedThreads: pr.unresolvedThreadCount,
        status,
        ...(lastKnownHead ? { lastKnownHead } : {}),
      });
    }

    return updated;
  },

  /**
   * Import stacks from forge — reverse sync escape hatch.
   *
   * Fetches the open MRs of the project `remoteUrl` points at, discovers stack
   * chains, and builds a StackStore from scratch. Use for recovery, not normal
   * workflow.
   *
   * MRs from other projects are left out: the store is this repo's, so an MR
   * from elsewhere has no branch here to attach to.
   */
  async importFromForge(provider: GitProvider, repoPath: string, remoteUrl: string): Promise<StackStore> {
    const discovered = await ForgeSync.discoverStacks(provider, projectPathFromRemoteUrl(remoteUrl));
    const usedIds = new Set<string>();

    const stacks: Stack[] = discovered.map((ds) => {
      const stackId = deriveStackId(ds, usedIds);
      usedIds.add(stackId);
      let stack = StackManager.createStack(stackId, ds.root);

      for (const branch of ds.branches) {
        const pr = ds.mrMap.get(branch);
        const parent = pr?.targetBranch ?? ds.root;

        stack = StackManager.addNode(stack, branch, parent);
        stack = StackManager.updateNode(stack, branch, {
          mrIid: pr?.iid ?? null,
          mrUrl: pr?.webUrl ?? null,
          mrTitle: pr?.title || null,
          status: pr ? 'synced' : 'local-only',
          diffStats: mapDiffStats(pr?.diffStats ?? null),
          pipelineStatus: normalizePipelineStatus(pr?.pipeline?.status),
          unresolvedThreads: pr?.unresolvedThreadCount ?? 0,
        });
      }

      return stack;
    });

    return { repoPath, remoteUrl, stacks };
  },

  /**
   * Publish a stack: create MRs for its local-only nodes, update the MRs of
   * the nodes that already have one.
   *
   * Walks in topological order (parents first) so each new MR can target its
   * parent branch. A local-only node is pushed (force-with-lease) and gets a
   * draft MR. A node that already has an open MR is never pushed; its MR is
   * retargeted when the local tree moved it under a different parent, and its
   * title/description are rewritten only when `descriptions` names that branch
   * (so a republish never clobbers MR prose the caller did not supply). Nodes
   * whose MR needs neither are left alone and stay out of the results.
   *
   * Targets resolve through {@link resolveLiveTarget}, so a node under a merged
   * parent points at the nearest live ancestor rather than a branch the forge
   * may have deleted out from under it.
   *
   * A failed create stops the walk: the branch was never pushed, so the
   * children that would target it have no base to sit on. A failed update does
   * not, since it leaves the branch and its MR exactly as they were.
   */
  async publishStack(
    provider: GitProvider,
    stack: Stack,
    projectPath: string,
    cwd?: string,
    descriptions?: Record<string, { title?: string; body?: string }>,
  ): Promise<PublishResult> {
    const sorted = StackManager.toposort(stack);

    // Telling a retarget from a no-op needs the MR's current target, which only
    // the forge knows. Batch-fetch by iid, and only when something is published
    // — a first publish of an all-local stack still makes no read call.
    const publishedIids = sorted.filter((n) => n.status !== 'merged' && n.mrIid !== null).map((n) => n.mrIid as number);
    const prByIid = new Map<number, PullRequest>();
    if (publishedIids.length > 0) {
      const prs = await provider.fetchPullRequests({ iids: publishedIids, projectPath });
      for (const pr of prs) prByIid.set(pr.iid, pr);
    }

    const results: PublishNodeResult[] = [];
    const skipped: PublishSkip[] = [];
    let updatedStack = stack;

    for (const node of sorted) {
      const desc = descriptions?.[node.branch];
      const meta = metaUpdate(desc);
      const targetBranch = resolveLiveTarget(updatedStack, node.parent);

      if (node.mrIid === null) {
        if (node.status !== 'local-only') continue;

        try {
          if (cwd) {
            await GitShell.pushForceWithLease(cwd, node.branch);
          }

          const input: CreatePullRequestInput = {
            projectPath,
            title: desc?.title ?? node.branch,
            sourceBranch: node.branch,
            targetBranch,
            draft: true,
          };
          if (desc?.body) {
            input.description = desc.body;
          }

          const pr = await provider.createPullRequest(input);

          const head = cwd ? await GitShell.getBranchHead(cwd, node.branch).catch(() => null) : null;
          updatedStack = StackManager.updateNode(updatedStack, node.branch, {
            mrIid: pr.iid,
            mrUrl: pr.webUrl,
            status: 'synced',
            ...(head ? { lastKnownHead: head } : {}),
          });

          results.push({
            branch: node.branch,
            success: true,
            action: 'created',
            mrIid: pr.iid,
            mrUrl: pr.webUrl ?? undefined,
            targetBranch,
          });
        } catch (err) {
          results.push({
            branch: node.branch,
            success: false,
            action: 'created',
            error: toErrorMessage(err),
            targetBranch,
          });
          break;
        }
        continue;
      }

      // A merged node is the steady state gitq keeps in the tree, not a
      // surprise: its iid is deliberately left out of the pre-walk read above,
      // so reporting it as unreadable below would be a lie.
      if (node.status === 'merged') continue;

      // Already published. Anything the forge doesn't show as an open MR of
      // this branch is skipped rather than written to, and says so: a merged or
      // closed MR is not ours to retarget, an MR we couldn't read is one whose
      // target we can't compare against, and an iid belonging to some other
      // branch is a stale pointer that would retarget an unrelated MR.
      const pr = prByIid.get(node.mrIid);
      if (!pr) {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: 'mr-unreadable',
          detail: `MR !${node.mrIid} was not returned by GitLab`,
        });
        continue;
      }
      if (pr.state !== 'opened') {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: 'mr-not-open',
          detail: `MR !${node.mrIid} is ${pr.state}`,
        });
        continue;
      }
      if (pr.sourceBranch !== node.branch) {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: 'source-branch-mismatch',
          detail: `MR !${node.mrIid} is for ${pr.sourceBranch}, not ${node.branch}`,
        });
        continue;
      }

      const needsRetarget = pr.targetBranch !== targetBranch;
      if (!needsRetarget && !meta) continue;

      try {
        if (needsRetarget) {
          updatedStack = await ForgeSync.retargetMR(provider, updatedStack, node.branch, projectPath);
        }
        if (meta) {
          await provider.updatePullRequest(projectPath, node.mrIid, meta);
        }

        const changes: PublishChange[] = [];
        if (needsRetarget) changes.push('target');
        if (meta) changes.push('metadata');

        results.push({
          branch: node.branch,
          success: true,
          action: 'updated',
          changes,
          mrIid: node.mrIid,
          mrUrl: node.mrUrl ?? pr.webUrl ?? undefined,
          targetBranch,
        });
      } catch (err) {
        results.push({
          branch: node.branch,
          success: false,
          action: 'updated',
          error: toErrorMessage(err),
          targetBranch,
        });
      }
    }

    return { results, skipped, updatedStack };
  },

  /**
   * Retarget an MR on the forge so its target branch matches the local tree parent.
   *
   * `publishStack` calls this for every already-published node whose MR drifted
   * off its parent; it is also usable on its own for a single branch.
   *
   * Targets the nearest live ancestor ({@link resolveLiveTarget}), not the raw
   * parent: pointing an open MR at a merged branch either 400s (the forge
   * deleted it on merge) or undoes the forge's own retarget.
   */
  async retargetMR(provider: GitProvider, stack: Stack, branch: string, projectPath: string): Promise<Stack> {
    const node = StackManager.findNode(stack, branch);
    if (!node) throw new Error(`Branch "${branch}" not found in stack`);
    if (!node.mrIid) throw new Error(`Branch "${branch}" has no MR to retarget`);

    await provider.updatePullRequest(projectPath, node.mrIid, {
      targetBranch: resolveLiveTarget(stack, node.parent),
    });

    return StackManager.updateNode(stack, branch, { status: 'synced' });
  },

  /**
   * Discover stack chains from forge MRs grouped by author.
   *
   * @param projectPath - Scope discovery to one forge project ("group/project"),
   *   as in {@link ForgeSync.discoverStacks}. Without it a teammate's MRs in
   *   another project are listed under their name as if they were this repo's.
   */
  async discoverTeamStacks(provider: GitProvider, projectPath?: string | null): Promise<TeamStack[]> {
    const allPRs = await fetchPRsForProject(provider, projectPath);
    const openPRs = allPRs.filter((pr) => pr.state === 'opened');

    const byAuthor = new Map<string, { author: TeamStackAuthor; prs: PullRequest[] }>();

    for (const pr of openPRs) {
      if (!pr.author) continue;
      const key = pr.author.username;
      if (!byAuthor.has(key)) {
        byAuthor.set(key, {
          author: { username: pr.author.username, name: pr.author.name, avatarUrl: pr.author.avatarUrl },
          prs: [],
        });
      }
      byAuthor.get(key)?.prs.push(pr);
    }

    const teamStacks: TeamStack[] = [];

    for (const { author, prs } of byAuthor.values()) {
      const stacks = discoverStacksFromPRs(prs);
      if (stacks.length > 0) {
        teamStacks.push({ author, stacks });
      }
    }

    return teamStacks;
  },

  /**
   * Full background sync: populate node data + reconcile in a single pass.
   *
   * Fetches PRs once and shares the list across both operations. Also detects
   * branches that transitioned to 'merged' since the last sync.
   */
  async syncStack(provider: GitProvider, stack: Stack): Promise<SyncResult> {
    const allPRs = await provider.fetchPullRequests({ state: ['opened', 'merged'] });

    const oldStatuses = new Map(stack.nodes.map((n) => [n.branch, n.status]));
    const oldPipelines = new Map(stack.nodes.map((n) => [n.branch, n.pipelineStatus]));

    const updatedStack = await ForgeSync.populateNodeData(provider, stack, allPRs);
    const reconcile = await ForgeSync.reconcile(provider, updatedStack, allPRs);

    const prBySource = indexBySource(allPRs);

    return {
      updatedStack,
      reconcile,
      ...(await detectSyncChanges(provider, updatedStack, oldStatuses, oldPipelines, prBySource)),
    };
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up from `parent` past any merged node to the branch an MR can actually
 * target. Returns the root once every ancestor is merged.
 *
 * gitq leaves merged nodes in the tree with their children still pointing at
 * them (see the `drift-parent-merged` situation in `stack-diagnostics.ts`), and
 * a forge typically deletes the source branch on merge and retargets the child
 * MR itself. Mirrors `resolveLiveAncestor` in `rebase-engine.ts`, which is what
 * keeps the rebase side of the same tree honest.
 */
function resolveLiveTarget(stack: Stack, parent: string): string {
  let current = parent;
  while (current !== stack.root) {
    const node = stack.nodes.find((n) => n.branch === current);
    if (!node || node.status !== 'merged') break;
    current = node.parent;
  }
  return current;
}

/**
 * The title/description patch a `--mr-meta` entry asks for, or null when it
 * asks for nothing. An absent field leaves what is on the forge alone.
 */
function metaUpdate(desc?: { title?: string; body?: string }): { title?: string; description?: string } | null {
  if (!desc) return null;
  const update: { title?: string; description?: string } = {};
  if (desc.title !== undefined) update.title = desc.title;
  if (desc.body !== undefined) update.description = desc.body;
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Fetch the MRs of one forge project, or every MR the token user is involved
 * in when no project is given.
 *
 * The scoping is done on the result rather than in the query because
 * `@workforge/glance-sdk@0.9.0` cannot express "this project's MRs":
 * `fetchPullRequests` honours `projectPath` only alongside `iids` or
 * `authorUsernames`, neither of which discovery knows before it has fetched,
 * and `GitHubProvider.fetchPullRequests` takes no options at all at this
 * version. A later SDK can push this into the query (see MAT-16).
 */
async function fetchPRsForProject(provider: GitProvider, projectPath?: string | null): Promise<PullRequest[]> {
  const prs = await provider.fetchPullRequests();
  return projectPath ? filterPRsToProject(prs, projectPath) : prs;
}

async function detectSyncChanges(
  provider: GitProvider,
  updatedStack: Stack,
  oldStatuses: Map<string, string>,
  oldPipelines: Map<string, PipelineStatus>,
  prBySource: Map<string, PullRequest>,
): Promise<{ newlyMerged: string[]; pipelineChanges: PipelineChange[]; deletedBranches: DeletedBranch[] }> {
  const newlyMerged: string[] = [];
  const pipelineChanges: PipelineChange[] = [];
  const vanished: { branch: string; mrIid: number | null; mrUrl: string | null }[] = [];

  for (const node of updatedStack.nodes) {
    if (node.status === 'merged' && oldStatuses.get(node.branch) !== 'merged') {
      newlyMerged.push(node.branch);
    }

    const oldPipeline = oldPipelines.get(node.branch);
    if (oldPipeline && oldPipeline !== node.pipelineStatus && node.pipelineStatus !== 'unknown') {
      pipelineChanges.push({ branch: node.branch, from: oldPipeline, to: node.pipelineStatus });
    }

    if (oldStatuses.get(node.branch) === 'synced' && !prBySource.has(node.branch)) {
      vanished.push({ branch: node.branch, mrIid: node.mrIid, mrUrl: node.mrUrl });
    }
  }

  // Look up each vanished branch's MR to determine the reason
  const deletedBranches: DeletedBranch[] = await Promise.all(
    vanished.map(async ({ branch, mrIid, mrUrl }): Promise<DeletedBranch> => {
      if (mrIid != null && mrUrl) {
        const projectPath = projectPathFromWebUrl(mrUrl);
        if (projectPath) {
          try {
            const mr = await provider.fetchSingleMR(projectPath, mrIid, null);
            if (mr?.state === 'merged') return { branch, reason: 'merged', mrIid };
            if (mr?.state === 'closed') return { branch, reason: 'closed', mrIid };
          } catch {
            // Network error — fall through to default
          }
        }
      }
      return { branch, reason: 'deleted', mrIid };
    }),
  );

  return { newlyMerged, pipelineChanges, deletedBranches };
}

/**
 * Derive a meaningful stack ID from a discovered MR chain.
 *
 * Strategy: find the leaf branch (not a target of any other branch),
 * and use its MR title or branch name. Deduplicates against `usedIds`.
 */
function deriveStackId(ds: DiscoveredStack, usedIds: Set<string>): string {
  const targets = new Set<string>();
  for (const branch of ds.branches) {
    const pr = ds.mrMap.get(branch);
    if (pr?.targetBranch) targets.add(pr.targetBranch);
  }
  const leaves = ds.branches.filter((b) => !targets.has(b));
  const tip = leaves[0] ?? ds.branches[ds.branches.length - 1] ?? ds.root;

  const pr = ds.mrMap.get(tip);
  let base = pr?.title ?? tip;

  base = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  if (!base) base = 'stack';

  let id = base;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${base}-${counter++}`;
  }
  return id;
}
