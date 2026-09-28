# Deck "new code" redeploy pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In mattstack-dev.app only, deck's board swaps a row's `deploy` button for a yellow "New code · Redeploy" pill when the shared checkout has commits touching that app since its last deploy.

**Architecture:** A new `src/registry/new-code.ts` owns stamping (`lastDeploy` on the app record) and detection (`git diff --quiet <stamp> HEAD -- <appDir> packages bun.lock`, cached per HEAD). The command route stamps on deploy start, deck stamps itself on a source boot, `buildStatus` emits `newCode` on eligible rows, and the board renders the pill from it. Every piece is gated on dev mode.

**Tech Stack:** Bun, TypeScript, `bun:test`, React board (`core/board/`) on `@mattstack/tui-kit`, git CLI via `Bun.spawnSync`.

**Spec:** `apps/deck/docs/superpowers/specs/2026-09-28-deck-new-code-pill-design.md`

All paths below are relative to `apps/deck/` unless they start with `../../`. Run every command from `apps/deck/` (its `bunfig.toml` preload isolates HOME).

## Global Constraints

- Dev mode only: no git call, no `lastDeploy` write, no `newCode` field unless `isDevMode()` (server) / `opts.devMode` (status) is true.
- Only records where `isMattstackOwned(record)` is true and `readLinkedManifest(record).state === 'linked'` take part. User apps never.
- `newCode` is emitted only when `opts.local` is true.
- Only `dev.deploy` runs stamp. `build`, `start` and every other command never stamp.
- Detection paths are exactly: the app's dir relative to the checkout root, `packages`, `bun.lock`.
- No em dashes or en dashes anywhere (code, comments, commits). Comments only for a constraint the code cannot show.
- Colours come from tui-kit tokens/intents, never a raw hex.
- After any `core/board/` edit, run `bun run build:board` and commit `core/generated/board.{js,css}` with the source.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A production deck's status poll must never shell git or write the registry, even for a record that already carries a stale `lastDeploy` (Task 3 test).
- A deploy POST refused as `busy` (409) must not move the stamp (Task 2 test).
- A non-local caller (public board host) never sees `newCode` shas (Task 3 test).
- While a deploy run is in flight, the row shows the normal busy `deploy…` button, not the pill (Task 4 test).
- A stamp sha git no longer knows (history rewrite, gc) yields no pill and one warning, never a thrown `buildStatus` (Task 1 test).

---

### Task 1: `lastDeploy` record field and the `new-code` module

**Files:**
- Modify: `src/registry/records.ts` (add field to `AppRecord`, add `setLastDeploy`)
- Modify: `src/edge/source.ts:6` (export `git`)
- Create: `src/registry/new-code.ts`
- Create: `test/git-fixture.ts`
- Test: `src/registry/new-code.test.ts`

**Interfaces:**
- Produces:
  - `AppRecord.lastDeploy?: { sha: string; at: string }` (full sha, ISO time)
  - `setLastDeploy(name: string, lastDeploy: { sha: string; at: string }): void` in `records.ts`
  - `export function git(args: string[], dir: string): { code: number; stdout: string }` in `edge/source.ts`
  - In `new-code.ts`:
    - `export interface NewCode { deployed: string; head: string }` (7-char shas)
    - `export function stampDeploy(name: string, dir: string, now?: () => Date): void`
    - `export function newCodeFor(record: AppRecord, now?: () => Date): NewCode | null`
    - `export function stampSelfOnBoot(opts: { devMode: boolean; runMode: RunMode; record: AppRecord | undefined }): void`
    - `export function resetNewCodeCache(): void`
  - In `test/git-fixture.ts`: `gitRepo(files: Record<string, string>): string` (returns repo root) and `commit(root: string, files: Record<string, string>, msg?: string): string` (returns full HEAD sha)

- [ ] **Step 1: Add the git test fixture**

