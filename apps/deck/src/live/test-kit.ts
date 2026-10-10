import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ServiceManager } from '../services/manager.ts';
import type { LiveDeps } from './engine.ts';
import type { TreeRow } from './sources.ts';

const dir = mkdtempSync(join(tmpdir(), 'deck-live-'));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, 'registry.json');
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, 'routes.json');
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, 'settings.json');
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, 'platform.json');
process.env.LOCAL_AGENTS_DIR = join(dir, 'agents');
process.env.LOCAL_LAUNCHCTL_PIDS = '';
process.env.HOME = dir;

const { commit, gitRepo } = await import('../../test/git-fixture.ts');
const { FakeServiceManager } = await import('../services/fake.ts');
const { getRecord, putRecord, reloadRegistry } =
  await import('../registry/records.ts');
const { reloadSettings } = await import('../../core/settings.ts');

export { commit, gitRepo };

// Each start goes through sh (the $PORT), so no test depends on where bun lives.
export const SERVER = {
  kind: 'server',
  start: 'bun --watch src/server/index.ts --port $PORT',
} as const;
export const UI = {
  kind: 'ui',
  start: 'bun x vite --port $PORT --strictPort',
} as const;
export const manifest = (live: unknown[]) =>
  JSON.stringify({ name: 'chat', port: 11002, live });

export function routes(): Array<{ hostname: string; port: number }> {
  return JSON.parse(readFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, 'utf8'));
}

/** A server started once per file keeps this manager while each test swaps in a fresh fake. */
export function managerOf(current: () => ServiceManager): ServiceManager {
  return {
    install: spec => current().install(spec),
    uninstall: label => current().uninstall(label),
    kickstart: label => current().kickstart(label),
    isInstalled: label => current().isInstalled(label),
  };
}

/** A linked `chat` app on a fresh git checkout, its normal service installed. */
export function freshChat() {
  const shared = realpathSync(
    gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) })
  );
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([
      { hostname: 'chat.mattstack', port: 11002, pid: 0 },
      { hostname: 'chat.localhost', port: 11002, pid: 0 },
    ])
  );
  writeFileSync(
    process.env.LOCAL_REGISTRY_PATH!,
    JSON.stringify({ version: 1, apps: {} })
  );
  writeFileSync(
    process.env.LOCAL_APPS_SETTINGS_PATH!,
    JSON.stringify({ version: 1, apps: {} })
  );
  reloadRegistry();
  reloadSettings();
  putRecord({
    name: 'chat',
    managedBy: 'rt',
    port: 11002,
    kind: 'service',
    label: 'com.mattstack.deck.chat',
    createdAt: '',
    dev: { workingDirectory: join(shared, 'apps/chat') },
  });
  const manager = new FakeServiceManager();
  manager.installed.set('com.mattstack.deck.chat', {} as never);
  const trees = (): TreeRow[] => [
    { path: shared, branch: 'main', kind: 'main', state: null, repoName: 'r' },
  ];
  const deps = (over: Partial<LiveDeps> = {}): LiveDeps => ({
    devMode: () => true,
    installedLabels: async () => [...manager.installed.keys()],
    tlds: () => ['localhost', 'mattstack'],
    sources: { listTrees: async () => trees(), exists: () => true },
    now: () => new Date('2026-10-09T21:12:00Z'),
    ...over,
  });
  return { shared, manager, trees, deps, record: () => getRecord('chat')! };
}
