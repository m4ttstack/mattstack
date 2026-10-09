import { expect, test } from 'bun:test';

import fixture from '../../test/fixture/status.json' with { type: 'json' };
import {
  addPayload,
  autoBanner,
  behindRows,
  commandButtonLabel,
  commandKey,
  commandStuckToast,
  commandToast,
  editPatch,
  HEAL_RECENT_MS,
  isPlatform,
  isRowRestarting,
  localHosts,
  NAME_PATTERN,
  PROXY_WAIT_MS,
  reconcileRestarting,
  redeployAllTargets,
  redeployingText,
  REFRESH_MS,
  registerOutcome,
  remoteToggleTip,
  removeFailure,
  RESTART_SETTLE_MS,
  RESTART_TIMEOUT_MS,
  restartingFromCommand,
  sections,
  settingsBlocks,
  settingsFormFor,
  showDevLinkPrompt,
  showUnlinkButton,
  showVersionColumn,
  statusPill,
  subline,
  sublineHealthy,
  tunnelDomain,
  tunnels,
  updateStripText,
  versionCell,
  type CommandRuns,
  type RestartingMap,
  type Row,
  type SettingsBlocks,
  type StatusData,
} from './logic.ts';

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    name: 'app',
    displayTld: 'localhost',
    port: 3000,
    url: 'http://app.localhost',
    publicUrl: null,
    health: { ok: true, status: 200, ms: 5 },
    service: {
      label: 'com.deck.app',
      short: 'app',
      pid: 111,
      lastExitStatus: null,
      unmanaged: null,
      stderr: [],
    },
    published: true,
    hasPassword: false,
    isTunnel: false,
    override: null,
    publicFollowsOverride: false,
    self: false,
    managedBy: 'deck',
    icon: null,
    issues: [],
    record: { kind: 'service', command: null, workingDirectory: null },
    oauth: { mode: 'off' },
    ...overrides,
  };
}

function makeData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    suffix: 'localhost',
    canRestart: true,
    canManage: true,
    devMode: false,
    up: 2,
    total: 3,
    apps: [],
    orphans: [],
    nextPort: null,
    proxyStale: false,
    autoHeal: null,
    ...overrides,
  };
}

// ---- constants ----

test("constants match the oracle's timings", () => {
  expect(REFRESH_MS).toBe(5000);
  expect(RESTART_TIMEOUT_MS).toBe(30000);
  expect(HEAL_RECENT_MS).toBe(120000);
  expect(PROXY_WAIT_MS).toBe(45000);
});

// ---- subline ----

test('subline: null data reads loading', () => {
  expect(subline(null)).toBe('loading…');
});

test('subline: reports healthy/public/protected, no next-port or auto-refreshes', () => {
  const data = makeData({
    up: 2,
    total: 3,
    nextPort: 11012,
    apps: [
      makeRow({ published: true, hasPassword: false }),
      makeRow({ published: false, hasPassword: true }),
    ],
  });
  expect(subline(data)).toBe('2 of 3 healthy · 1 public · 1 protected');
});

test('subline: protected segment omitted when none are protected', () => {
  const data = makeData({
    up: 1,
    total: 1,
    apps: [makeRow({ published: true, hasPassword: false })],
  });
  expect(subline(data)).toBe('1 of 1 healthy · 1 public');
});

// ---- sublineHealthy ----

test('sublineHealthy: ok tone when every app is healthy', () => {
  const data = makeData({ up: 3, total: 3 });
  expect(sublineHealthy(data)).toEqual({ text: '3 of 3 healthy', ok: true });
});

test('sublineHealthy: bad tone when any app is unhealthy', () => {
  const data = makeData({ up: 3, total: 4 });
  expect(sublineHealthy(data)).toEqual({ text: '3 of 4 healthy', ok: false });
});

// ---- isPlatform ----

test('isPlatform: deck is platform-managed', () => {
  expect(isPlatform('deck')).toBe(true);
});

test('isPlatform: local is platform-managed (pre-rename)', () => {
  expect(isPlatform('local')).toBe(true);
});

test('showDevLinkPrompt: hidden on a public board (canManage false) even for an unlinked row', () => {
  expect(showDevLinkPrompt(makeRow({ devLink: 'unlinked' }), false)).toBe(
    false
  );
  expect(showDevLinkPrompt(makeRow({ devLink: 'broken' }), false)).toBe(false);
});

test("showDevLinkPrompt: shown for unlinked/broken rows when canManage is true, never for the platform's own row", () => {
  expect(showDevLinkPrompt(makeRow({ devLink: 'unlinked' }), true)).toBe(true);
  expect(showDevLinkPrompt(makeRow({ devLink: 'broken' }), true)).toBe(true);
  expect(showDevLinkPrompt(makeRow({ devLink: 'linked' }), true)).toBe(false);
  expect(
    showDevLinkPrompt(makeRow({ devLink: 'unlinked', self: true }), true)
  ).toBe(false);
});

