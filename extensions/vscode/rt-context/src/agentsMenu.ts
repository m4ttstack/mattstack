import * as vscode from 'vscode';
import { agentList, agentResume, listRuns, paneAttachPlan, paneList } from '@mattstack/rt-client';
import { ownerOf, type AgentRow } from './agentRows';
import { agentPickText } from './agentPickText';
import { attachPlanFor, loadAgentRows, paneForResume, type AgentsDeps } from './agentsLoad';
import { listWorktrees } from './git';
import { getCurrentWorktreePath } from './statusBar';

const DEPS: AgentsDeps = { paneList, agentList, listRuns, agentResume, paneAttachPlan };

let agentsItem: vscode.StatusBarItem | undefined;

// VS Code starts the process before the panel is laid out, and herdr refuses a
// zero-sized terminal, so wait (up to 5 s) for rows and columns first. herdr also
// refuses a pane another client already shows; offer the takeover right there, and
// keep the terminal open on any other failure so herdr's error stays readable.
const ATTACH_SCRIPT = [
  'i=0',
  'while [ "$i" -lt 50 ]; do',
  '  case "$(stty size 2>/dev/null)" in ""|"0 "*|*" 0") sleep 0.1; i=$((i+1)) ;; *) break ;; esac',
  'done',
  '"$@"; s=$?',
  '[ "$s" -eq 0 ] && exit 0',
  'for a in "$@"; do [ "$a" = --takeover ] && taken=1; done',
  'if [ -z "$taken" ]; then',
  '  printf "\\nPress y to take this agent over here (the other window lets it go), or Enter to close. "',
  '  read ans',
  '  case "$ans" in y|Y) exec "$@" --takeover ;; esac',
  '  exit "$s"',
  'fi',
  'printf "\\nPress Enter to close. "; read ans; exit "$s"',
].join('\n');

interface AgentPick extends vscode.QuickPickItem {
  row?: AgentRow;
}

async function worktreeContext(): Promise<{ worktreePath: string; worktreeRoots: string[]; branch: string | null } | null> {
  // The status bar sets its path only after git activates; the first refresh runs before that.
  const folder = getCurrentWorktreePath() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  if (!folder) return null;
  const worktrees = await listWorktrees(folder);
  const worktreeRoots = worktrees.map((w) => w.dirPath);
  const worktreePath = ownerOf(folder, worktreeRoots);
  if (!worktreePath) return null;
  const branch = worktrees.find((w) => w.dirPath === worktreePath)?.branch ?? null;
  return { worktreePath, worktreeRoots, branch };
}

export function initAgentsItem(context: vscode.ExtensionContext, priority: number): void {
  agentsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority - 3);
  agentsItem.command = 'rtContext.showAgents';
  agentsItem.text = '$(hubot) Agents';
  agentsItem.tooltip = "This worktree's Claude agents";
  context.subscriptions.push(
    agentsItem,
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) void refreshAgentsItem(); }),
  );
  void refreshAgentsItem();
}

export async function refreshAgentsItem(): Promise<void> {
  if (!agentsItem) return;
  const ctx = await worktreeContext();
  if (!ctx) {
    agentsItem.hide();
    return;
  }
  const res = await loadAgentRows(ctx, DEPS);
  const live = 'rows' in res ? res.rows.filter((r) => r.group === 'running').length : 0;
  agentsItem.text = live > 0 ? `$(hubot) Agents (${live})` : '$(hubot) Agents';
  agentsItem.show();
}

export async function showAgents(): Promise<void> {
  const ctx = await worktreeContext();
  if (!ctx) {
    vscode.window.showInformationMessage('Open a git worktree to see its agents.');
    return;
  }
  const res = await loadAgentRows(ctx, DEPS);
  if ('error' in res) {
    vscode.window.showErrorMessage(res.error);
    return;
  }
  if (!res.rows.length) {
    vscode.window.showInformationMessage('No agents have run in this worktree yet.');
    return;
  }

  const items: AgentPick[] = [];
  for (const [group, label] of [['running', 'Running'], ['recent', 'Recent']] as const) {
    const rows = res.rows.filter((r) => r.group === group);
    if (!rows.length) continue;
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    for (const row of rows) {
      items.push({ ...agentPickText(row), row });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick an agent to attach to in a terminal',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked?.row) return;
  await attachRow(picked.row, ctx.worktreePath);
}

async function attachRow(row: AgentRow, cwd: string): Promise<void> {
  let paneId: string;
  if (row.target.kind === 'pane') {
    paneId = row.target.paneId;
  } else {
    const resumed = await paneForResume(row.target.agentId, DEPS);
    if ('error' in resumed) {
      vscode.window.showErrorMessage(resumed.error);
      return;
    }
    paneId = resumed.paneId;
  }
  const plan = await attachPlanFor(paneId, DEPS);
  if ('error' in plan) {
    vscode.window.showErrorMessage(plan.error);
    return;
  }
  vscode.window.createTerminal({
    name: row.title,
    shellPath: '/bin/sh',
    shellArgs: ['-c', ATTACH_SCRIPT, 'rt-attach', ...plan.argv],
    env: plan.env,
    cwd,
  }).show();
  void refreshAgentsItem();
}