Create `test/git-fixture.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

function run(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (p.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

export function commit(
  root: string,
  files: Record<string, string>,
  msg = 'change'
): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  run(root, ['add', '-A']);
  run(root, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    msg,
  ]);
  return run(root, ['rev-parse', 'HEAD']);
}

export function gitRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-git-'));
  run(root, ['init', '-q', '-b', 'main']);
  commit(root, files, 'init');
  return root;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/registry/new-code.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { commit, gitRepo } from '../../test/git-fixture.ts';

const dir = mkdtempSync(join(tmpdir(), 'local-new-code-'));
process.env.LOCAL_REGISTRY_PATH = join(dir, 'registry.json');

const { getRecord, putRecord, reloadRegistry } = await import('./records.ts');
const { newCodeFor, resetNewCodeCache, stampDeploy, stampSelfOnBoot } =
  await import('./new-code.ts');

const MANIFEST = JSON.stringify({ name: 'x', commands: {}, dev: {} });

function setup(): { root: string; appDir: string; first: string } {
  const root = gitRepo({
    'apps/x/mattstack.deck.json': MANIFEST,
    'apps/x/a.ts': '1',
    'packages/y/b.ts': '1',
    'bun.lock': '1',
    'lib/other.ts': '1',
  });
  const first = commit(root, { 'apps/x/a.ts': '2' });
  const appDir = join(root, 'apps/x');
  putRecord({
    name: 'x',
    managedBy: 'rt',
    port: 4999,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
    lastDeploy: { sha: first, at: 'then' },
  });
  return { root, appDir, first };
}

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  resetNewCodeCache();
});

let warn: ReturnType<typeof spyOn> | undefined;
afterEach(() => warn?.mockRestore());

test('no stamp baselines at HEAD and reports no new code', () => {
  const { first } = setup();
  const { lastDeploy: _, ...rest } = getRecord('x')!;
  putRecord(rest);
  expect(newCodeFor(getRecord('x')!)).toBeNull();
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
});

test('HEAD equal to the stamp reports no new code', () => {
  setup();
  expect(newCodeFor(getRecord('x')!)).toBeNull();
});

test("a commit under the app's own dir is new code, with short shas", () => {
  const { root, first } = setup();
  const head = commit(root, { 'apps/x/a.ts': '3' });
  expect(newCodeFor(getRecord('x')!)).toEqual({
    deployed: first.slice(0, 7),
    head: head.slice(0, 7),
  });
});

test('a commit under packages/ is new code', () => {
  const { root } = setup();
  commit(root, { 'packages/y/b.ts': '2' });
  expect(newCodeFor(getRecord('x')!)).not.toBeNull();
});

test('a bun.lock change is new code', () => {
  const { root } = setup();
  commit(root, { 'bun.lock': '2' });
  expect(newCodeFor(getRecord('x')!)).not.toBeNull();
});

test('a commit touching only other paths is not new code', () => {
  const { root } = setup();
  commit(root, { 'lib/other.ts': '2' });
  expect(newCodeFor(getRecord('x')!)).toBeNull();
});

test('an unknown stamp sha reports nothing and warns once', () => {
  setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  const rec = { ...getRecord('x')!, lastDeploy: { sha: 'f'.repeat(40), at: 'then' } };
  expect(newCodeFor(rec)).toBeNull();
  expect(newCodeFor(rec)).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('stampDeploy writes HEAD of the checkout', () => {
  const { root } = setup();
  const head = commit(root, { 'apps/x/a.ts': '4' });
  stampDeploy('x', join(root, 'apps/x'), () => new Date('2026-09-28T00:00:00Z'));
  expect(getRecord('x')!.lastDeploy).toEqual({
    sha: head,
    at: '2026-09-28T00:00:00.000Z',
  });
});

test('stampDeploy outside a git checkout warns and writes nothing', () => {
  const { first } = setup();
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  stampDeploy('x', mkdtempSync(join(tmpdir(), 'not-git-')));
  expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('stampSelfOnBoot stamps only a dev deck running source', () => {
  const { root, first } = setup();
  const head = commit(root, { 'apps/x/a.ts': '5' });
  for (const [devMode, runMode] of [
    [false, 'source'],
    [true, 'pinned'],
    [true, 'standalone'],
  ] as const) {
    stampSelfOnBoot({ devMode, runMode, record: getRecord('x') });
    expect(getRecord('x')!.lastDeploy?.sha).toBe(first);
  }
  stampSelfOnBoot({ devMode: true, runMode: 'source', record: getRecord('x') });
  expect(getRecord('x')!.lastDeploy?.sha).toBe(head);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/registry/new-code.test.ts`