test('showUnlinkButton: hidden on a public board (canManage false) even for a linked row', () => {
  expect(showUnlinkButton(makeRow({ devLink: 'linked' }), false)).toBe(false);
});

test("showUnlinkButton: shown for a linked row when canManage is true, never for the platform's own row", () => {
  expect(showUnlinkButton(makeRow({ devLink: 'linked' }), true)).toBe(true);
  expect(
    showUnlinkButton(makeRow({ devLink: 'linked', self: true }), true)
  ).toBe(false);
  expect(showUnlinkButton(makeRow({ devLink: 'unlinked' }), true)).toBe(false);
});

test('isPlatform: user-managed and undefined are not platform', () => {
  expect(isPlatform('user')).toBe(false);
  expect(isPlatform(undefined)).toBe(false);
});

// ---- tunnelDomain ----

test('tunnelDomain: localhost suffix reads as empty', () => {
  expect(tunnelDomain(makeData({ suffix: 'localhost' }))).toBe('');
});

test('tunnelDomain: public suffix passes through', () => {
  expect(tunnelDomain(makeData({ suffix: 'example.com' }))).toBe('example.com');
});

// ---- sections ----

test("sections: mattstack-managed apps get their own titled section above 'your apps'", () => {
  const mine = makeRow({ name: 'mine', managedBy: 'user' });
  const product = makeRow({ name: 'board', managedBy: 'rt' });
  const out = sections(makeData({ apps: [mine, product] }));
  expect(out[0]).toEqual({
    key: 'mattstack',
    title: 'mattstack',
    rows: [product],
  });
  expect(out[1]).toEqual({ key: 'apps', title: 'your apps', rows: [mine] });
});

test('sections: mattstack group sorts the platform (deck) row to the top, rest alphabetical', () => {
  const rows = [
    makeRow({ name: 'gitq', managedBy: 'rt' }),
    makeRow({ name: 'deck', managedBy: 'deck' }),
    makeRow({ name: 'board', managedBy: 'rt' }),
  ];
  const out = sections(makeData({ apps: rows }));
  expect(out[0]!.rows.map(r => r.name)).toEqual(['deck', 'board', 'gitq']);
});

test("sections: with no mattstack apps the list stays a single untitled 'apps' section", () => {
  const mine = makeRow({ name: 'mine', managedBy: 'user' });
  expect(sections(makeData({ apps: [mine] }))).toEqual([
    { key: 'apps', title: null, rows: [mine] },
  ]);
});

test('sections: strays section appears only for non-tunnel orphans', () => {
  const stray = makeRow({ name: 'stray', isTunnel: false });
  const data = makeData({ orphans: [stray] });
  const out = sections(data);
  expect(out).toHaveLength(2);
  expect(out[1]).toEqual({
    key: 'strays',
    title: 'services without routes',
    rows: [stray],
  });
});

test('sections: tunnel-only orphans do not produce a strays section', () => {
  const data = makeData({ orphans: [makeRow({ isTunnel: true })] });
  expect(sections(data)).toHaveLength(1);
});

test('sections: null data yields an empty apps section', () => {
  expect(sections(null)).toEqual([{ key: 'apps', title: null, rows: [] }]);
});

test('sections: devLink passes through onto the row untouched', () => {
  const row = makeRow({ name: 'gitq', devLink: 'linked' });
  const [group] = sections(makeData({ apps: [row] }));
  expect(group!.rows[0]!.devLink).toBe('linked');
});

test('sections: an unlinked row carries no commands', () => {
  const row = makeRow({
    name: 'gitq',
    devLink: 'unlinked',
    commands: undefined,
  });
  const [group] = sections(makeData({ apps: [row] }));
  expect(group!.rows[0]!.commands).toBeUndefined();
});

// ---- tunnels ----

test('tunnels: filters orphans down to isTunnel rows', () => {
  const tunnel = makeRow({ name: 'cf', isTunnel: true });
  const stray = makeRow({ name: 'stray', isTunnel: false });
  expect(tunnels(makeData({ orphans: [tunnel, stray] }))).toEqual([tunnel]);
});

test('tunnels: null data yields empty array', () => {
  expect(tunnels(null)).toEqual([]);
});

// ---- reconcileRestarting ----

