import { describe, test, expect } from 'bun:test';
import { homedir } from 'os';
import {
  actionPrompt,
  buildPaneCommand,
  ensureHerdr,
  findWorkspaceIdByLabel,
  herdrBin,
  launchInWorkspace,
  parseTabCreate,
  parseTabList,
  parseWorkspaceCreate,
  statusBinPath,
  tabLabel,
} from '../src/server/herdr.ts';

const running = async () => ({ ok: true, data: { state: 'running' } });

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
    const res = await launchInWorkspace(OPTS, runner, running);
    expect(res).toEqual({ tabId: 'tab0', workspaceId: 'ws2', focusedExisting: false });
  });

  test('reuses an existing workspace with a new labelled tab', async () => {
    const { runner } = scriptedRunner([
      { expectArgs: ['workspace', 'list'], out: WS_LIST },
      { expectArgs: ['tab', 'list', '--workspace', 'ws1'], out: TAB_LIST_EMPTY },
      { expectArgs: ['tab', 'create', '--workspace', 'ws1', '--label', 'gitq:mystack sync', '--no-focus'], out: TAB_CREATE },
      { expectArgs: ['pane', 'run', 'pane1', 'CMD'], out: '{}' },
    ]);
    const res = await launchInWorkspace(OPTS, runner, running);
    expect(res).toEqual({ tabId: 'tab1', workspaceId: 'ws1', focusedExisting: false });
  });

  test('focuses an existing same-label tab WITHOUT re-running the pane command', async () => {
    const { runner, seen } = scriptedRunner([
      { expectArgs: ['workspace', 'list'], out: WS_LIST },
      { expectArgs: ['tab', 'list', '--workspace', 'ws1'], out: TAB_LIST_MATCH },
      { expectArgs: ['tab', 'focus', 'tab9'], out: '{}' },
    ]);
    const res = await launchInWorkspace(OPTS, runner, running);
    expect(res).toEqual({ tabId: 'tab9', workspaceId: 'ws1', focusedExisting: true });
    expect(seen.some((args) => args[0] === 'pane')).toBe(false);
  });

  test('a herdr that is not installed throws before the runner runs', async () => {
    const { runner, seen } = scriptedRunner([]);
    await expect(
      launchInWorkspace(OPTS, runner, async () => ({ ok: true, data: { state: 'not-installed' } })),
    ).rejects.toThrow("herdr isn't installed. Open mattstack Setup to install it");
    expect(seen).toEqual([]);
  });

  test('a failed start surfaces the daemon detail', async () => {
    const { runner, seen } = scriptedRunner([]);
    await expect(
      launchInWorkspace(OPTS, runner, async () => ({ ok: true, data: { state: 'failed', detail: 'socket never appeared' } })),
    ).rejects.toThrow('socket never appeared');
    expect(seen).toEqual([]);
  });

  test('an unreachable daemon does not stop the launch', async () => {
    const { runner, seen } = scriptedRunner([{ expectArgs: ['workspace', 'list'], out: WS_LIST }, { expectArgs: ['tab', 'list', '--workspace', 'ws1'], out: TAB_LIST_MATCH }, { expectArgs: ['tab', 'focus', 'tab9'], out: '{}' }]);
    await launchInWorkspace(OPTS, runner, async () => ({ ok: false }));
    expect(seen.length).toBe(3);
  });
});

describe('herdrBin', () => {
  const home = homedir();

  test('HERDR_BIN wins over any installed herdr', () => {
    expect(herdrBin({ HERDR_BIN: '/custom/herdr' }, () => true)).toBe('/custom/herdr');
  });

  test('finds a Homebrew herdr when it is the only one', () => {
    expect(herdrBin({}, (p) => p === '/opt/homebrew/bin/herdr')).toBe('/opt/homebrew/bin/herdr');
  });

  test('prefers ~/.local/bin, then /opt/homebrew, then /usr/local', () => {
    expect(herdrBin({}, () => true)).toBe(`${home}/.local/bin/herdr`);
    expect(herdrBin({}, (p) => p !== `${home}/.local/bin/herdr`)).toBe('/opt/homebrew/bin/herdr');
    expect(herdrBin({}, (p) => p === '/usr/local/bin/herdr')).toBe('/usr/local/bin/herdr');
  });

  test('falls back to ~/.local/bin when none exists', () => {
    expect(herdrBin({}, () => false)).toBe(`${home}/.local/bin/herdr`);
  });
});

describe('ensureHerdr', () => {
  test('running and started pass', async () => {
    await ensureHerdr(running);
    await ensureHerdr(async () => ({ ok: true, data: { state: 'started' } }));
  });
});
