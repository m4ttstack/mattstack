import { homedir } from 'os';
import { join } from 'path';
import type { JobAction } from './job-state.ts';

const HERDR_BIN = process.env.HERDR_BIN || join(homedir(), '.local', 'bin', 'herdr');
const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH || join(homedir(), '.config', 'herdr', 'herdr.sock');

export type HerdrRunner = (args: string[]) => Promise<string>;

/** One herdr CLI subprocess per call, talking over its unix socket. Absolute
    bin + explicit socket path because the server may run under a minimal
    launchd environment. */
export const defaultRunner: HerdrRunner = async (args) => {
  const proc = Bun.spawn([HERDR_BIN, ...args], {
    env: { ...process.env, HERDR_SOCKET_PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`herdr ${args.join(' ')} failed (${code}): ${err || out}`);
  return out;
};

interface TabInfo {
  tabId: string;
  paneId: string;
  workspaceId: string;
}

export function findWorkspaceIdByLabel(out: string, label: string): string | null {
  try {
    const parsed = JSON.parse(out) as { result?: { workspaces?: { workspace_id?: string; label?: string }[] } };
    const ws = parsed.result?.workspaces?.find((w) => w.label === label);
    return ws?.workspace_id ?? null;
  } catch {
    return null;
  }
}

export function parseWorkspaceCreate(out: string): TabInfo | null {
  try {
    const parsed = JSON.parse(out) as {
      result?: { workspace?: { workspace_id?: string }; tab?: { tab_id?: string }; root_pane?: { pane_id?: string } };
    };
    const workspaceId = parsed.result?.workspace?.workspace_id;
    const tabId = parsed.result?.tab?.tab_id;
    const paneId = parsed.result?.root_pane?.pane_id;
    return workspaceId && tabId && paneId ? { workspaceId, tabId, paneId } : null;
  } catch {
    return null;
  }
}

export function parseTabCreate(out: string): TabInfo | null {
  try {
    const parsed = JSON.parse(out) as {
      result?: { tab?: { tab_id?: string; workspace_id?: string }; root_pane?: { pane_id?: string } };
    };
    const tabId = parsed.result?.tab?.tab_id;
    const workspaceId = parsed.result?.tab?.workspace_id;
    const paneId = parsed.result?.root_pane?.pane_id;
    return tabId && workspaceId && paneId ? { tabId, workspaceId, paneId } : null;
  } catch {
    return null;
  }
}

export function parseTabList(out: string): { tabId: string; label: string; workspaceId: string }[] {
  try {
    const parsed = JSON.parse(out) as {
      result?: { tabs?: { tab_id?: string; label?: string; workspace_id?: string }[] };
    };
    return (parsed.result?.tabs ?? []).flatMap((t) =>
      t.tab_id && t.workspace_id ? [{ tabId: t.tab_id, label: t.label ?? '', workspaceId: t.workspace_id }] : [],
    );
  } catch {
    return [];
  }
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Absolute path to the Plan 2 status-writer CLI. The pane runs in the target
    repo's cwd, so the board injects this path via --status-bin. */
export function statusBinPath(): string {
  return join(import.meta.dir, '..', '..', 'bin', 'gitq-status.ts');
}

/** The slash command a spawned pane opens with. Flag shape must match the
    gitq:* skills: positionals <repoPath> <stackName>, then --state and
    --status-bin. */
export function actionPrompt(action: JobAction, repoPath: string, stack: string, statePath: string): string {
  return ['/gitq:' + action, repoPath, stack, '--state', statePath, '--status-bin', statusBinPath()].join(' ');
}

export function buildPaneCommand(cwd: string, prompt: string): string {
  return `cd ${shellSingleQuote(cwd)} && claude ${shellSingleQuote(prompt)}`;
}

/** The tab label doubles as the herdr-level dedup key, so it includes the
    action: one stack can have a sync pane and a publish pane side by side. */
export function tabLabel(repoName: string, stack: string, action: JobAction): string {
  return `${repoName}:${stack} ${action}`;
}

export interface LaunchOpts {
  workspaceLabel: string;
  tabLabel: string;
  paneCommand: string;
}

/** Create-or-reuse the labelled workspace, dedup tabs by label, run the pane
    command. A fresh workspace ships with an initial tab + pane; reuse it
    (rename + run) instead of orphaning a blank tab beside the work tab. An
    existing same-label tab is focused WITHOUT re-running the command; the
    existing tab already holds that work. */
export async function launchInWorkspace(
  opts: LaunchOpts,
  runner: HerdrRunner = defaultRunner,
): Promise<{ tabId: string; workspaceId: string; focusedExisting: boolean }> {
  const workspaceId = findWorkspaceIdByLabel(await runner(['workspace', 'list']), opts.workspaceLabel);
  if (!workspaceId) {
    const created = parseWorkspaceCreate(
      await runner(['workspace', 'create', '--label', opts.workspaceLabel, '--no-focus']),
    );
    if (!created) throw new Error('herdr: could not create workspace');
    await runner(['tab', 'rename', created.tabId, opts.tabLabel]);
    await runner(['pane', 'run', created.paneId, opts.paneCommand]);
    return { tabId: created.tabId, workspaceId: created.workspaceId, focusedExisting: false };
  }
  const openTab = parseTabList(await runner(['tab', 'list', '--workspace', workspaceId])).find(
    (t) => t.workspaceId === workspaceId && t.label === opts.tabLabel,
  );
  if (openTab) {
    await runner(['tab', 'focus', openTab.tabId]);
    return { tabId: openTab.tabId, workspaceId, focusedExisting: true };
  }
  const tab = parseTabCreate(
    await runner(['tab', 'create', '--workspace', workspaceId, '--label', opts.tabLabel, '--no-focus']),
  );
  if (!tab) throw new Error('herdr: could not create tab');
  await runner(['pane', 'run', tab.paneId, opts.paneCommand]);
  return { tabId: tab.tabId, workspaceId: tab.workspaceId, focusedExisting: false };
}

export async function focusTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(['tab', 'focus', tabId]);
}
