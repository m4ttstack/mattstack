# Just Me Solo Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person picks **Just me** on mattstack.app's Team screen and reaches a green `rt verify` with no team, no forge token and no `gh` login; the window shows only console and chat; Settings can turn any app on or off and can upgrade the install to a team in place.

**Architecture:** Deck owns a per-app `enabled` flag and learns `requiresTeam` from each app's `mattstack.deck.json` (read from the source checkout in dev and from `Contents/Resources/apps/<name>/` in prod). rt's setup plan branches on a derived solo state (no team known) and its `deck.managed` step applies the mode default over deck's API. The tray adds the card, a Settings > Apps pane driven by new `rt apps` verbs, and re-enters its own setup window at the Team screen for upgrades.

**Tech Stack:** Bun + TypeScript (rt, deck), bun:test, Swift/SwiftUI (rt-tray, SwiftPM checks + XCUITest), bash (VM harness).

**Spec:** `docs/superpowers/specs/2026-09-26-just-me-solo-setup-design.md`

## Global Constraints

- Run every rt unit test from the repo root (`bun test ./lib/...`); deck tests run from `apps/deck` (`bun test src/...`); tray checks run from `rt-tray` (`swift run mattstack-checks "<filter>"`, after `scripts/fetch-deps.sh arm64` has populated `rt-tray/deps`).
- No em dashes or en dashes anywhere (code, comments, copy, commit messages).
- Comments only for constraints the code cannot show; no narration, no task references.
- Solo is derived: `isSolo(team)` is `team.mode === "none" && team.slug === ""`. Never store a solo flag.
- Deck: prod serves the bundle's explicit catalog, dev serves the machine's registrations; `enabled` narrows either set and never adds to it. Absent `enabled` reads as enabled.
- `requiresTeam` is declared in `mattstack.deck.json` only (board and boxscore declare `true`); deck parses it; rt reads it from deck's API, never from the bundle.
- The `deck.managed` step PATCHes `enabled` only for apps with `requiresTeam: true`, and only at Install or upgrade. Nothing else overwrites a user's toggle.
- Copy, verbatim: card title `Just me`; card body `rt, the daemon and Claude Code on this Mac. No team repo, no forge account. You can create or join a team later from Settings.`; forge note `Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt.` (the spec's wording); Fast Browser solo note `Works without this; only the browser skills need it.` (new: the spec points at "the existing works-without-this note", but the only note the row carries today is `FASTBROWSER_SETUP_NOTE`, which says Install creates the runtime, not that the tool is optional); apps caption `Needs a team. Create or join one under Team to use this.`; team status text `rt team status: no team (Just me)`.
- The `deck.managed` default runs only when `ctx.intent !== null`: a first run (solo, create, join, restore) and both upgrade entries write an intent, and a completed apply clears it, so a bare `rt setup apply` on an installed machine leaves every toggle alone.
- Execution order: Part A (deck) lands after monorepo Stage C merges; Part B (rt) may start now on this branch and merges after Part A; Part C (tray) after B; Part D after C.
- Every new rt command module goes into `lib/module-registry.ts` as a thunk; every visible leaf with a required positional declares `omitBehavior`; `bun run picker:check` must pass.

## Review Focus

1. A registry written by an older deck (no `enabled` key) must serve every app exactly as before. Pinned in Task 3 (`isEnabled` on a record without the key) and Task 4 (sweep treats such a record as served).
2. A user who disables console by hand, then upgrades to a team, must keep console disabled (the default touches only `requiresTeam` apps), and a solo user who turns board on from Settings must keep it on across a later plain `rt setup apply` (the default runs only under an intent). Both pinned in Task 11.
3. A solo intent left on disk from an interrupted first run must not make a later `rt setup apply` create a team of one: `team.create` applies only with an explicit create intent or the headless flag with no intent at all. Pinned in Task 7.
4. `rt team status --json` on a machine with two team clones and no `--team` must still error `ambiguous-team`, never answer `mode: "solo"`. Pinned in Task 12.
5. An `enabled` PATCH mixed with structural fields must be refused rather than half-applied. Pinned in Task 5.

---

## Part A: deck

### Task 1: `requiresTeam` in the deck manifest parser

**Files:**
- Modify: `apps/deck/src/registry/deck-manifest.ts`
- Test: `apps/deck/src/registry/deck-manifest.test.ts`

**Interfaces:**
- Produces: `DeckManifest.requiresTeam?: boolean`, parsed by `readDeckManifest`, rejected with `requiresTeam must be a boolean` when not boolean.

- [ ] **Step 1: Write the failing tests**

Append to `apps/deck/src/registry/deck-manifest.test.ts` (the file already has `dirWith`-style helpers; use the same `mkdtempSync` + `writeFileSync` pattern the `reads name, port, start and action commands` test uses):

```ts
test('reads requiresTeam when it is a boolean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-manifest-'));
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify({ name: 'board', requiresTeam: true }));
  const r = readDeckManifest(dir);
  expect(r?.ok && r.manifest.requiresTeam).toBe(true);
});

test('a manifest without requiresTeam leaves it undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-manifest-'));
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify({ name: 'chat' }));
  const r = readDeckManifest(dir);
  expect(r?.ok && r.manifest.requiresTeam).toBeUndefined();
});

test('rejects a non-boolean requiresTeam', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-manifest-'));
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify({ name: 'board', requiresTeam: 'yes' }));
  expect(readDeckManifest(dir)).toEqual({ ok: false, error: 'requiresTeam must be a boolean' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts`
Expected: the first and third tests FAIL (`requiresTeam` undefined; no error returned).

- [ ] **Step 3: Implement**

In `apps/deck/src/registry/deck-manifest.ts`, add to `DeckManifest`:

```ts
  /** The app only means something on a team (board, boxscore); rt idles it on a solo install. */
  requiresTeam?: boolean;
```

In `readDeckManifest`, after the `includeInBundle` block:

```ts
  if (m.requiresTeam !== undefined) {
    if (typeof m.requiresTeam !== 'boolean')
      return err('requiresTeam must be a boolean');
    out.requiresTeam = m.requiresTeam;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/deck && bun test src/registry/deck-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/registry/deck-manifest.ts apps/deck/src/registry/deck-manifest.test.ts
git commit -m "deck: parse requiresTeam from mattstack.deck.json"
```

### Task 2: carry `requiresTeam` onto the record in both flavors

**Files:**
- Modify: `apps/deck/src/registry/records.ts` (AppRecord)
- Modify: `apps/deck/src/registry/manifest.ts` (`ingestManifest`)
- Modify: `apps/deck/src/registry/bundled-identity.ts` (`AppIdentity`, `readBundledIdentity`, `storedIdentity`)
- Test: `apps/deck/src/registry/bundled-identity.test.ts`, `apps/deck/src/registry/manifest.test.ts`
- Fixture: `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json` (add `"requiresTeam": true`)

**Interfaces:**
- Produces: `AppRecord.requiresTeam?: boolean`, `AppRecord.enabled?: boolean`, `AppIdentity.requiresTeam?: boolean`, and `export function requiresTeamFor(record: AppRecord): boolean` in `bundled-identity.ts` (true when the effective identity says so).

- [ ] **Step 1: Rewrite the fixture in staged form and write the failing tests**

The deck fixture's bytes are sha256-pinned (`FIXTURE_SHA256` in `bundled-identity.test.ts`, test `the fixture bytes match the digests its repo-tools twin pins`) and must stay byte-identical to `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json`, which Task 6 rewrites the same way. Overwrite `apps/deck/src/registry/__fixtures__/bundle-resources/apps/board/mattstack.deck.json` with exactly (2-space JSON, `requiresTeam` last, one trailing newline):

```json
{
  "name": "board",
  "displayName": "Board",
  "description": "Open MRs ready for review.",
  "icon": "./src/favicon.svg",
  "badge": "/api/badge",
  "requiresTeam": true
}
```

and set `FIXTURE_SHA256['mattstack.deck.json']` to `998fddd2621726f465df3f478d0eeefa8c0186ce3e5c8fd1de7c0edb7193faf5` (verify with `shasum -a 256` on the file). Extend the two `toEqual` expectations on `readBundledIdentity(FIXTURE_RESOURCES, 'board')` (test `reads the staged identity build-apps ships`) and `effectiveIdentity(record(), FIXTURE_RESOURCES)` (test `an unlinked managed row takes its identity from the bundle`) with `requiresTeam: true`. Then append:

```ts
test('requiresTeamFor reads the effective identity: bundled beats a stored record without it', () => {
  setBundledResourcesDir(FIXTURE_RESOURCES);
  expect(requiresTeamFor(record())).toBe(true);
  setBundledResourcesDir(null);
  expect(requiresTeamFor(record())).toBe(false);
  expect(requiresTeamFor(record({ requiresTeam: true }))).toBe(true);
});
```

In `apps/deck/src/registry/manifest.test.ts`, follow the file's per-test shape (`isolate()`, then `const { putRecord, getRecord, reloadRegistry } = await import('./records.ts'); reloadRegistry();`) and its checkout-dir helper that writes `mattstack.deck.json` plus `icon.svg`:

```ts
test('ingestManifest carries requiresTeam onto the record and clears a stale one', async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import('./records.ts');
  const { ingestManifest } = await import('./manifest.ts');
  reloadRegistry();
  const dir = checkoutDir({ name: 'board', displayName: 'Board', icon: './icon.svg', requiresTeam: true });
  putRecord({ name: 'board', managedBy: 'rt', port: 11006, kind: 'service', workingDirectory: dir, createdAt: '2026-08-10T00:00:00Z' });
  ingestManifest('board');
  expect(getRecord('board')?.requiresTeam).toBe(true);
  writeFileSync(join(dir, 'mattstack.deck.json'), JSON.stringify({ name: 'board', displayName: 'Board', icon: './icon.svg' }));
  ingestManifest('board');
  expect(getRecord('board')?.requiresTeam).toBeUndefined();
});
```

(`checkoutDir` stands for whatever the file already names that helper; if it takes a fixed manifest, add a variant that takes the object.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/deck && bun test src/registry/bundled-identity.test.ts src/registry/manifest.test.ts`
Expected: FAIL (`requiresTeamFor` not exported; `requiresTeam` undefined).

- [ ] **Step 3: Implement**

`records.ts`, in `AppRecord` after `badge?`:

```ts
  /** From mattstack.deck.json: the app only means something on a team. */
  requiresTeam?: boolean;
  /** Absent means enabled. A disabled app keeps its record but is neither served nor listed for the launcher. */
  enabled?: boolean;
```

Add to `records.ts`:

```ts
export function isEnabled(record: Pick<AppRecord, 'enabled'>): boolean {
  return record.enabled !== false;
}
```

`manifest.ts`, in `ingestManifest`: extend the `manifest` object built from the deck manifest with `requiresTeam: deck.manifest.requiresTeam`; in the stale-clear branch also destructure `requiresTeam: _requiresTeam` out of `record`; in the success `putRecord`, change `const { badge: _staleBadge, ...base } = record;` to `const { badge: _staleBadge, requiresTeam: _staleRequiresTeam, ...base } = record;` and spread `...('requiresTeam' in manifest && manifest.requiresTeam !== undefined ? { requiresTeam: manifest.requiresTeam } : {})`.

`bundled-identity.ts`: add `requiresTeam?: boolean` to `AppIdentity`; in `readBundledIdentity` return `...(m.requiresTeam !== undefined ? { requiresTeam: m.requiresTeam } : {})`; in `storedIdentity` add `...(record.requiresTeam !== undefined ? { requiresTeam: record.requiresTeam } : {})`; add:

```ts
export function requiresTeamFor(record: AppRecord): boolean {
  return effectiveIdentity(record).requiresTeam === true;
}
```

- [ ] **Step 4: Run to verify they pass, plus the registry suite**

Run: `cd apps/deck && bun test src/registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/registry
git commit -m "deck: carry requiresTeam and enabled on the app record"
```

### Task 3: the launcher catalog omits disabled apps

**Files:**
- Modify: `apps/deck/src/api/discovery.ts`
- Test: `apps/deck/src/api/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

`buildDiscoveryApps` keeps only records that `buildStatus` joined to a route in `routes.json`, so a record with no route is dropped before any `enabled` check and a test that forgets the route passes for the wrong reason. Append to `discovery.test.ts`, seeding both routes in one write (the file's `boardRow` helper overwrites the routes file with board's alone):

```ts
test('a disabled managed app is absent from discovery; a record without enabled is present', async () => {
  const chatDir = manifestDir();
  putRecord({ name: 'chat', managedBy: 'rt', port: 11002, kind: 'service', workingDirectory: chatDir, createdAt: '2026-08-10T00:00:00Z' });
  ingestManifest('chat');
  boardRow({ enabled: false });
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([
    { hostname: 'chat.localhost', port: 11002 },
    { hostname: 'board.localhost', port: 11006 },
  ]));
  const apps = await buildDiscoveryApps(statusOpts);
  expect(apps.map(a => a.name)).toEqual(['chat']);
  boardRow();
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([
    { hostname: 'chat.localhost', port: 11002 },
    { hostname: 'board.localhost', port: 11006 },
  ]));
  expect((await buildDiscoveryApps(statusOpts)).map(a => a.name)).toEqual(['board', 'chat']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/deck && bun test src/api/discovery.test.ts`
Expected: FAIL (board listed).

- [ ] **Step 3: Implement**

In `discovery.ts`, import `isEnabled` from `../registry/records.ts` and add after the `notServedHere` check:

```ts
    if (!isEnabled(record)) continue;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/deck && bun test src/api/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts
git commit -m "deck: hide disabled apps from the launcher catalog"
```

### Task 4: the sweep does not serve a disabled app

**Files:**
- Modify: `apps/deck/src/api/register.ts` (`reresolveManagedApps`, `restartManagedApps`)
- Test: `apps/deck/src/api/register.test.ts`

**Interfaces:**
- Produces: `reresolveManagedApps` body gains `disabled: string[]`.

- [ ] **Step 1: Write the failing tests**

A managed row only serves what the resolver finds: a command whose argv0 lives under the bundle helpers dir, or a linked source. So the row must be built the way the neighbouring reresolve test (`reinstalls only the app whose resolved command differs`) builds it: `bundleHelpers('board')` aims the resolver's seam at a scratch helpers dir, `registerApp` with `h.command('board', 'serve')` writes a servable row, and the module-level `drivers` (from `beforeEach`) with a `CountingManager` records installs and uninstalls. Add next to that test:

```ts
test('reresolve: a disabled rt row loses its plist and is reported under disabled; enabling it again installs it', async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  const h = bundleHelpers('board');
  await registerApp({ ...input, name: 'board', managedBy: 'rt', command: h.command('board', 'serve') }, reresolveDrivers);
  const label = `${LABEL_PREFIX}board`;
  expect(counting.installed.has(label)).toBe(true);
  counting.installCalls = [];
  counting.uninstallCalls = [];

  putRecord({ ...getRecord('board')!, enabled: false });
  const off = await reresolveManagedApps(reresolveDrivers);
  expect(off.body).toMatchObject({ ok: true, disabled: ['board'], failed: [] });
  expect(counting.uninstallCalls).toEqual([label]);
  expect(counting.installed.has(label)).toBe(false);

  putRecord({ ...getRecord('board')!, enabled: undefined });
  const on = await reresolveManagedApps(reresolveDrivers);
  expect(on.body).toMatchObject({ ok: true, disabled: [], restarted: ['board'] });
  expect(counting.installed.has(label)).toBe(true);
});

test('restartManagedApps skips a disabled row', async () => {
  const h = bundleHelpers('board');
  await registerApp({ ...input, name: 'board', managedBy: 'rt', command: h.command('board', 'serve') }, drivers);
  putRecord({ ...getRecord('board')!, enabled: false });
  const manager = drivers.manager as FakeServiceManager;
  manager.kickstarts = [];
  const r = await restartManagedApps(drivers);
  expect(manager.kickstarts).toEqual([]);
  expect(r.body.restarted).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/deck && bun test src/api/register.test.ts -t "disabled"`
Expected: FAIL (`disabled` undefined on the body; plist still installed; kickstart recorded).

- [ ] **Step 3: Implement**

`register.ts`: import `isEnabled` from `../registry/records.ts`. In `reresolveManagedApps`, declare `const disabled: string[] = [];` beside `notServed`, and right after the `notServedHere` block add:

```ts
    if (!isEnabled(record)) {
      const issue = await runDriver('launchd', () =>
        drivers.manager.uninstall(record.label!)
      );
      if (issue) {
        addIssue(record.name, issue);
        failed.push({ name: record.name, error: issue.message });
        continue;
      }
      clearIssues(record.name, 'launchd');
      disabled.push(record.name);
      continue;
    }
```

Add `disabled` to the returned body. In `restartManagedApps`, after the `notServedHere` skip: `if (!isEnabled(record)) continue;`. In `apps/deck/src/boot-reresolve.ts`, add `disabled?: string[]` to `Swept` and a `parts.push(\`disabled ${body.disabled.join(', ')}\`)` line so the boot log names them.

- [ ] **Step 4: Run to verify they pass, plus the api suite**

Run: `cd apps/deck && bun test src/api src/boot-reresolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts
git commit -m "deck: a disabled app is not served by the sweep"
```

### Task 5: `enabled`, `requiresTeam` and `displayName` on the admin API

**Files:**
- Modify: `apps/deck/src/api/status.ts` (`StatusRow`, the row literal in `buildStatus`, the tunnel row literal)
- Modify: `apps/deck/src/api/server.ts` (`SafeRecord`, `safeRecord`, `rowFor`)
- Modify: `apps/deck/src/api/register.ts` (`editApp`)
- Test: `apps/deck/src/api/register.test.ts`, `apps/deck/src/api/status.test.ts`

**Interfaces:**
- Produces: `StatusRow.enabled: boolean`, `StatusRow.requiresTeam: boolean`, `StatusRow.displayName: string`; `SafeRecord.enabled`, `SafeRecord.requiresTeam`; `PATCH /api/v1/apps/<name>` with body `{ enabled: boolean }` (alone) from the registrar caller.

- [ ] **Step 1: Write the failing tests**

`register.test.ts`, built the same way as Task 4's servable row:

```ts
test('editApp: enabled alone flips the record and re-sweeps; mixed with other fields it is refused', async () => {
  const h = bundleHelpers('board');
  await registerApp({ ...input, name: 'board', managedBy: 'rt', command: h.command('board', 'serve') }, drivers);
  const manager = drivers.manager as FakeServiceManager;
  const label = `${LABEL_PREFIX}board`;
  expect(manager.installed.has(label)).toBe(true);

  const off = await editApp('board', { enabled: false }, 'rt', false, drivers);
  expect(off.status).toBe(200);
  expect(getRecord('board')?.enabled).toBe(false);
  expect(manager.installed.has(label)).toBe(false);

  const mixed = await editApp('board', { enabled: true, port: 11007 }, 'rt', false, drivers);
  expect(mixed).toEqual({ status: 400, body: { error: 'enabled must be patched on its own' } });
  const notRegistrar = await editApp('board', { enabled: true }, 'user', false, drivers);
  expect(notRegistrar.status).toBe(409);
  const bad = await editApp('board', { enabled: 'yes' as never }, 'rt', false, drivers);
  expect(bad).toEqual({ status: 400, body: { error: 'enabled must be a boolean' } });

  const on = await editApp('board', { enabled: true }, 'rt', false, drivers);
  expect(on.status).toBe(200);
  expect(getRecord('board')?.enabled).toBeUndefined();
  expect(manager.installed.has(label)).toBe(true);
});
```

`status.test.ts`: its `beforeEach` seeds one route, `myapp.localhost` on 19999, so the record under test must be `myapp` at that port (a record with no route gets no row):

```ts
test('status rows carry enabled, requiresTeam and displayName', async () => {
  putRecord({ name: 'myapp', managedBy: 'rt', port: 19999, kind: 'service', enabled: false, requiresTeam: true, displayName: 'My App', createdAt: '2026-08-10T00:00:00Z' });
  const row = (await buildStatus(opts)).apps.find(a => a.name === 'myapp')!;
  expect(row.enabled).toBe(false);
  expect(row.requiresTeam).toBe(true);
  expect(row.displayName).toBe('My App');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/deck && bun test src/api/register.test.ts src/api/status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`status.ts`: add to `StatusRow`:

```ts
  /** Launcher name from the effective identity; the record name when none. */
  displayName: string;
  enabled: boolean;
  requiresTeam: boolean;
```

In the row literal inside `buildStatus` (the one with `managedBy: record?.managedBy ?? null`), add:

```ts
        displayName: record ? effectiveIdentity(record).displayName : a.name,
        enabled: record ? isEnabled(record) : true,
        requiresTeam: record ? requiresTeamFor(record) : false,
```

and in the tunnel row literal (`managedBy: null`): `displayName: <that row's name expression>, enabled: true, requiresTeam: false`. Run `cd apps/deck && bunx tsc --noEmit` to find any other `StatusRow` literal and give it the same three fields.

`server.ts`: `SafeRecord` gains `enabled: boolean; requiresTeam: boolean;`; `safeRecord` sets `enabled: isEnabled(record), requiresTeam: requiresTeamFor(record)`; `rowFor`'s fallback literal gains `displayName: effectiveIdentity(record).displayName, enabled: isEnabled(record), requiresTeam: requiresTeamFor(record)`.

`register.ts`, `editApp`: add `enabled?: boolean` to the patch type. Right after the `if (!record)` guard:

```ts
  if (patch.enabled !== undefined) {
    if (Object.keys(patch).length !== 1)
      return { status: 400, body: { error: 'enabled must be patched on its own' } };
    if (typeof patch.enabled !== 'boolean')
      return { status: 400, body: { error: 'enabled must be a boolean' } };
    const verdict = authorizeStructural(record, caller, force);
    if (!verdict.ok) return { status: verdict.status, body: verdict.body };
    putRecord({ ...record, enabled: patch.enabled ? undefined : false });
    await reresolveManagedApps(drivers);
    return { status: 200, body: { record: safeRecordFor(getRecord(record.name)!) } };
  }
```

`safeRecord` lives in `server.ts`; move it and `SafeRecord` into `status.ts` (exported), import them in `server.ts` and `register.ts`, and name the import `safeRecord` in both (the snippet's `safeRecordFor` is that function). This branch deliberately answers with the safe record where the rest of `editApp` answers with the raw one: an `enabled` flip is the one PATCH the tray drives through `rt apps`, and no raw record field should ride out through it.

- [ ] **Step 4: Run to verify they pass, plus typecheck**

Run: `cd apps/deck && bunx tsc --noEmit && bun test src`
Expected: clean typecheck, PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/api
git commit -m "deck: enabled and requiresTeam on the admin API, enabled PATCH"
```

### Task 6: the bundle identity ships `requiresTeam`; board and boxscore declare it

**Files:**
- Modify: `scripts/lib/app-identity.ts`
- Modify: `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json`
- Modify: `apps/board/mattstack.deck.json`, `apps/boxscore/mattstack.deck.json`
- Test: `scripts/lib/__tests__/app-identity.test.ts`

- [ ] **Step 1: Write the failing test**

In `app-identity.test.ts`, add `requiresTeam: true` to `BOARD_SOURCE` (after `badge`), and add:

```ts
test("requiresTeam survives staging and a non-boolean is refused", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-req-")), "identity");
  const id = stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), out, "board");
  expect(id?.requiresTeam).toBe(true);
  expect(readStagedIdentity(out, "board").requiresTeam).toBe(true);
  expect(() => readDeclaredIdentity(appDir({ ...BOARD_SOURCE, requiresTeam: "yes" }, { "src/favicon.svg": SVG }))).toThrow(/requiresTeam must be a boolean/);
});
```

Overwrite the fixture `scripts/lib/__tests__/fixtures/bundle-resources/apps/board/mattstack.deck.json` with the exact bytes Task 2 wrote to its deck twin (same seven lines, `requiresTeam` last, trailing newline; sha256 `998fddd2621726f465df3f478d0eeefa8c0186ce3e5c8fd1de7c0edb7193faf5`). The `staging board's source manifest writes exactly the twin fixture's bytes` test pins those bytes, and the deck side pins the same digest, so the two files must stay identical.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test ./scripts/lib/__tests__/app-identity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app-identity.ts`: add `"requiresTeam"` to `IDENTITY_KEYS`; `AppIdentity.requiresTeam?: boolean`; in `readDeclaredIdentity` destructure `requiresTeam`, validate `if (requiresTeam !== undefined && typeof requiresTeam !== "boolean") throw new Error(\`${path}: requiresTeam must be a boolean\`);`, return `...(requiresTeam !== undefined ? { requiresTeam } : {})`; in `serializeIdentity` change `out` to `Record<string, string | boolean>` and add `if (id.requiresTeam !== undefined) out.requiresTeam = id.requiresTeam;` after the badge line.

