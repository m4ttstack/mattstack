# Settings Backup GitHub Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Store in a GitHub repo" ends with a private repo rt created and pushed to, on any Mac, without the gh CLI.

**Architecture:** A new `lib/setup/github-signin.ts` talks to GitHub's device flow and REST API through `Probes.fetch`. A hidden verb `rt setup github sign-in` starts a sign-in and leaves a detached waiter (`--wait`) that stores the token as rt's `githubToken` and stages the create. `setHomeRemote` creates the repo over REST with that token and names rt as the home repo's credential helper. The this-mac form's remote row draws the sign-in with the same shape as the team-tool sign-in rows (run, then waiting with a code and Open again).

**Tech Stack:** Bun + TypeScript (rt), SwiftUI tray (drawing only), the stub rt under `rt-tray/Tests/stub-rt`.

**Spec:** `docs/superpowers/specs/2026-11-02-settings-backup-github-signin-design.md`

## Global Constraints

- OAuth client id: `GITHUB_OAUTH_CLIENT_ID` in `lib/setup/github-signin.ts`, `""` until Matt registers the app. While it is empty, `rt setup github sign-in` refuses with "GitHub sign-in isn't set up in this build", and the remote row never offers it.
- Scope: `repo`. Endpoints: `https://github.com/login/device/code`, `https://github.com/login/oauth/access_token`, `https://api.github.com/user`, `https://api.github.com/user/repos`.
- The run never opens a browser or starts a sign-in. Only the this-mac screen's button does.
- A token never goes in argv, a log line, an envelope or a git config. It is stored only through `storeCredential` semantics: write to the personal store when it's ready, otherwise stage it (`stageSecret(p, "rt", "githubToken", token)`).
- The repo name is `mattstack-home`; if that is taken, the first free of `mattstack-home-2` through `mattstack-home-5`.
- Copy (exact): row title "Remote repo"; button "Sign in to GitHub"; todo subtext "Opens your browser once. rt then makes a private repo for you"; waiting detail `Your code is ${code}. Confirm it in your browser` (reuse `FORM_COPY.connect.teamTool.code`); waiting button "Open again"; done detail "rt creates it as a private repo when setup runs"; expired "That code expired. Sign in again"; declined "GitHub sign-in was declined. Sign in again".
- Output: `--json` through `out.json`, failures as `UserActionableError`, no `console.*` (`lib/__tests__/no-raw-output.test.ts`).
- Tests run from the repo root (`bun test <file>`), under the preload's isolated HOME. Never run a built binary outside `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin`.
- Don't update existing tests that fail only because of this branch's earlier UI changes (answered repo rows, unanswered backup row): Matt asked for those to wait until the UI settles. New tests for new code are fine.

## Review Focus

1. A code that expires (15 minutes) before the member confirms it puts the row back on "Sign in to GitHub" with the expired line. It never waits forever. Pinned in Task 2.
2. A member who declines on GitHub sees the declined line and can sign in again. Pinned in Task 2.
3. `mattstack-home` already exists on the account (a second Mac): rt takes `mattstack-home-2`, and the run doesn't fail. Pinned in Task 3.
4. A GitHub team's existing token that can't create repos (no `repo` in `x-oauth-scopes`, or a fine-grained token with no such header) gets the sign-in, not a run that fails at home.init. Pinned in Tasks 1 and 4.
5. A waiter killed mid-sign-in (reboot, app quit): its record's dead pid reads as no sign-in, and the row is back to todo. Pinned in Task 1.

---

### Task 1: GitHub device flow and token check

**Files:**
- Create: `lib/setup/github-signin.ts`
- Test: `lib/setup/__tests__/github-signin.test.ts`

**Interfaces:**
- Consumes: `Probes` (`fetch`, `readFile`, `writeFile`, `removeFile`, `mkdirp`, `now`, `home`), `pidAlive` from `lib/setup/update-lock.ts`.
- Produces:
  - `export const GITHUB_OAUTH_CLIENT_ID: string` (`""`).
  - `export interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; intervalSec: number; expiresAt: string }`
  - `export async function requestDeviceCode(p: Pick<Probes, "fetch" | "now">, clientId?: string): Promise<DeviceCode>`, which throws `UserActionableError` on a non-200 or when the client id is empty.
  - `export type PollResult = { kind: "token"; token: string } | { kind: "pending" } | { kind: "slow-down"; intervalSec: number } | { kind: "expired" } | { kind: "declined" }`
  - `export async function pollDeviceToken(p: Pick<Probes, "fetch">, deviceCode: string, clientId?: string): Promise<PollResult>`
  - `export async function githubLoginIfCanCreateRepos(p: Pick<Probes, "fetch">, token: string): Promise<string | null>`: the login when `x-oauth-scopes` lists `repo`, else null.
  - `export interface GitHubSignIn { userCode: string; url: string; expiresAt: string; pid: number | null; outcome?: "expired" | "declined" }`
  - `export function writeGitHubSignIn(p, record: GitHubSignIn): void` and `export function readGitHubSignIn(p, alive?: (pid: number) => boolean): GitHubSignIn | null`. The record lives at `~/.mattstack/rt/logins/github.json`, written 0600. The read returns null when there's no record, the time is past `expiresAt` with no outcome, or the pid is dead with no outcome. A record carrying an outcome is returned as is, so the row can say why.
  - `export function clearGitHubSignIn(p): void`

