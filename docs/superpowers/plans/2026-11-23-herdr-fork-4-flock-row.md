# herdr fork, Plan 4: the flock row in setup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt setup` gets a required `tool.flock` row that downloads the latest notarized Flock release from `m4ttstack/flock` into `/Applications`, checks its signature and notarization before placing it, and leaves Flock alone once it is there (Sparkle keeps it current).

**Architecture:** One module, `lib/setup/flock-install.ts`, reads Flock's Sparkle feed (`appcast.xml` on the latest release), finds an installed Flock, and installs one: download the zip, unpack with `ditto`, verify bundle id, Developer ID team and Gatekeeper notarization, then copy into place. The row, `rt tools install flock`, the accounts prepare stage, and a new update-safe step `flock.install` all call it, the same way herdr's row, prepare and `herdr.integration` share `installHerdrBuild`.

**Tech Stack:** Bun + TypeScript, `bun:test`, `fakeProbes` (`lib/setup/__tests__/fakes.ts`).

**Spec:** `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/happy-oyster/docs/superpowers/specs/2026-11-23-herdr-fork-design.md` (read-only), §4 "flock row" and Goal 3. Stacks on Plan 2 (`herdr-setup` branch), which this branch is rebased on: it reuses Plan 2's `InstallResult` (`lib/setup/install-result.ts`) and sits beside `installHerdrBuild`. Plan 3 (flock) makes Flock install the fork's herdr itself when none is found; this plan changes only mattstack, and `tool.herdr` still installs herdr on its own.

## Global Constraints

- Feed: `FLOCK_APPCAST_URL = "https://github.com/m4ttstack/flock/releases/latest/download/appcast.xml"`. Each `<item>` has `<sparkle:version>` (build number, integer), `<sparkle:shortVersionString>` (e.g. `0.12.2`) and `<enclosure url="…/Flock-<v>.zip" …>`. The release is the item with the highest `sparkle:version`, not the first.
- Download URLs are accepted only under `FLOCK_DOWNLOAD_PREFIX = "https://github.com/m4ttstack/flock/releases/download/"` and ending `.zip`. Download with `curl -fsSL` (follows GitHub's redirect).
- Flock is `Flock.app`, bundle id `FLOCK_BUNDLE_ID = "dev.mattstack.Flock"`, signed by Developer ID team `FLOCK_TEAM_ID = "5BF66B3X4V"` (same team as mattstack.app, `rt-tray/project.yml`), notarized and stapled. `Flock-dev.app` (`dev.mattstack.Flock.dev`) does not count as installed.
- Installed means `Flock.app` with that bundle id in `/Applications` or `~/Applications` (read `Contents/Info.plist` with `/usr/bin/plutil -extract CFBundleIdentifier raw -o - <plist>`; version from `CFBundleShortVersionString` the same way). Any version is ready: rt never upgrades or replaces Flock.
- Install target: `/Applications` when `p.statPath("/Applications")?.writable`, else `~/Applications` (created if missing), so a standard account never needs an admin prompt. Nothing the bar runs may raise a dialog.
- Verification before placing, each by exit code: `plutil` bundle id equals `FLOCK_BUNDLE_ID`; `/usr/bin/codesign --verify --deep --strict <app>` exits 0; `/usr/bin/codesign -dv <app>` output (stderr) contains `TeamIdentifier=5BF66B3X4V`; `/usr/sbin/spctl --assess --type execute <app>` exits 0 (Developer ID and notarized).
- Place with `ditto <unpacked app> <target>/Flock.app`, only when the target does not already exist; a failed copy removes the `Flock.app` rt just started writing, never one that was there.
- Never launch Flock, never quit it, never touch an installed Flock.
- Run `bun test` from the repo root, only on files a task touches. Unit tests use `fakeProbes`, never the network.
- Copy rules: `.claude/rules/output-layer.md`, `output-setup-and-services.md`, `command-tree.md`. Row `detail`, step `detail`/`remedy` are copy; ids, statuses and action shapes are contract. A copy change is a deliberate `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`, with the diff read.

## Review Focus

1. **A download that is not Flock's release** (an unsigned or ad-hoc app, another team's app, a non-notarized build, a zip with no `Flock.app`). Expect: nothing lands in `/Applications`, the temp folder is gone, the row stays Install. Task 1 `refuses an app from another team` and `refuses an app spctl rejects`, `refuses a zip without Flock.app`.
2. **The feed unreachable or malformed** (offline, a 404 while a release publishes, an enclosure off the flock repo). Expect: a plain failure naming m4ttstack/flock, no `curl` of anything. Task 1 `parseFlockAppcast rejects an enclosure outside the repo` and `feed unreachable installs nothing`.
3. **A standard (non-admin) account** where `/Applications` is not writable. Expect: Flock lands in `~/Applications` and reads ready there. Task 1 `installs into ~/Applications when /Applications is not writable`.
4. **The member removed Flock after rt installed it.** Expect: an update run does not put it back each launch; the row still reads missing with Install. Task 3 `update run leaves a Flock the member removed`.
5. **Flock appears between the check and the copy** (Sparkle, or the member dragging it in). Expect: rt does not copy over it and reports it installed. Task 1 `does not copy over a Flock that appeared during the download`.

