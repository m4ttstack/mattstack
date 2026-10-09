import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatMark: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatPost: vi.fn(),
  chatArchive: vi.fn(),
  chatDmOpen: vi.fn(),
  chatInvite: vi.fn(),
  paneList: vi.fn(),
  panePeek: vi.fn(),
  paneFocus: vi.fn(),
  paneSpawn: vi.fn(),
  paneAccounts: vi.fn(),
  paneDirectories: vi.fn(),
  daemonHealth: vi.fn(),
  agentIntegrations: vi.fn(),
  getSetting: vi.fn(),
}));
const rt = await import('@mattstack/rt-client');
const { routes } = await import('./routes');

type Summary = Awaited<
  ReturnType<typeof rt.agentIntegrations>
>['data'] extends infer D
  ? D extends { integrations: Array<infer S> }
    ? S
    : never
  : never;

const CLAUDE: Summary = {
  id: 'claude',
  label: 'Claude Code',
  enabled: true,
  readiness: { ready: true },
  capabilities: ['launch'],
  options: [
    { name: 'model', kind: 'text' },
    { name: 'effort', kind: 'text' },
    { name: 'account', kind: 'text' },
    { name: 'yolo', kind: 'boolean' },
  ],
};
const CODEX: Summary = {
  id: 'codex',
  label: 'Codex',
  enabled: true,
  readiness: {
    ready: false,
    reason: 'rt has no connection to the Codex app server yet',
  },
  capabilities: ['launch'],
  options: [
    { name: 'model', kind: 'text' },
    { name: 'effort', kind: 'text' },
  ],
};
const THIRD: Summary = {
  id: 'pilot',
  label: 'Pilot',
  enabled: true,
  readiness: { ready: true },
  capabilities: ['launch'],
  options: [{ name: 'model', kind: 'choice', choices: ['p-1', 'p-2'] }],
};
const OFF: Summary = {
  id: 'dormant',
  label: 'Dormant',
  enabled: false,
  readiness: { ready: true },
  capabilities: ['launch'],
  options: [],
};

const PANE = {
  paneId: 'w1:p1',
  workspace: 'chat',
  agentStatus: 'idle' as const,
};

function settings(values: Record<string, unknown>) {
  vi.mocked(rt.getSetting).mockImplementation(((key: string) => ({
    value: values[key],
  })) as typeof rt.getSetting);
}

function metadata(integrations: Summary[]) {
  vi.mocked(rt.agentIntegrations).mockResolvedValue({
    ok: true,
    data: { integrations },
  });
}

function post(body: Record<string, unknown>) {
  return routes.request('/api/panes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.resetAllMocks());

test('switch off: no harness list, no daemon read, and a spawn carries no provider', async () => {
  settings({ 'agent.integrations.enabled': false });
  const res = await routes.request('/api/panes/harnesses');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ enabled: false });
  expect(rt.agentIntegrations).not.toHaveBeenCalled();

  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: true,
    data: { pane: PANE, ready: true },
  });
  await post({ cwd: '/r/x', provider: 'codex', model: 'm' });
  expect(rt.paneSpawn).toHaveBeenCalledWith(
    {
      cwd: '/r/x',
      account: undefined,
      model: 'm',
      effort: undefined,
      prompt: undefined,
      workspace: undefined,
    },
    expect.anything()
  );
});

test('switch on: lists every enabled harness in registry order, a fixture third one included, with the configured default', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'codex' });
  metadata([CLAUDE, CODEX, THIRD, OFF]);
  const res = await routes.request('/api/panes/harnesses');
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    enabled: boolean;
    harnesses: Array<{ id: string; ready: boolean; reason?: string }>;
    defaultHarness: string;
  };
  expect(body.enabled).toBe(true);
  expect(body.harnesses.map(h => h.id)).toEqual(['claude', 'codex', 'pilot']);
  expect(body.harnesses[1]).toMatchObject({
    ready: false,
    reason: 'rt has no connection to the Codex app server yet',
  });
  expect(body.defaultHarness).toBe('codex');
  expect(rt.agentIntegrations).toHaveBeenCalledWith(
    { mode: 'herdr' },
    expect.anything()
  );
});

test('switch on: the default falls back to the first enabled harness when agent.provider is not one', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'dormant' });
  metadata([OFF, CODEX, CLAUDE]);
  const body = (await (
    await routes.request('/api/panes/harnesses')
  ).json()) as { defaultHarness: string };
  expect(body.defaultHarness).toBe('codex');
});

test('switch on: an unreadable registry is a 502, never a guessed list', async () => {
  settings({ 'agent.integrations.enabled': true });
  vi.mocked(rt.agentIntegrations).mockResolvedValue({
    ok: false,
    error: 'rt daemon unreachable',
  });
  const res = await routes.request('/api/panes/harnesses');
  expect(res.status).toBe(502);
});

test('switch on: an explicit choice is spawned as that harness, even when it reads not ready', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'claude' });
  metadata([CLAUDE, CODEX]);
  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: true,
    data: { pane: { ...PANE, provider: 'codex' }, ready: true },
  });
  const res = await post({ cwd: '/r/x', provider: 'codex', model: 'gpt-5' });
  expect(res.status).toBe(200);
  expect(rt.paneSpawn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(rt.paneSpawn).mock.calls[0]![0]).toMatchObject({
    cwd: '/r/x',
    provider: 'codex',
    model: 'gpt-5',
  });
});

test('switch on: a harness that stopped being ready is refused in its own words, and no other harness is tried', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'claude' });
  metadata([CLAUDE, CODEX]);
  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: false,
    error:
      'Codex is not installed: there is no codex on PATH or in ~/.local/bin',
  });
  const res = await post({ cwd: '/r/x', provider: 'codex' });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({
    error:
      'Codex is not installed: there is no codex on PATH or in ~/.local/bin',
  });
  expect(rt.paneSpawn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(rt.paneSpawn).mock.calls[0]![0].provider).toBe('codex');
});

test('switch on: a harness turned off since the form loaded is refused, not swapped for another', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'claude' });
  metadata([CLAUDE, { ...CODEX, enabled: false }]);
  const res = await post({ cwd: '/r/x', provider: 'codex' });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: string }).error).toBe(
    'Codex is turned off, so Chat did not start it. Turn it on in setup, or pick another agent.'
  );
  expect(rt.paneSpawn).not.toHaveBeenCalled();
});

test('switch on: Codex is never given an account, since it offers no account option', async () => {
  settings({ 'agent.integrations.enabled': true });
  metadata([CLAUDE, CODEX]);
  const res = await post({ cwd: '/r/x', provider: 'codex', account: 'Acme' });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe(
    'Codex does not take an account, so Chat did not start it.'
  );
  expect(rt.paneSpawn).not.toHaveBeenCalled();
});

test('switch on: a spawn that names no harness takes the default the picker would have shown', async () => {
  settings({ 'agent.integrations.enabled': true, 'agent.provider': 'pilot' });
  metadata([CLAUDE, THIRD]);
  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: true,
    data: { pane: PANE, ready: true },
  });
  await post({ cwd: '/r/x', model: 'p-2' });
  expect(vi.mocked(rt.paneSpawn).mock.calls[0]![0]).toMatchObject({
    provider: 'pilot',
    model: 'p-2',
  });
});

test('switch on: an unknown harness is refused', async () => {
  settings({ 'agent.integrations.enabled': true });
  metadata([CLAUDE]);
  const res = await post({ cwd: '/r/x', provider: 'nope' });
  expect(res.status).toBe(400);
  expect(rt.paneSpawn).not.toHaveBeenCalled();
});