Add `"requiresTeam": true` to `apps/board/mattstack.deck.json` (after `badge`) and `apps/boxscore/mattstack.deck.json` (after `includeInBundle`).

- [ ] **Step 4: Run to verify it passes, plus the bundle checks**

Run: `bun test ./scripts/lib/__tests__/app-identity.test.ts && cd apps/deck && bun test src/registry/deck-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/app-identity.ts scripts/lib/__tests__ apps/board/mattstack.deck.json apps/boxscore/mattstack.deck.json
git commit -m "bundle identity: ship requiresTeam; board and boxscore declare it"
```

## Part B: rt

### Task 7: the solo intent and `isSolo`

**Files:**
- Modify: `lib/setup/intent.ts`, `lib/setup/contract.ts`, `commands/setup.ts` (`setupIntent`), `lib/command-tree-def.ts` (the `setup intent` node hint)
- Test: `lib/setup/__tests__/intent.test.ts`, `lib/setup/__tests__/contract.test.ts`, `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Produces: `SetupIntent.mode` includes `"solo"`; `isSolo(team: Pick<TeamRef, "slug" | "mode">): boolean` exported from `contract.ts`; `rt setup intent solo [--json]` writes `{ v: 1, at, mode: "solo" }` and prints `{ mode: "solo" }`.

- [ ] **Step 1: Write the failing tests**

`intent.test.ts`:

```ts
test("round-trips a solo intent and maps it to the no-team ref", () => {
  const p = fakeProbes();
  const intent: SetupIntent = { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" };
  writeIntent(p, intent);
  expect(readIntent(p)).toEqual(intent);
  expect(teamRefFromIntent(intent, [])).toEqual({ slug: "", name: "", mode: "none" });
  expect(teamRefFromIntent(intent, ["acme"])).toEqual({ slug: "acme", name: "acme", mode: "none" });
});
```

`contract.test.ts`:

```ts
test("isSolo: no team known, and only then", () => {
  expect(isSolo({ slug: "", mode: "none" })).toBe(true);
  expect(isSolo({ slug: "acme", mode: "none" })).toBe(false);
  expect(isSolo({ slug: "", mode: "create" })).toBe(false);
  expect(isSolo({ slug: "", mode: "restore" })).toBe(false);
});
```

`steps-a.test.ts`, in the `team.create` describe:

```ts
  test("a solo intent never makes team-of-one create a team", () => {
    const { ctx } = makeCtx(fakeProbes(), { teamOfOne: true, intent: { v: 1, at: "", mode: "solo" }, team: { slug: "", name: "", mode: "none" } });
    expect(teamCreateStep.applies(ctx)).toBe(false);
    expect(teamJoinStep.applies(ctx)).toBe(false);
  });
```

The verb is covered in `commands/__tests__/setup-apply.test.ts` (search it for `setupIntent(`); add there, with the `IntentDeps` fake shape that file already uses (`probes: fakeProbes()`, `print` collecting lines, `exit` throwing):

```ts
test("rt setup intent solo writes the solo intent and prints it", async () => {
  const p = fakeProbes();
  const out: string[] = [];
  await setupIntent(["solo", "--json"], {}, { probes: p, print: (s) => out.push(s), exit: (c) => { throw new Error(`exit ${c}`); } });
  expect(readIntent(p)?.mode).toBe("solo");
  expect(JSON.parse(out[0]!)).toMatchObject({ contract: 1, mode: "solo" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test ./lib/setup/__tests__/intent.test.ts ./lib/setup/__tests__/contract.test.ts ./lib/setup/__tests__/steps-a.test.ts ./commands/__tests__/setup-apply.test.ts && bunx tsc --noEmit`
Expected: the contract test and the verb test FAIL at runtime; the intent and steps-a tests pass at runtime but `tsc` rejects `"solo"` (bun test does not typecheck).

- [ ] **Step 3: Implement**

`intent.ts`: `mode: "create" | "join" | "restore" | "solo";` and in `teamRefFromIntent` no code change is needed once the type admits it (solo falls to the final fallback), but add a line above the fallback so the intent is read as chosen, not as absent:

```ts
  // solo carries no team; the discovered clones still decide the ref so a machine that later has a team never reads as solo.
```

`contract.ts`:

```ts
/** No team known: the derived solo state every validator branches on. */
export function isSolo(team: Pick<TeamRef, "slug" | "mode">): boolean {
  return team.mode === "none" && team.slug === "";
}
```

`commands/setup.ts`, in `setupIntent` before the `clear` branch:

```ts
    if (sub === "solo") {
      writeIntent(deps.probes, { v: 1, at: deps.probes.now().toISOString(), mode: "solo" });
      printIntentResult(deps, json, { mode: "solo" });
      return;
    }
```

Update both usage strings to `rt setup intent restore <org>/<repo> | rt setup intent solo | rt setup intent clear` and the tree node's `Mode` hint to `restore <org>/<repo> | solo | clear`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test ./lib/setup/__tests__/intent.test.ts ./lib/setup/__tests__/contract.test.ts ./lib/setup/__tests__/steps-a.test.ts ./commands/__tests__/setup-apply.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/intent.ts lib/setup/contract.ts commands/setup.ts lib/command-tree-def.ts lib/setup/__tests__ commands/__tests__/setup-apply.test.ts
git commit -m "setup: solo intent and isSolo"
```

### Task 8: access rows are empty on solo

**Files:**
- Modify: `lib/setup/validators/access.ts`
- Test: `lib/setup/__tests__/validators-access.test.ts`

**Interfaces:**
- Produces: `accessRows(p, team, intent, overrides?, secrets?, solo = false)`; returns `[]` when `solo`.

- [ ] **Step 1: Write the failing test**

```ts
describe("accessRows on solo", () => {
  test("no rows at all, whatever the snapshot says", async () => {
    const rows = await accessRows(fakeProbes(), baseTeam({ remote: REMOTE, trackingIdentities: ["github.com/acme/x"] }), null, {}, undefined, true);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test ./lib/setup/__tests__/validators-access.test.ts -t "on solo"`
Expected: FAIL (rows returned).

- [ ] **Step 3: Implement**

Change the signature to `export async function accessRows(p: Probes, team: TeamSnapshot, intent: SetupIntent | null, overrides: UserIntegrationOverrides = {}, secrets?: SecretPresence, solo = false): Promise<Row[]>` and start the body with `if (solo) return [];`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test ./lib/setup/__tests__/validators-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/access.ts lib/setup/__tests__/validators-access.test.ts
git commit -m "setup: no access rows on a solo install"
```

### Task 9: an optional GitHub account row on solo

**Files:**
- Modify: `lib/setup/validators/accounts.ts`
- Test: `lib/setup/__tests__/validators-accounts.test.ts`

**Interfaces:**
- Produces: `accountRows(p, team, reqs, secrets, intent, overrides?, solo = false)`; on solo with nothing declared, exactly one row `account.github` with `required: false` and `optionalNote: "Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt."`.

- [ ] **Step 1: Write the failing test**

Using the file's existing probes/secrets fakes and `baseTeam` helper (empty integrations):

```ts
describe("accountRows on solo", () => {
  test("one optional github row, nothing else", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam({ slug: "" }), [], NO_SECRETS, { v: 1, at: "", mode: "solo" }, {}, true);
    expect(rows.map((r) => r.id)).toEqual(["account.github"]);
    expect(rows[0]!.required).toBe(false);
    expect(rows[0]!.optionalNote).toBe("Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt.");
    expect(rows[0]!.status).toBe("missing");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test ./lib/setup/__tests__/validators-accounts.test.ts -t "on solo"`
Expected: FAIL (no rows).

- [ ] **Step 3: Implement**

Add the constant and the branch in `accountRows`:

```ts
const SOLO_FORGE_NOTE = "Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt.";
```

```ts
export async function accountRows(p, team, reqs, secrets, intent, overrides = {}, solo = false): Promise<Row[]> {
  const declared = solo && !team.integrations.forge && reqs.length === 0
    ? [{ id: "github" as Integration, required: false, optionalNote: SOLO_FORGE_NOTE }]
    : declaredIntegrations(team, reqs);
```

(keep the parameter types as they are today; the rest of the function is unchanged).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test ./lib/setup/__tests__/validators-accounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/accounts.ts lib/setup/__tests__/validators-accounts.test.ts
git commit -m "setup: optional GitHub account row on a solo install"
```

### Task 10: Fast Browser optional on solo, and the plan wiring with snapshots

**Files:**
- Modify: `lib/setup/validators/tools.ts`, `lib/setup/plan.ts`
- Test: `lib/setup/__tests__/validators-tools.test.ts`, `lib/setup/__tests__/plan.test.ts`

**Interfaces:**
- Produces: `toolRows(p, reqs, { hasBrew, secrets, teamSlug?, solo? }, seams?)`; on solo `tool.fast-browser` is `required: false` with `optionalNote: "Works without this; only the browser skills need it."` and `tool.fast-browser-extension` has `finishGated: false`. `composePlan` passes `isSolo(team)` to `accessRows`, `accountRows` and `toolRows`.

- [ ] **Step 1: Write the failing tests**

`validators-tools.test.ts`, in the `tool.fast-browser` describe:

```ts
  test("solo: the binary row is optional and the extension row never gates Finish", async () => {
    const rows = await toolRows(fakeProbes(), [], { hasBrew: true, secrets: NO_SECRETS, solo: true }, NOOP_SEAMS);
    const fb = rows.find((r) => r.id === "tool.fast-browser")!;
    expect(fb.required).toBe(false);
    expect(fb.optionalNote).toBe("Works without this; only the browser skills need it.");
    const ext = rows.find((r) => r.id === "tool.fast-browser-extension")!;
    expect(ext.finishGated).toBe(false);
  });
```

`plan.test.ts`:

```ts
  test("solo intent, no teams -> no access rows, github optional, fast-browser optional, no team rows, and the existing modes unchanged", async () => {
    const p = fakeProbes({ exec: readyExec, tray: grantedTray });
    writeIntent(p, { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" });
    const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });
    expect(plan.team).toEqual({ slug: "", name: "", mode: "none" });
    expect(plan.groups.find((g) => g.id === "access")!.rows).toEqual([]);
    const accounts = plan.groups.find((g) => g.id === "accounts")!.rows;
    expect(accounts.map((r) => [r.id, r.required])).toEqual([["account.github", false]]);
    const tools = plan.groups.find((g) => g.id === "tools")!.rows;
    expect(tools.find((r) => r.id === "tool.fast-browser")!.required).toBe(false);
    expect(tools.some((r) => r.id.startsWith("team."))).toBe(false);
    expect(plan.canInstall).toBe(true);
  });

  test("create, join and restore intents produce the same rows as before solo existed", async () => {
    // readyExec puts no fast-browser on PATH, so the row's "missing" branch is the one asserted; the pending branches already read required:false in every mode.
    for (const intent of [createIntent(), joinIntent(), restoreIntent()]) {
      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, intent);
      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: [] });
      expect(plan.groups.find((g) => g.id === "access")!.rows.length).toBeGreaterThan(0);
      expect(plan.groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.fast-browser")!.required).toBe(true);
    }
  });
```

Build `createIntent`, `joinIntent`, `restoreIntent` from the intents the file's existing create and join tests already write (lift them into helpers at the top of the file; restore is `{ v: 1, at: "...", mode: "restore", restore: { homeRepo: "acme/home" } }`).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test ./lib/setup/__tests__/validators-tools.test.ts ./lib/setup/__tests__/plan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tools.ts`: extend `opts` with `solo?: boolean`. `fastBrowserRow(probe, solo: boolean)`: build `base` with `required: !solo` and, when `solo`, `optionalNote: "Works without this; only the browser skills need it."` on every branch (spread a `soloNote` object into each `row({...})` call). `fastBrowserExtensionRow(p, probe, solo: boolean)`: `finishGated: !solo`. Pass `opts.solo === true` at both call sites in `toolRows`.

`plan.ts`: import `isSolo` from `./contract.ts`; in `composePlan` after `resolveTeam`: `const solo = isSolo(team);` and pass it: `accountRows(i.p, snapshot, reqs, i.secrets, intent, userOverrides, solo)`, `accessRows(i.p, snapshot, intent, userOverrides, i.secrets, solo)`, `toolRows(i.p, reqs, { hasBrew, secrets: i.secrets, teamSlug: team.slug, solo })`.

- [ ] **Step 4: Run to verify they pass, then the whole setup suite**

Run: `bun test ./lib/setup && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/tools.ts lib/setup/plan.ts lib/setup/__tests__
git commit -m "setup: Fast Browser optional on solo; plan branches on isSolo"
```

### Task 11: `deck.managed` applies the mode default

**Files:**
- Modify: `lib/setup/steps/deck.ts`
- Test: `lib/setup/__tests__/steps-b.test.ts`

**Interfaces:**
- Produces: `readDeckApiPortFrom(p: Pick<Probes, "readFile" | "home">): number | null` exported from `steps/deck.ts` (used by Task 13); `deck.managed` detail ends with `; solo: <names> off`, `; team apps on: <names>` or `; no team-only apps`.

- [ ] **Step 1: Update the existing tests and add the new ones**

In the `deck.managed` describe, extend `healthyFetch` so a `GET .../api/v1/apps` answers a list, parameterised:

```ts
    const healthyFetch = (deckPort: number, patchStatus = 200, apps: Array<{ name: string; managedBy: string; requiresTeam: boolean; enabled: boolean }> = []): Probes["fetch"] =>
      async (url, init) => {
        if (url === `http://127.0.0.1:${deckPort}/healthz`) return { status: 200, body: "ok", headers: {} };
        if (url === `http://127.0.0.1:${deckPort}/api/v1/apps` && (init?.method ?? "GET") === "GET") return { status: 200, body: JSON.stringify({ apps }), headers: {} };
        if (url.includes("/api/v1/apps/") && init?.method === "PATCH") {
          if (init.headers?.["x-local-caller"] !== "rt") return { status: 409, body: JSON.stringify({ error: "managed" }), headers: {} };
          return { status: patchStatus, body: "", headers: {} };
        }
        return { status: 404, body: "", headers: {} };
      };
```

Every existing `deck ready; ...` expectation in that describe gets a fragment appended: `; no team-only apps` where the test uses `healthyFetch` (its list answers `{ apps: [] }`), and `; app defaults skipped (deck answered 404)` where a test supplies its own `fetch` that does not answer the list. Every existing test there runs with `makeCtx`'s default `intent: null`, which the new gate treats as "not an install", so those expectations instead end with `; app defaults untouched (not an install)`; only tests that set an intent reach the fragments above. Then add:

```ts
    const CATALOG = [
      { name: "board", managedBy: "rt", requiresTeam: true, enabled: true },
      { name: "boxscore", managedBy: "rt", requiresTeam: true, enabled: true },
      { name: "console", managedBy: "rt", requiresTeam: false, enabled: false },
      { name: "chat", managedBy: "rt", requiresTeam: false, enabled: true },
    ];

    // steps-b.test.ts does not import SetupIntent today; add `import type { SetupIntent } from "../intent.ts";` to its imports.
    const SOLO_INTENT: SetupIntent = { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "solo" };
    const CREATE_INTENT: SetupIntent = { v: 1, at: "2026-09-26T00:00:00.000Z", mode: "create", team: { slug: "acme", name: "Acme", remote: "https://github.com/acme/x.git", others: false } };

    test("no intent (a plain rt setup apply after install): nothing is PATCHed, whatever the mode", async () => {
      const p = bundledProbes({ tools: ["board"], overrides: { files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) }, fetch: healthyFetch(4100, 200, CATALOG), exec: async () => adoptReply(false) } });
      const { ctx } = makeCtx(p, { intent: null, team: { slug: "", name: "", mode: "none" } });
      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; board already adopted; app defaults untouched (not an install)" });
      expect(p.calls.fetchInits.filter((c) => c.init?.method === "PATCH")).toEqual([]);
    });

    test("solo: every requiresTeam app is PATCHed off; console's manual off is left alone", async () => {
      const p = bundledProbes({ tools: ["board"], overrides: { files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) }, fetch: healthyFetch(4100, 200, CATALOG), exec: async () => adoptReply(false) } });
      const { ctx } = makeCtx(p, { intent: SOLO_INTENT, team: { slug: "", name: "", mode: "none" } });
      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; board already adopted; solo: board, boxscore off" });
      const patches = p.calls.fetchInits.filter((c) => c.init?.method === "PATCH").map((c) => [c.url, c.init?.body]);
      expect(patches).toEqual([
        ["http://127.0.0.1:4100/api/v1/apps/board", JSON.stringify({ enabled: false })],
        ["http://127.0.0.1:4100/api/v1/apps/boxscore", JSON.stringify({ enabled: false })],
      ]);
    });

    test("team: every requiresTeam app is PATCHed on; console's manual off is left alone", async () => {
      const p = bundledProbes({ tools: ["board"], overrides: { files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) }, fetch: healthyFetch(4100, 200, CATALOG), exec: async () => adoptReply(false) } });
      const { ctx } = makeCtx(p, { intent: CREATE_INTENT, team: { slug: "acme", name: "Acme", mode: "create" } });
      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; board already adopted; team apps on: board, boxscore" });
      const patched = p.calls.fetchInits.filter((c) => c.init?.method === "PATCH").map((c) => c.url);
      expect(patched).toEqual(["http://127.0.0.1:4100/api/v1/apps/board", "http://127.0.0.1:4100/api/v1/apps/boxscore"]);
    });
```

If `fakeProbes` records only URLs (`p.calls.fetch`), extend `lib/setup/__tests__/fakes.ts` so it also pushes `{ url, init }` onto `calls.fetchInits`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test ./lib/setup/__tests__/steps-b.test.ts -t "deck.managed"`
Expected: FAIL (details lack the fragment; no PATCHes).

- [ ] **Step 3: Implement**

`steps/deck.ts`: add and use

```ts
export function readDeckApiPortFrom(p: Pick<Probes, "readFile" | "home">): number | null {
  const raw = p.readFile(join(p.home, ".mattstack", "deck", "api.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as DeckApiFile;
    return typeof parsed.port === "number" ? parsed.port : null;
  } catch {
    return null;
  }
}

export function readDeckApiPort(ctx: ApplyContext): number | null {
  return readDeckApiPortFrom(ctx.p);
}
```

```ts
interface DeckAppRow { name: string; managedBy: string; requiresTeam?: boolean; enabled?: boolean }

async function applyAppDefaults(ctx: ApplyContext, port: number): Promise<string> {
  // An intent is only on disk during a first run or an upgrade; a completed apply clears it. Without one this is a re-run, and a user's own toggles stand.
  if (ctx.intent === null) return "app defaults untouched (not an install)";
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps`);
  if (res.status !== 200) return `app defaults skipped (deck answered ${res.status})`;
  let apps: DeckAppRow[];
  try {
    apps = (JSON.parse(res.body) as { apps?: DeckAppRow[] }).apps ?? [];
  } catch {
    return "app defaults skipped (unreadable app list)";
  }
  const targets = apps.filter((a) => a.managedBy === MATTSTACK_REGISTRAR && a.requiresTeam === true).map((a) => a.name).sort();
  if (targets.length === 0) return "no team-only apps";
  const enabled = !isSolo(ctx.team);
  const headers = { "content-type": "application/json", "x-local-caller": MATTSTACK_REGISTRAR };
  const failed: string[] = [];
  for (const name of targets) {
    const r = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps/${name}`, { method: "PATCH", headers, body: JSON.stringify({ enabled }) });
    if (r.status < 200 || r.status >= 300) failed.push(`${name} (${r.status})`);
  }
  const names = targets.join(", ");
  const tail = failed.length ? `; failed: ${failed.join(", ")}` : "";
  return enabled ? `team apps on: ${names}${tail}` : `solo: ${names} off${tail}`;
}
```

Import `isSolo` from `../contract.ts`. In `deckManagedRun`, replace the two `return { state: "done", ... }` lines with:

```ts
  const adoptDetail = adopted.kind === "skip" ? adopted.detail : `board adopted from legacy mrs, ${await repointBoard(ctx, port)}`;
  return { state: "done", detail: `deck ready; ${adoptDetail}; ${await applyAppDefaults(ctx, port)}` };
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test ./lib/setup/__tests__/steps-b.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/deck.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/fakes.ts
git commit -m "setup: deck.managed applies the solo or team app default"
```

### Task 12: `rt team status` answers solo

**Files:**
- Modify: `commands/team.ts` (`teamStatus`)
- Test: `commands/__tests__/team.test.ts` (or the file that already tests `teamStatus`; search `teamStatus(` under `commands/__tests__` and `lib`)

**Interfaces:**
- Produces: with no `--team` and zero clones, `--json` prints `envelope({ mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [] })` and exits 0; text prints `rt team status: no team (Just me)`. Two clones without `--team` still fail `ambiguous-team`.

- [ ] **Step 1: Rewrite the no-team test and add the two new ones**

In `commands/__tests__/team-status.test.ts`, `listTeams()` reads the test run's isolated `process.env.HOME` (not the fake probes' `/home/x`), so "zero teams" is the default and two clones need real directories. Replace the test `no --team and zero local teams -> exits 2 with no-team, from resolveTeamSlug` with:

```ts
  test("no --team and zero local teams -> mode solo, exit 0, in both output modes", async () => {
    const deps = baseDeps();
    await teamStatus(["--json"], {}, deps);
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [] });

    const text = baseDeps();
    await teamStatus([], {}, text);
    expect(text.lines[0]).toBe("rt team status: no team (Just me)");
  });

  test("two local teams and no --team -> still exits 2 with ambiguous-team, never solo", async () => {
    const teams = join(process.env.HOME!, ".mattstack", "teams");
    mkdirSync(join(teams, "acme"), { recursive: true });
    mkdirSync(join(teams, "beta"), { recursive: true });
    try {
      const deps = baseDeps();
      const code = await runExpectingProcessExit(() => teamStatus(["--json"], {}, deps));
      expect(code).toBe(2);
      expect(JSON.parse(deps.lines[0]!).error.code).toBe("ambiguous-team");
    } finally {
      rmSync(teams, { recursive: true, force: true });
    }
  });
```

Add `mkdirSync, rmSync` to the file's `fs` imports. The `--team acme` no-team test above it stays as it is.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test ./commands/__tests__/team-status.test.ts`
Expected: the rewritten test FAILS (exit 2 with `no-team`); the ambiguous test passes already.

- [ ] **Step 3: Implement**

At the top of `teamStatus`'s `try`, before `resolveTeamSlug`:

```ts
    if (!flagValue(args, "--team") && listTeams().length === 0) {
      const result = { mode: "solo" as const, slug: null, name: null, remote: null, lastPush: null, members: [] as never[] };
      deps.print(json ? JSON.stringify(envelope(result)) : "rt team status: no team (Just me)");
      return;
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test ./commands/__tests__/team-status.test.ts ./commands/__tests__/team.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts commands/__tests__
git commit -m "team status: answer mode solo when no clone exists"
```

### Task 13: `rt apps list|enable|disable`

**Files:**
- Create: `commands/apps.ts`
- Modify: `lib/command-tree-def.ts` (new top-level `apps` group after `services`), `lib/module-registry.ts`
- Test: `commands/__tests__/apps.test.ts`

**Interfaces:**
- Produces: `rt apps list [--json]` prints `envelope({ apps: [{ name, displayName, enabled, requiresTeam }] })` for `managedBy: "rt"` rows; `rt apps enable <name> [--json]` and `rt apps disable <name> [--json]` PATCH deck and print `envelope({ name, enabled })`. Errors: `deck-not-running` (no api.json or healthz not 200), `unknown-app` (404), `not-managed` (409). Omitting the name prints the list and the usage error (`omitBehavior: "list"`).

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/apps.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { appsDisable, appsEnable, appsList, type AppsDeps } from "../apps.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";

const ROWS = [
  { name: "board", managedBy: "rt", displayName: "Board", enabled: false, requiresTeam: true },
  { name: "chat", managedBy: "rt", displayName: "Chat", enabled: true, requiresTeam: false },
  { name: "mine", managedBy: "user", displayName: "mine", enabled: true, requiresTeam: false },
];

function deps(overrides: { patchStatus?: number; running?: boolean } = {}): AppsDeps & { out: string[]; patches: string[] } {
  const home = "/fake-home";
  const running = overrides.running ?? true;
  const out: string[] = [];
  const patches: string[] = [];
  const p = fakeProbes({
    home,
    files: running ? { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) } : {},
    fetch: async (url, init) => {
      if (url.endsWith("/healthz")) return { status: 200, body: "ok", headers: {} };
      if (url.endsWith("/api/v1/apps")) return { status: 200, body: JSON.stringify({ apps: ROWS }), headers: {} };
      if (init?.method === "PATCH") {
        patches.push(`${url} ${init.body} ${init.headers?.["x-local-caller"]}`);
        return { status: overrides.patchStatus ?? 200, body: "{}", headers: {} };
      }
      return { status: 404, body: "", headers: {} };
    },
  });
  return { probes: p, print: (s) => out.push(s), exit: (c) => { throw new Error(`exit ${c}`); }, out, patches };
}