---

### Task 1: Read the feed, find Flock, install it

**Files:**
- Create: `lib/setup/flock-install.ts`
- Test: `lib/setup/__tests__/flock-install.test.ts`

**Interfaces:**
- Consumes: `InstallResult` from `lib/setup/install-result.ts` (`via: "download"`), `Probes`.
- Produces:
  - `FLOCK_APPCAST_URL`, `FLOCK_DOWNLOAD_PREFIX`, `FLOCK_BUNDLE_ID`, `FLOCK_TEAM_ID` (values above)
  - `flockAppDirs(home: string): string[]` → `["/Applications", join(home, "Applications")]`
  - `interface FlockRelease { version: string; build: number; url: string }`
  - `parseFlockAppcast(xml: string): FlockRelease | null` (null when no item has an integer `sparkle:version`, a `shortVersionString` and an enclosure url under the prefix ending `.zip`; items failing that are skipped, the highest build of the rest wins)
  - `fetchFlockRelease(p: Pick<Probes, "fetch">): Promise<FlockRelease | null>` (10 s timeout; non-200, a throw or a bad parse is null)
  - `interface InstalledFlock { path: string; version: string | null }`
  - `installedFlock(p: Probes): Promise<InstalledFlock | null>` (first of `flockAppDirs` whose `Flock.app` has `FLOCK_BUNDLE_ID`)
  - `installFlock(p: Probes): Promise<InstallResult>`

`installFlock` order (each failure returns `ok: false` with this detail and leaves no `Flock.app` rt created; the work folder `$TMPDIR/rt-flock-install-${process.pid}` (per pid, matching herdr-install) is removed in a `finally`):
1. `installedFlock` non-null → `ok: true`, `Flock <v> is already installed`.
2. `fetchFlockRelease` null → `rt could not read Flock's release feed from m4ttstack/flock`.
3. `curl -fsSL <url> -o <work>/Flock.zip` (5 min); exit 124 → `Downloading Flock did not finish in time`; other non-zero → `Downloading Flock failed (exit <n>): <first line>`.
4. `ditto -x -k <zip> <work>/unpacked`; non-zero → `Unpacking the Flock download failed: <first line>`; no `<work>/unpacked/Flock.app` → `The Flock download has no Flock.app in it, so nothing was installed`.
5. The four verification checks; any failing → `The Flock download is not signed and notarized by mattstack, so nothing was installed`.
6. Pick the target dir; `~/Applications` gets `p.mkdirp`. `installedFlock` non-null again → `ok: true`, `Flock <v> is already installed`.
7. `ditto <app> <target>/Flock.app`; non-zero → remove `<target>/Flock.app` with `p.removeDir`, detail `Copying Flock into <target> failed: <first line>`.
8. `ok: true`, detail `Installed Flock <version> in <target>` (`~/Applications` written with `~`).

