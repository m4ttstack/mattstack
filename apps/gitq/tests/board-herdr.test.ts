import { describe, test, expect } from 'bun:test';
import {
  actionPrompt,
  buildPaneCommand,
  findWorkspaceIdByLabel,
  launchInWorkspace,
  parseTabCreate,
  parseTabList,
  parseWorkspaceCreate,
  statusBinPath,
  tabLabel,
} from '../src/server/herdr.ts';

const WS_LIST = JSON.stringify({ result: { workspaces: [{ workspace_id: 'ws1', label: 'gitq' }] } });
const WS_EMPTY = JSON.stringify({ result: { workspaces: [] } });
const WS_CREATE = JSON.stringify({
  result: { workspace: { workspace_id: 'ws2' }, tab: { tab_id: 'tab0' }, root_pane: { pane_id: 'pane0' } },
});
const TAB_CREATE = JSON.stringify({
  result: { tab: { tab_id: 'tab1', workspace_id: 'ws1' }, root_pane: { pane_id: 'pane1' } },
});
const TAB_LIST_EMPTY = JSON.stringify({ result: { tabs: [] } });
const TAB_LIST_MATCH = JSON.stringify({
  result: { tabs: [{ tab_id: 'tab9', label: 'gitq:mystack sync', workspace_id: 'ws1' }] },
});

function scriptedRunner(script: Array<{ expectArgs: string[]; out: string }>) {
  const seen: string[][] = [];
  const runner = async (args: string[]) => {
    seen.push(args);
    const step = script.shift();
    if (!step) throw new Error(`unexpected herdr call: ${args.join(' ')}`);
    expect(args).toEqual(step.expectArgs);
    return step.out;
  };
  return { runner, seen };
}

describe('parsers', () => {
  test('findWorkspaceIdByLabel matches label, null otherwise', () => {
    expect(findWorkspaceIdByLabel(WS_LIST, 'gitq')).toBe('ws1');
    expect(findWorkspaceIdByLabel(WS_LIST, 'other')).toBeNull();
    expect(findWorkspaceIdByLabel('junk', 'gitq')).toBeNull();
  });

  test('parseWorkspaceCreate and parseTabCreate pull the ids', () => {
    expect(parseWorkspaceCreate(WS_CREATE)).toEqual({ workspaceId: 'ws2', tabId: 'tab0', paneId: 'pane0' });
    expect(parseTabCreate(TAB_CREATE)).toEqual({ tabId: 'tab1', workspaceId: 'ws1', paneId: 'pane1' });
    expect(parseTabCreate('junk')).toBeNull();
  });

  test('parseTabList returns rows and tolerates junk', () => {
    expect(parseTabList(TAB_LIST_MATCH)).toEqual([{ tabId: 'tab9', label: 'gitq:mystack sync', workspaceId: 'ws1' }]);
    expect(parseTabList('junk')).toEqual([]);
  });
});

describe('command builders', () => {
  test('actionPrompt composes the skill invocation with injected paths', () => {
    const prompt = actionPrompt('sync', '/repo', 'mystack', '/state/job.json');
    expect(prompt).toBe(`/gitq:sync /repo mystack --state /state/job.json --status-bin ${statusBinPath()}`);
  });

  // From a checkout it must be bin/gitq -- an executable, not a .ts file run
  // through `bun run`. The skills invoke it as `<status-bin> job-status`, one
  // shape that also fits the compiled binary handing out its own path.
  test('statusBinPath points at the executable gitq entry', () => {
    expect(statusBinPath().endsWith('/bin/gitq')).toBe(true);
  });

  test('buildPaneCommand cds and single-quotes, escaping embedded quotes', () => {
    const cmd = buildPaneCommand('/my repo', "run 'x'");
    expect(cmd).toBe("cd '/my repo' && claude 'run '\\''x'\\'''");
  });

  test('tabLabel includes the action so panes for one stack do not collide', () => {
    expect(tabLabel('gitq', 'mystack', 'publish')).toBe('gitq:mystack publish');
  });
});

describe('launchInWorkspace', () => {
  const OPTS = { workspaceLabel: 'gitq', tabLabel: 'gitq:mystack sync', paneCommand: 'CMD' };

  test('creates the workspace and reuses its initial tab (no orphan blank tab)', async () => {
    const { runner } = scriptedRunner([
      { expectArgs: ['workspace', 'list'], out: WS_EMPTY },
      { expectArgs: ['workspace', 'create', '--label', 'gitq', '--no-focus'], out: WS_CREATE },
      { expectArgs: ['tab', 'rename', 'tab0', 'gitq:mystack sync'], out: '{}' },
      { expectArgs: ['pane', 'run', 'pane0', 'CMD'], out: '{}' },
    ]);
    const res = await launchInWorkspace(OPTS, runner);
    expect(res).toEqual({ tabId: 'tab0', workspaceId: 'ws2', focusedExisting: false });
  });

  test('reuses an existing workspace with a new labelled tab', async () => {
    const { runner } = scriptedRunner([
      { expectArgs: ['workspace', 'list'], out: WS_LIST },
      { expectArgs: ['tab', 'list', '--workspace', 'ws1'], out: TAB_LIST_EMPTY },
      { expectArgs: ['tab', 'create', '--workspace', 'ws1', '--label', 'gitq:mystack sync', '--no-focus'], out: TAB_CREATE },
      { expectArgs: ['pane', 'run', 'pane1', 'CMD'], out: '{}' },
    ]);
    const res = await launchInWorkspace(OPTS, runner);
    expect(res).toEqual({ tabId: 'tab1', workspaceId: 'ws1', focusedExisting: false });
  });

  test('focuses an existing same-label tab WITHOUT re-running the pane command', async () => {
    const { runner, seen } = scriptedRunner([
      { expectArgs: ['workspace', 'list'], out: WS_LIST },
      { expectArgs: ['tab', 'list', '--workspace', 'ws1'], out: TAB_LIST_MATCH },
      { expectArgs: ['tab', 'focus', 'tab9'], out: '{}' },
    ]);
    const res = await launchInWorkspace(OPTS, runner);
    expect(res).toEqual({ tabId: 'tab9', workspaceId: 'ws1', focusedExisting: true });
    expect(seen.some((args) => args[0] === 'pane')).toBe(false);
  });
});