test('reconcileRestarting: settles on new pid + healthy, then clears after RESTART_SETTLE_MS', () => {
  const restarting: RestartingMap = { 'com.deck.app': { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [
      makeRow({
        service: {
          label: 'com.deck.app',
          short: 'app',
          pid: 222,
          lastExitStatus: null,
          unmanaged: null,
          stderr: [],
        },
        health: { ok: true, status: 200, ms: 1 },
      }),
    ],
  });
  const settled = reconcileRestarting(restarting, data, 2000);
  expect(settled).toEqual({
    'com.deck.app': { pid: 111, at: 1000, settledAt: 2000 },
  });
  expect(
    reconcileRestarting(settled, data, 2000 + RESTART_SETTLE_MS + 1)
  ).toEqual({});
});

test('reconcileRestarting: cleared past RESTART_TIMEOUT_MS even if unhealthy', () => {
  const restarting: RestartingMap = { 'com.deck.app': { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [
      makeRow({
        service: {
          label: 'com.deck.app',
          short: 'app',
          pid: 111,
          lastExitStatus: null,
          unmanaged: null,
          stderr: [],
        },
        health: { ok: false, status: null, ms: null },
      }),
    ],
  });
  expect(
    reconcileRestarting(restarting, data, 1000 + RESTART_TIMEOUT_MS + 1)
  ).toEqual({});
});

test('reconcileRestarting: kept while same pid or unhealthy, within timeout', () => {
  const restarting: RestartingMap = { 'com.deck.app': { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [
      makeRow({
        service: {
          label: 'com.deck.app',
          short: 'app',
          pid: 111,
          lastExitStatus: null,
          unmanaged: null,
          stderr: [],
        },
        health: { ok: false, status: null, ms: null },
      }),
    ],
  });
  expect(reconcileRestarting(restarting, data, 1500)).toEqual(restarting);
});

test('reconcileRestarting: pure -- input map is not mutated', () => {
  const restarting: RestartingMap = { 'com.deck.app': { pid: 111, at: 1000 } };
  const snapshot = JSON.parse(JSON.stringify(restarting));
  const data = makeData({
    apps: [
      makeRow({
        service: {
          label: 'com.deck.app',
          short: 'app',
          pid: 222,
          lastExitStatus: null,
          unmanaged: null,
          stderr: [],
        },
        health: { ok: true, status: 200, ms: 1 },
      }),
    ],
  });
  reconcileRestarting(restarting, data, 2000);
  expect(restarting).toEqual(snapshot);
});

// ---- autoBanner ----

test('autoBanner: heal in-flight (ok null, recent) reads a restarting bad notice', () => {
  const data = makeData({ autoHeal: { at: 1000, ok: null } });
  const notice = autoBanner(data, 1000 + HEAL_RECENT_MS - 1);
  expect(notice?.kind).toBe('bad');
  expect(notice?.message).toContain('Restarting the proxy automatically');
});

test('autoBanner: proxyStale reads a bad notice mentioning reload proxy', () => {
  const data = makeData({ proxyStale: true });
  const notice = autoBanner(data, 1000);
  expect(notice?.kind).toBe('bad');
  expect(notice?.message).toContain('reload proxy');
});

test('autoBanner: recent successful heal reads an ok notice', () => {
  const data = makeData({ autoHeal: { at: 1000, ok: true } });
  const notice = autoBanner(data, 1000 + HEAL_RECENT_MS - 1);
  expect(notice?.kind).toBe('ok');
  expect(notice?.message).toContain('restarted automatically');
});

test('autoBanner: nothing to report reads null', () => {
  expect(autoBanner(makeData(), 1000)).toBeNull();
});

// ---- addPayload ----

test('addPayload: service app sends name, whitespace-split command, workingDirectory', () => {
  expect(
    addPayload({
      name: 'svc',
      command: '  bun run dev  ',
      workingDirectory: ' /tmp/svc ',
    })
  ).toEqual({
    name: 'svc',
    command: ['bun', 'run', 'dev'],
    workingDirectory: '/tmp/svc',
  });
});

// ---- registerOutcome ----

test('registerOutcome: an ok answer means the manifest registered the app', () => {
  expect(registerOutcome(200, { record: { name: 'x' } })).toEqual({
    kind: 'registered',
  });
});

test('registerOutcome: the missing-manifest 400 asks for the manual form', () => {
  expect(
    registerOutcome(400, { error: 'no mattstack.deck.json in /code/app' })
  ).toEqual({ kind: 'no-manifest' });
});

test("registerOutcome: any other 400 carries the route's error text", () => {
  expect(
    registerOutcome(400, {
      error: 'manifest must declare commands.start or a port',
    })
  ).toEqual({
    kind: 'error',
    message: 'manifest must declare commands.start or a port',
  });
});

test('registerOutcome: an existing app reads as already registered, by name', () => {
  expect(
    registerOutcome(409, {
      error: 'already registered',
      name: 'forecast',
      dir: '/code/forecast',
    })
  ).toEqual({ kind: 'error', message: 'forecast is already registered' });
});