- [ ] **Step 1: Write the failing tests** with a fixture appcast in the test (two items, builds 1171 `0.12.1` and 1173 `0.12.2`, listed lowest first) and `fakeProbes` scripting `fetch`, `curl`, `ditto`, `plutil`, `codesign`, `spctl` and `statPath`:
  - `parseFlockAppcast takes the highest build`: `{ version: "0.12.2", build: 1173, url: ".../v0.12.2/Flock-0.12.2.zip" }`.
  - `parseFlockAppcast rejects an enclosure outside the repo`: only item's url `https://example.com/Flock.zip` → null; a `.dmg` url → null; non-XML → null.
  - `fetchFlockRelease reads the latest feed and returns null on 404`: `calls.fetch[0]` is `FLOCK_APPCAST_URL`.
  - `installedFlock finds Flock in either folder and ignores Flock-dev`: `~/Applications/Flock.app` with the right id → its path and `0.12.2`; `/Applications/Flock.app` whose id is `dev.mattstack.Flock.dev` → null.
  - `installs the latest release into /Applications`: curl of the 0.12.2 url; `ditto <app> /Applications/Flock.app`; `ok: true`; detail `Installed Flock 0.12.2 in /Applications`; work folder removed.
  - `installs into ~/Applications when /Applications is not writable`: `statPath("/Applications")` → `{ isDirectory: true, writable: false }`; `mkdirp(~/Applications)` and the ditto target under it.
  - `already installed does nothing`: no fetch, no curl; `ok: true`.
  - `feed unreachable installs nothing`: fetch 404 → no curl; detail as step 2.
  - `refuses a zip without Flock.app`.
  - `refuses an app from another team`: codesign `-dv` stderr `TeamIdentifier=ABCDE12345` → no copy ditto; detail as step 5.
  - `refuses an app spctl rejects`: spctl exit 3 → no copy ditto.
  - `does not copy over a Flock that appeared during the download`: `installedFlock` null at step 1, Flock present at step 6 → no copy ditto, `ok: true`.
  - `a failed copy removes only the Flock.app it started`: copy ditto exit 1 → `removeDir("/Applications/Flock.app")` called, `ok: false`.
- [ ] **Step 2:** Run `bun test lib/setup/__tests__/flock-install.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `lib/setup/flock-install.ts` per Interfaces. Parse the feed with regexes over `<item>…</item>` blocks (no XML dependency); the module doc comment states only the constraints (verified before placing, never replaces an installed Flock).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `add lib/setup/flock-install.ts: read Flock's feed and install a verified release`.

### Task 2: The `tool.flock` row and `rt tools install flock`

**Files:**
- Modify: `lib/setup/validators/tools.ts` (`flockRow`, pushed right after `herdrRow` in `toolRows`; `provisionedInstallAction` passes `via: "download"` for flock too)
- Modify: `lib/setup/expectations.ts` (`"tool.flock": "finish"`), `lib/setup/regroup.ts` (`"tool.flock": "agents"`)
- Modify: `lib/setup/tools-install.ts` (`installRoute` → `"download"` and `installTool` → `installFlock(p)` for `"flock"`), `commands/tools.ts` (`installableTools` lists `flock`), `lib/command-tree-def.ts` (the install hint: `Tool name (herdr, flock, claude, apple-clt, or a team-declared tool)`)
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (a ready `tool.flock` row beside `tool.herdr`, detail `Flock 0.12.2`)
- Test: `lib/setup/__tests__/validators-tools.test.ts`, `lib/setup/__tests__/tools-install.test.ts`, `lib/setup/__tests__/expectations.test.ts` if it lists ids; snapshot `commands/__tests__/setup-copy.test.ts`

**Interfaces:**
- Consumes: Task 1's `installedFlock`, `installFlock`.
- Produces: row `tool.flock`: `kind: "tool"`, `title: "Flock"`, `why: "The Mac app for your herdr panes and agents."`, `required: true`, `recheck: "on-activate"`.

| Condition | status | detail (copy) | action |
|---|---|---|---|
| `installedFlock` non-null | ready | `Flock <version>` (`Flock` when the version is unreadable) | none |
| otherwise | missing | `Flock is not installed` | `{ type: "install", label: "Install", tool: "flock", via: "download" }` |

- [ ] **Step 1: Write the failing tests**: `flock row reads ready with its version`; `flock row reads missing with Install`; `Flock-dev alone reads missing`; in `tools-install.test.ts`, `installRoute(flock) is download` and `installTool(flock) runs installFlock` (fetch is called with `FLOCK_APPCAST_URL`).
- [ ] **Step 2:** Run `bun test lib/setup/__tests__/validators-tools.test.ts lib/setup/__tests__/tools-install.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per the table and file list. Existing `validators-tools` tests that count or list `toolRows` ids gain `tool.flock`; adjust them.
- [ ] **Step 4:** Run them again, plus `bun test lib/setup/__tests__/expectations.test.ts lib/__tests__/command-tree*.test.ts rt-tray/Tests/stub-rt/stub.test.ts`. Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts`; if only the new row moved, rerun with `--update-snapshots` and read the diff.
- [ ] **Step 5:** Commit `setup: a required Flock row; rt tools install flock`.

