import { loadStore, resolveRepoIdentity } from '../core/persistence.ts';
import { collectSnapshot, diagnoseStack } from '../core/stack-diagnostics.ts';
import type { BannerDirective, NodeDirective } from '../core/stack-diagnostics.ts';
import { RebaseEngine } from '../core/rebase-engine.ts';
import type { ConflictPrediction } from '../core/rebase-engine.ts';
import { OperationLog, entryBelongsToRepo } from '../core/operation-log.ts';
import type { OperationEntry } from '../core/operation-log.ts';
import { GitShell } from '../core/git-shell.ts';
import { createForgeProvider } from '../cli/provider.ts';
import type { ForgeProviderContext, ForgeProviderOptions } from '../cli/provider.ts';
import { readForgeOverrides, resolveForge, type ForgeSlug } from '../core/forges.ts';
import { hostFromRemoteUrl } from '../core/forge-helpers.ts';
import { getWorktreeMap } from '../core/worktrees.ts';
import { listLeases } from '../core/leases.ts';
import type { Stack, StackStore } from '../core/types.ts';
import type { PullRequest } from '@workforge/glance-sdk';
import type { JobAction } from './job-state.ts';
import type { RepoEntry } from './config.ts';

export interface BoardMr {
  iid: number;
  url: string | null;
  title: string;
  state: string;
  pipelineStatus: string;
}

export interface BoardNode {
  branch: string;
  parent: string;
  situation: string;
  statusLine: string;
  badge: { label: string; variant: string } | null;
  mr: BoardMr | null;
  checkedOutIn: string | null;
  checkedOutDirty: boolean;
}

export interface BoardWorktree {
  name: string;
  path: string;
  branch: string | null;
  dirty: boolean;
  isWorkSlot: boolean;
  lease: { stackName: string; action: string; state: 'running' | 'parked' } | null;
}

export interface BoardStack {
  stackName: string;
  root: string;
  nodes: BoardNode[];
  banner: BannerDirective | null;
  globalBlocks: string[];
  predictedConflicts: ConflictPrediction[];
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  operation: string;
  stackName: string;
  branches: string[];
}

export interface BoardRepo {
  path: string;
  name: string;
  /**
   * Which forge this repo's remote names, so the UI can use its own notation
   * (`!42` on GitLab, `#42` on GitHub) rather than picking one for it.
   *
   * Null covers both "the remote names no forge gitq can identify" and "nothing
   * looked", the latter because a repo with no tracked stacks never reads its
   * remote. Neither case has an MR to render, so the UI treats them the same.
   */
  forge: ForgeSlug | null;
  stacks: BoardStack[];
  activity: ActivityEntry[];
  worktrees: BoardWorktree[];
  error: string | null;
}

/** Pure shaping of one stack for the wire: diagnostics directives flattened
    onto nodes, live MR data when we have it, the node's stored forge fields
    as the offline fallback. */
export function shapeStack(
  stack: Stack,
  directives: Map<string, NodeDirective>,
  banner: BannerDirective | null,
  globalBlocks: string[],
  predictedConflicts: ConflictPrediction[],
  mrByBranch: Map<string, BoardMr>,
  slotByBranch: Map<string, { name: string; dirty: boolean }> = new Map(),
): BoardStack {
  const nodes: BoardNode[] = stack.nodes.map((n) => {
    const d = directives.get(n.branch);
    const fallback: BoardMr | null = n.mrUrl
      ? { iid: n.mrIid ?? 0, url: n.mrUrl, title: n.mrTitle ?? '', state: 'unknown', pipelineStatus: n.pipelineStatus }
      : null;
    const slot = slotByBranch.get(n.branch) ?? null;
    return {
      branch: n.branch,
      parent: n.parent,
      situation: d?.situation ?? 'synced',
      statusLine: d?.statusLine ?? '',
      badge: d?.badge ?? null,
      mr: mrByBranch.get(n.branch) ?? fallback,
      checkedOutIn: slot?.name ?? null,
      checkedOutDirty: slot?.dirty ?? false,
    };
  });
  return { stackName: stack.stackName, root: stack.root, nodes, banner, globalBlocks, predictedConflicts };
}