test('registerOutcome: a conflict names the port or app it is about', () => {
  expect(registerOutcome(409, { error: 'port in use', port: 4321 })).toEqual({
    kind: 'error',
    message: 'port in use: 4321',
  });
  expect(registerOutcome(409, { error: 'name taken', name: 'x' })).toEqual({
    kind: 'error',
    message: 'name taken: x',
  });
  expect(
    registerOutcome(400, { error: 'directory not found', dir: '/nope' })
  ).toEqual({ kind: 'error', message: 'directory not found: /nope' });
});

// ---- removeFailure ----

test('removeFailure: an ok answer removed the app, nothing to say', () => {
  expect(removeFailure('gitq', 200, { ok: true })).toBeNull();
});

test('removeFailure: a refusal carries the API message verbatim, escape hatch included', () => {
  expect(
    removeFailure('board', 409, {
      error: 'managed',
      message:
        'Managed by mattstack: remove it anyway with `deck remove board --force`',
    })
  ).toBe(
    'Managed by mattstack: remove it anyway with `deck remove board --force`'
  );
  expect(removeFailure('ghost', 404, { error: 'unknown app' })).toBe(
    'unknown app'
  );
  expect(removeFailure('ghost', 500, {})).toBe('remove failed (500)');
});

test('removeFailure: a 200 that says ok:false is a failure, named by its error', () => {
  expect(
    removeFailure('gitq', 200, {
      ok: false,
      error: "Error: EACCES: permission denied, open 'routes.json'",
    })
  ).toBe(
    "removing gitq failed: Error: EACCES: permission denied, open 'routes.json'"
  );
});

test("removeFailure: an ok:false record answer names this teardown's issues", () => {
  expect(
    removeFailure('myapp', 200, {
      ok: false,
      issues: [
        { message: 'bootout failed' },
        { message: 'alias removal failed' },
      ],
    })
  ).toBe('removing myapp failed: bootout failed; alias removal failed');
  expect(removeFailure('myapp', 200, { ok: false })).toBe(
    'removing myapp failed.'
  );
});

test('NAME_PATTERN compiles under the v flag browsers use for pattern', () => {
  const re = new RegExp(`^(?:${NAME_PATTERN})$`, 'v');
  expect(re.test('my-app.2')).toBe(true);
  expect(re.test('My App')).toBe(false);
});

test('registerOutcome: a failure with no error text names the status', () => {
  expect(registerOutcome(500, {})).toEqual({
    kind: 'error',
    message: 'failed (500)',
  });
});

// ---- editPatch ----

test('editPatch: service kind adds command array and workingDirectory, port becomes numeric', () => {
  expect(
    editPatch({
      name: 'svc',
      port: '4200',
      kind: 'service',
      command: 'bun run dev',
      workingDirectory: '/tmp/svc',
    })
  ).toEqual({
    name: 'svc',
    port: 4200,
    command: ['bun', 'run', 'dev'],
    workingDirectory: '/tmp/svc',
  });
});

test('editPatch: external kind omits command and workingDirectory', () => {
  expect(
    editPatch({
      name: 'ext',
      port: '4300',
      kind: 'external',
      command: '',
      workingDirectory: '',
    })
  ).toEqual({ name: 'ext', port: 4300 });
});

// ---- command runs ----

test("commandKey: one app's command never collides with another's", () => {
  expect(commandKey('deck', 'deploy')).not.toBe(commandKey('deck deploy', ''));
  expect(commandKey('app', 'build')).toBe(commandKey('app', 'build'));
});

test('commandButtonLabel: idle is the bare command, running trails it, restarting replaces it', () => {
  expect(commandButtonLabel('deploy', undefined)).toBe('deploy');
  expect(commandButtonLabel('deploy', 'running')).toBe('deploy…');
  expect(commandButtonLabel('deploy', 'restarting')).toBe('restarting…');
});

test('commandToast: exit 0 stays quiet about logs, a failure carries the exit code and the log verb', () => {
  expect(commandToast('myapp', 'build', 0)).toBe('build finished.');
  expect(commandToast('myapp', 'build', 1)).toBe(
    'build failed (exit 1) · deck logs myapp'
  );
});

test('commandStuckToast: names the app to look at rather than claiming an outcome', () => {
  expect(commandStuckToast('myapp', 'deploy')).toBe(
    'deploy is still running after 10 minutes · deck logs myapp'
  );
});