### Task 3: Prepare installs it early; update runs install it on set-up Macs

**Files:**
- Modify: `lib/setup/prepare.ts` (`prepareTools`, accounts stage: push `"flock"` right after `"herdr"` when `installedFlock(p)` is null)
- Modify: `lib/setup/form.ts` (`preparedTool`: `tool.flock` → `"flock"`, so the connect screen's extra row shows Installing and a prepare failure the way herdr's does)
- Modify: `lib/setup/state.ts` (`SetupState.flockInstalledAt?: string`, kept by the normalizer)
- Modify: `lib/setup/steps/tools.ts` (`flockInstallStep`), `lib/setup/steps/index.ts` (registered right after `herdrIntegrationStep`)
- Modify: `lib/setup/tools-install.ts` (`installTool("flock")` records `flockInstalledAt` when `installFlock` ok and its detail starts `Installed`)
- Test: `lib/setup/__tests__/prepare.test.ts`, `lib/setup/__tests__/form-connect.test.ts`, `lib/setup/__tests__/update-safe.test.ts`, the steps test file holding `herdr.integration` (`rg -l herdrIntegration lib/setup/__tests__`)

**Interfaces:**
- Consumes: Task 1's `installedFlock`, `installFlock`; `waitWhilePreparing` (`lib/setup/prepare-record.ts`).
- Produces: `flockInstallStep: StepDef` with `id: "flock.install"`, `title: "Install Flock"`, `kind: "rt"`, `updateSafe: true`, `applies: () => true`. Run, after `waitWhilePreparing(ctx.p, "accounts", …)`:
  1. `installedFlock` non-null → `{ state: "skipped", detail: "Flock is already installed" }`.
  2. `ctx.update` and `readSetupState(ctx.p).flockInstalledAt` set → `{ state: "skipped", detail: "Flock was removed after rt installed it, so rt left it alone" }`.
  3. `installTool(ctx.p, "flock", [])` ok → `{ state: "done", detail }`; not ok → `{ state: "failed", detail, remedy: "Open setup's Flock row and press Install" }`. A throw goes through `toFailedOutcome`.

- [ ] **Step 1: Write the failing tests**:
  - `prepare lists flock when it is missing` and `prepare skips flock when installed` (accounts stage).
  - `connect extra row shows Flock installing while prepare runs it`: record `running`, items `["flock"]`, a required missing `tool.flock` → row `tool.flock` state `busy`.
  - `flock.install installs a missing Flock and records it`: `flockInstalledAt` set afterwards.
  - `flock.install skips an installed Flock`.
  - `update run leaves a Flock the member removed`: `ctx.update`, `flockInstalledAt` set, no Flock → skipped, no fetch.
  - `update run installs Flock on a Mac rt never installed it on`: `ctx.update`, no record → installs.
  - `a failed install names the row`: remedy as above.
  - `update-safe.test.ts`: add `"flock.install"` to the pinned set.
- [ ] **Step 2:** Run the four test files. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run them again, plus `bun test lib/setup/__tests__/form-stage.test.ts lib/setup/__tests__/form-this-mac.test.ts`. Expected: PASS. Then the setup-copy snapshot as in Task 2.
- [ ] **Step 5:** Commit `setup: prepare and update runs install Flock`.

### Task 4: Check against the live release

- [ ] **Step 1:** `bun -e 'const m=await import("./lib/setup/flock-install.ts");const r=await fetch(m.FLOCK_APPCAST_URL);console.log(m.parseFlockAppcast(await r.text()))'`. Expected: the current release (`0.12.2` or newer), its url under the prefix.
- [ ] **Step 2:** In a scratch dir, download that zip, `ditto -x -k` it, and run the four verification commands from Global Constraints against the unpacked `Flock.app`. Expected: every one passes, so the real release clears the checks the tests fake. Nothing is copied into `/Applications`.
- [ ] **Step 3:** Record the two outputs in the report's Verification lines. No commit.