- [ ] **Step 1: Write the failing tests** with a fake `fetch` keyed by URL:
  - `requestDeviceCode` posts `client_id=<id>&scope=repo` with `Accept: application/json` and maps `{device_code, user_code, verification_uri, interval, expires_in}` (here `expires_in: 900`, so `expiresAt` = now + 900s).
  - `requestDeviceCode` with `clientId: ""` throws, message "GitHub sign-in isn't set up in this build".
  - `pollDeviceToken` maps `{access_token}` to token, `authorization_pending` to pending, `slow_down` with `interval: 10` to slow-down 10, `expired_token` to expired, and `access_denied` to declined.
  - `githubLoginIfCanCreateRepos` returns `"janedoe"` for headers `{ "x-oauth-scopes": "read:org, repo" }` with body `{"login":"janedoe"}`; null for `"read:org"`; null when the header is absent; null on 401.
  - `readGitHubSignIn`: null past `expiresAt`; null with a dead pid; returns the record with `outcome: "declined"` even when the pid is dead (Review Focus 5).
- [ ] **Step 2:** `bun test lib/setup/__tests__/github-signin.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the module. Form-encode bodies, put `Accept: application/json` on every call and `Authorization: Bearer <token>` on API calls, and use timeouts of 15000 ms.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `setup: GitHub device sign-in and repo-scope check for the settings backup`.

### Task 2: `rt setup github sign-in`

**Files:**
- Create: `commands/setup-github.ts`
- Modify: `lib/command-tree-def.ts`: under `setup`, add a hidden group `github` ("Sign in to GitHub for your settings backup") with subcommand `sign-in` ("Sign in to GitHub so rt can back up your settings"), module `./commands/setup-github.ts`, fn `setupGitHubSignIn`, args `[SETUP_JSON_ARG]`. Follow the `claude` group at `lib/command-tree-def.ts:2897`.
- Test: `commands/__tests__/setup-github.test.ts`

**Interfaces:**
- Consumes: Task 1's exports, `rtSelfArgv` (`lib/rt-self.ts`), `stageHomeRemote` (`lib/setup/home-remote.ts`), `realSecretWriter` and `stageSecret` (the pattern `storeCredential` follows in `commands/setup.ts:1619`).
- Produces: `export async function setupGitHubSignIn(args: string[], ctx?: CommandContext, deps?: GitHubSignInDeps): Promise<void>` with `GitHubSignInDeps = { probes; json; spawnWaiter(argv: string[]): number | null; writer: SecretWriter; sleep(ms): Promise<void>; alive(pid): boolean }`.
  - Without `--wait`: a live record is returned as is (no second code). Otherwise it requests a code, writes the record with `pid: null`, spawns `[...rtSelfArgv(), "setup", "github", "sign-in", "--wait"]` detached, writes its pid, and returns `{ userCode, url }` in the envelope.
  - With `--wait`: it polls `pollDeviceToken` every `intervalSec` (bumped on slow-down) until token, expired, declined or `expiresAt`.
    - **Token:** store `githubToken` (personal store when ready, otherwise staged), `stageHomeRemote(p, { create: true })`, clear the record.
    - **Expired or declined:** write the record with `outcome`. Exit 0 either way.

- [ ] **Step 1: Write the failing tests** with fake deps:
  - A start writes the record and spawns argv ending `["setup","github","sign-in","--wait"]`, and the envelope carries `userCode` and `url` and no `deviceCode`.
  - A second start with a live record spawns nothing.
  - A wait that gets pending, pending, then a token stores `githubToken` through `writer.write("rt","githubToken",…)`, stages `homeBackup` to `{ mode: "remote", create: true }` and removes the record.
  - With `writer.storeReady()` false, the token is staged rather than written.
  - A wait that gets expired leaves `outcome: "expired"` (Review Focus 1); declined leaves `outcome: "declined"` (Review Focus 2).
  - An empty client id fails with the refusal message.
- [ ] **Step 2:** `bun test commands/__tests__/setup-github.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it, and register the verb.
- [ ] **Step 4:** Rerun, plus `bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/command-tree.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `setup: rt setup github sign-in starts GitHub's device sign-in and waits for it detached`.

### Task 3: Create the repo with rt's token

**Files:**
- Modify: `lib/setup/home-remote.ts` (`setHomeRemote`, the `!url` branch)
- Modify: `lib/setup/github-signin.ts`: add `export async function createGitHubRepo(p: Pick<Probes, "fetch">, token: string, base?: string): Promise<string>`, which returns the https clone url ending `.git`.
- Test: `lib/setup/__tests__/home-remote.test.ts` (new cases), `lib/setup/__tests__/github-signin.test.ts`

