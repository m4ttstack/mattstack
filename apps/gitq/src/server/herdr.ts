import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  agentIntegrations as rtAgentIntegrations,
  agentStart as rtAgentStart,
  codexHomeFor,
  defaultHarness,
  integrationsSwitchOn,
  repoNameForPath,
  selectLaunchHarness,
  type HarnessId,
  type LaunchHarnessIo,
} from '@mattstack/rt-client';
import { IS_COMPILED } from '../core/app-root.ts';
import type { JobAction, JobLaunch } from './job-state.ts';

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

/**
 * Absolute path to the gitq executable a spawned pane calls as
 * `<status-bin> job-status <state> <status>`. The pane runs in the target
 * repo's cwd, so the board injects this path via --status-bin.
 *
 * Compiled, that is this very binary. Path-based rather than inode-based on
 * purpose: a Sparkle update replaces the whole .app while the board runs, and
 * a pane that spawns afterwards must reach the NEW binary at the same path.
 * From a checkout it is bin/gitq, whose bun shebang makes it executable.
 */
export function statusBinPath(): string {
  return IS_COMPILED ? process.execPath : join(import.meta.dir, '..', '..', 'bin', 'gitq');
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

export interface ActionLaunchIo {
  agentStart: typeof rtAgentStart;
  /** The switch-off launch: a herdr pane running `claude` directly. */
  herdrLaunch: (opts: LaunchOpts) => Promise<{ tabId: string; workspaceId: string; focusedExisting: boolean }>;
  codexSkillsDir: () => string;
  exists: (path: string) => boolean;
  /** The serialized rt repo identity for a repo path, null when rt does not know it. */
  rtRepo: (repoPath: string) => string | null;
}

export const defaultActionLaunchIo: Omit<ActionLaunchIo, 'herdrLaunch'> = {
  agentStart: rtAgentStart,
  codexSkillsDir: () => {
    const home = codexHomeFor();
    if (!home.ok) throw new Error(home.error.message);
    return join(home.data, 'skills');
  },
  exists: existsSync,
  rtRepo: (repoPath) => repoNameForPath(repoPath),
};

const defaultActionHarnessIo: LaunchHarnessIo = {
  switchOn: () => integrationsSwitchOn(),
  defaultHarness: () => defaultHarness(),
  agentIntegrations: rtAgentIntegrations,
};

/** The harness a board action runs under; undefined while the integrations switch is off. */
export function selectActionHarness(io: LaunchHarnessIo = defaultActionHarnessIo): Promise<HarnessId | undefined> {
  return selectLaunchHarness(io, 'gitq');
}

export interface ActionLaunchOpts {
  action: JobAction;
  repoPath: string;
  runDir: string;
  stack: string;
  statePath: string;
  workspaceLabel: string;
  tabLabel: string;
  /** Unset launches exactly as before the integrations switch. */
  harness: HarnessId | undefined;
}

export interface ActionLaunched {
  tabId: string;
  workspaceId: string;
  focusedExisting: boolean;
  /** The session rt started, which alone may report the job. */
  launch?: JobLaunch;
}

/** The first message of a harness with no slash commands: it names the installed skill by path. */
function harnessActionPrompt(harness: HarnessId, opts: ActionLaunchOpts, io: ActionLaunchIo): string {
  if (harness === 'claude') return actionPrompt(opts.action, opts.runDir, opts.stack, opts.statePath);
  if (harness !== 'codex') throw new Error(`gitq has no skills for ${harness}, so it cannot start ${opts.action} there.`);
  const skill = `gitq:${opts.action}`;
  const path = join(io.codexSkillsDir(), skill, 'SKILL.md');
  if (!io.exists(path)) {
    throw new Error(`The ${skill} skill is not installed for Codex, so gitq cannot start it there.`);
  }
  const args = [opts.runDir, opts.stack, '--state', opts.statePath, '--status-bin', statusBinPath()].join(' ');
  return `Use the ${skill} skill at ${path} with these arguments: ${args}`;
}

/**
 * Start a board action's agent. With the integrations switch off this is
 * the herdr pane running `claude` it always was; with it on, rt's shared
 * launcher starts the selected harness and returns the session it bound.
 */
export async function launchAction(opts: ActionLaunchOpts, io: ActionLaunchIo): Promise<ActionLaunched> {
  if (opts.harness === undefined) {
    const prompt = actionPrompt(opts.action, opts.runDir, opts.stack, opts.statePath);
    return io.herdrLaunch({
      workspaceLabel: opts.workspaceLabel,
      tabLabel: opts.tabLabel,
      paneCommand: buildPaneCommand(opts.runDir, prompt),
    });
  }
  const prompt = harnessActionPrompt(opts.harness, opts, io);
  const repo = io.rtRepo(opts.repoPath);
  if (!repo) throw new Error(`rt does not know ${opts.repoPath}, so gitq cannot start an agent there. Add the repo to rt first.`);
  const res = await io.agentStart({
    repo,
    cwd: opts.runDir,
    prompt,
    surface: 'herdr',
    workspace: opts.workspaceLabel,
    tab: opts.tabLabel,
    provider: opts.harness,
  });
  if (!res.ok) {
    if (res.error && /already open; focused it/.test(res.error)) return { tabId: '', workspaceId: '', focusedExisting: true };
    throw new Error(res.error || 'rt sent no answer');
  }
  if (!res.data) throw new Error('rt sent no agent record');
  return {
    tabId: res.data.tabId ?? '',
    workspaceId: res.data.workspaceId ?? '',
    focusedExisting: false,
    launch: { harness: opts.harness, agentId: res.data.id, sessionId: res.data.sessionId },
  };
}

export async function focusTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(['tab', 'focus', tabId]);
}
