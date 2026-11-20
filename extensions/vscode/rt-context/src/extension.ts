import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { branchCache, branchListCache } from './cache';
import {
  initStatusBar,
  waitForGitAndStart,
  scheduleUpdate,
  clearUpdateTimer,
  getCurrentTicketUrl,
  getCurrentMrUrl,
  getCurrentForge,
  getCurrentWorktreePath,
  openLinearUrl,
} from './statusBar';
import { onDaemonRefresh } from './daemonClient';
import { showBranchSwitcher } from './branchSwitcher';
import { showAllWorktrees } from './worktreePicker';
import { forgeWords } from './forge';
import { initAgentsItem, refreshAgentsItem, showAgents } from './agentsMenu';

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('rtContext');
  const priority = config.get<number>('statusBarPriority', 200);

  branchCache.init(context);
  branchListCache.init(context);
  initStatusBar(context, priority);
  initAgentsItem(context, priority);

  context.subscriptions.push(
    vscode.commands.registerCommand('rtContext.openTicket', async () => {
      interface ActionItem extends vscode.QuickPickItem {
        action: () => void;
      }

      const items: ActionItem[] = [];
      const ticketUrl = getCurrentTicketUrl();
      const mrUrl = getCurrentMrUrl();
      const worktreePath = getCurrentWorktreePath();
      const w = forgeWords(getCurrentForge());

      if (ticketUrl) {
        items.push({
          label: '$(link-external) Open Linear Ticket',
          action: () => openLinearUrl(ticketUrl),
        });
      }

      if (mrUrl) {
        items.push({
          label: `$(git-merge) Open ${w.site} ${w.title}`,
          action: () => vscode.env.openExternal(vscode.Uri.parse(mrUrl)),
        });
      }

      if (worktreePath) {
        items.push({
          label: '$(folder-opened) Open in Finder',
          action: () => {
            execFile('open', [worktreePath]);
          },
        });
      }

      if (!items.length) {
        vscode.window.showInformationMessage('No actions available for this branch.');
        return;
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Choose an action',
      });
      picked?.action();
    }),

    vscode.commands.registerCommand('rtContext.showAllWorktrees', () =>
      showAllWorktrees(context),
    ),

    vscode.commands.registerCommand('rtContext.showAgents', () => showAgents()),

    vscode.commands.registerCommand('rtContext.switchBranch', () =>
      showBranchSwitcher(context),
    ),

    vscode.commands.registerCommand('rtContext.refresh', () => {
      branchCache.clear();
      branchListCache.clear();
      scheduleUpdate(context);
    }),

    vscode.commands.registerCommand('rtContext.resetWorkspacePref', async () => {
      await context.globalState.update('rtContext.preferredWorkspaceFile', {});
      vscode.window.showInformationMessage(
        'All workspace file preferences cleared. You will be prompted next time.',
      );
    }),
  );

  waitForGitAndStart(context);

  context.subscriptions.push(onDaemonRefresh(() => {
    scheduleUpdate(context);
    void refreshAgentsItem();
  }));

  void noticeEditorTokens(context);
}

const EDITOR_TOKENS: Record<string, string> = {
  'rtContext.linearApiKey': 'linearApiKey',
  'rtContext.gitlabToken': 'gitlabToken',
};

/** Tokens the old Set commands saved in the editor are no longer read; say how to move them until they are forgotten. */
async function noticeEditorTokens(context: vscode.ExtensionContext): Promise<void> {
  const found: string[] = [];
  for (const editorKey of Object.keys(EDITOR_TOKENS)) {
    if (await context.secrets.get(editorKey)) found.push(editorKey);
  }
  if (!found.length) return;
  const commands = found.map((k) => `rt secrets set rt ${EDITOR_TOKENS[k]}`).join(' and ');
  const forget = 'Forget the editor copies';
  const picked = await vscode.window.showWarningMessage(
    `RT Context no longer reads tokens saved in the editor. Move them to rt with ${commands}.`,
    forget,
  );
  if (picked === forget) await Promise.all(found.map((k) => context.secrets.delete(k)));
}

export function deactivate() {
  clearUpdateTimer();
  branchCache.clear();
}
