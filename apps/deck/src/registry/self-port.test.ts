import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

let registry = '';
let routes = '';

function isolate(): void {
  const dir = mkdtempSync(join(tmpdir(), 'deck-self-port-'));
  registry = join(dir, 'registry.json');
  routes = join(dir, 'routes.json');
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = registry;
  process.env.LOCAL_APPS_ROUTES_PATH = routes;
  process.env.HOME = dir;
}

isolate();
const { ensureSelfRecord, ensureSelfRoutes, reconcileSelfPort } =
  await import('./self-port.ts');
const { putRecord, reloadRegistry } = await import('./records.ts');

beforeEach(() => {
  isolate();
  reloadRegistry();
});

function selfRecord(port: number) {
  return {
    name: 'deck',
    managedBy: 'deck',
    port,
    kind: 'service' as const,
    label: 'com.mattstack.deck',
    createdAt: 'x',
  };
}

function portsOnDisk() {
  const apps = JSON.parse(readFileSync(registry, 'utf8')).apps;
  const table = JSON.parse(readFileSync(routes, 'utf8')) as Array<{
    hostname: string;
    port: number;
  }>;
  return {
    records: Object.fromEntries(
      Object.values(apps).map((r: any) => [r.name, r.port])
    ),
    routes: Object.fromEntries(table.map(r => [r.hostname, r.port])),
  };
}

test("a helper serving on a new port moves deck's record and every deck route to it", () => {
  putRecord(selfRecord(11007));
  putRecord({ ...selfRecord(11003), name: 'board', managedBy: 'rt' });
  writeFileSync(
    routes,
    JSON.stringify([
      { hostname: 'deck.mattstack', port: 11007, pid: 0 },
      { hostname: 'deck.localhost', port: 11007, pid: 0 },
      { hostname: 'deck.mattstack.localhost', port: 11007, pid: 0 },
      { hostname: 'board.mattstack', port: 11003, pid: 0 },
    ])
  );

  const changed = reconcileSelfPort(7940);

  expect(changed).toEqual({
    record: true,
    routes: ['deck.mattstack', 'deck.localhost', 'deck.mattstack.localhost'],
  });
  expect(portsOnDisk()).toEqual({
    records: { deck: 7940, board: 11003 },
    routes: {
      'deck.mattstack': 7940,
      'deck.localhost': 7940,
      'deck.mattstack.localhost': 7940,
      'board.mattstack': 11003,
    },
  });
});

test('a deck already on its served port changes nothing', () => {
  putRecord(selfRecord(7940));
  writeFileSync(
    routes,
    JSON.stringify([{ hostname: 'deck.mattstack', port: 7940, pid: 0 }])
  );

  expect(reconcileSelfPort(7940)).toEqual({ record: false, routes: [] });
});

test('with no self record the routes still follow the served port', () => {
  writeFileSync(
    routes,
    JSON.stringify([{ hostname: 'deck.mattstack', port: 11007, pid: 0 }])
  );

  expect(reconcileSelfPort(7940)).toEqual({
    record: false,
    routes: ['deck.mattstack'],
  });
  expect(JSON.parse(readFileSync(routes, 'utf8'))[0].port).toBe(7940);
});

test('a self record another process changed since load keeps that change', () => {
  putRecord(selfRecord(11007));
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      apps: { deck: { ...selfRecord(11007), displayName: 'Deck' } },
    })
  );
  writeFileSync(routes, '[]');

  reconcileSelfPort(7940);

  const deck = JSON.parse(readFileSync(registry, 'utf8')).apps.deck;
  expect(deck.port).toBe(7940);
  expect(deck.displayName).toBe('Deck');
});

test('a helper-only machine with no deck routes gets deck.localhost and deck.mattstack on the served port', async () => {
  writeFileSync(
    routes,
    JSON.stringify([
      { hostname: 'board.mattstack', port: 11006, pid: 0 },
      { hostname: 'board.localhost', port: 11006, pid: 0 },
    ])
  );

  expect(await ensureSelfRoutes(7940)).toEqual([
    'deck.localhost',
    'deck.mattstack',
  ]);
  expect(JSON.parse(readFileSync(routes, 'utf8'))).toEqual([
    { hostname: 'board.mattstack', port: 11006, pid: 0 },
    { hostname: 'board.localhost', port: 11006, pid: 0 },
    { hostname: 'deck.localhost', port: 7940, pid: 0 },
    { hostname: 'deck.mattstack', port: 7940, pid: 0 },
  ]);
});

test('deck routes that already exist are left as they are', async () => {
  writeFileSync(
    routes,
    JSON.stringify([
      { hostname: 'deck.mattstack', port: 7940, pid: 0 },
      { hostname: 'deck.localhost', port: 7940, pid: 0 },
    ])
  );

  expect(await ensureSelfRoutes(7940)).toEqual([]);
});

test('a helper-only machine gets the self record `deck setup` would have written', () => {
  putRecord({ ...selfRecord(11006), name: 'board', managedBy: 'rt' });

  expect(
    ensureSelfRecord(7940, [
      '/Applications/m.app/Contents/Helpers/deck',
      'serve',
    ])
  ).toBe(true);

  const deck = JSON.parse(readFileSync(registry, 'utf8')).apps.deck;
  expect(deck).toMatchObject({
    name: 'deck',
    managedBy: 'deck',
    port: 7940,
    kind: 'service',
    label: 'com.mattstack.deck',
    command: ['/Applications/m.app/Contents/Helpers/deck', 'serve'],
    workingDirectory: process.env.LOCAL_STATE_DIR,
  });
  expect(typeof deck.createdAt).toBe('string');
});

test('an existing self record, current or pre-rename, is left alone', () => {
  putRecord(selfRecord(11007));
  expect(ensureSelfRecord(7940, ['x', 'serve'])).toBe(false);
  expect(JSON.parse(readFileSync(registry, 'utf8')).apps.deck.port).toBe(11007);

  isolate();
  reloadRegistry();
  putRecord({ ...selfRecord(7940), name: 'local', managedBy: 'local' });
  expect(ensureSelfRecord(7940, ['x', 'serve'])).toBe(false);
  expect(JSON.parse(readFileSync(registry, 'utf8')).apps.deck).toBeUndefined();
});