describe("rt apps", () => {
  test("list --json prints only rt-managed rows", async () => {
    const d = deps();
    await appsList(["--json"], {}, d);
    expect(JSON.parse(d.out[0]!).apps).toEqual([
      { name: "board", displayName: "Board", enabled: false, requiresTeam: true },
      { name: "chat", displayName: "Chat", enabled: true, requiresTeam: false },
    ]);
  });

  test("enable and disable PATCH deck as the registrar", async () => {
    const d = deps();
    await appsEnable(["board", "--json"], {}, d);
    await appsDisable(["chat", "--json"], {}, d);
    expect(d.patches).toEqual([
      'http://127.0.0.1:4100/api/v1/apps/board {"enabled":true} rt',
      'http://127.0.0.1:4100/api/v1/apps/chat {"enabled":false} rt',
    ]);
    expect(JSON.parse(d.out[0]!)).toMatchObject({ name: "board", enabled: true });
  });

  test("deck not running -> deck-not-running, exit 2", async () => {
    const d = deps({ running: false });
    await expect(appsList(["--json"], {}, d)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d.out[0]!).error.code).toBe("deck-not-running");
  });

  test("a 404 from deck -> unknown-app; a 409 -> not-managed", async () => {
    const d404 = deps({ patchStatus: 404 });
    await expect(appsEnable(["nope", "--json"], {}, d404)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d404.out[0]!).error.code).toBe("unknown-app");
    const d409 = deps({ patchStatus: 409 });
    await expect(appsEnable(["mine", "--json"], {}, d409)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d409.out[0]!).error.code).toBe("not-managed");
  });

  test("enable with no name lists the apps and exits 2 usage", async () => {
    const d = deps();
    await expect(appsEnable(["--json"], {}, d)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d.out[0]!).error.code).toBe("usage");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test ./commands/__tests__/apps.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`commands/apps.ts`:

```ts
/**
 * rt apps list|enable|disable: the mattstack apps deck serves on this Mac.
 * Thin facade over deck's admin API, calling as the registrar so a managed
 * row accepts the flip.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { readDeckApiPortFrom } from "../lib/setup/steps/deck.ts";

export interface AppsDeps {
  probes: Probes;
  print: (s: string) => void;
  exit: (code: number) => never;
}

export function realAppsDeps(): AppsDeps {
  return { probes: createRealProbes(), print: (s) => console.log(s), exit: process.exit };
}

export interface AppRow {
  name: string;
  displayName: string;
  enabled: boolean;
  requiresTeam: boolean;
}

const REGISTRAR = "rt";

function fail(deps: AppsDeps, json: boolean, verb: string, err: UserActionableError): never {
  deps.print(json ? JSON.stringify(userErrorPayload(err, deps.probes.now())) : `rt ${verb}: ${err.message}`);
  return deps.exit(2);
}

async function deckPort(deps: AppsDeps): Promise<number | null> {
  const port = readDeckApiPortFrom(deps.probes);
  if (port === null) return null;
  const res = await deps.probes.fetch(`http://127.0.0.1:${port}/healthz`);
  return res.status === 200 ? port : null;
}