test('versionCell: behind when newCode is set', () => {
  const row = {
    name: 'a',
    devLink: 'linked',
    newCode: { deployed: 'a3f19c2', head: 'e81d4b0' },
  } as Row;
  expect(versionCell(row)).toEqual({
    kind: 'behind',
    deployed: 'a3f19c2',
    head: 'e81d4b0',
  });
});
test('versionCell: current when linked with no newCode', () => {
  expect(versionCell({ name: 'a', devLink: 'linked' } as Row)).toEqual({
    kind: 'current',
  });
});
test('versionCell: untracked for unlinked, broken, undefined devLink', () => {
  for (const devLink of ['unlinked', 'broken', undefined])
    expect(versionCell({ name: 'a', devLink } as Row)).toEqual({
      kind: 'untracked',
    });
});
test('showVersionColumn follows data.devMode', () => {
  expect(showVersionColumn({ devMode: true } as StatusData)).toBe(true);
  expect(showVersionColumn({ devMode: false } as StatusData)).toBe(false);
  expect(showVersionColumn({} as StatusData)).toBe(false);
});
test('behindRows: newCode and a deploy command, off rows excluded', () => {
  const nc = { deployed: 'x', head: 'y' };
  const rows = [
    { name: 'a', newCode: nc, commands: ['build', 'deploy'] },
    { name: 'b', newCode: nc, commands: ['build'] },
    { name: 'c', commands: ['deploy'] },
    { name: 'd', newCode: nc, commands: ['deploy'], enabled: false },
  ] as Row[];
  expect(behindRows(rows).map(r => r.name)).toEqual(['a']);
});
test('updateStripText', () => {
  expect(updateStripText(1)).toBe('New code for 1 app since its last deploy');
  expect(updateStripText(5)).toBe(
    'New code for 5 apps since their last deploy'
  );
});
test('redeployingText', () => {
  expect(redeployingText({ index: 2, total: 3, app: 'meridian' })).toBe(
    'Redeploying 2 of 3 · meridian'
  );
});
test('redeployAllTargets: table order, self last, in-flight skipped', () => {
  const nc = { deployed: 'x', head: 'y' };
  const rows = [
    { name: 'deck', self: true, newCode: nc, commands: ['deploy'] },
    { name: 'board', newCode: nc, commands: ['build', 'deploy'] },
    { name: 'chat', newCode: nc, commands: ['deploy'] },
    { name: 'console', newCode: nc, commands: ['deploy'] },
  ] as Row[];
  const runs = { [commandKey('chat', 'deploy')]: 'running' } as CommandRuns;
  expect(redeployAllTargets(rows, runs).map(r => r.name)).toEqual([
    'board',
    'console',
    'deck',
  ]);
});

const baseRow = (o: Partial<Row> = {}) =>
  ({
    name: 'x',
    port: 11001,
    isTunnel: false,
    self: false,
    managedBy: 'mattstack',
    override: null,
    service: { label: 'l', short: 'x', pid: 1, lastExitStatus: 0 },
    ...o,
  }) as unknown as Row;
const baseData = (o: Partial<StatusData> = {}) =>
  ({ canManage: true, canRestart: true, ...o }) as StatusData;
const NONE: SettingsBlocks = {
  code: false,
  app: false,
  port: false,
  portInput: false,
  overrideControls: false,
  errors: false,
  reach: false,
  gates: false,
  remove: false,
  giveRoute: false,
  restart: false,
  relink: false,
};

test('settingsFormFor: tunnel, service (no port), app', () => {
  expect(settingsFormFor(baseRow({ isTunnel: true, port: null }))).toBe(
    'tunnel'
  );
  expect(settingsFormFor(baseRow({ port: null }))).toBe('service');
  expect(settingsFormFor(baseRow())).toBe('app');
});

test('settingsBlocks app: code needs managed, not self, devLink defined (RootScreen.tsx:311)', () => {
  const d = baseData();
  const linked = baseRow({ devLink: 'linked' });
  expect(settingsBlocks(linked, d).code).toBe(true);
  expect(settingsBlocks(baseRow(), d).code).toBe(false);
  expect(settingsBlocks({ ...linked, self: true }, d).code).toBe(false);
  expect(settingsBlocks({ ...linked, managedBy: 'user' }, d).code).toBe(false);
});

test('settingsBlocks app: relink is code and canManage (showDevLinkPrompt, logic.ts:132)', () => {
  const r = baseRow({ devLink: 'linked' });
  expect(settingsBlocks(r, baseData()).relink).toBe(true);
  expect(settingsBlocks(r, baseData({ canManage: false })).relink).toBe(false);
});

test('settingsBlocks app: app block is user rows under canManage, even when off (RootScreen.tsx:329)', () => {
  const u = baseRow({ managedBy: 'user', enabled: false });
  expect(settingsBlocks(u, baseData()).app).toBe(true);
  expect(settingsBlocks(baseRow(), baseData()).app).toBe(false);
  expect(settingsBlocks(u, baseData({ canManage: false })).app).toBe(false);
});