**Interfaces:**
- Consumes: `forgeTokenLookupReal(p, "https://github.com/mattstack/identity")` (`lib/team/forge-token.ts`), `rtCredentialHelper` (`lib/setup/steps/repos.ts`), `linkPath(p.home, "rt")`.
- Produces: `setHomeRemote` gains an optional `hooks.githubToken?: () => Promise<string | null>` (default: the real lookup) so tests inject it.

- [ ] **Step 1: Write the failing tests.**
  - `createGitHubRepo` posts `{"name":"mattstack-home","private":true}` to `/user/repos` and returns `clone_url`. On a 422 whose body says `name already exists` it tries `mattstack-home-2` (Review Focus 3). After `-5` it throws `UserActionableError` with "Could not find a free name for your settings repo".
  - `setHomeRemote({ create: true })` with a token creates over REST (no `gh` exec). Before pushing it sets `credential.https://github.com.helper` to `""` then `rtCredentialHelper(<rt link>)` in the home repo, and it never puts the token in argv.
  - With no token it still runs `gh repo create` as today.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement it. When the push runs, the token reaches git through `gitWithToken` (`lib/team/git-credential.ts`), so the first push works before the helper is ever asked.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `setup: the settings repo is created with rt's GitHub token, and rt answers its pushes`.

### Task 4: The form's remote row and the backup verb

**Files:**
- Modify: `lib/setup/form.ts`: `FORM_COPY.thisMac.remote` (new keys `signIn`, `signInSubtext`, `expired`, `declined`, and `creates` reworded to the Global Constraints copy); `ThisMacInputs` gains `githubSignIn: GitHubSignIn | null` and `githubReady: boolean`; `remoteRow`; and the input gathering near `lib/setup/form.ts:972`.
- Modify: `commands/setup.ts` (`setupHomeBackup`): stage `{ create: true }` when `gh auth status` exits 0 **or** `githubLoginIfCanCreateRepos` returns a login for rt's stored `githubToken`.
- Test: `lib/setup/__tests__/form-this-mac.test.ts` (new cases only), `commands/__tests__/setup-home-backup.test.ts` (create it if absent)

**Interfaces:**
- Consumes: Task 1's `readGitHubSignIn`, `githubLoginIfCanCreateRepos`, `GITHUB_OAUTH_CLIENT_ID`.
- Produces: `remoteRow` states, in order:
  1. a staged url or create: done, with the url or the creates line;
  2. a live sign-in: `state: "waiting"`, detail `FORM_COPY.connect.teamTool.code(userCode)`, action `{ type: "open-url", label: "Open again", url }`, `watch: true`;
  3. a record with an outcome: `todo`, detail the expired or declined line, action run `["setup","github","sign-in"]`;
  4. otherwise, with a client id set: `todo`, subtext the sign-in subtext, action `{ type: "run", label: "Sign in to GitHub", verb: ["setup","github","sign-in"] }`;
  5. with the client id empty: today's URL form, unchanged.

  `githubReady` is computed only when backup is remote and nothing is staged, so the store isn't read on every form read.

- [ ] **Step 1: Write the failing tests** for each of the five states above, plus: `setupHomeBackup(["remote"])` with gh absent but a token whose scopes include `repo` stages create (Review Focus 4); with scopes lacking `repo` it stages nothing.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Rerun, plus `bun test commands/__tests__/setup-copy.test.ts`. Update its snapshot only where this task's copy changed (`bun test --update-snapshots` on that file), and read the diff before keeping it.
- [ ] **Step 5:** Commit: `setup: the settings repo row signs in to GitHub when rt has no token that can create it`.

### Task 5: Stub and tray render

**Files:**
- Modify: `rt-tray/Tests/stub-rt/stub.ts`: `setup home-backup remote` stages create only when stub state `github-token` is set. Otherwise `remoteRow` walks todo (Sign in to GitHub), then waiting (code `WDGT-4271`, url `https://github.com/login/device`) after `setup github sign-in`, then done after `landsAfter("github-reads", "github-signin-at", 2)`, which sets `github-token` and stages create.
- Modify: `rt-tray/Sources/Setup/Fast/FastSetupSnapshot.swift`: add `this-mac-github-signin` (the todo row) and `this-mac-github-waiting` (the waiting row) beside `this-mac-backup-github`.
- Test: `rt-tray/Tests/stub-rt/stub.test.ts` (one new case: the stub's sign-in lands and the row turns done)

- [ ] **Step 1:** Write the stub test, then run it from the root: `bun test rt-tray/Tests/stub-rt/stub.test.ts -t "github sign-in"`. Expected: FAIL.
- [ ] **Step 2:** Implement the stub. Rerun. Expected: PASS.
- [ ] **Step 3:** Add the snapshots, then `cd rt-tray && swift build --product rt-tray` and render with the session's render script. Look at both new PNGs: the button reads "Sign in to GitHub", and the waiting row shows the code line with Open again.
- [ ] **Step 4:** `cd rt-tray && swift run mattstack-checks`. Expected: all pass.
- [ ] **Step 5:** Commit: `tray: test drive and snapshots walk the settings repo's GitHub sign-in`.