async function listRows(deps: AppsDeps, port: number): Promise<AppRow[]> {
  const res = await deps.probes.fetch(`http://127.0.0.1:${port}/api/v1/apps`);
  if (res.status !== 200) throw new UserActionableError("deck-error", `deck answered ${res.status} listing apps`);
  const apps = (JSON.parse(res.body) as { apps?: Array<AppRow & { managedBy: string }> }).apps ?? [];
  return apps.filter((a) => a.managedBy === REGISTRAR).map(({ name, displayName, enabled, requiresTeam }) => ({ name, displayName, enabled, requiresTeam }));
}

function printList(deps: AppsDeps, json: boolean, apps: AppRow[]): void {
  if (json) {
    deps.print(JSON.stringify(envelope({ apps }, deps.probes.now())));
    return;
  }
  for (const a of apps) deps.print(`${a.enabled ? "on " : "off"}  ${a.name.padEnd(10)} ${a.displayName}${a.requiresTeam ? "  (needs a team)" : ""}`);
}

export async function appsList(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  const json = args.includes("--json");
  const port = await deckPort(deps);
  if (port === null) return fail(deps, json, "apps list", new UserActionableError("deck-not-running", "deck is not running; open mattstack.app, then retry"));
  try {
    printList(deps, json, await listRows(deps, port));
  } catch (err) {
    if (err instanceof UserActionableError) return fail(deps, json, "apps list", err);
    throw err;
  }
}