test('settingsBlocks app: port input vs override controls (DevPortScreen.tsx:24,151)', () => {
  const d = baseData();
  const ov = { devPort: 3000, basePort: 11001 };
  const plain = settingsBlocks(baseRow(), d);
  expect(plain.port).toBe(true);
  expect(plain.portInput).toBe(true);
  expect(plain.overrideControls).toBe(false);
  const over = settingsBlocks(baseRow({ override: ov }), d);
  expect(over.portInput).toBe(false);
  expect(over.overrideControls).toBe(true);
  const self = settingsBlocks(baseRow({ override: ov, self: true }), d);
  expect(self.portInput).toBe(false);
  expect(self.overrideControls).toBe(false);
});

test('settingsBlocks app: errors always, reach needs canManage and on, gates canManage (RootScreen.tsx:240,298)', () => {
  const d = baseData();
  const off = baseRow({ enabled: false });
  expect(settingsBlocks(baseRow(), d).errors).toBe(true);
  expect(settingsBlocks(baseRow(), d).reach).toBe(true);
  expect(settingsBlocks(off, d).reach).toBe(false);
  expect(settingsBlocks(off, d).gates).toBe(true);
  expect(settingsBlocks(baseRow(), baseData({ canManage: false })).gates).toBe(
    false
  );
});

test('settingsBlocks app: remove needs canManage and not self (RootScreen.tsx:371)', () => {
  expect(settingsBlocks(baseRow(), baseData()).remove).toBe(true);
  expect(settingsBlocks(baseRow({ self: true }), baseData()).remove).toBe(
    false
  );
});

test('settingsBlocks app: restart needs on, canRestart and a service; giveRoute false (RootScreen.tsx:331)', () => {
  const d = baseData();
  expect(settingsBlocks(baseRow(), d).restart).toBe(true);
  expect(settingsBlocks(baseRow({ enabled: false }), d).restart).toBe(false);
  expect(
    settingsBlocks(baseRow({ service: undefined } as Partial<Row>), d).restart
  ).toBe(false);
  expect(
    settingsBlocks(baseRow(), baseData({ canRestart: false })).restart
  ).toBe(false);
  expect(settingsBlocks(baseRow(), d).giveRoute).toBe(false);
});

test('settingsBlocks service form: errors, restart, giveRoute only', () => {
  const r = baseRow({ port: null });
  expect(settingsBlocks(r, baseData())).toEqual({
    ...NONE,
    errors: true,
    restart: true,
    giveRoute: true,
  });
  expect(
    settingsBlocks(r, baseData({ canManage: false, canRestart: false }))
  ).toEqual({ ...NONE, errors: true });
});

test('settingsBlocks tunnel form: errors and restart only', () => {
  const r = baseRow({ isTunnel: true, port: null });
  expect(settingsBlocks(r, baseData())).toEqual({
    ...NONE,
    errors: true,
    restart: true,
  });
});

test('settingsBlocks over the status fixture rows', () => {
  const d = fixture as unknown as StatusData;
  const by = (n: string) =>
    settingsBlocks(
      d.apps.find(a => a.name === n)!,
      d
    );
  const app: SettingsBlocks = {
    ...NONE,
    port: true,
    errors: true,
    reach: true,
    gates: true,
    restart: true,
  };
  const managed = {
    ...app,
    code: true,
    relink: true,
    portInput: true,
    remove: true,
  };
  expect(by('atlas')).toEqual(managed);
  expect(by('forecast')).toEqual(app);
  expect(by('ledger')).toEqual(managed);
  expect(by('orbit')).toEqual({
    ...app,
    app: true,
    overrideControls: true,
    remove: true,
  });
  expect(d.orphans.map(o => settingsFormFor(o))).toEqual(['tunnel', 'service']);
});

test('settingsBlocks canManage false hides every write control', () => {
  const d = { ...(fixture as unknown as StatusData), canManage: false };
  for (const row of [...d.apps, ...d.orphans]) {
    const b = settingsBlocks(row, d);
    for (const k of [
      'relink',
      'app',
      'portInput',
      'overrideControls',
      'reach',
      'gates',
      'remove',
      'giveRoute',
    ] as const)
      expect(b[k]).toBe(false);
  }
});

const pillRow = (o: Partial<Row> = {}) =>
  makeRow({ managedBy: 'mattstack', ...o });
const svc = (o: Partial<NonNullable<Row['service']>> = {}) => ({
  label: 'com.deck.app',
  short: 'app',
  pid: 111,
  lastExitStatus: null,
  unmanaged: null,
  stderr: [],
  ...o,
});

test('statusPill: an off row reads Off in the muted tone, before restarting or health', () => {
  const off = pillRow({
    enabled: false,
    health: { ok: false, status: null, ms: null },
  });
  expect(statusPill(off, false)).toEqual({
    tone: 'muted',
    label: 'Off',
    detail: '',
  });
  expect(statusPill(off, true)).toEqual({
    tone: 'muted',
    label: 'Off',
    detail: '',
  });
});