Expected: FAIL (cannot resolve `./new-code.ts`; `lastDeploy` type error is fine too).

- [ ] **Step 4: Add the record field and writer**

In `src/registry/records.ts`, add to `AppRecord` right after `remote?: RemoteState;`:

```ts
  /** Dev mode only: the checkout HEAD the app last deployed from. */
  lastDeploy?: { sha: string; at: string };
```

Add after `clearIssues` (same read-modify-write shape as its neighbours):

```ts
export function setLastDeploy(
  name: string,
  lastDeploy: { sha: string; at: string }
): void {
  cache = load();
  const r = own(name);
  if (!r) return;
  r.lastDeploy = lastDeploy;
  save();
}
```

In `src/edge/source.ts`, change `function git(` to `export function git(`.

- [ ] **Step 5: Write the module**

Create `src/registry/new-code.ts`:

```ts
import { realpathSync } from 'fs';
import { relative } from 'path';

import type { RunMode } from '../api/state.ts';
import { git } from '../edge/source.ts';
import { setLastDeploy, type AppRecord } from './records.ts';

export interface NewCode {
  deployed: string;
  head: string;
}

const SHORT = 7;
const diffs = new Map<string, { key: string; changed: boolean }>();
const warned = new Set<string>();

export function resetNewCodeCache(): void {
  diffs.clear();
  warned.clear();
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[new-code] ${message}`);
}

function checkout(dir: string): { root: string; head: string } | null {
  const top = git(['rev-parse', '--show-toplevel'], dir);
  const head = git(['rev-parse', 'HEAD'], dir);
  if (top.code !== 0 || head.code !== 0) return null;
  return { root: top.stdout.trim(), head: head.stdout.trim() };
}

export function stampDeploy(
  name: string,
  dir: string,
  now: () => Date = () => new Date()
): void {
  const co = checkout(dir);
  if (!co) {
    warnOnce(`stamp|${name}|${dir}`, `${name}: ${dir} is not a git checkout`);
    return;
  }
  setLastDeploy(name, { sha: co.head, at: now().toISOString() });
}

function touchesApp(
  name: string,
  sha: string,
  co: { root: string; head: string },
  dir: string
): boolean {
  const appDir = relative(co.root, realpathSync(dir)) || '.';
  const res = git(
    ['diff', '--quiet', sha, co.head, '--', appDir, 'packages', 'bun.lock'],
    co.root
  );
  if (res.code === 1) return true;
  if (res.code !== 0)
    warnOnce(`diff|${name}|${sha}`, `${name}: git diff from ${sha} failed`);
  return false;
}

// The first sighting of an app baselines at HEAD: what it loaded before this
// stamp existed is unknowable, so it starts with no offer.
export function newCodeFor(
  record: AppRecord,
  now: () => Date = () => new Date()
): NewCode | null {
  const dir = record.dev?.workingDirectory;
  if (!dir) return null;
  const co = checkout(dir);
  if (!co) return null;
  const sha = record.lastDeploy?.sha;
  if (!sha) {
    setLastDeploy(record.name, { sha: co.head, at: now().toISOString() });
    return null;
  }
  if (sha === co.head) return null;
  const key = `${sha}|${co.head}`;
  const hit = diffs.get(record.name);
  const changed =
    hit?.key === key ? hit.changed : touchesApp(record.name, sha, co, dir);
  diffs.set(record.name, { key, changed });
  return changed
    ? { deployed: sha.slice(0, SHORT), head: co.head.slice(0, SHORT) }
    : null;
}

