import { describe, test, expect } from 'bun:test';
import {
  actionPrompt,
  buildPaneCommand,
  findWorkspaceIdByLabel,
  launchAction,
  launchInWorkspace,
  parseTabCreate,
  parseTabList,
  parseWorkspaceCreate,
  statusBinPath,
  tabLabel,
  type ActionLaunchIo,
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

describe('launchAction', () => {
  const BASE = {
    action: 'sync' as const,
    repoPath: '/repo',
    runDir: '/repo-slot',
    stack: 'mystack',
    statePath: '/state/job.json',
    workspaceLabel: 'gitq',
    tabLabel: 'gitq:mystack sync',
  };
  const RECORD = {
    id: 'agent-1', repo: 'remote:host/repo', cwd: '/repo-slot', provider: 'codex', surface: 'herdr' as const,
    sessionId: 'thread-1', tabId: 'tab7', workspaceId: 'ws7', paneId: 'pane7', createdAt: 1,
  };
  function fakes(over: Partial<ActionLaunchIo> = {}) {
    const starts: Parameters<ActionLaunchIo['agentStart']>[0][] = [];
    const herdrCommands: string[] = [];
    const io: ActionLaunchIo = {
      agentStart: async (payload) => {
        starts.push(payload);
        return { ok: true, data: { ...RECORD, provider: payload.provider ?? 'claude' } };
      },
      herdrLaunch: async (opts) => {
        herdrCommands.push(opts.paneCommand);
        throw new Error('a harness launch must not run a pane command');
      },
      codexSkillsDir: () => '/codex-home/skills',
      exists: (p) => p === '/codex-home/skills/gitq:sync/SKILL.md',
      rtRepo: () => 'remote:host/repo',
      ...over,
    };
    return { io, starts, herdrCommands };
  }

  test('gitq action uses configured harness', async () => {
    const { io, starts, herdrCommands } = fakes();
    const launched = await launchAction({ ...BASE, harness: 'codex' }, io);
    expect(starts).toHaveLength(1);
    const launch = starts[0]!;
    expect(launch.provider).toBe('codex');
    expect(launch).toMatchObject({ repo: 'remote:host/repo', cwd: '/repo-slot', surface: 'herdr', workspace: 'gitq', tab: 'gitq:mystack sync' });
    expect(launch.prompt).toBe(
      `Use the gitq:sync skill at /codex-home/skills/gitq:sync/SKILL.md with these arguments: /repo-slot mystack --state /state/job.json --status-bin ${statusBinPath()}`,
    );
    expect(launch.prompt).not.toContain('claude');
    expect(herdrCommands).toEqual([]);
    expect(launched).toEqual({
      tabId: 'tab7', workspaceId: 'ws7', focusedExisting: false,
      launch: { harness: 'codex', agentId: 'agent-1', sessionId: 'thread-1' },
    });
  });

  test('Claude under the switch launches through rt with the slash prompt', async () => {
    const { io, starts, herdrCommands } = fakes();
    const launched = await launchAction({ ...BASE, harness: 'claude' }, io);
    expect(starts[0]!.provider).toBe('claude');
    expect(starts[0]!.prompt).toBe(actionPrompt('sync', '/repo-slot', 'mystack', '/state/job.json'));
    expect(herdrCommands).toEqual([]);
    expect(launched.launch).toEqual({ harness: 'claude', agentId: 'agent-1', sessionId: 'thread-1' });
  });

  test('switch off runs the same herdr pane command as before and never calls rt', async () => {
    const seen: unknown[] = [];
    const { io, starts } = fakes({
      herdrLaunch: async (opts) => {
        seen.push(opts);
        return { tabId: 't', workspaceId: 'w', focusedExisting: false };
      },
      rtRepo: () => {
        throw new Error('switch off must not resolve an rt repo');
      },
    });
    const launched = await launchAction({ ...BASE, harness: undefined }, io);
    expect(seen).toEqual([
      {
        workspaceLabel: 'gitq',
        tabLabel: 'gitq:mystack sync',
        paneCommand: buildPaneCommand('/repo-slot', actionPrompt('sync', '/repo-slot', 'mystack', '/state/job.json')),
      },
    ]);
    expect(starts).toEqual([]);
    expect(launched).toEqual({ tabId: 't', workspaceId: 'w', focusedExisting: false });
  });

  test('a Codex launch refuses when the gitq skill is not installed for Codex', async () => {
    const { io, starts } = fakes({ exists: () => false });
    await expect(launchAction({ ...BASE, harness: 'codex' }, io)).rejects.toThrow(
      'The gitq:sync skill is not installed for Codex, so gitq cannot start it there.',
    );
    expect(starts).toEqual([]);
  });

  test('a harness gitq has no skills for refuses', async () => {
    const { io, starts } = fakes();
    await expect(launchAction({ ...BASE, harness: 'pilot' }, io)).rejects.toThrow('gitq has no skills for pilot');
    expect(starts).toEqual([]);
  });

  test('a repo rt does not know refuses before launching', async () => {
    const { io, starts } = fakes({ rtRepo: () => null });
    await expect(launchAction({ ...BASE, harness: 'codex' }, io)).rejects.toThrow('rt does not know /repo');
    expect(starts).toEqual([]);
  });

  test('an already open tab is focused, with no session to bind', async () => {
    const { io } = fakes({ agentStart: async () => ({ ok: false, error: 'tab gitq:mystack sync already open; focused it' }) });
    expect(await launchAction({ ...BASE, harness: 'codex' }, io)).toEqual({ tabId: '', workspaceId: '', focusedExisting: true });
  });

  test("a refused launch surfaces rt's reason", async () => {
    const { io } = fakes({ agentStart: async () => ({ ok: false, error: 'codex is not ready' }) });
    await expect(launchAction({ ...BASE, harness: 'codex' }, io)).rejects.toThrow('codex is not ready');
  });
});
