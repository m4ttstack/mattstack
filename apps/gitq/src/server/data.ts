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
import { readMrsByBranch, repoNameForPath } from '@mattstack/rt-client';
import type { RtResponse, MrByBranchData } from '@mattstack/rt-client';
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

/** A `readMrsByBranch`-shaped call, injectable so tests can stub the rt read
    without a real daemon socket (mirrors how a fake `GitProvider` is passed
    directly for the provider-path tests below). */
type RtMrReader = (repoName: string, branches: string[]) => Promise<RtResponse<MrByBranchData>>;

/**
 * The MRs of `branches`: rt's project-mrs store first when this repo resolves
 * to an rt repo name, the direct-forge provider as fallback.
 *
 * `getProvider` is a thunk (see `resolveRepoForge`) rather than a resolved
 * `ForgeProviderContext`, so a repo the rt store fully answers for never
 * builds a forge client or reads a token -- the provider is invoked only on
 * the fallback path, at most once per repo since the thunk memoizes it.
 *
 * The store answering not-ok covers a grant error, an unreachable daemon, and
 * a malformed response alike: any of those falls through unchanged rather
 * than distinguishing reasons, since the fallback is the same either way.
 *
 * The provider's batch path is feature detection on an optional interface
 * member, not a check on the provider slug: `GitHubProvider` does not
 * implement `fetchPullRequestsByBranches`, and must fall back rather than fail.
 */
export async function fetchMrsByBranch(
  getProvider: () => Promise<ForgeProviderContext | null>,
  branches: string[],
  rtRepo: string | null,
  readMrs: RtMrReader = readMrsByBranch,
): Promise<Map<string, BoardMr>> {
  const out = new Map<string, BoardMr>();
  if (branches.length === 0) return out;

  if (rtRepo) {
    const res = await readMrs(rtRepo, branches);
    if (res.ok && res.data) {
      for (const [branch, entry] of Object.entries(res.data.byBranch)) {
        if (entry) out.set(branch, toBoardMr(entry.pr));
      }
      return out;
    }
  }

  const ctx = await getProvider();
  if (!ctx) return out;
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

/** Test/CLI seam over rt-client's `repoNameForPath`, so `collectRepo`'s call
    site reads as domain logic ("what does rt call this repo") rather than
    naming the rt-client import directly. */
export function resolveRtRepo(repoPath: string, reposJsonPath?: string): string | null {
  return repoNameForPath(repoPath, reposJsonPath);
}

/** What one repo's remote says about its forge: which one, and how to talk to it. */
export interface RepoForge {
  /**
   * A memoized thunk rather than a resolved context: building it reads
   * `~/.rt/secrets.json` (via `createForgeProvider`), and the rt store path in
   * `fetchMrsByBranch` answers most stacked repos without that read. Calling
   * `resolveRepoForge` alone -- once per repo, even across many stacks --
   * never touches secrets; only a caller that actually needs the fallback
   * invokes this, and every stack in that repo shares the one result.
   *
   * Null covers both "the remote names no forge gitq knows" and "this forge's
   * token is missing", so a repo on a board of several forges loses only its
   * own MR enrichment rather than withholding every other repo's.
   */
  getProvider: () => Promise<ForgeProviderContext | null>;
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

const NO_PROVIDER = () => Promise.resolve(null);

/**
 * Resolve one repo's forge from its own remote: which forge, and a lazy
 * provider builder for when its credential is configured.
 *
 * `slug` resolution stays eager here (one remote read, one settings read) since
 * the UI needs it regardless of whether MRs load. Building the provider itself
 * is deferred to `getProvider`, called only on the fallback path.
 */
export async function resolveRepoForge(
  repoPath: string,
  store: StackStore,
  opts: ForgeProviderOptions = {},
): Promise<RepoForge> {
  // Nothing to enrich, so the remote is never read: the common case for a repo
  // on the board that is not currently stacked.
  if (store.stacks.length === 0) return { getProvider: NO_PROVIDER, slug: null };

  let remoteUrl: string;
  try {
    remoteUrl = store.remoteUrl || (await GitShell.getRemoteUrl(repoPath));
  } catch {
    return { getProvider: NO_PROVIDER, slug: null };
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

  let cached: Promise<ForgeProviderContext | null> | undefined;
  const getProvider = (): Promise<ForgeProviderContext | null> => {
    // One build per repo no matter how many stacks/branches ask: the memo
    // lives on this closure, not on the caller.
    if (!cached) {
      cached = createForgeProvider(remoteUrl, { ...opts, overrides }).catch(() => null);
    }
    return cached;
  };

  return { getProvider, slug };
}

/** Assemble one repo's slice of the board. Every failure is contained to the
    repo (error string on the payload); enrichment failures are contained
    further, falling back to stored node fields. */
export async function collectRepo(repo: RepoEntry, opts: ForgeProviderOptions = {}): Promise<BoardRepo> {
  try {
    const store = await loadStore(repo.path);
    const { getProvider, slug: forge } = await resolveRepoForge(repo.path, store, opts);
    // Resolved once for the whole repo, same as the provider: every stack's
    // branches are looked up against the one rt repo name.
    const rtRepo = resolveRtRepo(repo.path);
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
      const branches = stack.nodes.map((n) => n.branch);
      let mrByBranch = new Map<string, BoardMr>();
      try {
        mrByBranch = await fetchMrsByBranch(getProvider, branches, rtRepo);
      } catch {
        // network failure (rt daemon or forge): the stored node fields carry the fallback
      }
      // Live MR states let diagnostics recognize a fresh merge before any
      // reconcile has updated the stored node status. Enrichment failure
      // leaves the map empty and diagnostics fall back to stored state.
      const liveMrStates = new Map([...mrByBranch].map(([branch, mr]) => [branch, mr.state]));
      const diagnostics = diagnoseStack(snapshot, stack, liveMrStates);
      const preflight = await RebaseEngine.preflight(repo.path, stack, branches);
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