export function stampSelfOnBoot(opts: {
  devMode: boolean;
  runMode: RunMode;
  record: AppRecord | undefined;
}): void {
  const dir = opts.record?.dev?.workingDirectory;
  if (!opts.devMode || opts.runMode !== 'source' || !opts.record || !dir)
    return;
  stampDeploy(opts.record.name, dir);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/registry/new-code.test.ts src/registry/records.test.ts src/edge`
Expected: PASS, 0 fail.

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add test/git-fixture.ts src/registry/new-code.ts src/registry/new-code.test.ts src/registry/records.ts src/edge/source.ts
git commit -m "deck: new-code module stamps and detects checkout drift per app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stamp on deploy start and on deck's source boot

**Files:**
- Modify: `src/api/server.ts` (command route, manifest branch, around lines 493-570)
- Modify: `src/main.ts` (inside `serve()`, right after `await prepareHelperBoot(...)`)
- Test: `src/api/server.test.ts` (append tests near the other `commands/` tests, around line 1490)

**Interfaces:**
- Consumes: `stampDeploy(name, dir)`, `stampSelfOnBoot({ devMode, runMode, record })` from Task 1; `gitRepo`, `commit` from `test/git-fixture.ts`.
- Produces: nothing new for later tasks; records now carry `lastDeploy` after a dev deploy.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/server.test.ts` (add `import { commit, gitRepo } from '../../test/git-fixture.ts';` with the other imports):

```ts
function deployableRepo(name: string, port: number, deploy: string) {
  const root = gitRepo({
    [`apps/${name}/mattstack.deck.json`]: JSON.stringify({
      name,
      commands: {},
      dev: { deploy, build: 'true' },
    }),
  });
  return { root, appDir: join(root, `apps/${name}`), port };
}

test('a dev deploy stamps the checkout HEAD on the record', async () => {
  const { putRecord, getRecord } = await import('../registry/records.ts');
  const { root, appDir } = deployableRepo('stampapp', 4920, 'true');
  const head = commit(root, { [`apps/stampapp/a.ts`]: '1' });
  putRecord({
    name: 'stampapp',
    managedBy: 'rt',
    port: 4920,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
  });
  const res = await devPost('/api/v1/apps/stampapp/commands/deploy', {});
  expect(res.status).toBe(200);
  expect(getRecord('stampapp')!.lastDeploy?.sha).toBe(head);
});

test('a dev build does not stamp', async () => {
  const { putRecord, getRecord } = await import('../registry/records.ts');
  const { appDir } = deployableRepo('buildonly', 4921, 'true');
  putRecord({
    name: 'buildonly',
    managedBy: 'rt',
    port: 4921,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
  });
  const res = await devPost('/api/v1/apps/buildonly/commands/build', {});
  expect(res.status).toBe(200);
  expect(getRecord('buildonly')!.lastDeploy).toBeUndefined();
});

test('a production deploy is 404 and stamps nothing', async () => {
  const { putRecord, getRecord } = await import('../registry/records.ts');
  const { appDir } = deployableRepo('prodstamp', 4922, 'true');
  putRecord({
    name: 'prodstamp',
    managedBy: 'rt',
    port: 4922,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
  });
  const res = await prodPost('/api/v1/apps/prodstamp/commands/deploy', {});
  expect(res.status).toBe(404);
  expect(getRecord('prodstamp')!.lastDeploy).toBeUndefined();
});

test('a deploy refused as busy does not move the stamp', async () => {
  const { putRecord, getRecord } = await import('../registry/records.ts');
  const { root, appDir } = deployableRepo('busyapp', 4923, 'sleep 1');
  putRecord({
    name: 'busyapp',
    managedBy: 'rt',
    port: 4923,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: appDir },
  });
  expect(
    (await devPost('/api/v1/apps/busyapp/commands/deploy', {})).status
  ).toBe(200);
  const first = getRecord('busyapp')!.lastDeploy?.sha;
  commit(root, { 'apps/busyapp/a.ts': '1' });
  expect(
    (await devPost('/api/v1/apps/busyapp/commands/deploy', {})).status
  ).toBe(409);
  expect(getRecord('busyapp')!.lastDeploy?.sha).toBe(first);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/server.test.ts -t "stamp|busy"`
Expected: FAIL on the first test (`lastDeploy` undefined); the build, production and busy tests may already pass, which is fine.

- [ ] **Step 3: Stamp in the command route**

In `src/api/server.ts`, import at the top with the other registry imports:

```ts
import { stampDeploy } from '../registry/new-code.ts';
```

Track whether the manifest branch resolved the command. Just before `let shell: string | undefined;` add `let fromManifest = false;`, and inside the final `else` branch, after `cwd = link.dir;`, add `fromManifest = true;`.

Then, in the POST path, replace:

```ts
              if (!started.started) return json({ error: 'busy' }, 409);
              return json({ started: true, runId: started.runId });
```

with:

```ts
              if (!started.started) return json({ error: 'busy' }, 409);
              if (fromManifest && cmd === 'deploy') stampDeploy(name, cwd);
              return json({ started: true, runId: started.runId });
```

(`fromManifest` is only ever true in dev mode, because the manifest branch 404s first when `!dev`.)

- [ ] **Step 4: Stamp deck itself on a source boot**

In `src/main.ts`, add imports:

```ts
import { stampSelfOnBoot } from './registry/new-code.ts';
```

and extend the existing `./api/state.ts` import to `import { claimApiInfo, runModeFromEnv, stateDir } from './api/state.ts';`.

Right after the `await prepareHelperBoot({ ... });` call in `serve()`, add:

```ts
  stampSelfOnBoot({
    devMode: isDevMode(),
    runMode: runModeFromEnv(process.env).runMode,
    record: listRecords().find(r => isPlatformManagedBy(r.managedBy)),
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/api/server.test.ts src/registry/new-code.test.ts`
Expected: PASS, 0 fail.

- [ ] **Step 6: Typecheck and commit**

Run: `bunx tsc --noEmit -p tsconfig.json` (expect no errors), then:

```bash
git add src/api/server.ts src/api/server.test.ts src/main.ts
git commit -m "deck: stamp lastDeploy on dev deploy start and on source boot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `newCode` on the status row

**Files:**
- Modify: `src/api/status.ts` (`StatusRow` interface near line 73; row mapping near line 378)
- Test: `src/api/status.test.ts`

**Interfaces:**
- Consumes: `newCodeFor(record): NewCode | null`, `NewCode` from Task 1; `isMattstackOwned` from `records.ts`.
- Produces: `StatusRow.newCode?: { deployed: string; head: string }`, read by the board in Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/status.test.ts` (add `import { commit, gitRepo } from '../../test/git-fixture.ts';` at the top, and `const { getRecord } = await import('../registry/records.ts');` alongside the existing `putRecord` import; also `const { resetNewCodeCache } = await import('../registry/new-code.ts');` and call `resetNewCodeCache()` at the end of the existing `beforeEach`):

```ts
function staleApp(managedBy: string): string {
  const root = gitRepo({
    'apps/myapp/mattstack.deck.json': JSON.stringify({
      name: 'myapp',
      commands: {},
      dev: { deploy: 'true' },
    }),
  });
  const first = commit(root, { 'apps/myapp/a.ts': '1' });
  commit(root, { 'apps/myapp/a.ts': '2' });
  putRecord({
    name: 'myapp',
    managedBy,
    port: 19999,
    kind: 'service',
    createdAt: 'x',
    dev: { workingDirectory: join(root, 'apps/myapp') },
    lastDeploy: { sha: first, at: 'then' },
  });
  return first;
}

test('newCode is set for a stale managed row in dev mode on a local call', async () => {
  const first = staleApp('rt');
  const row = (await buildStatus({ ...opts, devMode: true })).apps.find(
    a => a.name === 'myapp'
  )!;
  expect(row.newCode?.deployed).toBe(first.slice(0, 7));
});

test('production never emits newCode or baselines a stamp', async () => {
  staleApp('rt');
  const { lastDeploy: _, ...rest } = getRecord('myapp')!;
  putRecord(rest);
  const row = (await buildStatus({ ...opts, devMode: false })).apps.find(
    a => a.name === 'myapp'
  )!;
  expect(row.newCode).toBeUndefined();
  expect(getRecord('myapp')!.lastDeploy).toBeUndefined();
});

test('a non-local caller never sees newCode', async () => {
  staleApp('rt');
  const row = (
    await buildStatus({ ...opts, local: false, devMode: true })
  ).apps.find(a => a.name === 'myapp')!;
  expect(row.newCode).toBeUndefined();
});

test('a user app never carries newCode', async () => {
  staleApp('user');
  const row = (await buildStatus({ ...opts, devMode: true })).apps.find(
    a => a.name === 'myapp'
  )!;
  expect(row.newCode).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/status.test.ts -t newCode`
Expected: FAIL on the first test (`row.newCode` undefined).

- [ ] **Step 3: Emit the field**

In `src/api/status.ts`:

Add imports:

```ts
import { newCodeFor, type NewCode } from '../registry/new-code.ts';
```

and add `isMattstackOwned` to the existing `../registry/records.ts` import (add the import line if `records.ts` is not already imported there).

Add to `StatusRow`, right after the `devDir` field:

```ts
  /** Dev mode, local callers, linked managed rows only: the checkout has
      commits touching this app since its last deploy. */
  newCode?: NewCode;
```

Add a helper above `buildStatus`:

```ts
function newCodeForRow(
  record: AppRecord | undefined,
  opts: BuildStatusOpts
): NewCode | undefined {
  if (!record || !opts.devMode || !opts.local) return undefined;
  if (!isMattstackOwned(record)) return undefined;
  if (readLinkedManifest(record).state !== 'linked') return undefined;
  return newCodeFor(record) ?? undefined;
}
```

(import `type AppRecord` from `records.ts` if it is not already in scope.) In the row object literal, right after the `devDir: ...` property, add:

```ts
        newCode: newCodeForRow(record, opts),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/status.test.ts src/api/status.remote.test.ts src/api/status.tunnel.test.ts`
Expected: PASS, 0 fail.

- [ ] **Step 5: Typecheck and commit**

Run: `bunx tsc --noEmit -p tsconfig.json` (expect no errors), then:

```bash
git add src/api/status.ts src/api/status.test.ts
git commit -m "deck: emit newCode on dev-mode status rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Board pill, regenerated bundle, and UI validation

**Files:**
- Modify: `core/board/logic.ts` (`Row` type near line 63; new `deployPill` next to `commandButtonLabel` near line 351)
- Modify: `core/board/AppsTable.tsx` (`CommandsCell`, near lines 454-503)
- Regenerate: `core/generated/board.js`, `core/generated/board.css`
- Test: `core/board/logic.test.ts`

**Interfaces:**
- Consumes: `StatusRow.newCode` from Task 3 (arrives on the board's `Row` as `newCode?: { deployed: string; head: string }`).
- Produces: `deployPill(row: Row, cmd: string, phase: CommandPhase | undefined): { label: string; tip: string } | null` in `logic.ts`.

- [ ] **Step 1: Write the failing test**

Append to `core/board/logic.test.ts` (add `deployPill` to the existing import from `./logic.ts`; build rows the same way the file's other tests do, spreading a fixture row and overriding fields):

```ts
test('deployPill: offers the pill on deploy when newCode is set', () => {
  const row = { ...baseRow, newCode: { deployed: 'abc1234', head: 'def5678' } };
  expect(deployPill(row, 'deploy', undefined)).toEqual({
    label: 'New code · Redeploy',
    tip: 'Deployed at abc1234, checkout at def5678',
  });
});

test('deployPill: never on other commands, without newCode, or mid-run', () => {
  const stale = { ...baseRow, newCode: { deployed: 'abc1234', head: 'def5678' } };
  expect(deployPill(stale, 'build', undefined)).toBeNull();
  expect(deployPill(baseRow, 'deploy', undefined)).toBeNull();
  expect(deployPill(stale, 'deploy', 'running')).toBeNull();
  expect(deployPill(stale, 'deploy', 'restarting')).toBeNull();
});
```

If the file has no `baseRow`, define one at the top of the new tests by copying the smallest `Row` literal an existing test in the file already builds.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/board/logic.test.ts -t deployPill`
Expected: FAIL (`deployPill` is not exported).

- [ ] **Step 3: Implement the logic**

In `core/board/logic.ts`, add to `Row` after `devDir`:

```ts
  /** Dev mode only: the checkout has commits touching this app since its last deploy. */
  newCode?: { deployed: string; head: string };
```

Add after `commandButtonLabel`:

```ts
export function deployPill(
  row: Row,
  cmd: string,
  phase: CommandPhase | undefined
): { label: string; tip: string } | null {
  if (cmd !== 'deploy' || !row.newCode || phase != null) return null;
  return {
    label: 'New code · Redeploy',
    tip: `Deployed at ${row.newCode.deployed}, checkout at ${row.newCode.head}`,
  };
}
```

- [ ] **Step 4: Render it**

In `core/board/AppsTable.tsx`, import `deployPill` from `./logic.ts` alongside `commandButtonLabel`. In `CommandsCell`'s map, before the existing `return ( <Button ...`, add:

```tsx
        const pill = deployPill(row, name, phase);
        if (pill)
          return (
            <Tooltip key={name} tip={pill.tip}>
              <Button
                intent="warn"
                variant="light"
                size="sm"
                aria-label={`${name} ${row.name}`}
                onClick={() => onRunCommand(row, name)}
              >
                {pill.label}
              </Button>
            </Tooltip>
          );
```

Confirm `warn` is a valid Button intent in `../../packages/tui-kit/src/recipes/Button/Button.tsx` (the shared intent vocabulary; `Badge intent="warn"` is already used in this file). If `light|warn` fails the kit's contrast matrix, use `variant="outline"` instead.

- [ ] **Step 5: Run tests, regenerate the bundle**

Run: `bun test core/board/logic.test.ts` (expect PASS), then `bun run build:board`, then `bun test core/generated-fresh.test.ts` (expect PASS).

- [ ] **Step 6: Validate the UI in Fast Browser**

Boot a fixture deck with a stale row, under an isolated HOME and state dir:

```bash
FIX=$(mktemp -d); STATE=$(mktemp -d); H=$(mktemp -d)
bun -e "const s=JSON.parse(require('fs').readFileSync('test/fixture/status.json','utf8'));s.apps.find(a=>a.name==='atlas').newCode={deployed:'abc1234',head:'def5678'};require('fs').writeFileSync('$FIX/status.json',JSON.stringify(s))"
HOME=$H PORT=8392 DECK_FIXTURE=$FIX LOCAL_STATE_DIR=$STATE LOCAL_APPS_NO_GATEWAY=1 LOCAL_APPS_AUTO_HEAL=0 bun run src/main.ts serve
```

(run the server in the background). Open `http://127.0.0.1:8392/` in Fast Browser, screenshot the `atlas` row in light and dark (the board's theme toggle), hover the pill to show the tooltip, and report plainly what reads wrong (pill width breaking the row, contrast, alignment against the `build` button). Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add core/board/logic.ts core/board/logic.test.ts core/board/AppsTable.tsx core/generated/board.js core/generated/board.css
git commit -m "deck board: New code · Redeploy pill on stale dev rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full gate

- [ ] **Step 1:** Run `bun run test` from `apps/deck/` (expect 0 fail).
- [ ] **Step 2:** Run `bunx tsc --noEmit -p tsconfig.json` from `apps/deck/`, and `bun run deck:test` from the repo root (turbo, what CI runs); expect clean.
- [ ] **Step 3:** Run `bun run test:dom` from `apps/deck/` and compare the failure count with clean `main` (AGENTS.md notes 8 pre-existing failures); any new failure is this branch's to fix.