async function setEnabled(args: string[], deps: AppsDeps, enabled: boolean): Promise<void> {
  const json = args.includes("--json");
  const verb = enabled ? "apps enable" : "apps disable";
  const name = args.find((a) => !a.startsWith("--"));
  const port = await deckPort(deps);
  if (port === null) return fail(deps, json, verb, new UserActionableError("deck-not-running", "deck is not running; open mattstack.app, then retry"));
  if (!name) {
    if (!json) printList(deps, false, await listRows(deps, port));
    return fail(deps, json, verb, new UserActionableError("usage", `usage: rt ${verb} <name> [--json]`));
  }
  const res = await deps.probes.fetch(`http://127.0.0.1:${port}/api/v1/apps/${name}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-local-caller": REGISTRAR },
    body: JSON.stringify({ enabled }),
  });
  if (res.status === 404) return fail(deps, json, verb, new UserActionableError("unknown-app", `deck has no app named ${name}`));
  if (res.status === 409) return fail(deps, json, verb, new UserActionableError("not-managed", `${name} is not a mattstack app; toggle it from deck's board instead`));
  if (res.status < 200 || res.status >= 300) return fail(deps, json, verb, new UserActionableError("deck-error", `deck answered ${res.status}`));
  deps.print(json ? JSON.stringify(envelope({ name, enabled }, deps.probes.now())) : `rt ${verb}: ${name} is now ${enabled ? "on" : "off"}`);
}

export async function appsEnable(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  return setEnabled(args, deps, true);
}

export async function appsDisable(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  return setEnabled(args, deps, false);
}
```

(Check `userErrorPayload`'s real signature in `lib/setup/errors.ts` and match it; `commands/setup.ts` calls it with `(err, now)`.)

`lib/command-tree-def.ts`, after the `services` group:

```ts
  apps: {
    description: "The mattstack apps deck serves on this Mac (board, console, chat, boxscore)",
    subcommands: {
      list: { description: "List the apps and whether each is on", module: "./commands/apps.ts", fn: "appsList", args: [SETUP_JSON_ARG] },
      enable: {
        description: "Turn an app on (deck serves it and the window shows it)",
        module: "./commands/apps.ts",
        fn: "appsEnable",
        omitBehavior: "list",
        args: [{ name: "Name", type: "text", placeholder: "board", hint: "App name from rt apps list" }, SETUP_JSON_ARG],
      },
      disable: {
        description: "Turn an app off (deck stops it and the window hides it)",
        module: "./commands/apps.ts",
        fn: "appsDisable",
        omitBehavior: "list",
        args: [{ name: "Name", type: "text", placeholder: "board", hint: "App name from rt apps list" }, SETUP_JSON_ARG],
      },
    },
  },
```

`lib/module-registry.ts`: add `"./commands/apps.ts": () => import("../commands/apps.ts"),` in alphabetical position.

- [ ] **Step 4: Run to verify it passes, plus the gates that watch new verbs**

Run: `bun test ./commands/__tests__/apps.test.ts ./lib/__tests__ && bun run picker:check && bunx tsc --noEmit`
Expected: PASS, picker check clean (the `no-*` guards cover the registry and the tree).

- [ ] **Step 5: Commit**

```bash
git add commands/apps.ts commands/__tests__/apps.test.ts lib/command-tree-def.ts lib/module-registry.ts
git commit -m "rt apps: list, enable and disable the served mattstack apps"
```

## Part C: tray

### Task 14: `TeamChoice.solo` in the model, and the stub rt verb

**Files:**
- Modify: `rt-tray/Sources-core/Setup/TeamChoiceModel.swift`
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (answer `setup intent solo`)
- Test: `rt-tray/Tests/MattstackCoreChecks/TeamChoiceChecks.swift`, `rt-tray/Tests/stub-rt/stub.test.ts`

**Interfaces:**
- Produces: `TeamChoice.solo`; `TeamChoiceModel.soloExplainer` (the card body copy); `canContinue` true for `.solo`; `validateAndPrepare` for `.solo` runs `home init --dry-run --json` then `setup intent solo --json`, latched by fingerprint `"solo"`.

- [ ] **Step 1: Write the failing checks**

Append to `teamChoiceChecks`:

```swift
    Check("solo: Continue needs no fields, prepare runs home init then setup intent solo, and latches") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["setup intent solo"] = (0, #"{"contract":1,"mode":"solo"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .solo }
        c.expectEqual(await MainActor.run { m.canContinue }, true)
        let err = await m.validateAndPrepare()
        c.expect(err == nil, "got \(err ?? "")")
        try c.require(rt.calls.count == 2, "expected home init then setup intent solo, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args.prefix(3), ["home", "init", "--dry-run"])
        c.expectEqual(rt.calls[1].args, ["setup", "intent", "solo", "--json"])
        _ = await m.validateAndPrepare()
        c.expectEqual(rt.calls.count, 2, "an unchanged Back then Continue must not re-run the verbs")
    },
    Check("solo: a failed setup intent solo surfaces rt's message") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["setup intent solo"] = (2, #"{"contract":1,"error":{"code":"bad-args","message":"cannot record intent"}}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .solo }
        c.expectEqual(await m.validateAndPrepare(), "cannot record intent")
    },
```

`stub.test.ts`:

```ts
test("setup intent solo answers the contract shape", async () => {
  const r = await run("join-happy", ["setup", "intent", "solo", "--json"]);
  expect(r.code).toBe(0);
  expect(r.lines[0]).toMatchObject({ contract: 1, mode: "solo" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd rt-tray && swift run mattstack-checks "solo"` and `bun test ./rt-tray/Tests/stub-rt`
Expected: Swift build error (`.solo` unknown); stub test FAIL.

- [ ] **Step 3: Implement**

`TeamChoiceModel.swift`: `public enum TeamChoice: Equatable, Sendable { case create, join, restore, solo }`; add

```swift
    public static let soloExplainer = "rt, the daemon and Claude Code on this Mac. No team repo, no forge account. You can create or join a team later from Settings."
```

`canContinue`: `case .solo: return true`. `preparationFingerprint`: `case .solo: return "solo"`. `validateAndPrepare`, new case:

```swift
            case .solo:
                if let e = await homeInitCheck() { return e }
                let r = try await rt.run(["setup", "intent", "solo", "--json"], stdin: nil)
                if let e = r.userError { return e.message }
                guard r.exitCode == 0 else { return r.failureCopy(verb: "setup intent solo") }
                preparedFingerprint = fingerprint
                return nil
```

`stub.ts`: next to the `setup intent restore` line add `else if (a0 === "setup" && a1 === "intent" && a2 === "solo") emit({ mode: "solo" });`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd rt-tray && swift run mattstack-checks "solo"` and `bun test ./rt-tray/Tests/stub-rt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Setup/TeamChoiceModel.swift rt-tray/Tests/MattstackCoreChecks/TeamChoiceChecks.swift rt-tray/Tests/stub-rt
git commit -m "tray: TeamChoice.solo with its prepare verbs"
```

### Task 15: the Just me card

**Files:**
- Modify: `rt-tray/Sources/Setup/Screens/TeamScreen.swift`, `rt-tray/Sources/AccessibilityIDs.swift`
- Test: `rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift`, `rt-tray/Tests/stub-rt/stub.ts` (scenario `solo`)

**Interfaces:**
- Produces: `AXID.teamCardSolo = "setup.team.card.solo"`; `TeamScreen(model:showsSolo:)` (default `true`); stub scenario `solo` whose plan has `team.mode "none"`, `slug ""`, an empty access group, `account.github` optional, `tool.fast-browser` optional, and whose `team status` answers `{ mode: "solo" }`.

- [ ] **Step 1: Write the failing UI test and stub scenario**

`stub.ts`: in `plan()`, when `scenario === "solo"`: set `mode = "none"`, return `team: { slug: "", name: "", mode: "none" }`, `accounts[0]` replaced by `row("account.github", "account", "GitHub", "Opens pull requests from rt.", false, "missing", null, { type: "connect", label: "Connect", integration: "github", fields: [{ name: "token", label: "Personal access token", secret: true }], alternatives: [] }, undefined, "Works without this. Connect a GitHub account later to open pull requests from rt.")`, `access = []`, and `tools[1]!.required = false`. Add `"solo"` to `installableScenario`. Add a `team status` branch: `else if (a0 === "team" && a1 === "status") emit(scenario === "solo" ? { mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [] } : { ...the existing shape... });` (find where `team status` is answered today and branch there).

`SetupFlowUITests.swift`:

```swift
    func testJustMeContinuesWithNoFieldsAndReachesChecklist() {
        launch("solo")
        waitFor("setup.welcome.screen")
        el("setup.welcome.continue").click()
        waitFor("setup.team.screen")
        el("setup.team.card.solo").click()
        XCTAssertTrue(app.staticTexts[TeamChoiceModel.soloExplainer].waitForExistence(timeout: 3))
        XCTAssertTrue(el("setup.team.continue").isEnabled, "Just me needs no fields")
        el("setup.team.continue").click()
        waitFor("setup.checklist.screen")
        XCTAssertFalse(app.staticTexts["Team repo reachable"].exists, "a solo plan carries no access rows")
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test ./rt-tray/Tests/stub-rt` then `cd rt-tray && xcodebuild -project mattstack.xcodeproj -scheme mattstack -only-testing:mattstackUITests/SetupFlowUITests/testJustMeContinuesWithNoFieldsAndReachesChecklist test` (after `xcodegen` if the project is stale).
Expected: no `setup.team.card.solo` element.

- [ ] **Step 3: Implement**

`AccessibilityIDs.swift`: `static let teamCardSolo = "setup.team.card.solo"`.

`TeamScreen.swift`: add `var showsSolo = true`; after the join card:

```swift
                if showsSolo {
                    card(.solo, title: "Just me", systemImage: "person") {
                        Text(TeamChoiceModel.soloExplainer).font(.callout).foregroundStyle(.secondary)
                    }
                }
```

`cardID`: `case .solo: return AXID.teamCardSolo`.

- [ ] **Step 4: Run to verify it passes**

Run the same two commands as Step 2, plus `cd rt-tray && swift build`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources/Setup/Screens/TeamScreen.swift rt-tray/Sources/AccessibilityIDs.swift rt-tray/Tests
git commit -m "tray: Just me card on the Team screen"
```

### Task 16: setup entry (first run vs upgrade)

**Files:**
- Modify: `rt-tray/Sources-core/Setup/SetupFlowModel.swift`, `rt-tray/Sources/Setup/SetupWindowController.swift`, `rt-tray/Sources/Setup/SetupView.swift`, `rt-tray/Sources/Setup/SetupCoordinator.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/SetupFlowChecks.swift`

**Interfaces:**
- Produces: `public enum SetupEntry: Sendable { case firstRun, upgrade }`; `SetupFlowModel.entry` (`@Published var`, default `.firstRun`); `canGoBack` false on `.team` when upgrading; `SetupWindowController.show(step:joinCode:entry:)`; `SetupCoordinator.showSetup(step:joinCode:entry:)` (default `.firstRun`); Settings' join and the deep-link-after-install path pass `.upgrade`.

- [ ] **Step 1: Write the failing check**

```swift
    Check("upgrade entry: no Back on the team screen, first run keeps it") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .team)
            c.expectEqual(f.canGoBack, true)
            f.entry = .upgrade
            c.expectEqual(f.canGoBack, false)
            f.next()
            c.expectEqual(f.canGoBack, true, "Back from the checklist to the team screen stays")
        }
    },
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rt-tray && swift run mattstack-checks "upgrade entry"`
Expected: build error (`entry` unknown).

- [ ] **Step 3: Implement**

`SetupFlowModel.swift`:

```swift
public enum SetupEntry: Equatable, Sendable { case firstRun, upgrade }
```

Add `@Published public var entry: SetupEntry = .firstRun` and in `canGoBack`: `case .team: return entry == .firstRun`.

`SetupWindowController.show`:

```swift
    func show(step: SetupStep? = nil, joinCode: String? = nil, entry: SetupEntry = .firstRun) {
        flow.entry = entry
        if let step { flow.jump(to: step) }
        if entry == .upgrade, team.choice == .solo { team.choice = .create }
        if let joinCode { team.choice = .join; team.inviteCode = joinCode }
```

`SetupView.swift`: `case .team: TeamScreen(model: team, showsSolo: flow.entry == .firstRun)`.

`SetupCoordinator.swift`: `func showSetup(step: SetupStep? = nil, joinCode: String? = nil, entry: SetupEntry = .firstRun)` forwarding `entry` to `show`; the `onJoinAnotherTeam` closure and `handleJoin`'s post-install branch pass `entry: .upgrade`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd rt-tray && swift run mattstack-checks "flow" && swift build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Setup/SetupFlowModel.swift rt-tray/Sources/Setup rt-tray/Tests/MattstackCoreChecks/SetupFlowChecks.swift
git commit -m "tray: setup entry distinguishes first run from an upgrade"
```

### Task 17: Settings > Team on a solo install

**Files:**
- Modify: `rt-tray/Sources-core/Settings/TeamSettingsModel.swift`, `rt-tray/Sources/Settings/TeamPane.swift`, `rt-tray/Sources/Settings/SettingsWindowController.swift` (`SettingsEnvironment.onCreateTeam`), `rt-tray/Sources/Setup/SetupCoordinator.swift`, `rt-tray/Sources/AccessibilityIDs.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift`

**Interfaces:**
- Produces: `TeamSettingsInfo.mode: String?`, `TeamSettingsModel.isSolo: Bool`; `SettingsEnvironment.onCreateTeam: () -> Void`; `AXID.settingsTeamCreate = "settings.team.create"`.

- [ ] **Step 1: Write the failing check**

```swift
    Check("TeamSettingsModel reads mode solo from team status") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"mode":"solo","slug":null,"name":null,"remote":null,"lastPush":null,"members":[]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        c.expectEqual(await MainActor.run { m.isSolo }, true)
        c.expect(await MainActor.run { m.info?.remote == nil }, "a solo status carries no remote")
    },
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rt-tray && swift run mattstack-checks "mode solo"`
Expected: build error (`isSolo` unknown).

- [ ] **Step 3: Implement**

`TeamSettingsModel.swift`: add `public var mode: String?` to `TeamSettingsInfo`; add `public var isSolo: Bool { info?.mode == "solo" }`.

`SettingsWindowController.swift`: add `let onCreateTeam: () -> Void` to `SettingsEnvironment` (after `onJoinAnotherTeam`).

`SetupCoordinator.swift`, in `showSettings`: `onCreateTeam: { [weak self] in self?.showSetup(step: .team, entry: .upgrade) }`.

`AccessibilityIDs.swift`: `static let settingsTeamCreate = "settings.team.create"`.

`TeamPane.swift`: wrap the body so that when `model.isSolo` it renders

```swift
            Section("Team") {
                Text("You're set up as Just me: no team repo, no forge account.")
                HStack {
                    Button("Create a team…", action: env.onCreateTeam).accessibilityIdentifier(AXID.settingsTeamCreate)
                    Button("Join a team…", action: env.onJoinAnotherTeam).accessibilityIdentifier(AXID.settingsTeamJoinAnother)
                }
            }
```

and otherwise the existing sections unchanged. Keep the `model.error` line and `.formStyle(.grouped).task { await model.load() }` outside the branch.

- [ ] **Step 4: Run to verify it passes**

Run: `cd rt-tray && swift run mattstack-checks "TeamSettingsModel" && swift build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Settings/TeamSettingsModel.swift rt-tray/Sources/Settings rt-tray/Sources/Setup/SetupCoordinator.swift rt-tray/Sources/AccessibilityIDs.swift rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift
git commit -m "tray: Settings > Team offers Create and Join on a solo install"
```

### Task 18: Settings > Apps

**Files:**
- Create: `rt-tray/Sources-core/Settings/AppsSettingsModel.swift`, `rt-tray/Sources/Settings/AppsPane.swift`
- Modify: `rt-tray/Sources/Settings/SettingsWindowController.swift` (`SettingsPane.apps`, `SettingsEnvironment.apps`), `rt-tray/Sources/Settings/SettingsView.swift`, `rt-tray/Sources/Setup/SetupCoordinator.swift`, `rt-tray/Sources/AccessibilityIDs.swift`, `rt-tray/Tests/stub-rt/stub.ts`
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift`, `rt-tray/Tests/stub-rt/stub.test.ts`

**Interfaces:**
- Produces: `AppToggleRow { name, displayName, enabled, requiresTeam }`; `AppsSettingsModel.load()` runs `["apps", "list", "--json"]`; `setEnabled(_ name: String, _ on: Bool)` runs `["apps", on ? "enable" : "disable", name, "--json"]` then `load()`; `AXID.settingsAppToggle(name) = "settings.apps.toggle.<name>"`.

- [ ] **Step 1: Write the failing checks and stub answers**

`SettingsChecks.swift`:

```swift
    Check("AppsSettingsModel lists rt apps and flips one through rt, exact argv") { c in
        let rt = ScriptedRt()
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":false,"requiresTeam":true},{"name":"chat","displayName":"Chat","enabled":true,"requiresTeam":false}]}"#)
        rt.answers["apps enable board"] = (0, #"{"contract":1,"name":"board","enabled":true}"#)
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        await m.load()
        c.expectEqual(await MainActor.run { m.apps.map(\.name) }, ["board", "chat"])
        await m.setEnabled("board", true)
        try c.require(rt.calls.count == 3, "expected list, enable, list; got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[1].args, ["apps", "enable", "board", "--json"])
        c.expectEqual(rt.calls[2].args, ["apps", "list", "--json"])
    },
    Check("AppsSettingsModel keeps rt's error and the last list on a failed flip") { c in
        let rt = ScriptedRt()
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":false,"requiresTeam":true}]}"#)
        rt.answers["apps disable board"] = (2, #"{"contract":1,"error":{"code":"deck-not-running","message":"deck is not running; open mattstack.app, then retry"}}"#)
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        await m.load()
        await m.setEnabled("board", false)
        c.expectEqual(await MainActor.run { m.error }, "deck is not running; open mattstack.app, then retry")
        c.expectEqual(await MainActor.run { m.apps.count }, 1)
    },
```

`stub.ts`: `else if (a0 === "apps" && a1 === "list") emit({ apps: [{ name: "board", displayName: "Board", enabled: scenario !== "solo", requiresTeam: true }, { name: "boxscore", displayName: "boxscore", enabled: scenario !== "solo", requiresTeam: true }, { name: "console", displayName: "Console", enabled: true, requiresTeam: false }, { name: "chat", displayName: "Chat", enabled: true, requiresTeam: false }] });` and `else if (a0 === "apps" && (a1 === "enable" || a1 === "disable")) emit({ name: a2, enabled: a1 === "enable" });`. `stub.test.ts`: one test asserting `apps list --json` on scenario `solo` has board `enabled: false`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd rt-tray && swift run mattstack-checks "AppsSettingsModel"` and `bun test ./rt-tray/Tests/stub-rt`
Expected: build error; stub FAIL.

- [ ] **Step 3: Implement**

`AppsSettingsModel.swift`:

```swift
import Foundation
import Combine

public struct AppToggleRow: Codable, Equatable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var displayName: String
    public var enabled: Bool
    public var requiresTeam: Bool
}

struct AppsListResult: Codable { var apps: [AppToggleRow] }

@MainActor
public final class AppsSettingsModel: ObservableObject {
    @Published public private(set) var apps: [AppToggleRow] = []
    @Published public private(set) var error: String?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    public func load() async {
        if let r = await runJSON(["apps", "list", "--json"], verb: "apps list", as: AppsListResult.self) { apps = r.apps }
    }

    public func setEnabled(_ name: String, _ on: Bool) async {
        struct Flip: Codable { var name: String; var enabled: Bool }
        guard await runJSON(["apps", on ? "enable" : "disable", name, "--json"], verb: "apps \(on ? "enable" : "disable")", as: Flip.self) != nil else { return }
        await load()
    }

    private func runJSON<T: Decodable>(_ args: [String], verb: String, as type: T.Type) async -> T? {
        error = nil
        do {
            let r = try await rt.run(args, stdin: nil)
            if let e = r.userError { error = e.message; return nil }
            guard r.exitCode == 0, let decoded = try? r.decode(type) else { error = r.failureCopy(verb: verb); return nil }
            return decoded
        } catch {
            self.error = (error as? RtClientError)?.copy ?? "Could not run rt: \(error)"
            return nil
        }
    }
}
```

(Match the `catch` branch to what `TeamSettingsModel.runJSON` does today; copy its error shaping verbatim.)

`AppsPane.swift`:

```swift
import SwiftUI
import MattstackCore

struct AppsPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: AppsSettingsModel
    @ObservedObject private var team: TeamSettingsModel
    init(env: SettingsEnvironment) { self.env = env; self.model = env.apps; self.team = env.team }

    var body: some View {
        Form {
            Section("Apps") {
                ForEach(model.apps) { app in
                    VStack(alignment: .leading, spacing: 2) {
                        Toggle(app.displayName, isOn: Binding(get: { app.enabled }, set: { on in Task { await model.setEnabled(app.name, on) } }))
                            .toggleStyle(.switch)
                            .accessibilityIdentifier(AXID.settingsAppToggle(app.name))
                        if app.requiresTeam, team.isSolo {
                            Text("Needs a team. Create or join one under Team to use this.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if model.apps.isEmpty { Text("No apps listed. Is deck running?").foregroundStyle(.secondary) }
            }
            if let e = model.error { Text(e).font(.caption).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .task { await model.load(); await team.load() }
    }
}
```

`SettingsWindowController.swift`: `case general, permissions, fastBrowser, apps, team, uninstall`; title `"Apps"`, symbol `"square.grid.2x2"`; `SettingsEnvironment` gains `let apps: AppsSettingsModel`. `SettingsView.swift`: `case .apps: AppsPane(env: env)`. `SetupCoordinator.swift`: create `appsSettings = AppsSettingsModel(rt: rt)` beside `teamSettings` and pass `apps: appsSettings`. `AccessibilityIDs.swift`: `static func settingsAppToggle(_ name: String) -> String { "settings.apps.toggle.\(name)" }`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd rt-tray && swift run mattstack-checks && swift build` and `bun test ./rt-tray/Tests/stub-rt`
Expected: all checks PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Settings/AppsSettingsModel.swift rt-tray/Sources/Settings rt-tray/Sources/Setup/SetupCoordinator.swift rt-tray/Sources/AccessibilityIDs.swift rt-tray/Tests
git commit -m "tray: Settings > Apps toggles the served mattstack apps"
```

### Task 19: screenshots in both schemes from the stub-driven app

**Files:**
- Modify: `rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift`

- [ ] **Step 1: Add a screenshot helper and a test that walks the four screens in both schemes**

```swift
    private func shoot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    func testJustMeScreensLightAndDark() {
        for scheme in ["Light", "Dark"] {
            prepare("solo")
            app.launchArguments += ["-AppleInterfaceStyle", scheme]
            app.launch()
            waitFor("setup.welcome.screen"); el("setup.welcome.continue").click()
            waitFor("setup.team.screen"); el("setup.team.card.solo").click(); shoot("team-\(scheme)")
            el("setup.team.continue").click(); waitFor("setup.checklist.screen")
            el("setup.checklist.continue").click(); waitFor("setup.done.screen", 60); shoot("done-\(scheme)")
            // Settings opens with the Command-comma shortcut only while a window is key, and the Done screen is; Finish closes it.
            app.typeKey(",", modifierFlags: .command)
            waitFor("settings.tab.apps"); el("settings.tab.apps").click(); waitFor("settings.apps.toggle.board"); shoot("settings-apps-\(scheme)")
            el("settings.tab.team").click(); waitFor("settings.team.create"); shoot("settings-team-\(scheme)")
            app.typeKey("w", modifierFlags: .command)
            waitUntilEnabled("setup.done.continue"); el("setup.done.continue").click()
            waitUntilGone("setup.done.screen")
            app.terminate()
        }
    }
```

`launch(_:)` assigns `app = XCUIApplication()` itself, so set `launchArguments` after it returns and before `app.launch()`: split `launch` into `prepare(_:)` (everything but the final `app.launch()`) and call `app.launch()` from the test after appending the scheme argument.

- [ ] **Step 2: Run it and look at the attachments**

Run: `cd rt-tray && xcodebuild -project mattstack.xcodeproj -scheme mattstack -only-testing:mattstackUITests/SetupFlowUITests/testJustMeScreensLightAndDark test -resultBundlePath /tmp/justme.xcresult && xcrun xcresulttool export attachments --path /tmp/justme.xcresult --output-path /tmp/justme-shots`
Expected: eight PNGs. Open each and say plainly what looks wrong (text clipping, a card body that runs past the card, a caption in the wrong colour in dark mode, a Team pane that still shows invite fields on solo). Fix and re-run until the four screens read right in both schemes.

- [ ] **Step 3: Commit**

```bash
git add rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift
git commit -m "tray: light and dark screenshots of the Just me screens"
```

## Part D: verification

### Task 20: VM walkthrough, solo scenario and the upgrade leg

**Files:**
- Modify: `rt-tray/vm/run/walkthrough.sh`, `rt-tray/vm/run/guest/drive-setup.sh`, `rt-tray/vm/run/guest/assert-installed.sh`, `rt-tray/vm/run/guest/served-apps.sh`, `rt-tray/vm/run/guest/jq/served-verdict.jq`
- Create: `rt-tray/vm/run/guest/upgrade-to-team.sh`

- [ ] **Step 1: Accept `--scenario solo` and thread it to the guest asserts**

`walkthrough.sh`: the usage line lists `create|join|headless|solo`; the `assert-installed.sh` invocation (the `vm_ssh_try ... bash $GUEST_BIN/assert-installed.sh $EXPECT_ARG $HFLAG $UNTRUSTED_ARG` line) gains `$SOLO_ARG`, set beside the others as `SOLO_ARG=""; [ "$SCENARIO" = solo ] && SOLO_ARG="--solo"`. `drive-setup.sh`'s `case "$SCENARIO"` accepts `solo`; in `screen_team` add:

```bash
    solo)
      ax_click setup.team.card.solo
      ax_shot 02-team-solo
      ;;
```

`assert-installed.sh` has no `$SCENARIO`; it parses its own flags. Add `SOLO=0` and `--solo) SOLO=1; shift;;` to its `while` loop, `export SERVED_SOLO=$SOLO` before `assert_served_apps` is called, and under `[ "$SOLO" = 1 ]` next to the existing rt-side asserts:

```bash
  if rt setup status --json | "$JQ" -e '[.groups[].rows[].id | select(startswith("access.") or startswith("team."))] | length == 0' >/dev/null; then ok "solo: no access or team rows"; else bad "solo: access or team rows present"; fi
  if rt team status --json | "$JQ" -e '.mode == "solo"' >/dev/null; then ok "solo: team status reports mode solo"; else bad "solo: team status did not report mode solo"; fi
  if rt apps list --json | "$JQ" -e '[.apps[] | select(.requiresTeam) | .enabled] | all(. == false)' >/dev/null; then ok "solo: every team-only app is off"; else bad "solo: a team-only app is on"; fi
```

`served-apps.sh`: `served_snapshot` also fetches `http://127.0.0.1:$port/api/v1/apps` into `$dir/apps.json` (`null` when unreachable, the same way `status.json` is written), and `assert_served_apps` passes `--slurpfile apps "$dir/apps.json"` to jq. `served-verdict.jq` today demands every deps.lock serve app be rt-managed, healthy, routed, loaded and running; on a solo run board and boxscore are none of those by design, and `/api/v1/status` will carry the new `enabled` field only after Task 5. Teach the verdict the disabled case: bind `($apps[0].apps // []) as $adm`, and inside the per-app branch, before the `$row == null` check, add

```jq
        elif ([$adm[] | select(.name == $a.name and .enabled == false)] | length) > 0 then
          ok("\($a.name): disabled, not served (deck /api/v1/apps enabled false)")
```

so a disabled catalog app yields one ok line and skips the health, route and launchd asserts. Leave `assert_mattstack_routes` alone: deck keeps the portless alias when it disables an app, so the hostname still resolves and answers TLS; the upstream is simply down.

- [ ] **Step 2: Add the upgrade leg**

`upgrade-to-team.sh` (guest side, run by the host after the solo walkthrough with `--keep`): drives Settings > Team > Create a team… through `ax.sh` (`ax_click settings.team.create`, then the same `screen_team` create fields and `screen_readiness`/install/done steps `drive-setup.sh` already has, factored into functions it can source), then asserts `rt team status --json | jq -e '.slug == "'$SLUG'"'` and `rt apps list --json | jq -e '[.apps[] | select(.requiresTeam) | .enabled] | all'` and `https://board.mattstack` answers 200.

- [ ] **Step 3: Run both legs**

Run: `rt-tray/vm/run/walkthrough.sh --ver 26 --app <dev build> --scenario solo --no-quarantine --keep` and then the upgrade leg per the host instructions the script prints (`--team-remote` from a fresh repo in the throwaway org, as `--scenario create` needs).
Expected: `artifacts/<run>/report.md` shows every phase green, with `02-team-solo.png` and the Done screen captured; the upgrade leg ends with board served. Skipped phases are named skipped, never green.

- [ ] **Step 4: Commit**

```bash
git add rt-tray/vm
git commit -m "vm: solo walkthrough and the upgrade-to-team leg"
```

---

## Self-review

- **Spec coverage.** Solo derivation (Task 7); Team screen card (14, 15); plan branches (8, 9, 10); steps not applying on solo (7); app set in deck (1 to 5) and the bundle identity (6); mode default in `deck.managed` (11); tray Apps pane (18) and window hiding (3, deck side); upgrade in place (16, 17) with `rt team status` mode (12); `rt apps` verbs the tray needs (13); screenshots (19); VM runs (20). The spec's "steps report a skip with detail" is implemented as the steps not applying at all, which is how the apply engine already expresses "not this install"; no code path emits a synthetic skip for them.
- **Placeholders.** None; every step carries code or an exact command.
- **Type consistency.** `isEnabled` (records.ts), `requiresTeamFor` (bundled-identity.ts), `readDeckApiPortFrom` (steps/deck.ts), `isSolo` (contract.ts), `SetupEntry` and `TeamChoice.solo` (Swift), `AppToggleRow` (Swift) are named the same everywhere they appear.
- **Review Focus.** All five pinned in the tasks named beside them.