/** The repo's slice of the global operation log, newest first. Legacy entries
    without a repoPath belong to every repo (entryBelongsToRepo). */
export function shapeActivity(entries: OperationEntry[], repoPath: string, limit = 20): ActivityEntry[] {
  return entries
    .filter((e) => entryBelongsToRepo(e, repoPath))
    .map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      operation: e.operation,
      stackName: e.stackSnapshot.stackName,
      branches: Object.keys(e.branchSnapshots),
    }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

const ACTIONS: ReadonlySet<string> = new Set(['sync', 'publish', 'absorb', 'restructure']);

/** Validate a POST /action body against the configured repos. Null on any
    shape mismatch; the route turns null into a 400. */
export function parseActionBody(
  body: unknown,
  repos: RepoEntry[],
): { repoPath: string; stack: string; action: JobAction; sourceSlot?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { repoPath, stack, action, sourceSlot } = body as {
    repoPath?: unknown;
    stack?: unknown;
    action?: unknown;
    sourceSlot?: unknown;
  };
  if (typeof repoPath !== 'string' || typeof stack !== 'string' || typeof action !== 'string') return null;
  if (stack === '' || !ACTIONS.has(action)) return null;
  if (!repos.some((r) => r.path === repoPath)) return null;
  if (sourceSlot !== undefined) {
    // absorb sources from a picked worktree; no other action takes one
    if (typeof sourceSlot !== 'string' || sourceSlot === '' || action !== 'absorb') return null;
    return { repoPath, stack, action: action as JobAction, sourceSlot };
  }
  return { repoPath, stack, action: action as JobAction };
}

function toBoardMr(pr: PullRequest): BoardMr {
  return {
    iid: pr.iid,
    url: pr.webUrl,
    title: pr.title,
    state: pr.state,
    pipelineStatus: pr.pipeline?.status ?? 'unknown',
  };
}

/**
 * The MRs of `branches`, batched when the provider can and one at a time when
 * it cannot.
 *
 * The batch path is feature detection on an optional interface member, not a
 * check on the provider slug: `GitHubProvider` does not implement
 * `fetchPullRequestsByBranches`, and must fall back rather than fail.
 */
export async function fetchMrsByBranch(ctx: ForgeProviderContext, branches: string[]): Promise<Map<string, BoardMr>> {
  const out = new Map<string, BoardMr>();
  if (branches.length === 0) return out;
  if (ctx.provider.fetchPullRequestsByBranches) {
    const map = await ctx.provider.fetchPullRequestsByBranches(ctx.projectPath, branches, 'all');
    for (const [branch, pr] of map) if (pr) out.set(branch, toBoardMr(pr));
    return out;
  }
  for (const branch of branches) {
    const pr = await ctx.provider.fetchPullRequestByBranch(ctx.projectPath, branch, 'all');
    if (pr) out.set(branch, toBoardMr(pr));
  }
  return out;
}

/** What one repo's remote says about its forge: which one, and whether we can talk to it. */
export interface RepoForge {
  /**
   * Built only when this forge's token is configured, so null is the degraded
   * case rather than an error: the board shows many repos and they need not
   * share a forge, so a remote naming none gitq knows, or a forge whose token
   * is missing, costs this repo its MR enrichment and nothing else. Withholding
   * every other repo's MRs over it is what this replaced.
   */
  provider: ForgeProviderContext | null;
  /**
   * The forge the remote names, whether or not a token exists for it.
   *
   * Presentation needs this on its own: `!42` is GitLab's reference notation and
   * `#42` is GitHub's, and a repo shows the right one even when its MRs could
   * not be fetched. Null means the remote named no forge gitq can identify, in
   * which case the UI says neither.
   */
  slug: ForgeSlug | null;
}

/**
 * Resolve one repo's forge from its own remote: which forge, and a provider when
 * its credential is configured.
 *
 * One remote read and one settings read serve both answers, which is why they
 * come back together rather than from two entry points.
 */