test('statusPill: restarting reads Restarting… in the warn tone', () => {
  expect(statusPill(pillRow(), true)).toEqual({
    tone: 'warn',
    label: 'Restarting…',
    detail: '',
  });
});

test('statusPill: a healthy probe reads Healthy with status, ms and pid', () => {
  const row = pillRow({
    health: { ok: true, status: 200, ms: 34 },
    service: svc({ pid: 5123 }),
  });
  expect(statusPill(row, false)).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: '200 · 34ms · pid 5123',
  });
});

test("statusPill: the pid is the unmanaged process's when a route is served unmanaged", () => {
  const row = pillRow({
    service: svc({ pid: null, unmanaged: { pid: 777, command: 'vite' } }),
  });
  expect(statusPill(row, false).detail).toBe('200 · 5ms · pid 777');
});

test('statusPill: a failing probe with a status reads Down with that status', () => {
  const row = pillRow({ health: { ok: false, status: 502, ms: 12 } });
  expect(statusPill(row, false)).toEqual({
    tone: 'bad',
    label: 'Down',
    detail: '502 · 12ms · pid 111',
  });
});

test('statusPill: no answer reads Down, unreachable, with the exit code', () => {
  const row = pillRow({
    health: { ok: false, status: null, ms: null },
    service: svc({ pid: null, lastExitStatus: 1 }),
  });
  expect(statusPill(row, false)).toEqual({
    tone: 'bad',
    label: 'Down',
    detail: 'unreachable · exit 1',
  });
});

test('statusPill: no probe falls back to the service: running is Healthy, stopped is Down', () => {
  expect(statusPill(pillRow({ health: null }), false)).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: 'running · pid 111',
  });
  expect(
    statusPill(
      pillRow({ health: null, service: svc({ pid: null, lastExitStatus: 3 }) }),
      false
    )
  ).toEqual({ tone: 'bad', label: 'Down', detail: 'stopped · exit 3' });
  expect(
    statusPill(pillRow({ health: null, service: svc({ pid: null }) }), false)
  ).toEqual({ tone: 'bad', label: 'Down', detail: 'stopped' });
});

test('statusPill: a row with no port reads No route, toned by its service', () => {
  expect(
    statusPill(
      pillRow({
        port: null,
        health: null,
        service: svc({ pid: null, lastExitStatus: 1 }),
      }),
      false
    )
  ).toEqual({ tone: 'bad', label: 'No route', detail: 'stopped · exit 1' });
  expect(statusPill(pillRow({ port: null, health: null }), false)).toEqual({
    tone: 'ok',
    label: 'No route',
    detail: 'running · pid 111',
  });
  expect(
    statusPill(pillRow({ port: null, health: null, service: null }), false)
  ).toEqual({ tone: 'bad', label: 'No route', detail: '' });
});

const tunnelRow = (o: Partial<Row> = {}) =>
  pillRow({ isTunnel: true, port: null, managedBy: null, ...o });

test('statusPill tunnel: the edge health tone and detail, then the pid and hint', () => {
  expect(
    statusPill(
      tunnelRow({
        health: {
          ok: true,
          status: null,
          ms: null,
          tone: 'ok',
          detail: '4 connections',
        },
      }),
      false
    )
  ).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: '4 connections · pid 111',
  });
  expect(
    statusPill(
      tunnelRow({
        health: {
          ok: false,
          status: null,
          ms: null,
          tone: 'warn',
          detail: 'not connected to Cloudflare',
        },
      }),
      false
    )
  ).toEqual({
    tone: 'warn',
    label: 'Down',
    detail: 'not connected to Cloudflare · pid 111',
  });
  expect(
    statusPill(
      tunnelRow({
        health: {
          ok: false,
          status: null,
          ms: null,
          tone: 'bad',
          detail: 'tunnel missing at Cloudflare',
          hint: 're-run deck domain example.dev',
        },
        service: svc({ pid: null, lastExitStatus: 1 }),
      }),
      false
    )
  ).toEqual({
    tone: 'bad',
    label: 'Down',
    detail:
      'tunnel missing at Cloudflare · exit 1 · re-run deck domain example.dev',
  });
});

test('statusPill tunnel: with no edge health the pid alone decides', () => {
  expect(statusPill(tunnelRow({ health: null }), false)).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: 'pid 111',
  });
  expect(
    statusPill(
      tunnelRow({
        health: null,
        service: svc({ pid: null, lastExitStatus: 1 }),
      }),
      false
    )
  ).toEqual({ tone: 'bad', label: 'Down', detail: 'exit 1' });
});

