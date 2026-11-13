import * as vscode from 'vscode';
import { exec, execFile } from 'child_process';
import { existsSync } from 'fs';
import { extractLinearId } from './branchParser';
import { fetchTicket, type LinearTicket } from './linear';
import { fetchMRInfo } from './gitlab';
import { confirmedHostForLookup } from './gitlabNotice';
import { branchCache } from './cache';
import { fetchBranchFromDaemon } from './daemonClient';
import { getSecret } from './secrets';
import type { CachedBranchData, GitExtensionExports } from './types';
import { getGitApi, findWorkspaceRepo, getRepoRootName, getGitDir, readBranchFromHead } from './git';
import { branchDataFromDaemonEntry, forgeWords, ownBranchData, repoIdentityToStore, type Forge } from './forge';
import { resolveRepoForge, type RepoForge } from './repoForge';

// ── Module state ──

let statusBarItem: vscode.StatusBarItem;
let allWorktreesItem: vscode.StatusBarItem;
let branchSwitcherItem: vscode.StatusBarItem;
let currentTicketUrl: string | null = null;
let currentMrUrl: string | null = null;
let currentWorktreePath: string | null = null;
let currentForge: Forge | null = null;
let publishedForgeContext: string | undefined;
let updateSeq = 0;
let updateTimer: ReturnType<typeof setTimeout> | undefined;

// Cached values that are stable for the lifetime of a workspace session.
// Avoids spawning git subprocesses on every status bar update.
let cachedGitDir: string | null | undefined; // undefined = not yet resolved
let cachedWorktreeName: string | undefined;

// ── Public getters for extension command handlers ──

export function getCurrentTicketUrl(): string | null { return currentTicketUrl; }
export function getCurrentMrUrl(): string | null { return currentMrUrl; }
export function getCurrentWorktreePath(): string | null { return currentWorktreePath; }
export function getCurrentForge(): Forge | null { return currentForge; }

function setForge(forge: Forge | null) {
  currentForge = forge;
  const value = forge ?? 'none';
  if (value === publishedForgeContext) return;
  publishedForgeContext = value;
  void vscode.commands.executeCommand('setContext', 'rtContext.forge', value);
}

// ── Initialization ──

export function initStatusBar(context: vscode.ExtensionContext, priority: number) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  statusBarItem.command = 'rtContext.openTicket';
  context.subscriptions.push(statusBarItem);

  allWorktreesItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority - 1);
  allWorktreesItem.command = 'rtContext.showAllWorktrees';
  allWorktreesItem.text = '$(list-tree) Worktrees';
  allWorktreesItem.tooltip = 'Show all worktrees';
  context.subscriptions.push(allWorktreesItem);

  branchSwitcherItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority - 2);
  branchSwitcherItem.command = 'rtContext.switchBranch';
  branchSwitcherItem.tooltip = 'Switch branch';
  context.subscriptions.push(branchSwitcherItem);
}

export function showStatusBarItems() {
  statusBarItem.show();
  allWorktreesItem.show();
  branchSwitcherItem.show();
}

// ── Git watching ──

export function waitForGitAndStart(context: vscode.ExtensionContext) {
  const gitExtension = vscode.extensions.getExtension<import('./types').GitExtensionExports>('vscode.git');
  if (!gitExtension) {
    getRepoRootName().then((name) => {
      statusBarItem.text = '$(folder) ' + name;
      showStatusBarItems();
    });
    return;
  }

  const startWatching = (gitApi: import('./types').GitAPI) => {
    scheduleUpdate(context);

    for (const repo of gitApi.repositories) {
      context.subscriptions.push(repo.state.onDidChange(() => scheduleUpdate(context)));
    }

    context.subscriptions.push(
      gitApi.onDidOpenRepository((repo) => {
        context.subscriptions.push(repo.state.onDidChange(() => scheduleUpdate(context)));
        scheduleUpdate(context);
      }),
    );
  };

  if (gitExtension.isActive) {
    startWatching(gitExtension.exports.getAPI(1));
  } else {
    gitExtension.activate().then((exports) => startWatching(exports.getAPI(1)));
  }

  // Watch .git/HEAD directly for instant branch-change detection.
  // The VS Code Git API can lag after external checkouts (terminal, other tools);
  // HEAD changes immediately on every branch switch, so this gives a near-instant
  // status bar update via FSEvents without any polling.
  // We use a shorter debounce here (50ms vs 300ms) since HEAD changing is an
  // unambiguous signal that the checkout is complete, and we read branch from the
  // file directly (not from the VS Code git API) so we don't need to wait for it.
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    getGitDir(folders[0]!.uri.fsPath).then((gitDir) => {
      cachedGitDir = gitDir; // cache for use in updateStatusBar
      if (!gitDir) return;
      const pattern = new vscode.RelativePattern(vscode.Uri.file(gitDir), 'HEAD');
      const headWatcher = vscode.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(headWatcher.onDidChange(() => scheduleUpdate(context, 50)));
      context.subscriptions.push(headWatcher);
    });
  }
}