export async function resolveRepoForge(
  repoPath: string,
  store: StackStore,
  opts: ForgeProviderOptions = {},
): Promise<RepoForge> {
  // Nothing to enrich, so the remote is never read: the common case for a repo
  // on the board that is not currently stacked.
  if (store.stacks.length === 0) return { provider: null, slug: null };

  let remoteUrl: string;
  try {
    remoteUrl = store.remoteUrl || (await GitShell.getRemoteUrl(repoPath));
  } catch {
    return { provider: null, slug: null };
  }

  const overrides = opts.overrides ?? (await readForgeOverrides());
  const host = hostFromRemoteUrl(remoteUrl);
  let slug: ForgeSlug | null = null;
  try {
    slug = host ? resolveForge(host, overrides)?.slug ?? null : null;
  } catch {
    // A malformed `forges` entry. The board is not the place to report it; the
    // CLI does, loudly, on the next publish or import.
    slug = null;
  }

  try {
    return { provider: await createForgeProvider(remoteUrl, { ...opts, overrides }), slug };
  } catch {
    return { provider: null, slug };
  }
}

/** Assemble one repo's slice of the board. Every failure is contained to the
    repo (error string on the payload); enrichment failures are contained
    further, falling back to stored node fields. */
export async function collectRepo(repo: RepoEntry, opts: ForgeProviderOptions = {}): Promise<BoardRepo> {
  try {
    const store = await loadStore(repo.path);
    const { provider: providerCtx, slug: forge } = await resolveRepoForge(repo.path, store, opts);
    let worktrees: BoardWorktree[] = [];
    const slotByBranch = new Map<string, { name: string; dirty: boolean }>();
    try {
      const [map, leases] = await Promise.all([
        getWorktreeMap(repo.path),
        resolveRepoIdentity(repo.path).then((id) => listLeases(id)),
      ]);
      const stackNameById = new Map(store.stacks.map((s) => [s.id, s.stackName]));
      worktrees = map.map((s) => {
        const lease = leases.find((l) => l.slotPath === s.path) ?? null;
        return {
          name: s.name,
          path: s.path,
          branch: s.branch,
          dirty: s.dirty,
          isWorkSlot: s.isWorkSlot,
          lease: lease
            ? { stackName: stackNameById.get(lease.stackId) ?? lease.stackId, action: lease.action, state: lease.state }
            : null,
        };
      });
      for (const s of map) {
        if (!s.isWorkSlot && s.branch) slotByBranch.set(s.branch, { name: s.name, dirty: s.dirty });
      }
    } catch {
      // worktree enumeration failure: board still renders the stacks
    }
    const stacks: BoardStack[] = [];
    for (const stack of store.stacks) {
      const snapshot = await collectSnapshot(repo.path, stack);
      const diagnostics = diagnoseStack(snapshot, stack);
      const branches = stack.nodes.map((n) => n.branch);
      const preflight = await RebaseEngine.preflight(repo.path, stack, branches);
      let mrByBranch = new Map<string, BoardMr>();
      if (providerCtx) {
        try {
          mrByBranch = await fetchMrsByBranch(providerCtx, branches);
        } catch {
          // network failure: the stored node fields carry the fallback
        }
      }
      stacks.push(
        shapeStack(
          stack,
          diagnostics.nodes,
          diagnostics.banner,
          diagnostics.globalBlocks,
          preflight.conflictBranches,
          mrByBranch,
          slotByBranch,
        ),
      );
    }
    const activity = shapeActivity(await OperationLog.load(), repo.path);
    return { path: repo.path, name: repo.name, forge, stacks, activity, worktrees, error: null };
  } catch (err) {
    return {
      path: repo.path,
      name: repo.name,
      forge: null,
      stacks: [],
      activity: [],
      worktrees: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function collectAllRepos(repos: RepoEntry[]): Promise<BoardRepo[]> {
  // One settings read for the whole refresh rather than one per repo, since
  // every repo resolves its forge against the same `forges` map.
  const overrides = await readForgeOverrides();
  return Promise.all(repos.map((r) => collectRepo(r, { overrides })));
}