test('statusPill tunnel: restarting reads Restarting…', () => {
  expect(statusPill(tunnelRow(), true)).toEqual({
    tone: 'warn',
    label: 'Restarting…',
    detail: '',
  });
});

test('statusPill on the fixture rows', () => {
  const d = fixture as unknown as StatusData;
  const by = (n: string) =>
    statusPill(
      [...d.apps, ...d.orphans].find(r => r.name === n)!,
      false
    );
  expect(by('atlas')).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: '200 · 34ms · pid 5123',
  });
  expect(by('ledger')).toEqual({
    tone: 'bad',
    label: 'Down',
    detail: 'unreachable · exit 1',
  });
  expect(by('cloudflared')).toEqual({
    tone: 'ok',
    label: 'Healthy',
    detail: '4 connections · pid 4200',
  });
  expect(by('stray-agent')).toEqual({
    tone: 'bad',
    label: 'No route',
    detail: 'stopped · exit 1',
  });
});

test('localHosts: a mattstack row answers on .mattstack and .localhost, a user row on .localhost', () => {
  expect(localHosts(makeRow({ name: 'board', managedBy: 'rt' }))).toEqual([
    'board.mattstack',
    'board.localhost',
  ]);
  expect(localHosts(makeRow({ name: 'mine', managedBy: 'user' }))).toEqual([
    'mine.localhost',
  ]);
  expect(localHosts(makeRow({ name: 'stray', managedBy: null }))).toEqual([
    'stray.localhost',
  ]);
});

test('remoteToggleTip: only a password-only row that is not yet remote is refused', () => {
  const tip = 'Add Google sign-in first';
  expect(remoteToggleTip(makeRow({ hasPassword: true }))).toBe(tip);
  expect(remoteToggleTip(makeRow({ hasPassword: false }))).toBeUndefined();
  expect(
    remoteToggleTip(
      makeRow({
        hasPassword: true,
        oauth: { mode: 'domains', domains: ['x.co'] },
      })
    )
  ).toBeUndefined();
  expect(
    remoteToggleTip(
      makeRow({
        hasPassword: true,
        remote: { status: 'live' } as Row['remote'],
      })
    )
  ).toBeUndefined();
});

// ---- restartingFromCommand ----

const appSvc = svc({ label: 'com.deck.app', pid: 222 });

test('restartingFromCommand: an unreachable row with a command running reads restarting', () => {
  const row = makeRow({
    name: 'app',
    service: appSvc,
    health: { ok: false, status: null, ms: 0 },
  });
  expect(
    restartingFromCommand(row, { [commandKey('app', 'deploy')]: 'running' })
  ).toBe(true);
});

test("restartingFromCommand: no run, an HTTP answer, or another app's run leaves it alone", () => {
  const down = makeRow({
    name: 'app',
    service: appSvc,
    health: { ok: false, status: null, ms: 0 },
  });
  const erroring = makeRow({
    name: 'app',
    service: appSvc,
    health: { ok: false, status: 500, ms: 3 },
  });
  expect(restartingFromCommand(down, {})).toBe(false);
  expect(
    restartingFromCommand(erroring, {
      [commandKey('app', 'deploy')]: 'running',
    })
  ).toBe(false);
  expect(
    restartingFromCommand(down, { [commandKey('app2', 'deploy')]: 'running' })
  ).toBe(false);
});

test('reconcileRestarting: a null pid (set after a command) clears on any healthy pid', () => {
  const restarting: RestartingMap = { 'com.deck.app': { pid: null, at: 1000 } };
  const up = makeData({
    apps: [
      makeRow({ service: appSvc, health: { ok: true, status: 200, ms: 1 } }),
    ],
  });
  const down = makeData({
    apps: [
      makeRow({ service: appSvc, health: { ok: false, status: null, ms: 0 } }),
    ],
  });
  expect(reconcileRestarting(restarting, up, 2000)).toEqual({
    'com.deck.app': { pid: null, at: 1000, settledAt: 2000 },
  });
  expect(reconcileRestarting(restarting, down, 2000)).toEqual(restarting);
});

test('isRowRestarting: a settled flag reads restarting only while the row is unreachable', () => {
  const settled: RestartingMap = {
    'com.deck.app': { pid: 111, at: 1000, settledAt: 2000 },
  };
  const down = makeRow({
    service: appSvc,
    health: { ok: false, status: null, ms: 0 },
  });
  const up = makeRow({
    service: appSvc,
    health: { ok: true, status: 200, ms: 1 },
  });
  expect(isRowRestarting(down, settled, {})).toBe(true);
  expect(isRowRestarting(up, settled, {})).toBe(false);
  expect(
    isRowRestarting(up, { 'com.deck.app': { pid: 111, at: 1000 } }, {})
  ).toBe(true);
  expect(isRowRestarting(down, {}, {})).toBe(false);
});