// ── Update scheduling ──

export function scheduleUpdate(context: vscode.ExtensionContext, delayMs = 300) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => updateStatusBar(context), delayMs);
}

export function clearUpdateTimer() {
  if (updateTimer) clearTimeout(updateTimer);
}

// ── Status bar rendering ──

async function updateStatusBar(context: vscode.ExtensionContext) {
  const updateId = ++updateSeq;
  // Use cached worktree name — it's stable for the lifetime of the workspace session.
  // getRepoRootName() spawns a git subprocess on every call; avoid it after first run.
  if (!cachedWorktreeName) {
    cachedWorktreeName = await getRepoRootName();
  }
  const worktreeName = cachedWorktreeName;
  const gitApi = getGitApi();

  // Store the worktree folder path for the Finder action
  const folders = vscode.workspace.workspaceFolders;
  currentWorktreePath = folders?.length ? folders[0]!.uri.fsPath : null;

  if (!gitApi || !gitApi.repositories.length) {
    statusBarItem.text = `$(folder) ${worktreeName}`;
    statusBarItem.tooltip = `Worktree: ${worktreeName}\nNo git repository found`;
    statusBarItem.command = 'rtContext.openTicket';
    branchSwitcherItem.text = '$(git-branch)';
    setForge(null);
    currentTicketUrl = null;
    currentMrUrl = null;
    showStatusBarItems();
    return;
  }

  const repo = (await findWorkspaceRepo(gitApi)) ?? gitApi.repositories[0]!;
  const repoForge = resolveRepoForge(repo);
  setForge(repoForge.forge);

  // Read branch directly from .git/HEAD — VS Code's git API (repo.state.HEAD) updates
  // asynchronously after a checkout and can lag by hundreds of milliseconds, causing
  // the status bar to show the old branch through an extra debounce cycle.
  // Reading the file directly is synchronous and always reflects the true current branch.
  const branch = (cachedGitDir ? readBranchFromHead(cachedGitDir) : null) ?? repo.state.HEAD?.name;

  if (!branch) {
    statusBarItem.text = `$(folder) ${worktreeName}  │  $(git-branch) (detached)`;
    statusBarItem.tooltip = `Worktree: ${worktreeName}\nDetached HEAD`;
    statusBarItem.command = 'rtContext.openTicket';
    branchSwitcherItem.text = '$(git-branch) (detached)';
    currentTicketUrl = null;
    currentMrUrl = null;
    showStatusBarItems();
    return;
  }

  branchSwitcherItem.text = `$(git-branch) ${branch}`;

  const linearIdFromBranch = extractLinearId(branch);
  const cached = ownBranchData(branchCache.get(branch), repoForge.forge, repoForge.remoteUrl) ?? undefined;

  // Check if cache is fresh enough to render immediately (skip spinner)
  const config = vscode.workspace.getConfiguration('rtContext');
  const cacheTtl = config.get<number>('cacheTtlSeconds', 300) * 1000;
  const isFreshCache = cached && (Date.now() - cached.fetchedAt) < cacheTtl;

  if (isFreshCache) {
    // Render from cache immediately — no spinner, clickable right away
    renderFinalState(worktreeName, branch, cached, linearIdFromBranch);

    // A late result for a branch already switched away from must not repaint.
    fetchBranchData(context, branch, repoForge).then((fresh) => {
      if (!fresh) return;
      branchCache.set(branch, fresh);
      const changed = fresh.mrUrl !== cached.mrUrl || fresh.linearId !== cached.linearId;
      if (repoForge.forge === 'github' && changed && updateId === updateSeq) {
        renderFinalState(worktreeName, branch, fresh, linearIdFromBranch);
      }
    }).catch(() => {});
    return;
  }

  // ── Cache is stale or missing — show loading state and fetch ──
  statusBarItem.command = undefined;
  statusBarItem.tooltip = 'Refreshing…';

  if (cached) {
    const linearId = cached.linearId ?? linearIdFromBranch;
    if (linearId && cached.ticket) {
      const maxLen = config.get<number>('maxTitleLength', 50);
      let title = cached.ticket.title;
      if (maxLen > 0 && title.length > maxLen) {
        title = title.slice(0, maxLen - 1) + '…';
      }
      statusBarItem.text = `$(folder) ${worktreeName}  │  $(loading~spin) ${cached.ticket.identifier}: ${title}`;
    } else if (linearId) {
      statusBarItem.text = `$(folder) ${worktreeName}  │  $(loading~spin) ${linearId}`;
    } else {
      statusBarItem.text = `$(folder) ${worktreeName}  │  $(loading~spin) ${branch}`;
    }
  } else {
    const linearId = linearIdFromBranch;
    if (linearId) {
      statusBarItem.text = `$(folder) ${worktreeName}  │  $(loading~spin) ${linearId}`;
    } else {
      statusBarItem.text = `$(folder) ${worktreeName}  │  $(loading~spin) ${branch}`;
    }
  }
  showStatusBarItems();

  // ── Fetch and render ──
  let fresh: CachedBranchData | null = null;
  try {
    const FETCH_TIMEOUT_MS = 15_000;
    fresh = await Promise.race([
      fetchBranchData(context, branch, repoForge),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ]);

    if (fresh) {
      branchCache.set(branch, fresh);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    vscode.window.showErrorMessage(`RT Context: Failed to refresh — ${msg}`);
  } finally {
    const effectiveData = fresh ?? cached ?? null;
    renderFinalState(worktreeName, branch, effectiveData, linearIdFromBranch);
  }
}

/** Render the status bar in its final, clickable state from the given data. */
function renderFinalState(
  worktreeName: string,
  branch: string,
  data: CachedBranchData | null,
  linearIdFromBranch: string | null,
) {
  statusBarItem.command = 'rtContext.openTicket';
  const effectiveLinearId = data?.linearId ?? linearIdFromBranch;

  if (effectiveLinearId && data?.ticket) {
    renderTicket(worktreeName, branch, data.ticket, data.mrUrl);
  } else if (effectiveLinearId) {
    statusBarItem.text = `$(folder) ${worktreeName}  │  $(bookmark) ${effectiveLinearId}`;
    statusBarItem.tooltip =
      `Worktree: ${worktreeName}\nBranch: ${branch}\nTicket: ${effectiveLinearId}\n\nClick for options`;
    currentTicketUrl = data?.ticket?.url ?? `https://linear.app/issue/${effectiveLinearId}`;
    currentMrUrl = data?.mrUrl ?? null;
    showStatusBarItems();
  } else {
    statusBarItem.text = `$(folder) ${worktreeName}  │  $(git-branch) ${branch}`;
    statusBarItem.tooltip = `Worktree: ${worktreeName}\nBranch: ${branch}\nClick for options`;
    currentTicketUrl = null;
    currentMrUrl = data?.mrUrl ?? null;
    showStatusBarItems();
  }
}

/**
 * Fetch all data for a branch (MR info + Linear ticket).
 *
 * Strategy:
 *  1. Try daemon cache first (instant, no network) — daemon already has
 *     enriched data from its background refresh loop.
 *  2. Fall back to direct API calls if daemon is unavailable.
 *
 * Returns null if nothing useful could be fetched.
 */
export async function fetchBranchData(
  context: vscode.ExtensionContext,
  branch: string,
  repoForge: RepoForge,
): Promise<CachedBranchData | null> {
  // ── Daemon-first path (HTTP REST API) ──
  try {
    const response = await fetchBranchFromDaemon(branch);
    if (response?.ok && response.data) {
      const entries = response.data;
      const entry = entries[branch] ?? Object.values(entries)[0];
      if (entry) return branchDataFromDaemonEntry(entry, repoForge.forge, repoForge.remoteUrl, branch, undefined, branchCache.get(branch));
    }
  } catch {
    // Daemon not available — fall through to direct fetch
  }

  // ── Direct API fallback (daemon not running) ──
  const direct = await fetchBranchDataDirect(context, branch, repoForge);
  if (!direct || repoForge.forge !== 'github') return direct;

  // On GitHub the fallback cannot look a PR up, so keep the own one already cached.
  const prior = ownBranchData(branchCache.get(branch), repoForge.forge, repoForge.remoteUrl);
  if (!prior) return direct;
  return {
    ...direct,
    ticket: direct.ticket ?? prior.ticket,
    mrUrl: prior.mrUrl,
    linearId: prior.linearId,
  };
}

/**
 * Direct API fetch — used when daemon is not available.
 * Makes independent Linear/GitLab calls from the extension itself.
 */
async function fetchBranchDataDirect(
  context: vscode.ExtensionContext,
  branch: string,
  repoForge: RepoForge,
): Promise<CachedBranchData | null> {
  let linearId = extractLinearId(branch);
  let mrUrl: string | null = null;
  let mrLinearId: string | null = null;

  // Skip MR lookup for default/trunk branches — they never have an associated MR
  // and the query can hang or return huge result sets
  const DEFAULT_BRANCHES = new Set(['master', 'main', 'develop', 'development', 'staging', 'production']);
  const shouldLookupMR = !DEFAULT_BRANCHES.has(branch) && repoForge.forge !== 'github';

  // Fetch MR info
  if (shouldLookupMR) {
    const gitlabToken = await getSecret(context, 'gitlabToken');
    if (gitlabToken) {
      const { remoteUrl } = repoForge;
      if (remoteUrl) {
        try {
          const mrInfo = await fetchMRInfo(gitlabToken, remoteUrl, branch, confirmedHostForLookup(remoteUrl));
          if (mrInfo) {
            mrUrl = mrInfo.webUrl;
            mrLinearId = mrInfo.linearId;
          }
        } catch {
          // MR lookup failed
        }
      }
    }
  }

  // Use MR title as fallback for Linear ID
  if (!linearId && mrLinearId) {
    linearId = mrLinearId;
  }

  // Fetch Linear ticket
  let ticket: LinearTicket | null = null;
  if (linearId) {
    const apiKey = await getSecret(context, 'linearApiKey');
    if (apiKey) {
      try {
        ticket = await fetchTicket(apiKey, linearId);
      } catch {
        // Linear fetch failed
      }
    }
  }

  const repoIdentity = repoIdentityToStore(repoForge.forge, undefined, repoForge.remoteUrl);
  return {
    ticket,
    mrUrl,
    linearId: mrLinearId,
    fetchedAt: Date.now(),
    ...(repoIdentity ? { repoIdentity } : {}),
  };
}

function renderTicket(
  worktreeName: string,
  branch: string,
  ticket: LinearTicket | null,
  mrUrl: string | null,
) {
  if (!ticket) {
    statusBarItem.text = `$(folder) ${worktreeName}  │  $(bookmark) ${extractLinearId(branch) ?? branch}`;
    statusBarItem.tooltip = `Worktree: ${worktreeName}\nBranch: ${branch}\n\nTicket not found in Linear`;
    currentTicketUrl = null;
    currentMrUrl = mrUrl;
    showStatusBarItems();
    return;
  }

  const config = vscode.workspace.getConfiguration('rtContext');
  const maxLen = config.get<number>('maxTitleLength', 50);
  let title = ticket.title;
  if (maxLen > 0 && title.length > maxLen) {
    title = title.slice(0, maxLen - 1) + '…';
  }

  statusBarItem.text = `$(folder) ${worktreeName}  │  $(bookmark) ${ticket.identifier}: ${title}`;

  const tooltipLines = [
    `Worktree: ${worktreeName}`,
    `Branch: ${branch}`,
    `Ticket: ${ticket.identifier} — ${ticket.title}`,
  ];
  if (ticket.stateName) tooltipLines.push(`Status: ${ticket.stateName}`);
  if (mrUrl) tooltipLines.push(`${forgeWords(currentForge).short}: ${mrUrl}`);
  tooltipLines.push('', 'Click for options');
  statusBarItem.tooltip = tooltipLines.join('\n');

  currentTicketUrl = ticket.url;
  currentMrUrl = mrUrl;
  showStatusBarItems();
}

// ── Utilities ──

const LINEAR_APP_PATH = '/Applications/Linear.app';

export function openLinearUrl(url: string) {
  if (process.platform === 'darwin' && existsSync(LINEAR_APP_PATH)) {
    exec(`open -a Linear "${url}"`);
  } else {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
