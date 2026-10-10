# Deck Live Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the dev app, a mattstack app can run "live" (reloading as you edit) from the shared checkout or one of your worktrees, switched from the deck board or `deck live`.

**Architecture:** Each app's `mattstack.deck.json` gains a `live` list of processes (`server`, optional `ui`, any `worker`s). A new `src/live/` module in deck turns that list into one launchd service per process, run from `<source>/apps/<name>`, stops the app's normal service while live, and points every route of the app at the `ui` process when there is one. Live state sits on the app's entry in deck's `settings.json` (file-local, never the rt store), so the boot sweep and the 5-second reconcile tick keep it in place. The board gets a LIVE column, three modals and a live view in the settings modal; the searchable worktree select is a new tui-kit recipe wrapping Base UI's Combobox.

**Tech Stack:** Bun, TypeScript, React (deck board, bundled to `core/generated`), `@mattstack/tui-kit` (Base UI), launchd through deck's `ServiceManager`, portless routes, rt daemon `worktree:list`.

**Spec:** `docs/superpowers/specs/2026-10-09-deck-live-mode-design.md`. Design boards: `deck new.pen` (pen.dev), boards L1 · A, L2, L2b, L3, L4, L5, L6, light and dark.

## Global Constraints

- Dev app only: every live control and route answers only when `isDevMode()` (or the injected `devMode`) is true; prod ignores `live`.
- Only `managedBy` mattstack rows (`isMattstackOwned`) that are not the platform (`isPlatformManagedBy`) and have a linked dev source can go live.
- `live` list: exactly one `server`, at most one `ui`, any number of `worker`s; `start` is a non-empty shell string run through `startArgv`.
- Env for live processes: the record's `serviceEnv`, `PATH` from `composeServicePath`, `PORT` (server: the app's port; ui: the allocated live UI port; worker: unset), and `SERVER_PORT` (the app's port) on every process.
- Live labels: `com.mattstack.deck.<name>.live.<id>` with ids `server`, `ui`, `worker-1`, `worker-2`, …
- Live state is file-local in deck's `settings.json` (`apps.<name>.live`), never written to the `deck.apps` rt store.
- Live mode moves every route of the app (`<name>.mattstack` and `<name>.localhost`), not through the dev-port override, which only moves `.localhost`.
- No em dashes or en dashes anywhere (code, comments, copy, commits). Comments only for a constraint the code cannot show.
- UI copy is short and plain: "go live", "Go Live", "Run <app> live", "Code to run", "Needs setup first.", "Worktrees use your real data.", "<app> is live", "Stop Live", "Switch", "Couldn't set up <branch>", "Try Again", "Dismiss", "Full log".
- After any `core/board/` edit, run `bun run build:board` in `apps/deck` and commit `core/generated/` with the source.
- Commit after every task. Run targeted tests only; CI runs the rest.

## Review Focus

- **Going live while a manual dev-port override is set:** the override is cleared and the route is owned by live mode; stopping live leaves both routes on the app's own port, never on the old override port. Test pinned in Task 8.
- **Deck restarts while an app is live:** the boot sweep keeps the normal service uninstalled and the live services in place, and does not restart live services whose plists already match. Test pinned in Task 9.
- **The source's manifest changed while live** (a `worker` removed or renamed): stop and switch remove every installed label under the app's live prefix, not only the ids the current manifest names. Test pinned in Task 8.
- **The worktree is deleted while the app is live from it:** the next tick moves the app to live from main, records `movedFrom`, and keeps the routes on the UI port. Test pinned in Task 9.
- **A worktree that has no `apps/<name>`, or whose manifest has no valid `live` list:** go-live refuses with a plain reason and the normal service keeps running untouched. Test pinned in Task 8.

---

### Task 1: Vite preset reads `SERVER_PORT` and accepts deck's hostnames

**Files:**
- Modify: `packages/ui/presets/vite.js`
- Modify: `packages/ui/presets/vite.d.ts`
- Test: `packages/ui/presets/vite.test.ts` (create)

**Interfaces:**
- Produces: `mattstackVite(opts)` whose `server` always carries `allowedHosts: ['.mattstack', '.localhost']`, and whose proxy targets `127.0.0.1:${SERVER_PORT || apiPort}`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/presets/vite.test.ts
import { afterEach, describe, expect, it } from 'vitest';

import { mattstackVite } from './vite.js';

type Proxy = Record<string, { target: string }>;

describe('mattstackVite server', () => {
  afterEach(() => {
    delete process.env.SERVER_PORT;
  });

  it('proxies to apiPort when SERVER_PORT is unset', () => {
    const proxy = mattstackVite({ apiPort: 11002 }).server?.proxy as Proxy;
    expect(proxy['/api']!.target).toBe('http://127.0.0.1:11002');
    expect(proxy['/ws']!.target).toBe('ws://127.0.0.1:11002');
  });

  it('proxies to SERVER_PORT when deck sets it', () => {
    process.env.SERVER_PORT = '12002';
    const proxy = mattstackVite({ apiPort: 11002 }).server?.proxy as Proxy;
    expect(proxy['/api']!.target).toBe('http://127.0.0.1:12002');
    expect(proxy['/ws']!.target).toBe('ws://127.0.0.1:12002');
  });

  it('accepts .mattstack and .localhost hosts with or without the proxy', () => {
    expect(mattstackVite({ apiPort: 1 }).server?.allowedHosts).toEqual([
      '.mattstack',
      '.localhost',
    ]);
    const bare = mattstackVite({ apiPort: 1, proxy: false }).server;
    expect(bare?.allowedHosts).toEqual(['.mattstack', '.localhost']);
    expect(bare?.proxy).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && bunx vitest run presets/vite.test.ts`
Expected: FAIL (`allowedHosts` undefined; SERVER_PORT case still targets 11002).

- [ ] **Step 3: Write minimal implementation**

In `packages/ui/presets/vite.js`, replace the `server:` property of the returned object and read the port at the top of `mattstackVite`:

```js
const DECK_HOSTS = ['.mattstack', '.localhost'];

export function mattstackVite(opts) {
  const { apiPort, proxy = true, extraGroups = [] } = opts;
  const serverPort = Number(process.env.SERVER_PORT) || apiPort;
  return {
    // ...plugins, optimizeDeps, build unchanged...
    server: {
      allowedHosts: DECK_HOSTS,
      ...(proxy
        ? {
            proxy: {
              '/api': {
                target: `http://127.0.0.1:${serverPort}`,
                changeOrigin: true,
              },
              '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
            },
          }
        : {}),
    },
    // ...preview, test unchanged...
  };
}
```

In `packages/ui/presets/vite.d.ts`, document the env read on `apiPort`:

```ts
  /** The Bun/Hono server's port; the dev proxy forwards /api and /ws to it.
      `SERVER_PORT` in the environment wins, which is how deck's live mode
      points the proxy at the app's server. */
  apiPort: number;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && bunx vitest run presets/vite.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/presets/vite.js packages/ui/presets/vite.d.ts packages/ui/presets/vite.test.ts
git commit -m "app-kit vite preset: read SERVER_PORT, accept .mattstack and .localhost hosts"
```

---

### Task 2: Prove Vite's reload socket gets through portless (controller only, go/no-go)

This task is run by the controller, not a subagent: it briefly repoints Matt's live `chat.localhost` route and needs Matt's OK first. Everything after it assumes it passes.

**Files:** none committed.

- [ ] **Step 1: Ask Matt before touching the route.** Say: "I'm about to point chat.localhost at a Vite dev server for about two minutes to prove reload works through portless. chat.mattstack is untouched. OK?" Wait for yes.

- [ ] **Step 2: Start Vite from this worktree on a spare port**

Run (background, under Monitor): `cd apps/chat && SERVER_PORT=11002 bunx vite --port 5199 --strictPort`
Expected: Vite prints `Local: http://localhost:5199/`.

- [ ] **Step 3: Point chat.localhost at it**

Run: `deck override chat 5199`
Expected: `` `chat.localhost` now serves port 5199 ``

- [ ] **Step 4: Load it and watch the socket.** With Fast Browser (`fast-browser:browser-driver` agent or the MCP tools directly), open `https://chat.localhost`, read the console. Expected: a `[vite] connected.` line, no websocket error.

- [ ] **Step 5: Edit and confirm a hot update.** Append a harmless change to a chat client file (for example, add `export const __liveProbe = 1;` to the end of `apps/chat/src/app/icons.ts`), then read the console again. Expected: `[vite] hot updated:` or `[vite] page reload`. Revert the file with `git checkout -- apps/chat/src/app/icons.ts`.

- [ ] **Step 6: Restore**

Run: `deck override chat off` and stop the Vite process.
Expected: `override cleared`; `curl -sk https://chat.localhost/api/health` answers from the normal server.

- [ ] **Step 7: Decide.** If step 4 or 5 failed (no `[vite] connected.`, or a `WebSocket connection ... failed` line), stop the plan and tell Matt: Vite apps cannot hot-reload through portless as designed, and the fallback (Vite `server.hmr.clientPort` pointed straight at the UI port) needs his call. If both passed, continue.

---

### Task 3: Manifest `live` list

**Files:**
- Modify: `apps/deck/src/registry/deck-manifest.ts`
- Test: `apps/deck/src/registry/deck-manifest.test.ts`

**Interfaces:**
- Produces:
  - `export const LIVE_KINDS = ['server', 'ui', 'worker'] as const;`
  - `export type LiveKind = (typeof LIVE_KINDS)[number];`
  - `export interface LiveProcess { kind: LiveKind; start: string }`
  - `export function parseLive(raw: unknown): { ok: true; live: LiveProcess[] } | { ok: false; error: string }`
  - `export function liveProcessIds(live: LiveProcess[]): string[]`
  - `DeckManifest.live?: LiveProcess[]` (set only when valid) and `DeckManifest.liveError?: string` (set only when invalid; the rest of the manifest still loads).

- [ ] **Step 1: Write the failing tests** (append to `deck-manifest.test.ts`; `repo()` is the file's existing helper)

```ts
import { liveProcessIds, parseLive } from './deck-manifest.ts';

const SERVER = { kind: 'server', start: 'bun --watch src/server/index.ts' };
const UI = { kind: 'ui', start: 'vite --port $PORT --strictPort' };

test('reads a valid live list', () => {
  const dir = repo({
    'mattstack.deck.json': JSON.stringify({ name: 'chat', live: [SERVER, UI] }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok && r.manifest.live).toEqual([SERVER, UI]);
  expect(r?.ok && r.manifest.liveError).toBeUndefined();
});

test('a broken live list keeps the rest of the manifest', () => {
  const dir = repo({
    'mattstack.deck.json': JSON.stringify({
      name: 'chat',
      port: 11002,
      live: [UI],
    }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(true);
  expect(r?.ok && r.manifest.port).toBe(11002);
  expect(r?.ok && r.manifest.live).toBeUndefined();
  expect(r?.ok && r.manifest.liveError).toBe('no server in the live list');
});

test.each([
  [{}, 'live must be a list'],
  [[SERVER, SERVER], 'more than one server in the live list'],
  [[SERVER, UI, UI], 'more than one ui in the live list'],
  [[SERVER, { kind: 'proxy', start: 'x' }], 'live entry 2 has an unknown kind'],
  [[{ kind: 'server', start: '  ' }], 'live entry 1 has no start command'],
  [[SERVER, 'nope'], 'live entry 2 must be an object'],
])('parseLive refuses %j', (raw, error) => {
  expect(parseLive(raw)).toEqual({ ok: false, error });
});

test('liveProcessIds numbers workers and keeps server and ui as is', () => {
  expect(
    liveProcessIds([
      { kind: 'server', start: 'a' },
      { kind: 'worker', start: 'b' },
      { kind: 'ui', start: 'c' },
      { kind: 'worker', start: 'd' },
    ])
  ).toEqual(['server', 'worker-1', 'ui', 'worker-2']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts`
Expected: FAIL (`parseLive` is not exported).

- [ ] **Step 3: Implement**

In `deck-manifest.ts`, add above `DeckManifest`:

```ts
export const LIVE_KINDS = ['server', 'ui', 'worker'] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];
export interface LiveProcess {
  kind: LiveKind;
  start: string;
}
```

Add to `DeckManifest`:

```ts
  /** Live-mode processes; set only when the `live` list is valid. */
  live?: LiveProcess[];
  /** Why the `live` list cannot be used; the rest of the manifest still loads. */
  liveError?: string;
```

Add the parser and ids helper:

```ts
export function parseLive(
  raw: unknown
): { ok: true; live: LiveProcess[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'live must be a list' };
  const live: LiveProcess[] = [];
  for (const [i, entry] of raw.entries()) {
    const n = i + 1;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      return { ok: false, error: `live entry ${n} must be an object` };
    const { kind, start } = entry as Record<string, unknown>;
    if (!LIVE_KINDS.includes(kind as LiveKind))
      return { ok: false, error: `live entry ${n} has an unknown kind` };
    if (typeof start !== 'string' || start.trim() === '')
      return { ok: false, error: `live entry ${n} has no start command` };
    live.push({ kind: kind as LiveKind, start });
  }
  const count = (k: LiveKind) => live.filter(p => p.kind === k).length;
  if (count('server') === 0)
    return { ok: false, error: 'no server in the live list' };
  if (count('server') > 1)
    return { ok: false, error: 'more than one server in the live list' };
  if (count('ui') > 1)
    return { ok: false, error: 'more than one ui in the live list' };
  return { ok: true, live };
}

export function liveProcessIds(live: LiveProcess[]): string[] {
  let worker = 0;
  return live.map(p => (p.kind === 'worker' ? `worker-${++worker}` : p.kind));
}
```

In `readDeckManifest`, after the `env` block and before `altConfigs`:

```ts
  if (m.live !== undefined) {
    const live = parseLive(m.live);
    if (live.ok) out.live = live.live;
    else out.liveError = live.error;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/registry/deck-manifest.ts apps/deck/src/registry/deck-manifest.test.ts
git commit -m "deck manifest: parse the live list of server, ui and worker processes"
```

---

### Task 4: Live state on deck's settings entry

**Files:**
- Modify: `apps/deck/core/settings.ts`
- Test: `apps/deck/core/settings.test.ts`

**Interfaces:**
- Produces:
  - `export interface LiveState { source: string; branch: string | null; startedAt: string; uiPort?: number; movedFrom?: string }`
  - `export function getLive(app: string): LiveState | undefined`
  - `export function setLive(app: string, live: LiveState): void`
  - `export function clearLive(app: string): void`
  - `export function getLives(): Record<string, LiveState>`

- [ ] **Step 1: Write the failing tests** (add `getLive, setLive, clearLive, getLives` to the file's existing `await import('./settings.ts')` destructure)

```ts
const LIVE = {
  source: '/tmp/wt/console-runs-3',
  branch: 'console-runs-3',
  startedAt: '2026-10-09T21:12:00.000Z',
  uiPort: 11140,
};

test('setLive persists and survives reload', () => {
  setLive('chat', LIVE);
  reloadSettings();
  expect(getLive('chat')).toEqual(LIVE);
  expect(getLives()).toEqual({ chat: LIVE });
});

test('clearLive removes it and leaves the rest of the entry', async () => {
  await setPublished('chat', false);
  setLive('chat', LIVE);
  clearLive('chat');
  expect(getLive('chat')).toBeUndefined();
  expect(getAppSettings('chat').published).toBe(false);
});

test('live stays file-local: the store never carries it', () => {
  setSetting('deck.apps', { chat: { published: true } }, 'user');
  reloadSettings();
  setLive('chat', LIVE);
  const store = getSetting<Record<string, Record<string, unknown>>>(
    'deck.apps'
  ).value!;
  expect(store.chat).not.toHaveProperty('live');
  const onDisk = JSON.parse(
    readFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, 'utf8')
  );
  expect(onDisk.apps.chat.live).toEqual(LIVE);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test core/settings.test.ts`
Expected: FAIL (`setLive` is not a function).

- [ ] **Step 3: Implement**

In `core/settings.ts`, after `PortOverride`:

```ts
export interface LiveState {
  /** Root of the checkout the app runs live from: the shared checkout or a worktree. */
  source: string;
  branch: string | null;
  startedAt: string;
  uiPort?: number;
  /** The branch a deleted worktree moved the app off, for the board's warning. */
  movedFrom?: string;
}
```

Add `live?: LiveState;` to `AppEntry`. Then, after `getOverrides()`:

```ts
export function getLive(app: string): LiveState | undefined {
  return cache.apps[app]?.live;
}

export function setLive(app: string, live: LiveState): void {
  const previous = structuredClone(cache);
  ensure(app).live = live;
  save(previous);
}

export function clearLive(app: string): void {
  const entry = cache.apps[app];
  if (!entry?.live) return;
  const previous = structuredClone(cache);
  delete entry.live;
  save(previous);
}

export function getLives(): Record<string, LiveState> {
  const out: Record<string, LiveState> = {};
  for (const [app, s] of Object.entries(cache.apps)) if (s.live) out[app] = s.live;
  return out;
}
```

`buildAppsStoreDict` only copies `published` and `publicFollowsOverride`, and `stripMigratedFields` keeps every other field in the file, so no change is needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test core/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/core/settings.ts apps/deck/core/settings.test.ts
git commit -m "deck settings: keep each app's live state beside its override, file-local"
```

---

### Task 5: Live labels, a route writer for every hostname, and no live strays

**Files:**
- Create: `apps/deck/src/live/labels.ts`
- Modify: `apps/deck/core/routes-writer.ts`
- Modify: `apps/deck/core/discover.ts` (`orphanServices`)
- Test: `apps/deck/src/live/labels.test.ts` (create)
- Test: `apps/deck/core/routes-writer.test.ts`

**Interfaces:**
- Produces:
  - `export function liveLabel(name: string, id: string): string` → `com.mattstack.deck.<name>.live.<id>`
  - `export function liveLabelPrefix(name: string): string` → `com.mattstack.deck.<name>.live.`
  - `export function isLiveLabel(label: string): boolean`
  - `export function setAppRoutesPort(app: string, port: number, tlds: string[]): string[]` (returns the hostnames it moved; writes in place like `setRoutePort`)
- Consumes: `LABEL_PREFIX` from `src/services/manager.ts`, `bareName` from `core/discover.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/live/labels.test.ts
import { expect, test } from 'bun:test';

import { orphanServices, type LaunchdService } from '../../core/discover.ts';
import { isLiveLabel, liveLabel, liveLabelPrefix } from './labels.ts';

test('live labels sit under the app label with a live segment', () => {
  expect(liveLabel('chat', 'ui')).toBe('com.mattstack.deck.chat.live.ui');
  expect(liveLabelPrefix('chat')).toBe('com.mattstack.deck.chat.live.');
  expect(isLiveLabel('com.mattstack.deck.chat.live.worker-1')).toBe(true);
  expect(isLiveLabel('com.mattstack.deck.chat')).toBe(false);
  expect(isLiveLabel('com.other.chat.live.ui')).toBe(false);
});

test('a live service with no route of its own is not a stray', () => {
  const svc = (label: string): LaunchdService => ({
    label,
    plistPath: `/x/${label}.plist`,
    program: [],
    workingDirectory: null,
    stderrPath: null,
    port: 11002,
    pid: 1,
    lastExitStatus: null,
  });
  const strays = orphanServices([], [
    svc('com.mattstack.deck.chat.live.server'),
    svc('com.mattstack.deck.tunnel'),
  ]);
  expect(strays.map(s => s.label)).toEqual(['com.mattstack.deck.tunnel']);
});
```

Append to `core/routes-writer.test.ts` (it already points `LOCAL_APPS_ROUTES_PATH` at a temp file; reuse its write/read helpers or `writeFileSync`/`readFileSync` on `routesPath()`):

```ts
test('setAppRoutesPort moves every TLD of one app and nothing else', () => {
  writeFileSync(
    routesPath(),
    JSON.stringify([
      { hostname: 'chat.mattstack', port: 11002, pid: 0 },
      { hostname: 'chat.localhost', port: 11002, pid: 0 },
      { hostname: 'console.localhost', port: 11001, pid: 0 },
    ])
  );
  expect(setAppRoutesPort('chat', 11140, ['localhost', 'mattstack'])).toEqual([
    'chat.mattstack',
    'chat.localhost',
  ]);
  const routes = JSON.parse(readFileSync(routesPath(), 'utf8'));
  expect(routes.map((r: { port: number }) => r.port)).toEqual([
    11140, 11140, 11001,
  ]);
  expect(setAppRoutesPort('chat', 11140, ['localhost', 'mattstack'])).toEqual(
    []
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/labels.test.ts core/routes-writer.test.ts`
Expected: FAIL (modules or exports missing).

- [ ] **Step 3: Implement**

```ts
// apps/deck/src/live/labels.ts
import { LABEL_PREFIX } from '../services/manager.ts';

const LIVE_SEGMENT = '.live.';

export function liveLabelPrefix(name: string): string {
  return `${LABEL_PREFIX}${name}${LIVE_SEGMENT}`;
}

export function liveLabel(name: string, id: string): string {
  return `${liveLabelPrefix(name)}${id}`;
}

export function isLiveLabel(label: string): boolean {
  return label.startsWith(LABEL_PREFIX) && label.includes(LIVE_SEGMENT);
}
```

In `core/routes-writer.ts` (import `bareName` alongside `routesPath` from `./discover.ts`):

```ts
/** Every route of `app` under any of `tlds`, in place for the same reason as
    setRoutePort: portless follows the file's inode. */
export function setAppRoutesPort(
  app: string,
  port: number,
  tlds: string[]
): string[] {
  const path = routesPath();
  let routes: Array<Record<string, unknown>>;
  try {
    routes = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const moved: string[] = [];
  for (const r of routes) {
    const host = String(r.hostname);
    if (bareName(host, tlds) === app && r.port !== port) {
      r.port = port;
      moved.push(host);
    }
  }
  if (moved.length) writeFileSync(path, JSON.stringify(routes, null, 2));
  return moved;
}
```

In `core/discover.ts`, import `isLiveLabel` from `../src/live/labels.ts` and change `orphanServices`' filter to:

```ts
  return services.filter(s => !claimed.has(s.label) && !isLiveLabel(s.label));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live/labels.test.ts core/routes-writer.test.ts core/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/live/labels.ts apps/deck/src/live/labels.test.ts apps/deck/core/routes-writer.ts apps/deck/core/routes-writer.test.ts apps/deck/core/discover.ts
git commit -m "deck live: labels, a route writer for every hostname, no live strays"
```

---

### Task 6: Where an app can run live from

**Files:**
- Create: `apps/deck/src/live/sources.ts`
- Test: `apps/deck/src/live/sources.test.ts`

**Interfaces:**
- Produces:
  - `export interface TreeRow { path: string; branch: string | null; kind: string; state: string | null; repoName: string; readyAt?: string | null; lastActiveAt?: string | null }`
  - `export interface LiveSource { path: string; branch: string | null; main: boolean; needsSetup: boolean; lastActiveAt: string | null }`
  - `export interface SourcesDeps { listTrees?: () => Promise<TreeRow[]>; exists?: (path: string) => boolean }`
  - `export function sharedRootFor(record: AppRecord): string | null` (the git toplevel of the linked dev source, real path)
  - `export function appDirIn(record: AppRecord, root: string, sharedRoot: string): string | null`
  - `export function branchOf(root: string): string | null`
  - `export async function listLiveSources(sharedRoot: string, deps?: SourcesDeps): Promise<{ sources: LiveSource[]; error: string | null }>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/live/sources.test.ts
import { mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { gitRepo } from '../../test/git-fixture.ts';
import type { AppRecord } from '../registry/records.ts';
import {
  appDirIn,
  branchOf,
  listLiveSources,
  sharedRootFor,
  type TreeRow,
} from './sources.ts';

const root = realpathSync(gitRepo({ 'apps/chat/mattstack.deck.json': '{}' }));
const record = {
  name: 'chat',
  managedBy: 'rt',
  port: 11002,
  kind: 'service',
  createdAt: '',
  dev: { workingDirectory: join(root, 'apps/chat') },
} as AppRecord;

const row = (over: Partial<TreeRow>): TreeRow => ({
  path: '/wt/x',
  branch: 'x',
  kind: 'ephemeral',
  state: 'claimed',
  repoName: 'remote:mattstack',
  readyAt: '2026-10-01T00:00:00Z',
  lastActiveAt: null,
  ...over,
});

test('sharedRootFor is the git toplevel of the linked source', () => {
  expect(sharedRootFor(record)).toBe(root);
  expect(sharedRootFor({ ...record, dev: undefined })).toBeNull();
});

test('appDirIn keeps the app path relative to the checkout', () => {
  expect(appDirIn(record, '/wt/feature', root)).toBe('/wt/feature/apps/chat');
});

test('branchOf reads the checked out branch', () => {
  expect(branchOf(root)).toBe('main');
  expect(branchOf('/no/such/dir')).toBeNull();
});

test('main first, then claimed and unmanaged trees of the same repo by last use', async () => {
  const { sources, error } = await listLiveSources(root, {
    exists: () => false,
    listTrees: async () => [
      row({ path: root, kind: 'main', state: null, branch: 'main' }),
      row({ path: '/wt/old', branch: 'old', lastActiveAt: '2026-10-01T00:00:00Z' }),
      row({ path: '/wt/new', branch: 'new', lastActiveAt: '2026-10-09T00:00:00Z' }),
      row({ path: '/wt/spare', kind: 'on-deck', state: 'ready' }),
      row({ path: '/wt/golden', kind: 'golden', state: null }),
      row({ path: '/wt/gone', state: 'disposable' }),
      row({ path: '/wt/hand', kind: 'unmanaged', state: null, readyAt: null, branch: 'hand' }),
      row({ path: '/other', repoName: 'remote:other', branch: 'other' }),
    ],
  });
  expect(error).toBeNull();
  expect(sources.map(s => [s.branch, s.main, s.needsSetup])).toEqual([
    ['main', true, false],
    ['new', false, false],
    ['old', false, false],
    ['hand', false, true],
  ]);
});

test('an unready tree with installed packages does not need setup', async () => {
  const wt = realpathSync(gitRepo({ 'a.txt': 'a' }));
  mkdirSync(join(wt, 'node_modules'));
  const { sources } = await listLiveSources(root, {
    listTrees: async () => [
      row({ path: root, kind: 'main', state: null, branch: 'main' }),
      row({ path: wt, kind: 'unmanaged', state: null, readyAt: null }),
    ],
  });
  expect(sources[1]!.needsSetup).toBe(false);
});

test('an unreachable rt daemon still offers main', async () => {
  const { sources, error } = await listLiveSources(root, {
    listTrees: async () => {
      throw new Error('rt daemon unreachable');
    },
  });
  expect(sources).toEqual([
    { path: root, branch: 'main', main: true, needsSetup: false, lastActiveAt: null },
  ]);
  expect(error).toBe('rt daemon unreachable');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/sources.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/deck/src/live/sources.ts
import { existsSync, realpathSync } from 'fs';
import { join, relative } from 'path';

import { rtCommand } from '@mattstack/rt-client';
import { git } from '../edge/source.ts';
import type { AppRecord } from '../registry/records.ts';

/** Mirrors rt-client's WorktreeTreeRow, which the package does not export. */
export interface TreeRow {
  path: string;
  branch: string | null;
  kind: string;
  state: string | null;
  repoName: string;
  readyAt?: string | null;
  lastActiveAt?: string | null;
}

export interface LiveSource {
  path: string;
  branch: string | null;
  main: boolean;
  needsSetup: boolean;
  lastActiveAt: string | null;
}

export interface SourcesDeps {
  listTrees?: () => Promise<TreeRow[]>;
  exists?: (path: string) => boolean;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function gitLine(args: string[], dir: string): string | null {
  try {
    const r = git(args, dir);
    return r.code === 0 ? r.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

export function sharedRootFor(record: AppRecord): string | null {
  const dir = record.dev?.workingDirectory;
  if (!dir || !existsSync(dir)) return null;
  const top = gitLine(['rev-parse', '--show-toplevel'], dir);
  return top ? real(top) : null;
}

export function appDirIn(
  record: AppRecord,
  root: string,
  sharedRoot: string
): string | null {
  const linked = record.dev?.workingDirectory;
  if (!linked) return null;
  return join(root, relative(sharedRoot, real(linked)));
}

export function branchOf(root: string): string | null {
  if (!existsSync(root)) return null;
  const branch = gitLine(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  return branch === 'HEAD' ? null : branch;
}

async function defaultListTrees(): Promise<TreeRow[]> {
  const res = await rtCommand<{ trees: TreeRow[] }>('worktree:list', {});
  if (!res.ok || !res.data) throw new Error(res.error ?? 'rt worktree list failed');
  return res.data.trees;
}

/** Claimed and hand-made trees only: rt hands its spare trees out, so one
    picked here could change hands mid-session. */
function pickable(t: TreeRow): boolean {
  return (t.kind === 'ephemeral' && t.state === 'claimed') || t.kind === 'unmanaged';
}

export async function listLiveSources(
  sharedRoot: string,
  deps: SourcesDeps = {}
): Promise<{ sources: LiveSource[]; error: string | null }> {
  const exists = deps.exists ?? existsSync;
  const main: LiveSource = {
    path: sharedRoot,
    branch: branchOf(sharedRoot),
    main: true,
    needsSetup: false,
    lastActiveAt: null,
  };
  let trees: TreeRow[];
  try {
    trees = await (deps.listTrees ?? defaultListTrees)();
  } catch (err) {
    return { sources: [main], error: err instanceof Error ? err.message : String(err) };
  }
  const repo = trees.find(t => real(t.path) === sharedRoot)?.repoName;
  const worktrees = trees
    .filter(t => repo !== undefined && t.repoName === repo && real(t.path) !== sharedRoot && pickable(t))
    .map(t => ({
      path: real(t.path),
      branch: t.branch,
      main: false,
      needsSetup: !t.readyAt && !exists(join(t.path, 'node_modules')),
      lastActiveAt: t.lastActiveAt ?? null,
    }))
    .sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
  return { sources: [main, ...worktrees], error: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/live/sources.ts apps/deck/src/live/sources.test.ts
git commit -m "deck live: list the checkouts an app can run live from"
```

---

### Task 7: Worktree setup runner

**Files:**
- Create: `apps/deck/src/live/setup.ts`
- Test: `apps/deck/src/live/setup.test.ts`

**Interfaces:**
- Produces:
  - `export interface SetupRun { source: string; branch: string | null; state: 'running' | 'failed'; log: string[]; at: string }`
  - `export interface SetupDeps { run?: (cmd: string[], cwd: string, onLine: (line: string) => void) => Promise<number>; now?: () => Date }`
  - `export function setupFor(app: string): SetupRun | undefined`
  - `export function clearSetup(app: string): void`
  - `export async function runSetup(app: string, root: string, branch: string | null, deps?: SetupDeps): Promise<boolean>` (true on success; a success leaves no run behind, a failure keeps `state: 'failed'` with the last 200 lines)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/live/setup.test.ts
import { afterEach, expect, test } from 'bun:test';

import { clearSetup, runSetup, setupFor } from './setup.ts';

afterEach(() => clearSetup('chat'));

test('a clean install leaves no run behind', async () => {
  const seen: string[][] = [];
  const ok = await runSetup('chat', '/wt/a', 'a', {
    run: async (cmd, cwd, onLine) => {
      seen.push([...cmd, cwd]);
      onLine('installed 812 packages');
      return 0;
    },
  });
  expect(ok).toBe(true);
  expect(seen).toEqual([['bun', 'install', '/wt/a']]);
  expect(setupFor('chat')).toBeUndefined();
});

test('a failed install keeps its log for the board', async () => {
  const ok = await runSetup('chat', '/wt/a', 'a', {
    run: async (_cmd, _cwd, onLine) => {
      onLine('error: lockfile had changes, but lockfile is frozen');
      return 1;
    },
    now: () => new Date('2026-10-09T21:00:00Z'),
  });
  expect(ok).toBe(false);
  expect(setupFor('chat')).toEqual({
    source: '/wt/a',
    branch: 'a',
    state: 'failed',
    log: ['$ bun install', 'error: lockfile had changes, but lockfile is frozen'],
    at: '2026-10-09T21:00:00.000Z',
  });
});

test('a thrown runner counts as a failure', async () => {
  const ok = await runSetup('chat', '/wt/a', null, {
    run: async () => {
      throw new Error('bun not found');
    },
  });
  expect(ok).toBe(false);
  expect(setupFor('chat')?.log.at(-1)).toBe('Error: bun not found');
});

test('the log keeps only the last 200 lines', async () => {
  await runSetup('chat', '/wt/a', null, {
    run: async (_c, _d, onLine) => {
      for (let i = 0; i < 300; i++) onLine(`line ${i}`);
      return 1;
    },
  });
  const log = setupFor('chat')!.log;
  expect(log.length).toBe(200);
  expect(log.at(-1)).toBe('line 299');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/setup.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/deck/src/live/setup.ts
import { composeServicePath, resolveProgram } from '../services/exec-env.ts';

export interface SetupRun {
  source: string;
  branch: string | null;
  state: 'running' | 'failed';
  log: string[];
  at: string;
}

export interface SetupDeps {
  run?: (
    cmd: string[],
    cwd: string,
    onLine: (line: string) => void
  ) => Promise<number>;
  now?: () => Date;
}

const LOG_LINES = 200;
const runs = new Map<string, SetupRun>();

export function setupFor(app: string): SetupRun | undefined {
  return runs.get(app);
}

export function clearSetup(app: string): void {
  runs.delete(app);
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  if (buf) onLine(buf);
}

/** Spawns with deck's composed PATH: launchd starts deck on a bare one. */
async function defaultRun(
  cmd: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<number> {
  const path = composeServicePath();
  const program = resolveProgram(cmd[0]!, path);
  if (!program) throw new Error(`${cmd[0]} not found on the service PATH`);
  const proc = Bun.spawn([program, ...cmd.slice(1)], {
    cwd,
    env: { ...process.env, PATH: path },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine)]);
  return proc.exited;
}

export async function runSetup(
  app: string,
  root: string,
  branch: string | null,
  deps: SetupDeps = {}
): Promise<boolean> {
  const run: SetupRun = {
    source: root,
    branch,
    state: 'running',
    log: [],
    at: (deps.now ?? (() => new Date()))().toISOString(),
  };
  runs.set(app, run);
  const push = (line: string) => {
    run.log.push(line);
    if (run.log.length > LOG_LINES) run.log.shift();
  };
  push('$ bun install');
  let code: number;
  try {
    code = await (deps.run ?? defaultRun)(['bun', 'install'], root, push);
  } catch (err) {
    push(String(err));
    code = -1;
  }
  if (code === 0) {
    runs.delete(app);
    return true;
  }
  run.state = 'failed';
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live/setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/live/setup.ts apps/deck/src/live/setup.test.ts
git commit -m "deck live: run a worktree's install and keep a failed run's log"
```

---

### Task 8: Live engine: go live, switch, stop

**Files:**
- Create: `apps/deck/src/services/installed.ts` (moved from `register.ts`)
- Modify: `apps/deck/src/api/register.ts` (import `installedMatches` from the new module)
- Create: `apps/deck/src/live/engine.ts`
- Create: `apps/deck/src/live/test-kit.ts` (shared by every live test from here on)
- Test: `apps/deck/src/live/engine.test.ts`

**Interfaces:**
- Consumes: `parseLive`, `liveProcessIds`, `startArgv`, `readDeckManifest` (Task 3); `getLive`, `setLive`, `clearLive`, `getOverride`, `clearOverride`, `LiveState` (Task 4); `liveLabel`, `liveLabelPrefix`, `setAppRoutesPort` (Task 5); `sharedRootFor`, `appDirIn`, `branchOf`, `listLiveSources`, `SourcesDeps` (Task 6); `runSetup`, `setupFor`, `clearSetup`, `SetupDeps` (Task 7).
- Produces:
  - `export function installedMatches(label: string, spec: ServiceSpec): boolean` (in `src/services/installed.ts`)
  - `export interface LiveDeps { devMode?: () => boolean; sources?: SourcesDeps; setup?: SetupDeps; now?: () => Date; installedLabels?: () => Promise<string[]>; onRouteWrite?: () => void; tlds?: () => string[]; reinstall?: () => Promise<unknown> }` (`reinstall` brings the normal service back after a failed go-live; the API passes the sweep)
  - `export type LiveResult = { status: number; body: unknown }`
  - `export function liveRefusal(record: AppRecord | undefined, devMode: boolean): string | null`
  - `export function liveManifestAt(appDir: string): { ok: true; live: LiveProcess[] } | { ok: false; error: string }`
  - `export function liveSpecs(record: AppRecord, live: LiveProcess[], appDir: string, uiPort: number | null): ServiceSpec[]`
  - `export async function installLive(record: AppRecord, state: LiveState, manager: ServiceManager, deps?: LiveDeps): Promise<string | null>` (null on success, else a plain reason)
  - `export async function uninstallLive(name: string, manager: ServiceManager, deps?: LiveDeps): Promise<void>`
  - `export async function goLive(name: string, source: string, manager: ServiceManager, deps?: LiveDeps): Promise<LiveResult>` (200 live now, 202 setting up first, 4xx refused)
  - `export async function stopLive(name: string, manager: ServiceManager, deps?: LiveDeps): Promise<LiveResult>` (stops live services, routes back to the app's port, clears live and any setup failure; the caller then runs the sweep to reinstall the normal service)

- [ ] **Step 1: Move `installedMatches` and `sameEnvironment` out of `register.ts`**

Create `apps/deck/src/services/installed.ts` with the two functions cut verbatim from `register.ts` (lines with `function sameEnvironment(` and `function installedMatches(`), exported:

```ts
import {
  readInstalledEnvironment,
  readInstalledProgramArguments,
  readInstalledWorkingDirectory,
} from './launchd.ts';
import type { ServiceSpec } from './manager.ts';
import { renderedEnvironment } from './plist.ts';

function sameEnvironment(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k])
  );
}

export function installedMatches(label: string, spec: ServiceSpec): boolean {
  const installed = readInstalledProgramArguments(label);
  const installedEnv = readInstalledEnvironment(label);
  return (
    installed !== null &&
    installed.length === spec.programArguments.length &&
    installed.every((a, i) => a === spec.programArguments[i]) &&
    readInstalledWorkingDirectory(label) === spec.workingDirectory &&
    installedEnv !== null &&
    sameEnvironment(installedEnv, renderedEnvironment(spec))
  );
}
```

In `register.ts`, delete both functions, remove the now-unused imports (`readInstalled*`, `renderedEnvironment`), and add `import { installedMatches } from '../services/installed.ts';`.

Run: `cd apps/deck && bun test src/api/register.test.ts`
Expected: PASS (pure move). Commit: `git commit -am "deck: move installedMatches into services/installed.ts"`.

- [ ] **Step 2: Write the shared test kit**

Every live test imports this first: deck modules read their state paths when they load, so the environment has to be set before anything else.

```ts
// apps/deck/src/live/test-kit.ts
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
const { getRecord, putRecord, reloadRegistry } = await import('../registry/records.ts');
const { reloadSettings } = await import('../../core/settings.ts');

export { commit, gitRepo };

// Each start goes through sh (the $PORT), so no test depends on where bun lives.
export const SERVER = { kind: 'server', start: 'bun --watch src/server/index.ts --port $PORT' } as const;
export const UI = { kind: 'ui', start: 'bun x vite --port $PORT --strictPort' } as const;
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
  writeFileSync(process.env.LOCAL_REGISTRY_PATH!, JSON.stringify({ version: 1, apps: {} }));
  writeFileSync(process.env.LOCAL_APPS_SETTINGS_PATH!, JSON.stringify({ version: 1, apps: {} }));
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
```

- [ ] **Step 3: Write the failing engine tests**

```ts
// apps/deck/src/live/engine.test.ts
import { realpathSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { commit, freshChat, gitRepo, manifest, routes, SERVER, UI } from './test-kit.ts';
import { clearLive, getLive, getOverride, setOverride } from '../../core/settings.ts';
import { clearSetup, setupFor } from './setup.ts';
import { goLive, liveRefusal, liveSpecs, stopLive } from './engine.ts';

let { shared, manager, trees, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, trees, deps } = freshChat());
});

afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});

test('only a linked mattstack app in dev mode can go live', () => {
  expect(liveRefusal(undefined, true)).toBe('unknown app');
  const rec = { name: 'chat', managedBy: 'rt', port: 1, kind: 'service', createdAt: '' } as never;
  expect(liveRefusal(rec, false)).toBe('live mode only runs in the dev app');
  expect(liveRefusal({ ...(rec as object), managedBy: 'user' } as never, true)).toBe('only mattstack apps can go live');
  expect(liveRefusal({ ...(rec as object), managedBy: 'deck' } as never, true)).toBe('deck itself cannot go live');
  expect(liveRefusal(rec, true)).toBe('chat has no linked source');
});

test('going live swaps the normal service for one per process and moves both routes', async () => {
  const r = await goLive('chat', shared, manager, deps());
  expect(r.status).toBe(200);
  expect([...manager.installed.keys()].sort()).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.ui',
  ]);
  const live = getLive('chat')!;
  expect(live).toMatchObject({ source: shared, branch: 'main', startedAt: '2026-10-09T21:12:00.000Z' });
  expect(routes().map(x => x.port)).toEqual([live.uiPort, live.uiPort]);
  const ui = manager.installed.get('com.mattstack.deck.chat.live.ui')!;
  expect(ui.workingDirectory).toBe(join(shared, 'apps/chat'));
  expect(ui.environment.PORT).toBe(String(live.uiPort));
  expect(ui.environment.SERVER_PORT).toBe('11002');
  const server = manager.installed.get('com.mattstack.deck.chat.live.server')!;
  expect(server.environment.PORT).toBe('11002');
});

test('an app with no ui keeps its routes on its own port', async () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([SERVER]) });
  expect((await goLive('chat', shared, manager, deps())).status).toBe(200);
  expect(getLive('chat')!.uiPort).toBeUndefined();
  expect(routes().map(x => x.port)).toEqual([11002, 11002]);
});

test('a manual override is cleared and stopping leaves both routes on the app port', async () => {
  setOverride('chat', { devPort: 5173, basePort: 11002 });
  await goLive('chat', shared, manager, deps());
  expect(getOverride('chat')).toBeUndefined();
  const r = await stopLive('chat', manager, deps());
  expect(r.status).toBe(200);
  expect(routes().map(x => x.port)).toEqual([11002, 11002]);
  expect(getLive('chat')).toBeUndefined();
  expect([...manager.installed.keys()]).toEqual([]);
});

test('stop removes every live label, even one the manifest no longer names', async () => {
  await goLive('chat', shared, manager, deps());
  manager.installed.set('com.mattstack.deck.chat.live.worker-1', {} as never);
  await stopLive('chat', manager, deps());
  expect([...manager.installed.keys()]).toEqual([]);
});

test('a source with no valid live list is refused and nothing changes', async () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([UI]) });
  const r = await goLive('chat', shared, manager, deps());
  expect(r).toEqual({ status: 400, body: { error: "can't go live: no server in the live list" } });
  expect([...manager.installed.keys()]).toEqual(['com.mattstack.deck.chat']);
  expect(getLive('chat')).toBeUndefined();
});

test('a worktree without the app is refused', async () => {
  const wt = realpathSync(gitRepo({ 'README.md': 'x' }));
  const r = await goLive('chat', wt, manager, deps({
    sources: {
      exists: () => true,
      listTrees: async () => [...trees(), { path: wt, branch: 'wt', kind: 'unmanaged', state: null, repoName: 'r' }],
    },
  }));
  expect(r).toEqual({ status: 400, body: { error: 'that checkout has no apps/chat' } });
});

test('a path that is not one of the listed sources is refused', async () => {
  const r = await goLive('chat', '/tmp/elsewhere', manager, deps());
  expect(r.status).toBe(400);
});

test('a worktree that needs setup answers 202, then goes live when setup passes', async () => {
  const wt = realpathSync(gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) }));
  let finish!: (code: number) => void;
  const r = await goLive('chat', wt, manager, deps({
    sources: {
      exists: () => false,
      listTrees: async () => [...trees(), { path: wt, branch: 'main', kind: 'unmanaged', state: null, repoName: 'r', readyAt: null }],
    },
    setup: { run: () => new Promise<number>(res => (finish = res)) },
  }));
  expect(r.status).toBe(202);
  expect(setupFor('chat')?.state).toBe('running');
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(true);
  finish(0);
  await new Promise(res => setTimeout(res, 20));
  expect(getLive('chat')?.source).toBe(wt);
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(false);
});

test('liveSpecs gives workers no PORT and numbers them', () => {
  const rec = { name: 'chat', managedBy: 'rt', port: 11002, kind: 'service', createdAt: '' } as never;
  const specs = liveSpecs(rec, [{ kind: 'server', start: 'echo a' }, { kind: 'worker', start: 'echo b' }], '/x', null);
  expect(specs.map(s => s.label)).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.worker-1',
  ]);
  expect(specs[1]!.environment.PORT).toBeUndefined();
  expect(specs[1]!.environment.SERVER_PORT).toBe('11002');
});

test('a failed install stops live and asks for the normal service back', async () => {
  let reinstalled = 0;
  manager.failNext = 'com.mattstack.deck.chat.live.server';
  const r = await goLive('chat', shared, manager, deps({ reinstall: async () => void reinstalled++ }));
  expect(r.status).toBe(500);
  expect(getLive('chat')).toBeUndefined();
  expect(reinstalled).toBe(1);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/engine.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `src/live/engine.ts`**

```ts
import { existsSync } from 'fs';
import { join } from 'path';

import { MATTSTACK_TLD, readRoutes, readServices } from '../../core/discover.ts';
import { setAppRoutesPort } from '../../core/routes-writer.ts';
import {
  clearLive,
  clearOverride,
  getLive,
  getOverride,
  setLive,
  type LiveState,
} from '../../core/settings.ts';
import { isDevMode } from '../api/dev-mode.ts';
import { getPlatformSettings } from '../api/platform-settings.ts';
import { logsDir } from '../api/state.ts';
import { allocatePort } from '../registry/allocate.ts';
import {
  liveProcessIds,
  readDeckManifest,
  startArgv,
  type LiveProcess,
} from '../registry/deck-manifest.ts';
import {
  getRecord,
  isMattstackOwned,
  listRecords,
  type AppRecord,
} from '../registry/records.ts';
import { readLinkedManifest } from '../registry/serve-shape.ts';
import { serviceEnv } from '../registry/service-env.ts';
import { composeServicePath, resolveProgram } from '../services/exec-env.ts';
import { installedMatches } from '../services/installed.ts';
import {
  isPlatformManagedBy,
  type ServiceManager,
  type ServiceSpec,
} from '../services/manager.ts';
import { liveLabel, liveLabelPrefix } from './labels.ts';
import { clearSetup, runSetup, setupFor, type SetupDeps } from './setup.ts';
import {
  appDirIn,
  branchOf,
  listLiveSources,
  sharedRootFor,
  type SourcesDeps,
} from './sources.ts';

export interface LiveDeps {
  devMode?: () => boolean;
  sources?: SourcesDeps;
  setup?: SetupDeps;
  now?: () => Date;
  installedLabels?: () => Promise<string[]>;
  onRouteWrite?: () => void;
  tlds?: () => string[];
  reinstall?: () => Promise<unknown>;
}

export type LiveResult = { status: number; body: unknown };

const refuse = (status: number, error: string): LiveResult => ({
  status,
  body: { error },
});

function tldsOf(deps: LiveDeps): string[] {
  if (deps.tlds) return deps.tlds();
  return [...new Set([...getPlatformSettings().tlds, MATTSTACK_TLD])];
}

async function installedLabelsOf(deps: LiveDeps): Promise<string[]> {
  if (deps.installedLabels) return deps.installedLabels();
  return (await readServices()).map(s => s.label);
}

export function liveRefusal(
  record: AppRecord | undefined,
  devMode: boolean
): string | null {
  if (!record) return 'unknown app';
  if (!devMode) return 'live mode only runs in the dev app';
  if (isPlatformManagedBy(record.managedBy)) return 'deck itself cannot go live';
  if (!isMattstackOwned(record)) return 'only mattstack apps can go live';
  if (readLinkedManifest(record).state !== 'linked')
    return `${record.name} has no linked source`;
  return null;
}

export function liveManifestAt(
  appDir: string
): { ok: true; live: LiveProcess[] } | { ok: false; error: string } {
  const parsed = readDeckManifest(appDir);
  if (!parsed) return { ok: false, error: 'no mattstack.deck.json there' };
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.manifest.liveError)
    return { ok: false, error: `can't go live: ${parsed.manifest.liveError}` };
  if (!parsed.manifest.live)
    return { ok: false, error: "can't go live: the manifest has no live list" };
  return { ok: true, live: parsed.manifest.live };
}

export function liveSpecs(
  record: AppRecord,
  live: LiveProcess[],
  appDir: string,
  uiPort: number | null
): ServiceSpec[] {
  const base = serviceEnv(record);
  const path = base.PATH ?? composeServicePath();
  const ids = liveProcessIds(live);
  return live.map((proc, i) => {
    const id = ids[i]!;
    const [argv0, ...rest] = startArgv(proc.start);
    const program = resolveProgram(argv0!, path);
    if (!program)
      throw new Error(`${argv0} not found on the service PATH (${path})`);
    const environment: Record<string, string> = {
      ...base,
      PATH: path,
      SERVER_PORT: String(record.port),
    };
    if (proc.kind === 'ui') environment.PORT = String(uiPort);
    else if (proc.kind === 'worker') delete environment.PORT;
    return {
      label: liveLabel(record.name, id),
      programArguments: [program, ...rest],
      workingDirectory: appDir,
      environment,
      stdoutPath: join(logsDir(), `${record.name}.live.${id}.out.log`),
      stderrPath: join(logsDir(), `${record.name}.live.${id}.err.log`),
    };
  });
}

export async function uninstallLive(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps = {},
  keep: Set<string> = new Set()
): Promise<void> {
  const prefix = liveLabelPrefix(name);
  for (const label of await installedLabelsOf(deps))
    if (label.startsWith(prefix) && !keep.has(label))
      await manager.uninstall(label);
}

function routeTo(record: AppRecord, port: number, deps: LiveDeps): void {
  if (setAppRoutesPort(record.name, port, tldsOf(deps)).length)
    deps.onRouteWrite?.();
}

/** Installs only what differs from the installed plists, so a sweep over an
    app that is already live restarts nothing. */
export async function installLive(
  record: AppRecord,
  state: LiveState,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<string | null> {
  const sharedRoot = sharedRootFor(record);
  if (!sharedRoot) return `${record.name}'s linked source is not a git checkout`;
  const appDir = appDirIn(record, state.source, sharedRoot)!;
  if (!existsSync(appDir)) return `that checkout has no apps/${record.name}`;
  const manifest = liveManifestAt(appDir);
  if (!manifest.ok) return manifest.error;
  const hasUi = manifest.live.some(p => p.kind === 'ui');
  if (hasUi && state.uiPort === undefined) return 'no live UI port recorded';
  let specs: ServiceSpec[];
  try {
    specs = liveSpecs(record, manifest.live, appDir, state.uiPort ?? null);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  try {
    await uninstallLive(record.name, manager, deps, new Set(specs.map(s => s.label)));
    for (const spec of specs) {
      if (installedMatches(spec.label, spec)) continue;
      await manager.uninstall(spec.label);
      await manager.install(spec);
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  routeTo(record, hasUi ? state.uiPort! : record.port, deps);
  return null;
}

async function freeUiPort(): Promise<number | null> {
  return allocatePort(listRecords(), readRoutes(), await readServices());
}

async function activate(
  record: AppRecord,
  source: string,
  live: LiveProcess[],
  manager: ServiceManager,
  deps: LiveDeps
): Promise<string | null> {
  const previous = getLive(record.name);
  const hasUi = live.some(p => p.kind === 'ui');
  const uiPort = hasUi ? (previous?.uiPort ?? (await freeUiPort())) : undefined;
  if (hasUi && uiPort == null) return 'no free port for the live UI';
  if (!previous) {
    if (getOverride(record.name)) clearOverride(record.name);
    if (record.label) await manager.uninstall(record.label);
  }
  setLive(record.name, {
    source,
    branch: branchOf(source),
    startedAt: (deps.now ?? (() => new Date()))().toISOString(),
    ...(uiPort != null && { uiPort }),
  });
  const err = await installLive(record, getLive(record.name)!, manager, deps);
  if (err) {
    await stopLive(record.name, manager, deps);
    await deps.reinstall?.();
  }
  return err;
}

export async function goLive(
  name: string,
  source: string,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<LiveResult> {
  const record = getRecord(name);
  const refusal = liveRefusal(record, (deps.devMode ?? isDevMode)());
  if (refusal) return refuse(refusal === 'unknown app' ? 404 : 400, refusal);
  if (setupFor(name)?.state === 'running')
    return refuse(409, `${name} is still setting up`);
  const sharedRoot = sharedRootFor(record!);
  if (!sharedRoot) return refuse(400, `${name}'s linked source is not a git checkout`);
  const { sources } = await listLiveSources(sharedRoot, deps.sources);
  const picked = sources.find(s => s.path === source);
  if (!picked) return refuse(400, 'pick the shared checkout or one of your worktrees');
  const appDir = appDirIn(record!, source, sharedRoot)!;
  if (!existsSync(appDir)) return refuse(400, `that checkout has no apps/${name}`);
  const manifest = liveManifestAt(appDir);
  if (!manifest.ok) return refuse(400, manifest.error);
  if (picked.needsSetup) {
    void runSetup(name, source, picked.branch, deps.setup).then(ok =>
      ok ? activate(record!, source, manifest.live, manager, deps) : null
    );
    return { status: 202, body: { ok: true, setup: 'running' } };
  }
  const err = await activate(record!, source, manifest.live, manager, deps);
  return err ? refuse(500, err) : { status: 200, body: { ok: true } };
}

export async function stopLive(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<LiveResult> {
  const record = getRecord(name);
  if (!record) return refuse(404, 'unknown app');
  clearSetup(name);
  await uninstallLive(name, manager, deps);
  routeTo(record, record.port, deps);
  clearLive(name);
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live/engine.test.ts src/api/register.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/deck/src/live/engine.ts apps/deck/src/live/engine.test.ts apps/deck/src/live/test-kit.ts
git commit -m "deck live: go live, switch and stop, one service per live process"
```

---

### Task 9: Live mode survives restarts and deleted worktrees

**Files:**
- Modify: `apps/deck/src/api/register.ts` (`sweepManagedApps`)
- Modify: `apps/deck/core/reconcile.ts` (`reconcileOnce`)
- Create: `apps/deck/src/live/reconcile.ts`
- Modify: `apps/deck/src/api/server.ts` (`applyOverride` refuses while live)
- Test: `apps/deck/src/live/reconcile.test.ts`
- Test: `apps/deck/src/live/sweep.test.ts` (create)
- Test: `apps/deck/src/api/server.test.ts` (override refusal)

**Interfaces:**
- Consumes: `installLive`, `uninstallLive`, `LiveDeps` (Task 8); `getLive`, `getLives`, `setLive`, `clearLive` (Task 4); `sharedRootFor` (Task 6).
- Produces: `export async function reconcileLive(manager: ServiceManager, deps?: LiveDeps): Promise<void>`; `export let liveSweepDeps: LiveDeps` plus `export function setLiveSweepDeps(deps: LiveDeps): void` in `register.ts` (test seam, same pattern as `setServeShapeDeps`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/live/reconcile.test.ts
import { rmSync, realpathSync } from 'fs';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { freshChat, gitRepo, manifest, routes, SERVER, UI } from './test-kit.ts';
import { clearLive, getLive, setLive } from '../../core/settings.ts';
import { reconcileLive } from './reconcile.ts';

let { shared, manager, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps } = freshChat());
});
afterEach(() => clearLive('chat'));

test('a deleted worktree moves the app to live from main and remembers the branch', async () => {
  const wt = realpathSync(gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) }));
  setLive('chat', { source: wt, branch: 'deck-live-mode', startedAt: 'x', uiPort: 11140 });
  rmSync(wt, { recursive: true, force: true });
  await reconcileLive(manager, deps());
  expect(getLive('chat')).toMatchObject({
    source: shared,
    branch: 'main',
    uiPort: 11140,
    movedFrom: 'deck-live-mode',
  });
  expect(manager.installed.has('com.mattstack.deck.chat.live.ui')).toBe(true);
  expect(routes().map(r => r.port)).toEqual([11140, 11140]);
});

test('a live app whose routes drifted is pointed back at its UI', async () => {
  setLive('chat', { source: shared, branch: 'main', startedAt: 'x', uiPort: 11140 });
  await reconcileLive(manager, deps());
  expect(routes().map(r => r.port)).toEqual([11140, 11140]);
});

test('live state for a removed app is dropped', async () => {
  setLive('ghost', { source: shared, branch: 'main', startedAt: 'x' });
  await reconcileLive(manager, deps());
  expect(getLive('ghost')).toBeUndefined();
});
```

```ts
// apps/deck/src/live/sweep.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { freshChat } from './test-kit.ts';
import { clearLive, getLive, setLive } from '../../core/settings.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import {
  reresolveManagedApps,
  setLiveSweepDeps,
  setServeShapeDeps,
} from '../api/register.ts';

let { shared, manager, deps } = freshChat();
beforeEach(() => {
  ({ shared, manager, deps } = freshChat());
  setLive('chat', { source: shared, branch: 'main', startedAt: 'x', uiPort: 11140 });
  setLiveSweepDeps(deps());
});
afterEach(() => {
  clearLive('chat');
  setServeShapeDeps({});
  setLiveSweepDeps({});
});

test('the sweep keeps a live app live and its normal service off', async () => {
  setServeShapeDeps({ devMode: () => true, catalog: null, helpersDir: null });
  const r = await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect((r.body as { failed: unknown[] }).failed).toEqual([]);
  expect(manager.installed.has('com.mattstack.deck.chat')).toBe(false);
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(true);
  expect(manager.installed.has('com.mattstack.deck.chat.live.ui')).toBe(true);
});

test('prod drops live state and serves normally', async () => {
  setServeShapeDeps({ devMode: () => false, catalog: null, helpersDir: null });
  manager.installed.set('com.mattstack.deck.chat.live.server', {} as never);
  await reresolveManagedApps({ manager, edge: new FakeEdgeProxy() });
  expect(getLive('chat')).toBeUndefined();
  expect(manager.installed.has('com.mattstack.deck.chat.live.server')).toBe(false);
});
```

In `server.test.ts`, add next to the existing override tests (it already imports `putRecord`; add `setLive`, `clearLive` from `../../core/settings.ts`):

```ts
test('PUT override is refused while the app is live', async () => {
  putRecord({ name: 'livey', managedBy: 'rt', port: 18099, kind: 'service', createdAt: '' });
  setLive('livey', { source: '/x', branch: 'main', startedAt: 'x' });
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/livey/override`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ devPort: 5173 }),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'live mode owns this route; stop live first' });
  clearLive('livey');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/reconcile.test.ts src/live/sweep.test.ts src/api/server.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`apps/deck/src/live/reconcile.ts`:

```ts
import { existsSync } from 'fs';

import { clearLive, getLives, setLive } from '../../core/settings.ts';
import { getRecord } from '../registry/records.ts';
import type { ServiceManager } from '../services/manager.ts';
import { installLive, type LiveDeps } from './engine.ts';
import { branchOf, sharedRootFor } from './sources.ts';

/** Runs on deck's 5-second tick: re-asserts each live app's services and
    routes, and moves an app off a worktree that no longer exists. */
export async function reconcileLive(
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<void> {
  for (const [name, state] of Object.entries(getLives())) {
    const record = getRecord(name);
    if (!record) {
      clearLive(name);
      continue;
    }
    let next = state;
    if (!existsSync(state.source)) {
      const sharedRoot = sharedRootFor(record);
      if (!sharedRoot) continue;
      next = {
        ...state,
        source: sharedRoot,
        branch: branchOf(sharedRoot),
        movedFrom: state.branch ?? state.source,
      };
      setLive(name, next);
    }
    const err = await installLive(record, next, manager, deps);
    if (err) console.error(`live reconcile for ${name}: ${err}`);
  }
}
```

In `register.ts`, add the seam beside `serveShapeDeps`:

```ts
export let liveSweepDeps: LiveDeps = {};
export function setLiveSweepDeps(deps: LiveDeps): void {
  liveSweepDeps = deps;
}
```

and in `sweepManagedApps`, inside the record loop, right before `const shape = serveShape(record, serveShapeDeps);`:

```ts
    const live = getLive(record.name);
    if (live && !flavor.dev) {
      await uninstallLive(record.name, drivers.manager, liveSweepDeps);
      clearLive(record.name);
    } else if (live) {
      const issue = await runDriver('launchd', () =>
        drivers.manager.uninstall(record.label!)
      );
      const err =
        issue?.message ??
        (await installLive(record, live, drivers.manager, liveSweepDeps));
      if (err) {
        addIssue(record.name, { source: 'launchd', message: err, at: new Date().toISOString() });
        failed.push({ name: record.name, error: err });
      } else {
        clearIssues(record.name, 'launchd');
        unchanged.push(record.name);
      }
      continue;
    }
```

(imports: `getLive`, `clearLive` from `../../core/settings.ts`; `installLive`, `uninstallLive`, `type LiveDeps` from `../live/engine.ts`.)

In `core/reconcile.ts`, extend `reconcileOnce`:

```ts
import { reconcileLive } from '../src/live/reconcile.ts';
import { isDevMode } from '../src/api/dev-mode.ts';

export async function reconcileOnce(): Promise<void> {
  for (const { hostname, devPort } of overridesToReassert(readRoutes(), getOverrides())) {
    setRoutePort(hostname, devPort);
  }
  if (isDevMode()) {
    try {
      await reconcileLive(new LaunchdManager());
    } catch (err) {
      console.error('live reconcile failed:', err);
    }
  }
  await reconcileRemoteTick();
  await reconcileEdgeTick();
}
```

In `server.ts` `applyOverride`, first line after the unknown-app check:

```ts
  if (getLive(app))
    return [{ error: 'live mode owns this route; stop live first' }, 409];
```

(import `getLive` from `../../core/settings.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live src/api/register.test.ts src/api/server.test.ts core/reconcile.test.ts`

(`src/live` now includes `reconcile.test.ts` and `sweep.test.ts`.)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/live/reconcile.ts apps/deck/src/live/reconcile.test.ts apps/deck/src/live/sweep.test.ts apps/deck/src/api/register.ts apps/deck/core/reconcile.ts apps/deck/src/api/server.ts apps/deck/src/api/server.test.ts
git commit -m "deck live: keep live apps live across restarts, move off deleted worktrees"
```

---

### Task 10: Status rows say what is live

**Files:**
- Create: `apps/deck/src/live/status.ts`
- Modify: `apps/deck/src/api/status.ts` (`StatusRow`, `buildStatus`)
- Test: `apps/deck/src/live/status.test.ts`

**Interfaces:**
- Produces on `StatusRow` (dev mode, local callers, mattstack rows that are not the platform):
  - `live?: { branch: string | null; main: boolean; startedAt: string; uiPort: number | null; movedFrom: string | null; processes: Array<{ id: string; kind: LiveKind; command: string; port: number | null; running: boolean }> }`
  - `liveSetup?: { state: 'running' | 'failed'; branch: string | null; log: string[] }`
  - `liveBlocked?: string | null` (null means the app can go live; a string is the reason it cannot; absent means live controls do not apply to this row)
- Produces: `export function liveRowFields(record: AppRecord | undefined, opts: { devMode: boolean; local: boolean }, services: LaunchdService[]): Pick<StatusRow, 'live' | 'liveSetup' | 'liveBlocked'>`
- While `live` is set, `buildStatus` leaves `newCode` unset and drops `build` and `deploy` from `commands`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/live/status.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { commit, freshChat, manifest, SERVER, UI } from './test-kit.ts';
import { clearLive, setLive } from '../../core/settings.ts';
import { clearSetup, runSetup } from './setup.ts';
import { liveRowFields } from './status.ts';

let { shared, record } = freshChat();
beforeEach(() => {
  ({ shared, record } = freshChat());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});

const svc = (label: string, pid: number | null) =>
  ({ label, plistPath: '', program: [], workingDirectory: null, stderrPath: null, port: null, pid, lastExitStatus: null }) as never;
const ON = { devMode: true, local: true };

test('nothing for a user app, prod or a public caller', () => {
  expect(liveRowFields({ ...record(), managedBy: 'user' }, ON, [])).toEqual({});
  expect(liveRowFields(record(), { devMode: false, local: true }, [])).toEqual({});
  expect(liveRowFields(record(), { devMode: true, local: false }, [])).toEqual({});
});

test('a linked app with a valid live list can go live', () => {
  expect(liveRowFields(record(), ON, [])).toEqual({ liveBlocked: null });
});

test('a broken live list says why', () => {
  commit(shared, { 'apps/chat/mattstack.deck.json': manifest([UI]) });
  expect(liveRowFields(record(), ON, [])).toEqual({ liveBlocked: 'no server in the live list' });
});

test('a live app lists its processes and which are running', () => {
  setLive('chat', { source: shared, branch: 'main', startedAt: 't', uiPort: 11140 });
  const f = liveRowFields(record(), ON, [
    svc('com.mattstack.deck.chat.live.server', 41),
    svc('com.mattstack.deck.chat.live.ui', null),
  ]);
  expect(f.live).toEqual({
    branch: 'main',
    main: true,
    startedAt: 't',
    uiPort: 11140,
    movedFrom: null,
    processes: [
      { id: 'server', kind: 'server', command: SERVER.start, port: 11002, running: true },
      { id: 'ui', kind: 'ui', command: UI.start, port: 11140, running: false },
    ],
  });
});

test('a failed setup carries its log', async () => {
  await runSetup('chat', '/wt/a', 'a', { run: async (_c, _d, on) => (on('boom'), 1) });
  expect(liveRowFields(record(), ON, []).liveSetup).toEqual({
    state: 'failed',
    branch: 'a',
    log: ['$ bun install', 'boom'],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/live/status.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/deck/src/live/status.ts
import type { LaunchdService } from '../../core/discover.ts';
import { getLive } from '../../core/settings.ts';
import { liveProcessIds, type LiveKind } from '../registry/deck-manifest.ts';
import { isMattstackOwned, type AppRecord } from '../registry/records.ts';
import { readLinkedManifest } from '../registry/serve-shape.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { liveManifestAt } from './engine.ts';
import { liveLabel } from './labels.ts';
import { setupFor } from './setup.ts';
import { appDirIn, sharedRootFor } from './sources.ts';

export interface LiveRow {
  branch: string | null;
  main: boolean;
  startedAt: string;
  uiPort: number | null;
  movedFrom: string | null;
  processes: Array<{
    id: string;
    kind: LiveKind;
    command: string;
    port: number | null;
    running: boolean;
  }>;
}

export interface LiveRowFields {
  live?: LiveRow;
  liveSetup?: { state: 'running' | 'failed'; branch: string | null; log: string[] };
  liveBlocked?: string | null;
}

export function liveRowFields(
  record: AppRecord | undefined,
  opts: { devMode: boolean; local: boolean },
  services: LaunchdService[]
): LiveRowFields {
  if (!record || !opts.devMode || !opts.local) return {};
  if (!isMattstackOwned(record) || isPlatformManagedBy(record.managedBy)) return {};
  const out: LiveRowFields = {};
  const setup = setupFor(record.name);
  if (setup) out.liveSetup = { state: setup.state, branch: setup.branch, log: setup.log };
  const state = getLive(record.name);
  const sharedRoot = sharedRootFor(record);
  if (state && sharedRoot) {
    const manifest = liveManifestAt(appDirIn(record, state.source, sharedRoot)!);
    const live = manifest.ok ? manifest.live : [];
    const ids = liveProcessIds(live);
    out.live = {
      branch: state.branch,
      main: state.source === sharedRoot,
      startedAt: state.startedAt,
      uiPort: state.uiPort ?? null,
      movedFrom: state.movedFrom ?? null,
      processes: live.map((p, i) => ({
        id: ids[i]!,
        kind: p.kind,
        command: p.start,
        port: p.kind === 'server' ? record.port : p.kind === 'ui' ? (state.uiPort ?? null) : null,
        running:
          services.find(s => s.label === liveLabel(record.name, ids[i]!))?.pid != null,
      })),
    };
    return out;
  }
  const link = readLinkedManifest(record);
  if (link.state !== 'linked') return out;
  out.liveBlocked = link.manifest.liveError ?? (link.manifest.live ? null : 'no live list in the manifest');
  return out;
}
```

In `status.ts`, extend `StatusRow` with the three optional fields (types imported from `../live/status.ts`), and in `buildStatus`'s row builder:

```ts
      const liveFields = liveRowFields(
        record,
        { devMode: !!opts.devMode, local: opts.local },
        services
      );
      const live = liveFields.live !== undefined;
      const commands = record ? commandKeysFor(record, !!opts.devMode) : undefined;
```

and in the returned row: `commands: live ? commands?.filter(c => c !== 'build' && c !== 'deploy') : commands,`, `newCode: live ? undefined : newCodeForRow(record, opts),`, then `...liveFields,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/live/status.test.ts src/api/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/live/status.ts apps/deck/src/live/status.test.ts apps/deck/src/api/status.ts
git commit -m "deck live: status rows carry live state, setup progress and why an app cannot go live"
```

---

### Task 11: Live API routes

**Files:**
- Modify: `apps/deck/src/api/server.ts`
- Test: `apps/deck/src/api/server.live.test.ts` (create)

**Interfaces:**
- Consumes: `goLive`, `stopLive`, `liveRefusal`, `LiveDeps` (Task 8); `listLiveSources`, `sharedRootFor` (Task 6); `clearSetup`, `setupFor` (Task 7); `getLives` (Task 4); `reresolveManagedApps` (existing).
- Produces:
  - `ApiDeps.live?: LiveDeps` (test seam; production leaves it unset)
  - `GET /api/v1/apps/:name/live/sources` → `{ sources: Array<LiveSource & { liveApps: string[] }>, error: string | null }` (400 with `{ error }` when the app cannot go live)
  - `PUT /api/v1/apps/:name/live` body `{ source: string }` → `goLive` result
  - `DELETE /api/v1/apps/:name/live` → stops live (then runs the sweep so the normal service comes back) or, when not live, dismisses a failed setup; `{ ok: true }`
  - `GET /api/v1/live` → `{ apps: Array<{ name: string; source: string; branch: string | null; startedAt: string }> }`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/api/server.live.test.ts
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { freshChat, managerOf } from '../live/test-kit.ts';
import { clearLive, getLive } from '../../core/settings.ts';
import { clearSetup, runSetup, setupFor } from '../live/setup.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { startApi } from './server.ts';

const PORT = 18951;
let kit = freshChat();
const live: LiveDeps = {};
const server = startApi({
  manager: managerOf(() => kit.manager),
  edge: new FakeEdgeProxy(),
  tunnel: new FakeTunnelDriver(),
  port: PORT,
  canaryPort: PORT + 1,
  freshness: () => 'unknown',
  autoHeal: () => null,
  onRouteWrite: () => {},
  devMode: () => true,
  live,
});
beforeEach(() => {
  kit = freshChat();
  Object.assign(live, kit.deps());
});
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});
afterAll(() => server.stop(true));

const api = (path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

test('sources lists main with the apps live from it', async () => {
  const res = await api('/api/v1/apps/chat/live/sources');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.sources[0]).toMatchObject({ path: kit.shared, main: true, liveApps: [] });
});

test('PUT goes live, GET /live lists it, DELETE stops it', async () => {
  const put = await api('/api/v1/apps/chat/live', { method: 'PUT', body: JSON.stringify({ source: kit.shared }) });
  expect(put.status).toBe(200);
  const list = await (await api('/api/v1/live')).json();
  expect(list.apps).toEqual([
    { name: 'chat', source: kit.shared, branch: 'main', startedAt: expect.any(String) },
  ]);
  expect((await api('/api/v1/apps/chat/live', { method: 'DELETE' })).status).toBe(200);
  expect(getLive('chat')).toBeUndefined();
});

test('restart on a live app kickstarts its live services', async () => {
  await api('/api/v1/apps/chat/live', { method: 'PUT', body: JSON.stringify({ source: kit.shared }) });
  kit.manager.kickstarts.length = 0;
  const res = await api('/api/v1/apps/chat/restart', { method: 'POST' });
  expect(await res.json()).toEqual({ ok: true });
  expect(kit.manager.kickstarts.sort()).toEqual([
    'com.mattstack.deck.chat.live.server',
    'com.mattstack.deck.chat.live.ui',
  ]);
});

test('sources for an unknown app is a 404', async () => {
  const res = await api('/api/v1/apps/nope/live/sources');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'unknown app' });
});

test('a cross-origin page cannot go live', async () => {
  const res = await api('/api/v1/apps/chat/live', {
    method: 'PUT',
    body: JSON.stringify({ source: kit.shared }),
    headers: { origin: 'https://evil.example' },
  });
  expect(res.status).toBe(403);
});

test('DELETE on an app that is not live dismisses a failed setup', async () => {
  await runSetup('chat', '/wt/a', 'a', { run: async () => 1 });
  expect((await api('/api/v1/apps/chat/live', { method: 'DELETE' })).status).toBe(200);
  expect(setupFor('chat')).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/api/server.live.test.ts`
Expected: FAIL (404s).

- [ ] **Step 3: Implement**

In `ApiDeps` add `/** Test seam for live mode; production leaves it unset. */ live?: LiveDeps;`.

Inside `fetch`, in the `/api/v1/` block, before the `/api/v1/apps/register` check:

```ts
        const liveDeps: LiveDeps = {
          devMode: deps.devMode ?? isDevMode,
          onRouteWrite: deps.onRouteWrite,
          reinstall: () => reresolveManagedApps(deps),
          ...deps.live,
        };
        if (pathname === '/api/v1/live' && req.method === 'GET') {
          return json({
            apps: Object.entries(getLives()).map(([name, s]) => ({
              name,
              source: s.source,
              branch: s.branch,
              startedAt: s.startedAt,
            })),
          });
        }
        const liveSources = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/live\/sources$/);
        if (liveSources && req.method === 'GET') {
          const record = getRecord(liveSources[1]!);
          const refusal = liveRefusal(record, (liveDeps.devMode ?? isDevMode)());
          if (refusal) return json({ error: refusal }, refusal === 'unknown app' ? 404 : 400);
          const root = sharedRootFor(record!);
          if (!root) return json({ error: `${record!.name}'s linked source is not a git checkout` }, 400);
          const { sources, error } = await listLiveSources(root, liveDeps.sources);
          const lives = Object.entries(getLives());
          return json({
            sources: sources.map(s => ({
              ...s,
              liveApps: lives.filter(([, l]) => l.source === s.path).map(([n]) => n),
            })),
            error,
          });
        }
```

Inside the generic `/api/v1/apps/:name/:sub` block, add:

```ts
          if (sub === 'live' && req.method === 'PUT') {
            const b = await body(req);
            const r = await goLive(name, String(b.source ?? ''), deps.manager, liveDeps);
            return json(r.body, r.status);
          }
          if (sub === 'live' && req.method === 'DELETE') {
            if (!getLive(name)) {
              clearSetup(name);
              return json({ ok: true });
            }
            const r = await stopLive(name, deps.manager, liveDeps);
            if (r.status === 200) await reresolveManagedApps(deps);
            return json(r.body, r.status);
          }
```

Compute `liveDeps` right after `const force = …`, before the first route that uses it.

Make the existing restart route aware of live apps. At the top of `if (sub === 'restart' && req.method === 'POST') {`:

```ts
            if (getLive(name)) {
              const prefix = liveLabelPrefix(name);
              const labels = (
                await (liveDeps.installedLabels ?? (async () => (await readServices()).map(s => s.label)))()
              ).filter(l => l.startsWith(prefix));
              const oks = await Promise.all(labels.map(l => deps.manager.kickstart(l)));
              return json({ ok: oks.length > 0 && oks.every(Boolean) });
            }
```

(imports: `getLive`, `getLives` from `../../core/settings.ts`; `goLive`, `stopLive`, `liveRefusal`, `type LiveDeps` from `../live/engine.ts`; `liveLabelPrefix` from `../live/labels.ts`; `listLiveSources`, `sharedRootFor` from `../live/sources.ts`; `clearSetup` from `../live/setup.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/api/server.live.test.ts src/api/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api/server.ts apps/deck/src/api/server.live.test.ts
git commit -m "deck live: API to list sources, go live, stop and list live apps"
```

---

### Task 12: `deck live` CLI

**Files:**
- Modify: `apps/deck/src/cli/commands.ts`
- Test: `apps/deck/src/cli/live.test.ts` (create)

**Interfaces:**
- Consumes: the Task 11 routes through `apiJson`.
- Produces: `deck live`, `deck live <app> on [--worktree <branch|path>] [--json]`, `deck live <app> off [--json]`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/deck/src/cli/live.test.ts
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { freshChat, managerOf } from '../live/test-kit.ts';
import { clearLive } from '../../core/settings.ts';
import { startApi } from '../api/server.ts';
import { writeApiInfo } from '../api/state.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { runCommand } from './commands.ts';

const PORT = 18955;
let kit = freshChat();
const live: LiveDeps = {};
const server = startApi({
  manager: managerOf(() => kit.manager),
  edge: new FakeEdgeProxy(),
  tunnel: new FakeTunnelDriver(),
  port: PORT,
  canaryPort: PORT + 1,
  freshness: () => 'unknown',
  autoHeal: () => null,
  onRouteWrite: () => {},
  devMode: () => true,
  live,
});
beforeEach(() => {
  kit = freshChat();
  Object.assign(live, kit.deps());
  writeApiInfo(PORT);
});
afterEach(() => clearLive('chat'));
afterAll(() => server.stop(true));

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCommand(argv, { out: s => out.push(s), err: s => err.push(s) });
  return { out, err, code };
}

test('on with no --worktree runs main', async () => {
  const { out, code } = await run(['live', 'chat', 'on']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is live from main']);
});

test('deck live lists live apps', async () => {
  await run(['live', 'chat', 'on']);
  expect((await run(['live'])).out).toEqual([`${'chat'.padEnd(24)} main`]);
});

test('an unknown worktree is a plain error', async () => {
  const { err, code } = await run(['live', 'chat', 'on', '--worktree', 'nope']);
  expect(code).toBe(1);
  expect(err).toEqual(['no worktree named nope']);
});

test('off brings it back', async () => {
  await run(['live', 'chat', 'on']);
  const { out, code } = await run(['live', 'chat', 'off']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is back to normal']);
});

test('--json prints the API answer', async () => {
  const { out } = await run(['live', 'chat', 'on', '--json']);
  expect(JSON.parse(out[0]!)).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test src/cli/live.test.ts`
Expected: FAIL (`deck: named https…` usage printed, code 2).

- [ ] **Step 3: Implement**

Add to `USAGE` after the `override` line:

```
  deck live                                list apps running live
  deck live <app> on [--worktree B|PATH]   run <app> live, reloading as you edit
  deck live <app> off                      stop running <app> live
```

Add the case:

```ts
      case 'live': {
        const json = rest.includes('--json');
        const args = rest.filter(a => a !== '--json');
        const [name, action] = args;
        if (!name) {
          const { body } = await apiJson('/api/v1/live');
          if (json) io.out(JSON.stringify(body));
          else
            for (const a of body.apps ?? [])
              io.out(`${String(a.name).padEnd(24)} ${a.branch ?? 'main'}`);
          return 0;
        }
        if (action === 'on') {
          const want = flag(args, '--worktree');
          const { status: ss, body: s } = await apiJson(`/api/v1/apps/${name}/live/sources`);
          if (ss >= 400) {
            io.err(s.error ?? `failed (${ss})`);
            return 1;
          }
          const sources: Array<{ path: string; branch: string | null; main: boolean }> = s.sources ?? [];
          const pick =
            want === undefined
              ? sources.find(x => x.main)
              : sources.find(x => x.branch === want || x.path === resolve(want));
          if (!pick) {
            io.err(`no worktree named ${want}`);
            return 1;
          }
          const { status, body } = await apiJson(`/api/v1/apps/${name}/live`, {
            method: 'PUT',
            body: JSON.stringify({ source: pick.path }),
          });
          if (status >= 400) {
            io.err(body.error ?? `failed (${status})`);
            return 1;
          }
          const from = pick.main ? 'main' : (pick.branch ?? pick.path);
          if (json) io.out(JSON.stringify(body));
          else
            io.out(
              status === 202
                ? `setting up ${from} first, then ${name} goes live`
                : `${name} is live from ${from}`
            );
          return 0;
        }
        if (action === 'off') {
          const { status, body } = await apiJson(`/api/v1/apps/${name}/live`, { method: 'DELETE' });
          if (status >= 400) {
            io.err(body.error ?? `failed (${status})`);
            return 1;
          }
          if (json) io.out(JSON.stringify(body));
          else io.out(`${name} is back to normal`);
          return 0;
        }
        io.err(USAGE);
        return 2;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test src/cli/live.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/cli/commands.ts apps/deck/src/cli/live.test.ts
git commit -m "deck live: CLI to list, start and stop live apps"
```

---

### Task 13: The apps declare their live setup

**Files:**
- Modify: `apps/chat/mattstack.deck.json`, `apps/console/mattstack.deck.json`, `apps/boxscore/mattstack.deck.json`, `apps/board/mattstack.deck.json`

- [ ] **Step 1: Add the `live` lists**

chat, console and boxscore each get:

```json
  "live": [
    { "kind": "server", "start": "bun --watch src/server/index.ts" },
    { "kind": "ui", "start": "bun x vite --port $PORT --strictPort" }
  ]
```

board gets:

```json
  "live": [
    { "kind": "server", "start": "caffeinate -s bun --watch src/server.ts" }
  ]
```

- [ ] **Step 2: Validate each with the real parser**

Run: `cd apps/deck && for a in chat console boxscore board; do bun -e "import { readDeckManifest } from './src/registry/deck-manifest.ts'; const r = readDeckManifest('../$a'); console.log('$a', r?.ok && r.manifest.live ? 'live ok' : JSON.stringify(r))"; done`
Expected: four `live ok` lines.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/mattstack.deck.json apps/console/mattstack.deck.json apps/boxscore/mattstack.deck.json apps/board/mattstack.deck.json
git commit -m "chat, console, boxscore, board: declare their live mode processes"
```

---

### Task 14: tui-kit SearchSelect recipe

**Files:**
- Create: `packages/tui-kit/src/recipes/SearchSelect/SearchSelect.tsx`
- Create: `packages/tui-kit/src/recipes/SearchSelect/SearchSelect.module.css`
- Create: `packages/tui-kit/src/recipes/SearchSelect/SearchSelect.test.tsx`
- Modify: `packages/tui-kit/src/index.ts`

**Interfaces:**
- Produces:
  - `export interface SearchSelectItem { value: string; label: string; group?: string; icon?: ReactNode; detail?: ReactNode }`
  - `export interface SearchSelectOwnProps { items: SearchSelectItem[]; value: string | null; onValueChange: (value: string) => void; label: string; searchPlaceholder?: string; emptyText?: string; footer?: ReactNode }`
  - `SearchSelect`, `SEARCHSELECT_PARTS`, `searchSelectTheme`, `SearchSelectOwnProps`, `SearchSelectProps` from `@mattstack/tui-kit`.
- Behaviour: a field-styled trigger shows the selected item's icon and label; clicking it opens a popup with a search input (focused) above a scrolling list; items without `group` come first, then one labelled section per `group` in input order; typing filters by label; Enter or click picks; Escape closes; a `footer` renders under the list.

- [ ] **Step 1: Write the failing browser tests**

```tsx
// packages/tui-kit/src/recipes/SearchSelect/SearchSelect.test.tsx
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { SearchSelect, type SearchSelectItem } from "./SearchSelect.tsx";

const ITEMS: SearchSelectItem[] = [
  { value: "/main", label: "main", detail: "shared checkout" },
  { value: "/wt/a", label: "console-runs-3", group: "worktrees · 2" },
  { value: "/wt/b", label: "deck-live-mode", group: "worktrees · 2", detail: "needs setup" },
];

function Harness() {
  const [value, setValue] = useState<string | null>("/main");
  return (
    <>
      <SearchSelect items={ITEMS} value={value} onValueChange={setValue} label="Code to run" searchPlaceholder="Search worktrees" />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("SearchSelect (browser)", () => {
  it("shows the picked item on its trigger", async () => {
    await renderWithTheme(<Harness />);
    await expect.element(page.getByRole("combobox", { name: "Code to run" })).toHaveTextContent("main");
  });

  it("opens with the search focused, filters, and picks with Enter", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    const search = page.getByPlaceholder("Search worktrees");
    await expect.element(search).toHaveFocus();
    await userEvent.type(search, "deck");
    await expect.element(page.getByRole("option", { name: /console-runs-3/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect.element(page.getByTestId("value")).toHaveTextContent("/wt/b");
  });

  it("labels each group once", async () => {
    await renderWithTheme(<Harness />);
    await userEvent.click(page.getByRole("combobox", { name: "Code to run" }));
    await expect.element(page.getByText("worktrees · 2")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tui-kit && bunx vitest run --project browser src/recipes/SearchSelect/SearchSelect.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Before writing, read the "Input inside popup" and "Grouped" sections of `packages/tui-kit/node_modules/@base-ui/react/docs/react/components/combobox.md`: group items are `{ value, items }`, rendered with `Combobox.Group`, `Combobox.GroupLabel` and `Combobox.Collection`. If the trigger renders with a role other than `combobox` in this mode, use that role in this task's tests and in Tasks 16 and 17.

```tsx
// packages/tui-kit/src/recipes/SearchSelect/SearchSelect.tsx
import { Combobox } from "@base-ui/react/combobox";
import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./SearchSelect.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 2 as const;

const SEARCHSELECT_SELECTORS = [
  "root", "label", "trigger", "value", "chevron", "portal", "positioner",
  "popup", "search", "list", "groupLabel", "item", "itemIcon", "itemLabel",
  "itemDetail", "empty", "footer",
] as const;

export const SEARCHSELECT_PARTS = {
  root: "search-select",
  trigger: "search-select-trigger",
  popup: "search-select-popup",
  item: "search-select-item",
} as const;

export interface SearchSelectItem {
  value: string;
  label: string;
  /** Items sharing a group render under one label, after the ungrouped ones. */
  group?: string;
  icon?: ReactNode;
  detail?: ReactNode;
}

export interface SearchSelectOwnProps {
  items: SearchSelectItem[];
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  searchPlaceholder?: string;
  emptyText?: string;
  footer?: ReactNode;
}

interface Group {
  value: string;
  items: SearchSelectItem[];
}

function grouped(items: SearchSelectItem[]): Group[] {
  const out: Group[] = [];
  for (const item of items) {
    const key = item.group ?? "";
    const last = out.at(-1);
    if (last && last.value === key) last.items.push(item);
    else out.push({ value: key, items: [item] });
  }
  return out;
}

export const SearchSelect = defineComponent<
  SearchSelectOwnProps,
  typeof SEARCHSELECT_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "SearchSelect",
  selectors: SEARCHSELECT_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const { items, value, onValueChange, label, searchPlaceholder, emptyText, footer } = props;
    const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
    const groups = useMemo(() => grouped(items), [items]);
    const selected = items.find(i => i.value === value) ?? null;
    return (
      <div ref={ref} {...getStyles("root")} data-part={SEARCHSELECT_PARTS.root}>
        <Combobox.Root
          items={groups}
          value={selected}
          onValueChange={(next: SearchSelectItem | null) => next && onValueChange(next.value)}
          isItemEqualToValue={(a: SearchSelectItem, b: SearchSelectItem) => a.value === b.value}
          itemToStringLabel={(i: SearchSelectItem) => i.label}
          autoHighlight
        >
          <Combobox.Label {...getStyles("label")}>{label}</Combobox.Label>
          <Combobox.Trigger {...getStyles("trigger")} data-part={SEARCHSELECT_PARTS.trigger} aria-label={label}>
            {selected?.icon}
            <Combobox.Value {...getStyles("value")} />
            <Combobox.Icon {...getStyles("chevron")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </Combobox.Icon>
          </Combobox.Trigger>
          {/* An in-place wrapper, not <body>, so a scoped theme around the caller still reaches the popup. */}
          <div ref={setWrapper} {...getStyles("portal")} />
          <Combobox.Portal container={wrapper}>
            <Combobox.Positioner align="start" sideOffset={4} {...getStyles("positioner")}>
              <Combobox.Popup {...getStyles("popup")} data-part={SEARCHSELECT_PARTS.popup} aria-label={label}>
                <Combobox.Input {...getStyles("search")} placeholder={searchPlaceholder} />
                <Combobox.Empty {...getStyles("empty")}>{emptyText ?? "Nothing matches"}</Combobox.Empty>
                <Combobox.List {...getStyles("list")}>
                  {(group: Group) => (
                    <Combobox.Group key={group.value} items={group.items}>
                      {group.value && <Combobox.GroupLabel {...getStyles("groupLabel")}>{group.value}</Combobox.GroupLabel>}
                      <Combobox.Collection>
                        {(item: SearchSelectItem) => (
                          <Combobox.Item key={item.value} value={item} {...getStyles("item")} data-part={SEARCHSELECT_PARTS.item}>
                            {item.icon && <span {...getStyles("itemIcon")}>{item.icon}</span>}
                            <span {...getStyles("itemLabel")}>{item.label}</span>
                            {item.detail && <span {...getStyles("itemDetail")}>{item.detail}</span>}
                          </Combobox.Item>
                        )}
                      </Combobox.Collection>
                    </Combobox.Group>
                  )}
                </Combobox.List>
                {footer && <div {...getStyles("footer")}>{footer}</div>}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
    );
  },
});

export type SearchSelectProps = ComponentProps<typeof SearchSelect>;

export const searchSelectTheme = SearchSelect.extend({});
```

```css
/* packages/tui-kit/src/recipes/SearchSelect/SearchSelect.module.css */
@layer soribashi.recipes {
  .root { display: flex; flex-direction: column; gap: var(--spacing-px6); }
  .label { color: var(--text-1); font-family: var(--font-sans); font-size: var(--font-size-px13); font-weight: 500; }
  .trigger {
    box-sizing: border-box; display: flex; align-items: center; gap: var(--spacing-px6);
    width: 100%; padding: var(--spacing-px6) var(--spacing-px10);
    background: var(--card); color: var(--text-1); border: 1px solid var(--border-control);
    border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--font-size-px13);
    cursor: default;
  }
  .trigger[data-popup-open] { border-color: var(--fill-accent); }
  .value { flex: 1; text-align: left; }
  .chevron { color: var(--text-2); display: flex; }
  .portal { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 300; }
  .popup {
    box-sizing: border-box; width: var(--anchor-width); max-height: min(24rem, var(--available-height));
    display: flex; flex-direction: column; background: var(--card); color: var(--text-1);
    border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-menu);
    overflow: hidden; outline: none;
  }
  .search {
    box-sizing: border-box; margin: var(--spacing-px8); padding: var(--spacing-px6) var(--spacing-px10);
    background: var(--inset); color: var(--text-1); border: 1px solid var(--border-control);
    border-radius: var(--radius-md); font-family: var(--font-sans); font-size: var(--font-size-px13); outline: none;
  }
  .list { overflow-y: auto; overscroll-behavior: contain; padding-bottom: var(--spacing-px4); }
  .groupLabel {
    padding: var(--spacing-px8) var(--spacing-px14) var(--spacing-px4); color: var(--text-2);
    font-family: var(--font-sans); font-size: var(--font-size-px11); font-weight: 500;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .item {
    display: flex; align-items: center; gap: var(--spacing-px8); min-height: 1.875rem;
    padding: 0 var(--spacing-px14); font-family: var(--font-mono); font-size: var(--font-size-px13);
    cursor: default; outline: none;
  }
  .item[data-highlighted] { background: color-mix(in srgb, var(--fg) 6%, transparent); }
  .itemIcon { color: var(--text-2); display: flex; }
  .itemLabel { flex: 1; }
  .itemDetail { color: var(--text-2); font-family: var(--font-sans); font-size: var(--font-size-px12); }
  .empty { padding: var(--spacing-px10) var(--spacing-px14); color: var(--text-2); font-size: var(--font-size-px13); }
  .footer {
    display: flex; gap: var(--spacing-px14); padding: var(--spacing-px8) var(--spacing-px14);
    background: var(--panel); border-top: 1px solid var(--line-3); color: var(--text-2);
    font-family: var(--font-sans); font-size: var(--font-size-px12);
  }
}
```

Before committing, check every token above exists: `bunx vitest run --project node test/token-existence.test.ts test/no-hardcoded-values.test.ts`. Replace any token the gate rejects with the nearest one the gate's error names (for example `--spacing-px14` may not exist: use the closest real step from `src/generated/theme.css`). The `color-mix` highlight is the same form `Button`'s pinned cells use.

Add the export block to `src/index.ts`, alphabetically between `ScrollPane` and `Segmented`:

```ts
export {
  SEARCHSELECT_PARTS,
  SearchSelect,
  searchSelectTheme,
} from "./recipes/SearchSelect/SearchSelect.tsx";
export type {
  SearchSelectItem,
  SearchSelectOwnProps,
  SearchSelectProps,
} from "./recipes/SearchSelect/SearchSelect.tsx";
```

- [ ] **Step 4: Run tests and the kit's gates**

Run: `cd packages/tui-kit && bunx vitest run --project browser src/recipes/SearchSelect && bun run gates && bun run typecheck && bun run build`
Expected: PASS, and `git diff --exit-code src/generated/theme.css` clean. If `scripts/derive.ts` or the census reports the new recipe needs a manifest entry, run `bun run census` and commit what it writes.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-kit/src/recipes/SearchSelect packages/tui-kit/src/index.ts
git commit -m "tui-kit: SearchSelect, a select whose popup searches its items"
```

---

### Task 15: Board LIVE column and row states

**Files:**
- Modify: `apps/deck/core/board/logic.ts` (StatusRow fields, `subline`)
- Create: `apps/deck/core/board/live/live-logic.ts`
- Create: `apps/deck/core/board/live/LiveCell.tsx`
- Modify: `apps/deck/core/board/AppsTable.tsx`
- Modify: `apps/deck/core/board/board.css`
- Test: `apps/deck/core/board/live/live-logic.test.ts`
- Create: `apps/deck/test/fixture/status-live.json`
- Test: `apps/deck/test/dom/live.spec.ts`

**Interfaces:**
- Consumes: Task 10's row fields.
- Produces:
  - `export type LiveCellState = { kind: 'none' } | { kind: 'go' } | { kind: 'blocked'; reason: string } | { kind: 'setup'; branch: string | null } | { kind: 'failed' } | { kind: 'starting' } | { kind: 'live'; label: string; worktree: boolean; movedFrom: string | null }`
  - `export const LIVE_STARTING_MS = 30_000`
  - `export function liveCell(row: Row, data: StatusData, now: number): LiveCellState`
  - `export function liveHealth(row: Row, now: number): { tone: 'warn' | 'bad'; text: string } | null`
  - `export function liveCount(data: StatusData): number`
  - `LiveCell` props: `{ row: Row; data: StatusData; now: number; onOpen: (row: Row, opener: HTMLElement) => void }`

- [ ] **Step 1: Write the failing logic tests**

```ts
// apps/deck/core/board/live/live-logic.test.ts
import { expect, test } from 'bun:test';

import type { Row, StatusData } from '../logic.ts';
import { liveCell, liveCount, liveHealth } from './live-logic.ts';

const data = { devMode: true, canManage: true, apps: [] } as unknown as StatusData;
const row = (over: Partial<Row>): Row => ({ name: 'chat', managedBy: 'rt', ...over }) as Row;
const live = (processes: Array<{ running: boolean; kind?: string }>, startedAt = '2026-10-09T21:00:00Z') => ({
  branch: 'console-runs-3', main: false, startedAt, uiPort: 11140, movedFrom: null,
  processes: processes.map((p, i) => ({ id: `p${i}`, kind: p.kind ?? 'server', command: 'x', port: null, running: p.running })),
});
const NOW = Date.parse('2026-10-09T21:10:00Z');

test('no live controls outside dev mode, for user apps, or deck', () => {
  expect(liveCell(row({ liveBlocked: null }), { ...data, devMode: false }, NOW)).toEqual({ kind: 'none' });
  expect(liveCell(row({ managedBy: 'user' }), data, NOW)).toEqual({ kind: 'none' });
  expect(liveCell(row({ managedBy: 'deck', liveBlocked: null }), data, NOW)).toEqual({ kind: 'none' });
});

test('go, blocked, setup, failed', () => {
  expect(liveCell(row({ liveBlocked: null }), data, NOW)).toEqual({ kind: 'go' });
  expect(liveCell(row({ liveBlocked: 'no server in the live list' }), data, NOW)).toEqual({ kind: 'blocked', reason: 'no server in the live list' });
  expect(liveCell(row({ liveSetup: { state: 'running', branch: 'a', log: [] } }), data, NOW)).toEqual({ kind: 'setup', branch: 'a' });
  expect(liveCell(row({ liveSetup: { state: 'failed', branch: 'a', log: [] } }), data, NOW)).toEqual({ kind: 'failed' });
});

test('live from a worktree, and starting while processes come up', () => {
  expect(liveCell(row({ live: live([{ running: true }]) }), data, NOW)).toEqual({ kind: 'live', label: 'console-runs-3', worktree: true, movedFrom: null });
  expect(liveCell(row({ live: live([{ running: false }], '2026-10-09T21:09:50Z') }), data, NOW)).toEqual({ kind: 'starting' });
});

test('health names the process that is down once starting is over', () => {
  expect(liveHealth(row({ live: live([{ running: true }, { running: false, kind: 'ui' }]) }), NOW)).toEqual({ tone: 'bad', text: 'ui down' });
  expect(liveHealth(row({ live: live([{ running: true }]) }), NOW)).toBeNull();
  expect(liveHealth(row({}), NOW)).toBeNull();
});

test('liveCount counts live rows', () => {
  expect(liveCount({ ...data, apps: [row({ live: live([]) }), row({})] } as StatusData)).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun test core/board/live/live-logic.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the logic**

Add to the board's `StatusRow` in `logic.ts`:

```ts
  /** Dev mode, local, mattstack apps: present while the app runs live. */
  live?: {
    branch: string | null;
    main: boolean;
    startedAt: string;
    uiPort: number | null;
    movedFrom: string | null;
    processes: { id: string; kind: 'server' | 'ui' | 'worker'; command: string; port: number | null; running: boolean }[];
  };
  liveSetup?: { state: 'running' | 'failed'; branch: string | null; log: string[] };
  /** null: can go live; a string: why not; absent: live controls do not apply. */
  liveBlocked?: string | null;
```

and change `subline` to count live apps:

```ts
export function subline(data: StatusData | null): string {
  if (!data) return 'loading…';
  const pub = data.apps.filter(r => r.published).length;
  const prot = data.apps.filter(r => r.hasPassword).length;
  const live = data.apps.filter(r => r.live).length;
  const parts = [healthyFraction(data)];
  if (live) parts.push(`${live} live`);
  parts.push(`${pub} public`);
  if (prot) parts.push(`${prot} protected`);
  return parts.join(' · ');
}
```

```ts
// apps/deck/core/board/live/live-logic.ts
import { isPlatform, type Row, type StatusData } from '../logic.ts';

export const LIVE_STARTING_MS = 30_000;

export type LiveCellState =
  | { kind: 'none' }
  | { kind: 'go' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'setup'; branch: string | null }
  | { kind: 'failed' }
  | { kind: 'starting' }
  | { kind: 'live'; label: string; worktree: boolean; movedFrom: string | null };

function starting(row: Row, now: number): boolean {
  const live = row.live;
  if (!live || live.processes.every(p => p.running)) return false;
  return now - Date.parse(live.startedAt) < LIVE_STARTING_MS;
}

export function liveCell(row: Row, data: StatusData, now: number): LiveCellState {
  if (!data.devMode || !data.canManage) return { kind: 'none' };
  if (!row.managedBy || row.managedBy === 'user' || isPlatform(row.managedBy)) return { kind: 'none' };
  if (row.liveSetup?.state === 'running') return { kind: 'setup', branch: row.liveSetup.branch };
  if (row.liveSetup?.state === 'failed') return { kind: 'failed' };
  if (row.live) {
    if (starting(row, now)) return { kind: 'starting' };
    return {
      kind: 'live',
      label: row.live.main ? 'main' : (row.live.branch ?? 'worktree'),
      worktree: !row.live.main,
      movedFrom: row.live.movedFrom,
    };
  }
  if (typeof row.liveBlocked === 'string') return { kind: 'blocked', reason: row.liveBlocked };
  if (row.liveBlocked === null) return { kind: 'go' };
  return { kind: 'none' };
}

export function liveHealth(row: Row, now: number): { tone: 'warn' | 'bad'; text: string } | null {
  const down = row.live?.processes.find(p => !p.running);
  if (!down) return null;
  if (starting(row, now)) return { tone: 'warn', text: 'starting' };
  return { tone: 'bad', text: `${down.kind} down` };
}

export function liveCount(data: StatusData): number {
  return data.apps.filter(r => r.live).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/deck && bun test core/board/live/live-logic.test.ts core/board/logic.test.ts`
Expected: PASS (update any `subline` expectation in `logic.test.ts` that now gains nothing: rows without `live` are unchanged).

- [ ] **Step 5: Implement the cell and column**

```tsx
// apps/deck/core/board/live/LiveCell.tsx
import { Badge, Button, ICONS, Icon, Spinner } from '@mattstack/tui-kit';
import { GIT_BRANCH, RADIO } from '../icons.ts';
import type { Row, StatusData } from '../logic.ts';
import { Tooltip } from '../Tooltip.tsx';
import { liveCell } from './live-logic.ts';

export function LiveCell({ row, data, now, onOpen }: {
  row: Row;
  data: StatusData;
  now: number;
  onOpen: (row: Row, opener: HTMLElement) => void;
}) {
  const cell = liveCell(row, data, now);
  switch (cell.kind) {
    case 'none':
      return null;
    case 'go':
    case 'blocked': {
      const button = (
        <Button size="sm" className="live-go" disabled={cell.kind === 'blocked'}
          aria-label={`run ${row.name} live`} onClick={e => onOpen(row, e.currentTarget)}>
          <Icon d={RADIO} /> go live
        </Button>
      );
      return cell.kind === 'blocked'
        ? <Tooltip tip={`Can't go live: ${cell.reason}`}>{button}</Tooltip>
        : button;
    }
    case 'setup':
      return <Badge intent="warn"><Spinner size="xs" />setting up {cell.branch ?? 'worktree'}</Badge>;
    case 'starting':
      return <Badge intent="warn"><Spinner size="xs" />starting</Badge>;
    case 'failed':
      return (
        <button type="button" className="live-failed" aria-label={`${row.name} setup failed`}
          onClick={e => onOpen(row, e.currentTarget)}>
          <Badge intent="bad">{ICONS['triangle-alert']}setup failed{ICONS['chevron-down']}</Badge>
        </button>
      );
    case 'live': {
      const button = (
        <Button size="sm" className="live-source" aria-label={`${row.name} is live from ${cell.label}`}
          onClick={e => onOpen(row, e.currentTarget)}>
          <Icon d={RADIO} className="t-accent" />
          {cell.worktree && <Icon d={GIT_BRANCH} />}
          <span className="live-source-name">{cell.label}</span>
          {cell.movedFrom && <span className="t-warn">{ICONS['triangle-alert']}</span>}
          {ICONS['chevron-down']}
        </Button>
      );
      return cell.movedFrom
        ? <Tooltip tip={`${cell.movedFrom} was deleted. Now live from main.`}>{button}</Tooltip>
        : button;
    }
  }
}
```

Add `RADIO` and `GIT_BRANCH` path strings to `core/board/icons.ts` in the same form as `GLOBE` (lucide `radio` and `git-branch` paths). If the kit's `ICONS` map lacks `chevron-down` or `triangle-alert`, use `Icon` with a path constant the same way.

In `AppsTable.tsx`:
- Add a `live` width set and use it when `data.devMode`: `versioned: ['26%', '7%', '10%', '15%', '8%', '14%', '20%']`.
- Head: after `public`, `{versioned && <Table.HeadCell>live</Table.HeadCell>}`.
- Row: after the public cell, `{versioned && <Table.Cell><LiveCell row={row} data={data} now={board.now} onOpen={board.openLive} /></Table.Cell>}`.
- `HealthCell` gets `now`: when `liveHealth(row, now)` is non-null, render `<Badge intent={h.tone}>{h.tone === 'warn' && <Spinner size="xs" />}{h.text}</Badge>` in place of the HTTP badge.

`board.now` and `board.openLive` come from Task 16's hook; until then pass `Date.now()` and a no-op so this task builds on its own.

In `board.css`, add (tokens only, no literals):

```css
.live-source .live-source-name { font-family: var(--font-mono); }
.live-failed { all: unset; cursor: pointer; }
```

- [ ] **Step 6: Fixture and DOM spec**

Create `test/fixture/status-live.json` by copying `status.json` and editing its first two managed rows: give one `"liveBlocked": null`, give another
`"live": { "branch": "console-runs-3", "main": false, "startedAt": "2026-01-01T00:00:00Z", "uiPort": 11140, "movedFrom": null, "processes": [{ "id": "server", "kind": "server", "command": "bun --watch src/server/index.ts", "port": 11002, "running": true }, { "id": "ui", "kind": "ui", "command": "bun x vite --port $PORT --strictPort", "port": 11140, "running": true }] }`, and set `"devMode": true`.

```ts
// apps/deck/test/dom/live.spec.ts
import { expect, test } from 'bun:test';
import { withBoard } from './rig.ts';

test('LIVE column: go live on a ready app, the source on a live one', async () => {
  await withBoard(async page => {
    expect(await page.getByRole('button', { name: /^run .* live$/ }).count()).toBeGreaterThan(0);
    expect(await page.getByRole('button', { name: /is live from console-runs-3/ }).count()).toBe(1);
    expect(await page.locator('.board-subline').textContent()).toContain('1 live');
  }, { fixture: 'status-live.json' });
});
```

Run: `cd apps/deck && bun run build:board && bun test test/dom/live.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/deck/core/board apps/deck/core/generated apps/deck/test/fixture/status-live.json apps/deck/test/dom/live.spec.ts
git commit -m "deck board: LIVE column with go live, live source and row states"
```

---

### Task 16: Go-live, live and setup-failed modals

**Files:**
- Create: `apps/deck/core/board/live/live-api.ts`
- Create: `apps/deck/core/board/live/useLive.ts`
- Create: `apps/deck/core/board/live/GoLiveModal.tsx` (L2, L2b, L3 in one component)
- Create: `apps/deck/core/board/live/SetupFailedModal.tsx` (L6)
- Modify: `apps/deck/core/board/useBoardState.ts` (expose `now`, `openLive`, and the live hook)
- Modify: `apps/deck/core/board/Board.tsx` (mount the modals)
- Modify: `apps/deck/core/board/board.css`
- Test: `apps/deck/test/dom/live.spec.ts`

**Interfaces:**
- Produces:
  - `live-api.ts`: `getSources(name): Promise<{ sources: SourceRow[]; error: string | null }>`, `putLive(name, source): Promise<{ status: number; body: { ok?: true; setup?: 'running'; error?: string } }>`, `deleteLive(name): Promise<{ status: number; body: { ok?: true; error?: string } }>`, with `type SourceRow = { path: string; branch: string | null; main: boolean; needsSetup: boolean; lastActiveAt: string | null; liveApps: string[] }`.
  - `useLive(refresh: () => Promise<unknown>, addToast: (msg: string) => void)` returning `{ modal: LiveModalState | null; open(row: Row, opener: HTMLElement): void; close(): void; pick(path: string): void; submit(): Promise<void>; stop(): Promise<void>; dismiss(): Promise<void> }` where `type LiveModalState = { row: Row; mode: 'go' | 'live' | 'failed'; sources: SourceRow[] | null; error: string | null; picked: string | null; busy: boolean; opener: HTMLElement }`.
  - `board.openLive = live.open`, `board.live = live`, `board.now` (a `Date.now()` refreshed on every status poll).

- [ ] **Step 1: Write the failing DOM tests** (append to `test/dom/live.spec.ts`)

```ts
const SOURCES = {
  sources: [
    { path: '/repo', branch: 'main', main: true, needsSetup: false, lastActiveAt: null, liveApps: [] },
    { path: '/wt/a', branch: 'console-runs-3', main: false, needsSetup: false, lastActiveAt: '2026-01-02T00:00:00Z', liveApps: ['console'] },
    { path: '/wt/b', branch: 'deck-live-mode', main: false, needsSetup: true, lastActiveAt: '2026-01-01T00:00:00Z', liveApps: [] },
  ],
  error: null,
};

test('go live: the form defaults to main and submits the picked worktree', async () => {
  await withBoard(async page => {
    await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
    let put: unknown = null;
    await page.route('**/api/v1/apps/*/live', async r => {
      put = r.request().postDataJSON();
      await r.fulfill({ status: 202, json: { ok: true, setup: 'running' } });
    });
    await page.getByRole('button', { name: /^run .* live$/ }).first().click();
    const dialog = page.getByRole('dialog');
    expect(await dialog.getByRole('combobox', { name: 'Code to run' }).textContent()).toContain('main');
    await dialog.getByRole('combobox', { name: 'Code to run' }).click();
    await page.getByPlaceholder('Search worktrees').fill('deck');
    await page.keyboard.press('Enter');
    expect(await dialog.textContent()).toContain('Needs setup first.');
    expect(await dialog.textContent()).toContain('Worktrees use your real data.');
    await dialog.getByRole('button', { name: 'Go Live' }).click();
    expect(put).toEqual({ source: '/wt/b' });
  }, { fixture: 'status-live.json' });
});

test('a live app: Switch waits for a different pick, Stop Live sends DELETE', async () => {
  await withBoard(async page => {
    await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
    let deleted = false;
    await page.route('**/api/v1/apps/*/live', async r => {
      if (r.request().method() === 'DELETE') deleted = true;
      await r.fulfill({ json: { ok: true } });
    });
    await page.getByRole('button', { name: /is live from console-runs-3/ }).click();
    const dialog = page.getByRole('dialog');
    expect(await dialog.getByRole('button', { name: 'Switch' }).isDisabled()).toBe(true);
    await dialog.getByRole('button', { name: 'Stop Live' }).click();
    expect(deleted).toBe(true);
  }, { fixture: 'status-live.json' });
});
```

Add a third managed row to `status-live.json` with `"liveSetup": { "state": "failed", "branch": "deck-live-mode", "log": ["$ bun install", "error: lockfile had changes, but lockfile is frozen"] }`, then:

```ts
test('setup failed: the log, Dismiss sends DELETE, Try Again sends PUT again', async () => {
  await withBoard(async page => {
    await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
    const calls: string[] = [];
    await page.route('**/api/v1/apps/*/live', async r => {
      calls.push(r.request().method());
      await r.fulfill({ json: { ok: true } });
    });
    await page.getByRole('button', { name: /setup failed/ }).click();
    const dialog = page.getByRole('dialog');
    expect(await dialog.textContent()).toContain("Couldn't set up deck-live-mode");
    expect(await dialog.textContent()).toContain('lockfile is frozen');
    await dialog.getByRole('button', { name: 'Try Again' }).click();
    expect(calls).toEqual(['PUT']);
  }, { fixture: 'status-live.json' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/deck && bun run build:board && bun test test/dom/live.spec.ts`
Expected: the three new tests FAIL (no dialog).

- [ ] **Step 3: Implement the API wrappers and hook**

```ts
// apps/deck/core/board/live/live-api.ts
import { apiDelete, apiPut } from '../api.ts';

export type SourceRow = {
  path: string;
  branch: string | null;
  main: boolean;
  needsSetup: boolean;
  lastActiveAt: string | null;
  liveApps: string[];
};

export async function getSources(name: string): Promise<{ sources: SourceRow[]; error: string | null }> {
  const res = await fetch(`/api/v1/apps/${name}/live/sources`);
  const body = await res.json();
  if (!res.ok) return { sources: [], error: body.error ?? `failed (${res.status})` };
  return body;
}

export async function putLive(name: string, source: string) {
  const res = await apiPut(`/api/v1/apps/${name}/live`, { source });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function deleteLive(name: string) {
  const res = await apiDelete(`/api/v1/apps/${name}/live`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
```

```ts
// apps/deck/core/board/live/useLive.ts
import { useCallback, useRef, useState } from 'react';

import type { Row } from '../logic.ts';
import { deleteLive, getSources, putLive, type SourceRow } from './live-api.ts';

export type LiveModalState = {
  row: Row;
  mode: 'go' | 'live' | 'failed';
  sources: SourceRow[] | null;
  error: string | null;
  picked: string | null;
  busy: boolean;
  opener: HTMLElement;
};

function current(row: Row, sources: SourceRow[]): string | null {
  if (row.live?.main) return sources.find(s => s.main)?.path ?? null;
  if (row.live) return sources.find(s => s.branch === row.live!.branch)?.path ?? null;
  if (row.liveSetup) return sources.find(s => s.branch === row.liveSetup!.branch)?.path ?? null;
  return sources.find(s => s.main)?.path ?? null;
}

export function useLive(refresh: () => Promise<unknown>, addToast: (msg: string) => void) {
  const [modal, setModal] = useState<LiveModalState | null>(null);

  const open = useCallback((row: Row, opener: HTMLElement) => {
    const mode = row.liveSetup?.state === 'failed' ? 'failed' : row.live ? 'live' : 'go';
    setModal({ row, mode, sources: null, error: null, picked: null, busy: false, opener });
    void getSources(row.name).then(({ sources, error }) =>
      setModal(m => m && m.row.name === row.name
        ? { ...m, sources, error, picked: current(row, sources) }
        : m)
    );
  }, []);

  const modalRef = useRef<LiveModalState | null>(null);
  modalRef.current = modal;

  const close = useCallback(() => {
    const opener = modalRef.current?.opener;
    setModal(null);
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  }, []);

  const pick = useCallback((path: string) => setModal(m => m && { ...m, picked: path }), []);

  const run = useCallback(async (fn: (m: LiveModalState) => Promise<{ status: number; body: { error?: string } }>) => {
    const m = modal;
    if (!m) return;
    setModal({ ...m, busy: true, error: null });
    const r = await fn(m);
    if (r.status >= 400) {
      setModal({ ...m, busy: false, error: r.body.error ?? `failed (${r.status})` });
      return;
    }
    close();
    await refresh();
  }, [modal, close, refresh]);

  const submit = useCallback(() => run(m => putLive(m.row.name, m.picked!)), [run]);
  const stop = useCallback(async () => {
    await run(m => deleteLive(m.row.name));
    addToast('Live mode stopped');
  }, [run, addToast]);
  const dismiss = useCallback(() => run(m => deleteLive(m.row.name)), [run]);

  return { modal, open, close, pick, submit, stop, dismiss };
}
```

In `useBoardState.ts`: add `const [now, setNow] = useState(Date.now());` and call `setNow(Date.now())` inside `refresh` after `setData(next)`; add `const live = useLive(refresh, addToast);`; return `now`, `live`, and `openLive: live.open`.

- [ ] **Step 4: Implement the modals**

```tsx
// apps/deck/core/board/live/GoLiveModal.tsx
import { Alert, Button, Icon, Modal, SearchSelect, Spinner } from '@mattstack/tui-kit';
import { GIT_BRANCH, HOUSE, RADIO } from '../icons.ts';
import type { SourceRow } from './live-api.ts';
import type { useLive } from './useLive.ts';

type Live = ReturnType<typeof useLive>;

function items(sources: SourceRow[]) {
  const worktrees = sources.filter(s => !s.main);
  return sources.map(s => ({
    value: s.path,
    label: s.main ? 'main' : (s.branch ?? s.path),
    icon: <Icon d={s.main ? HOUSE : GIT_BRANCH} />,
    ...(s.main ? {} : { group: `worktrees · ${worktrees.length}` }),
    detail: s.main
      ? 'shared checkout'
      : s.liveApps.length
        ? <span className="t-accent">{s.liveApps.join(', ')} is live here</span>
        : s.needsSetup
          ? <span className="t-warn">needs setup</span>
          : null,
  }));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function GoLiveModal({ live }: { live: Live }) {
  const m = live.modal;
  if (!m || m.mode === 'failed') return null;
  const isLive = m.mode === 'live';
  const picked = m.sources?.find(s => s.path === m.picked) ?? null;
  const unchanged = isLive && m.picked === m.sources?.find(s =>
    m.row.live!.main ? s.main : s.branch === m.row.live!.branch)?.path;
  const title = isLive ? `${m.row.name} is live` : `Run ${m.row.name} live`;
  return (
    <Modal title={<span className="live-modal-title">{title}<span className="muted">
      {isLive ? 'It reloads as you edit. Pick other code to switch to it.' : 'Pick the code to run. It reloads as you edit.'}
    </span></span>} ariaLabel={title} onClose={live.close} className="live-modal">
      <form onSubmit={ev => { ev.preventDefault(); void live.submit(); }}>
        <div className="modal-form">
          {m.sources == null ? <Spinner /> : (
            <SearchSelect
              label="Code to run"
              items={items(m.sources)}
              value={m.picked}
              onValueChange={live.pick}
              searchPlaceholder="Search worktrees"
              emptyText="No worktree matches"
              footer={<><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> choose</span><span><kbd>esc</kbd> close</span></>}
            />
          )}
          <div className="live-help">
            {isLive && <p className="muted">Running since {formatTime(m.row.live!.startedAt)}.</p>}
            {picked?.needsSetup && <p className="t-warn">Needs setup first.</p>}
            {picked && !picked.main && <p className="muted">Worktrees use your real data.</p>}
          </div>
          {m.error && <Alert intent="bad">{m.error}</Alert>}
        </div>
        <footer className="modal-footer">
          {isLive && (
            <Button type="button" variant="subtle" intent="bad" className="live-stop"
              disabled={m.busy} onClick={() => void live.stop()}>Stop Live</Button>
          )}
          <Button type="button" onClick={live.close}>Cancel</Button>
          <Button type="submit" variant="filled" intent="accent" busy={m.busy}
            disabled={!m.picked || (isLive && unchanged)}>
            <Icon d={RADIO} />{isLive ? 'Switch' : 'Go Live'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
```

```tsx
// apps/deck/core/board/live/SetupFailedModal.tsx
import { Button, Modal } from '@mattstack/tui-kit';
import type { useLive } from './useLive.ts';

export function SetupFailedModal({ live, onFullLog }: {
  live: ReturnType<typeof useLive>;
  onFullLog: (name: string) => void;
}) {
  const m = live.modal;
  if (!m || m.mode !== 'failed' || !m.row.liveSetup) return null;
  const setup = m.row.liveSetup;
  const title = `Couldn't set up ${setup.branch ?? 'that worktree'}`;
  return (
    <Modal title={<span className="live-modal-title">{title}<span className="muted">
      {m.row.name} is still running its normal code.</span></span>}
      ariaLabel={title} onClose={live.close} className="live-modal">
      <pre className="live-log">{setup.log.slice(-6).join('\n')}</pre>
      <footer className="modal-footer">
        <Button type="button" variant="subtle" onClick={() => onFullLog(m.row.name)}>Full log</Button>
        <span className="modal-footer-spacer" />
        <Button type="button" disabled={m.busy} onClick={() => void live.dismiss()}>Dismiss</Button>
        <Button type="button" variant="filled" intent="accent" busy={m.busy} disabled={!m.picked}
          onClick={() => void live.submit()}>Try Again</Button>
      </footer>
    </Modal>
  );
}
```

"Full log" opens the existing app settings modal on that row (`openSettings(name)` in `Board.tsx`), whose Recent errors block shows the setup log when `liveSetup` is failed (Task 17). Add `HOUSE` to `icons.ts` (lucide `house` path).

In `Board.tsx`, after `<UnlinkConfirm …/>`: `<GoLiveModal live={board.live} />` and `<SetupFailedModal live={board.live} onFullLog={name => { board.live.close(); openSettings(name); }} />`.

`board.css`:

```css
.live-modal { width: min(30rem, calc(100vw - 2rem)); }
.live-modal-title { display: flex; flex-direction: column; gap: 0.25rem; }
.live-modal-title .muted { font-weight: normal; font-size: var(--font-size-px13); }
.live-help { display: flex; flex-direction: column; gap: 0.25rem; }
.live-help p { margin: 0; font-size: var(--font-size-px12); }
.live-log { margin: 0; padding: 0.75rem; background: var(--inset); border: 1px solid var(--border-on-card); border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--font-size-px12); white-space: pre-wrap; }
.modal-footer .live-stop { margin-right: auto; }
.modal-footer-spacer { flex: 1; }
```

(Use whatever existing deck CSS variables the board already uses for these roles; check `board.css` and `packages/tui-kit/src/generated/theme.css` for the exact names before writing, per `apps/deck/AGENTS.md`.)

- [ ] **Step 5: Build and run the DOM tests**

Run: `cd apps/deck && bun run build:board && bun test test/dom/live.spec.ts`
Expected: PASS (all live specs).

- [ ] **Step 6: Commit**

```bash
git add apps/deck/core/board apps/deck/core/generated apps/deck/test/fixture/status-live.json apps/deck/test/dom/live.spec.ts
git commit -m "deck board: go-live form, live app modal and setup-failed modal"
```

---

### Task 17: Settings modal while live

**Files:**
- Modify: `apps/deck/core/board/settings/CodeBlock.tsx`
- Create: `apps/deck/core/board/settings/LiveProcessesBlock.tsx`
- Modify: `apps/deck/core/board/settings/PortBlock.tsx`
- Modify: `apps/deck/core/board/settings/RecentErrors.tsx`
- Modify: `apps/deck/core/board/settings/AppSettingsModal.tsx`
- Modify: `apps/deck/core/board/settings/settings.css`
- Test: `apps/deck/test/dom/live.spec.ts`

**Interfaces:**
- Consumes: `row.live`, `row.liveSetup`, `board.live.open`.
- Produces: the L5 layout: Code shows the live source with Change code and Stop Live; a Live processes block; Port shows Assigned and Live UI; Recent errors shows the failed setup log when there is one.

- [ ] **Step 1: Write the failing DOM test**

```ts
test('settings while live: source, processes, live UI port', async () => {
  await withBoard(async page => {
    await page.getByRole('button', { name: /settings for/ }).nth(liveRowIndex).click();
    const dialog = page.getByRole('dialog');
    const code = dialog.locator('[data-block="code"]');
    expect(await code.textContent()).toContain('console-runs-3');
    expect(await code.getByRole('button', { name: 'Change code' }).count()).toBe(1);
    expect(await code.getByRole('button', { name: 'Stop Live' }).count()).toBe(1);
    expect(await code.getByRole('button', { name: /redeploy/i }).count()).toBe(0);
    const procs = dialog.locator('[data-block="live-processes"]');
    expect(await procs.textContent()).toContain('bun --watch src/server/index.ts');
    expect(await procs.textContent()).toContain('11140');
    const port = dialog.locator('[data-block="port"]');
    expect(await port.textContent()).toContain('Live UI');
    expect(await port.getByLabel('dev port override').count()).toBe(0);
  }, { fixture: 'status-live.json' });
});
```

(`liveRowIndex` is the index of the live row among rows with a gear in `status-live.json`; read it off the fixture when writing the test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/deck && bun run build:board && bun test test/dom/live.spec.ts`
Expected: the new test FAILS.

- [ ] **Step 3: Implement**

`CodeBlock.tsx`: at the top of the component, after `if (!blocks.code) return null;`:

```tsx
  if (row.live) {
    return (
      <section data-block="code" aria-label="Code" className="settings-block">
        <div className="settings-block-head">
          <h3 className="settings-heading">Code</h3>
          <p className="settings-note">Live. It reloads as you edit.</p>
        </div>
        <dl className="settings-facts">
          <dt>Source</dt>
          <dd className="settings-live-source">
            <Icon d={RADIO} className="t-accent" />
            {!row.live.main && <Icon d={GIT_BRANCH} />}
            <span className="settings-mono">{row.live.main ? 'main' : row.live.branch}</span>
          </dd>
        </dl>
        <div className="settings-actions">
          <Button onClick={e => board.openLive(row, e.currentTarget)}>
            <Icon d={GIT_BRANCH} /> Change code
          </Button>
          <span className="settings-actions-end">
            <Button variant="subtle" intent="bad" onClick={e => board.openLive(row, e.currentTarget)}>
              Stop Live
            </Button>
          </span>
        </div>
      </section>
    );
  }
```

(Stop Live opens the live modal, whose Stop Live does the DELETE, so the destructive step stays behind one confirmable surface.)

```tsx
// apps/deck/core/board/settings/LiveProcessesBlock.tsx
import { Badge, Button, ICONS } from '@mattstack/tui-kit';
import type { BlockProps } from './block.ts';

export function LiveProcessesBlock({ row, board }: BlockProps) {
  if (!row.live) return null;
  return (
    <section data-block="live-processes" aria-label="Live processes" className="settings-block">
      <div className="settings-block-head">
        <h3 className="settings-heading">Live processes</h3>
        <p className="settings-note">From the app's manifest. Deck restarts one that stops.</p>
      </div>
      <ul className="live-procs">
        {row.live.processes.map(p => (
          <li key={p.id} className="live-proc">
            <span className="live-proc-kind">{p.kind}</span>
            <code className="live-proc-cmd" title={p.command}>{p.command}</code>
            {p.port != null && <span className="settings-mono">{p.port}</span>}
            <Badge intent={p.running ? 'ok' : 'bad'}>{p.running ? 'running' : 'down'}</Badge>
            <Button variant="subtle" size="sm" iconOnly aria-label={`${p.id} logs`}
              onClick={() => board.openLogs(row.name, p.id)}>{ICONS['scroll-text'] ?? ICONS.logs}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`board.openLogs(name, id)`: wire it to the existing logs surface. Read `test/dom/settings-logs.spec.ts` and the component it drives to find the logs entry point; extend the server's `GET /api/v1/apps/:name/logs` to accept `?process=<id>` and read `<name>.live.<id>.err.log` (add a server test case in `server.live.test.ts`: `GET /api/v1/apps/chat/logs?process=ui` returns that file's tail). If the existing logs surface has no programmatic opener, omit the logs button from this task and say so in the PR body.

Mount `<LiveProcessesBlock {...props} />` in `AppSettingsModal.tsx`'s left column right after `<CodeBlock />`.

`PortBlock.tsx`: when `row.live`, render Assigned (the app's port) plus, if `row.live.uiPort`, a `Live UI` fact with `<Help tip="Where the live UI runs" />` and the port in `settings-mono t-accent`; note `` `${host} goes to the live UI while ${row.name} is live.` ``; never render the override input or the override fact while live.

`RecentErrors.tsx`: when `row.liveSetup?.state === 'failed'`, show `row.liveSetup.log` in the log tail instead of the service stderr, under the heading "Setup log".

`settings.css`: `.settings-live-source { display: flex; gap: 0.375rem; align-items: center; }`, `.live-procs { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-on-card); border-radius: var(--radius-lg); }`, `.live-proc { display: flex; align-items: center; gap: 0.625rem; padding: 0.5rem 0.625rem 0.5rem 0.75rem; }`, `.live-proc + .live-proc { border-top: 1px solid var(--line-3); }`, `.live-proc-kind { width: 3rem; font-weight: 500; }`, `.live-proc-cmd { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted-on-card); }` (check each variable exists in `settings.css` or the generated theme first).

- [ ] **Step 4: Build and run**

Run: `cd apps/deck && bun run build:board && bun test test/dom/live.spec.ts test/dom/settings.spec.ts test/dom/port.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/core/board apps/deck/core/generated apps/deck/src/api/server.ts apps/deck/src/api/server.live.test.ts apps/deck/test/dom/live.spec.ts
git commit -m "deck board: settings modal shows live source, processes and live UI port"
```

---

### Task 18: Docs, visual check and PR (controller)

**Files:**
- Modify: `apps/deck/AGENTS.md` (Manifest-first section)
- Modify: the docs site's deck page if one covers the manifest (run the `rt:docs` skill to find it)

- [ ] **Step 1: Document the manifest entry.** In `apps/deck/AGENTS.md`'s "Manifest-first" section, add one paragraph: the `live` list (kinds, ports, `SERVER_PORT`), that live mode is dev-only and per app, the labels it installs, that live state is file-local in `settings.json`, and that live mode moves every route itself rather than through the dev-port override (which only moves `.localhost`). Commit: `git commit -am "deck AGENTS.md: live mode and the manifest live list"`.

- [ ] **Step 2: Run the docs skill.** Invoke `rt:docs` for the deck CLI change (`deck live`) and the manifest key; commit what it changes.

- [ ] **Step 3: Visual check in both schemes (fixture server).** Start the fixture board: `cd apps/deck && DECK_FIXTURE=$PWD/test/fixture-live PORT=7999 LOCAL_STATE_DIR=$(mktemp -d) LOCAL_APPS_NO_GATEWAY=1 LOCAL_APPS_AUTO_HEAL=0 bun run src/main.ts serve` where `test/fixture-live/status.json` is a copy of `status-live.json` (scratch, not committed). With Fast Browser at `http://localhost:7999`, screenshot light then dark: the main page, the go-live form closed and open, a live app's modal, the setup-failed modal, and the settings modal of the live row. Compare each against its pen.dev board (L1 · A, L2, L2b, L3, L6, L5) and say plainly what differs. Fix differences before the PR.

- [ ] **Step 4: Targeted tests, typecheck, lint**

Run: `cd apps/deck && bun test src/live core/board src/registry/deck-manifest.test.ts core/settings.test.ts core/routes-writer.test.ts src/api/server.live.test.ts src/cli/live.test.ts && bun test test/dom/live.spec.ts && cd ../.. && bun run deck:typecheck 2>/dev/null || (cd apps/deck && bunx tsc --noEmit)`
Expected: PASS.

- [ ] **Step 5: Push and open the PR**, following the coderabbit rule in Matt's CLAUDE.md (wait for CodeRabbit and green CI; merge only with Matt's OK). PR body: what live mode does, the deviation from the spec draft (routes moved directly, not through the override), and the Task 2 result.

- [ ] **Step 6: After merge (with Matt).** Check `#mattstack` chat and the checkout log for holds, confirm the shared checkout is on `main`, pull, deploy deck (`bun run deploy` from the checkout, or the deck row's deploy button), then in the dev app: run chat live from main, edit a client file and a server file and see each update at `chat.mattstack`; run board live and edit a client file; stop both and confirm the normal services are back. Screenshot the live row in light and dark.
```
