import * as vscode from 'vscode';
import { agentList, agentResume, listRuns, paneAttachPlan, paneList } from '@mattstack/rt-client';
import { ownerOf, type AgentRow } from './agentRows';
import { agentDisplayName, agentPickText } from './agentPickText';
import { attachPlanFor, loadAgentRows, paneForResume, type AgentsDeps } from './agentsLoad';
import { listWorktrees } from './git';
import { getCurrentWorktreePath } from './statusBar';

const DEPS: AgentsDeps = { paneList, agentList, listRuns, agentResume, paneAttachPlan };

let agentsItem: vscode.StatusBarItem | undefined;

// Runs as `sh -c ATTACH_SCRIPT rt-attach <name> <attach argv...>`.
// - VS Code starts the process before the panel is laid out, and herdr refuses a
//   zero-sized terminal, so wait (up to 5 s) for rows and columns first.
// - When the attach ends (herdr took the pane back, a detach, or a failure), clear
//   herdr's own output and offer Enter to bring the agent back here.
// - Never exit non-zero: VS Code turns that into an error popup.
const ATTACH_SCRIPT = String.raw`
name="$1"; shift
i=0
while [ "$i" -lt 50 ]; do
  case "$(stty size 2>/dev/null)" in ""|"0 "*|*" 0") sleep 0.1; i=$((i+1)) ;; *) break ;; esac
done
while :; do
  err=$(mktemp -t rt-attach) || err=/dev/null
  "$@" 2>"$err"; s=$?
  msg=$(tail -n 1 "$err" 2>/dev/null)
  [ "$err" != /dev/null ] && rm -f "$err"
  printf '\033[0m\033[2J\033[3J\033[H'
  if [ "$s" -eq 0 ]; then
    printf '\n  Detached from \033[1m%s\033[0m. It keeps running.\n' "$name"
  else
    case "$msg" in
      *"attached client"*|*"taken over"*|*"takeover"*|*"another client"*)
        printf '\n  \033[1m%s\033[0m is open somewhere else now. It keeps running.\n' "$name" ;;
      *)
        printf '\n  \033[1m%s\033[0m left this terminal.\n' "$name"
        [ -n "$msg" ] && printf '  \033[2m%s\033[0m\n' "$msg" ;;
    esac
  fi
  printf '\n  Press Enter to bring it back here, or close this tab.\n'
  read ans || exit 0
done
`;

const openTerminals = new Map<string, { terminal: vscode.Terminal; paneId: string }>();
const attaching = new Map<string, Promise<void>>();

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
    vscode.window.onDidCloseTerminal((t) => {
      for (const [key, open] of openTerminals) if (open.terminal === t) openTerminals.delete(key);
    }),
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

function attachRow(row: AgentRow, cwd: string): Promise<void> {
  const inFlight = attaching.get(row.key);
  if (inFlight) return inFlight;
  const job = attachRowNow(row, cwd).finally(() => attaching.delete(row.key));
  attaching.set(row.key, job);
  return job;
}

async function attachRowNow(row: AgentRow, cwd: string): Promise<void> {
  // The wrapper shell outlives the attach, so a live tab can hold a pane that has since ended.
  const open = openTerminals.get(row.key);
  const alive = open && open.terminal.exitStatus === undefined ? open : undefined;
  if (alive && row.target.kind === 'pane' && row.target.paneId === alive.paneId) {
    alive.terminal.show();
    return;
  }
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
  alive?.terminal.dispose();
  const name = agentDisplayName(row);
  const terminal = vscode.window.createTerminal({
    name,
    iconPath: new vscode.ThemeIcon('hubot'),
    shellPath: '/bin/sh',
    shellArgs: ['-c', ATTACH_SCRIPT, 'rt-attach', name, ...plan.argv],
    env: plan.env,
    cwd,
  });
  openTerminals.set(row.key, { terminal, paneId });
  terminal.show();
  void refreshAgentsItem();
}
