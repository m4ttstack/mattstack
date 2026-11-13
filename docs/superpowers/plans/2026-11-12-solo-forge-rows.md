# Solo forge rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Just me (solo) install shows an optional GitHub row and an optional GitLab row in the plan, on the setup window's Connect your accounts screen and in Settings > Accounts, and connecting either touches no team state or app toggle.

**Architecture:** One helper in `lib/setup/solo-forge.ts` decides which confirmed host a solo GitLab row may use. The plan validator (`accountRows`), the form's connect section and the `rt setup gitlab connect` verb all run overrides through it. The tray draws the new rows with no view change; Settings gets a check and a snapshot render.

**Tech Stack:** Bun + TypeScript (`bun test`), Swift (SwiftPM `mattstack-checks`, the `rt-tray` DEBUG snapshot flags), Docusaurus MDX.

**Spec:** `docs/superpowers/specs/2026-11-12-solo-forge-rows-design.md`

## Global Constraints

- Write only under `lib/setup/`, `commands/setup.ts`, `commands/__tests__/` files for setup, `rt-tray/Sources/Settings/`, `rt-tray/Tests/MattstackCoreChecks/AccountsPaneChecks.swift`, `sites/docs/docs/start/setup.mdx`, `docs/superpowers/`. Never `commands/sync.ts`, `commands/git/`, `lib/stack-guard.ts`, `lib/team/forge.ts`, `lib/worktree/`, `apps/`, `packages/`, `plugins/`.
- Run `bun test` from the worktree root only (bunfig preload isolates HOME). Never run rt, the daemon, setup or a built binary against the real HOME; a built Swift binary runs only as `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin <binary> ...`.
- Swift builds happen only in a scratch copy of `rt-tray` under the session scratchpad (Task 5 Step 0; `$SCRATCH` = `/private/tmp/claude-501/-Users-matt--mattstack-rt-worktrees-gh-m4ttstack-mattstack-lively-paddle/a74d0adb-cb7f-49e5-b98a-3d0345c79a3c/scratchpad`); never run `rt-tray/build.sh`; never touch `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app`.
- No em or en dashes anywhere. Forge-aware copy: PR on GitHub, MR on GitLab. A token never appears in output, logs or test snapshots.
- Create, join and restore behavior stays unchanged: existing non-solo tests in `lib/setup/__tests__/validators-accounts.test.ts` and `lib/setup/__tests__/form-connect.test.ts` pass untouched.
- Stage named files only. Commit after each task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Exact copy (use verbatim):
  - `SOLO_GITHUB_NOTE` = `Works without this. Connect GitHub to open PRs from rt.`
  - `SOLO_GITLAB_NOTE` = `Works without this. Connect GitLab to open MRs from rt. On your own GitLab server, run rt setup gitlab connect --host <host> in a terminal.`
  - connect screen GitHub subtext = `Optional. Lets mattstack open PRs`
  - connect screen GitLab subtext = `Optional. Lets mattstack open MRs`
  - connect screen GitLab hint (detail while no token) = `On your own GitLab server? Connect from a terminal with rt setup gitlab connect --host <host>`

## Review Focus

1. A solo Mac that left a github.com team keeps `rt.integrations.forgeHost: "github.com"`; the GitLab row, its Create token link and its Connect must all use gitlab.com (Tasks 2, 3, 4).
2. A solo Mac with a confirmed self-hosted GitLab host (`gitlab.example.com`) must keep using it in the row, the link and the verb (Tasks 1, 2, 3, 4).
3. A stored GitLab token that is invalid or short on scopes must show the account's own reason on the connect screen, not the self-hosted hint (Task 3).
4. Connecting on solo while the personal secret store is not ready stages exactly one file and writes nothing else (Task 4).
5. A Mac with an org clone but no intent (not solo) keeps today's single team-forge row and today's host reading (Tasks 2, 4).

---

### Task 1: The solo host helper

**Files:**
- Create: `lib/setup/solo-forge.ts`
- Test: `lib/setup/__tests__/solo-forge.test.ts`

**Interfaces:**
- Produces: `export function soloForgeOverrides(overrides: UserIntegrationOverrides, solo: boolean): UserIntegrationOverrides` (import `UserIntegrationOverrides` from wherever `accounts.ts` imports it). Returns `overrides` unchanged unless `solo` is true and `overrides.forgeHost` lowercased is `"github.com"`; then returns a copy without `forgeHost`.

- [ ] **Step 1: Write the failing tests** in `solo-forge.test.ts`, `describe("soloForgeOverrides")`:
  - `"drops a leftover github.com host on solo"`: `soloForgeOverrides({ forgeHost: "github.com" }, true)` has no `forgeHost` key.
  - `"drops it case-insensitively"`: `{ forgeHost: "GitHub.com" }`, true → no `forgeHost`.
  - `"keeps a self-hosted GitLab host on solo"`: `{ forgeHost: "gitlab.example.com" }`, true → `toEqual({ forgeHost: "gitlab.example.com" })`.
  - `"keeps every host on a team Mac"`: `{ forgeHost: "github.com" }`, false → `toEqual({ forgeHost: "github.com" })`.
  - `"does not change the overrides it was given"`: the input object still holds `forgeHost: "github.com"` after the call.
- [ ] **Step 2:** `bun test lib/setup/__tests__/solo-forge.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `soloForgeOverrides` in `lib/setup/solo-forge.ts`. One doc comment stating the constraint: `forgeHost` is shared by both forges, and a team Mac writes `github.com` there.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `add lib/setup/solo-forge.ts: solo GitLab ignores a leftover github.com host`.

### Task 2: Two optional forge rows in the plan

**Files:**
- Modify: `lib/setup/validators/accounts.ts` (`SOLO_FORGE_NOTE` at about line 484, `accountRows` at about line 505)
- Test: `lib/setup/__tests__/validators-accounts.test.ts` (`describe("accountRows on solo")` at about line 863)
- Snapshots: `commands/__tests__/__snapshots__/setup-copy.test.ts.snap`

**Interfaces:**
- Consumes: `soloForgeOverrides` (Task 1).
- Produces: plan rows `account.github` then `account.gitlab` on solo, both `required: false`, with `optionalNote` `SOLO_GITHUB_NOTE` / `SOLO_GITLAB_NOTE` (both exported from `accounts.ts` so the tests import them instead of repeating the strings).

- [ ] **Step 1: Write the failing tests** in `describe("accountRows on solo")`, calling `accountRows(fakeProbes({ exec }), baseTeam({ slug: "" }), [], fakeSecrets(), { v: 1, at: "", mode: "solo" }, overrides, true)`:
  - Replace `"one optional github row, nothing else"` with `"an optional GitHub row, then an optional GitLab row, nothing else"`: ids `["account.github", "account.gitlab"]`; both `required === false`; `optionalNote`s equal the two Global Constraints notes; both `status === "missing"`.
  - `"the solo GitLab row connects with a token and links to gitlab.com"`: gitlab row `action` matches `{ type: "connect", integration: "gitlab" }`, `action.create.url` starts with `https://gitlab.com/`.
  - `"a leftover github.com host does not reach the solo GitLab row"`: overrides `{ forgeHost: "github.com" }` → gitlab `action.create.url` starts with `https://gitlab.com/`.
  - `"a confirmed self-hosted host does reach it"`: overrides `{ forgeHost: "gitlab.example.com" }` → `action.create.url` starts with `https://gitlab.example.com/`.
  - `"a stored GitLab token reads ready on solo"`: secrets `{ "rt.gitlabToken": "tok123" }`, fetch answering `/api/v4/user` 200 (copy the existing `fetch` fakes in this file) → gitlab row `status === "ready"`.
- [ ] **Step 2:** `bun test lib/setup/__tests__/validators-accounts.test.ts` → the new cases FAIL; every non-solo case PASSES.
- [ ] **Step 3:** In `accountRows`: replace `SOLO_FORGE_NOTE` with exported `SOLO_GITHUB_NOTE` and `SOLO_GITLAB_NOTE`; the solo `declared` becomes `[{ id: "github", required: false, optionalNote: SOLO_GITHUB_NOTE }, { id: "gitlab", required: false, optionalNote: SOLO_GITLAB_NOTE }]`; when `solo`, pass `soloForgeOverrides(overrides, true)` instead of `overrides` to every `accountRowForSafe` call. The non-solo branch is untouched.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** `bun test commands/__tests__/setup-copy.test.ts` → exactly four snapshots fail: `plan: the machine view is unchanged`, `plan: the copy is what the copy table says`, `status: the machine view is unchanged`, `status: the copy is what the copy table says`. Read each diff: the only changes are the new `account.gitlab` row and the two new notes. Then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and rerun → PASS. This diff is the look at the checklist's text output; quote the new lines in the task report.
- [ ] **Step 6:** In `lib/setup/__tests__/plan.test.ts` (the test `"solo intent, no teams -> no access rows, github optional, ..."`, about line 187), change the expected solo accounts rows from `[["account.github", false]]` to `[["account.github", false], ["account.gitlab", false]]` and rename the test's "github optional" to "github and gitlab optional". `bun test lib/setup/__tests__/plan.test.ts` → PASS.
- [ ] **Step 7:** `bun test e2e/tests/setup.test.ts --preload ./e2e/setup.ts` → PASS.
- [ ] **Step 8:** Commit `setup: solo plan offers GitHub and GitLab forge rows (RT-349)` with both test files, `accounts.ts` and the `.snap`.

### Task 3: Two forge rows on the Connect your accounts screen

**Files:**
- Modify: `lib/setup/form.ts` (`FORM_COPY.connect.soloForge` at about line 151, `drawnForge`/`formOwnedIds` at about lines 478 to 500, `forgeRow` at about line 556, the connect rows list at about line 691, `connectSection` at about line 1180)
- Test: `lib/setup/__tests__/form-connect.test.ts` (solo tests at about lines 380, 397 and 479)

**Interfaces:**
- Consumes: `soloForgeOverrides` (Task 1); `isSolo` from `lib/setup/contract.ts`.
- Produces: on `path === "solo"`, connect rows `forge` (GitHub) then `forge.gitlab` (GitLab), both `optional: true`; `formOwnedIds` on solo contains `account.github` and `account.gitlab`. Create and join rows are byte-identical to today.

- [ ] **Step 1: Write the failing tests** (reuse the file's `r`, `plan`, `inputs`, `pick`, `SOLO` helpers):
  - Update `"solo shows the code host as optional, then Claude and Fast Browser"`: plan rows add `r("account.gitlab", "missing", "No GitLab account connected yet", { required: false })`; ids `["forge", "forge.gitlab", "claude", "fast-browser"]`; `forge` subtext `Optional. Lets mattstack open PRs`; `forge.gitlab` title `GitLab`, subtext `Optional. Lets mattstack open MRs`, `state === "todo"`, `optional === true`, `detail` equals the GitLab hint; action `{ type: "connect", integration: "gitlab" }` with `create.url` starting `https://gitlab.com/`; `allAnswered(list) === true`.
  - `"the solo GitLab row keeps the account's reason once a token is stored"`: `account.gitlab` with status `"invalid"`, detail `"GitLab rejected the token"` → `forge.gitlab.detail === "GitLab rejected the token"`.
  - `"a connected solo GitLab row reads done"`: `account.gitlab` `"ready"` → `state === "done"`, `action === null`.
  - `"a confirmed self-hosted host is the solo GitLab row's host"`: `confirmedHost: "gitlab.example.com"` in inputs → `create.url` starts `https://gitlab.example.com/`.
  - `"formOwnedIds on solo owns both forge accounts"`: `formOwnedIds(plan(rows, SOLO), { path: "solo", forge: null, signIn: [] })` contains both ids.
  - Update the `composeForm` solo test (`"a solo Mac with nothing installed gets the code host, Claude, herdr and Get Chrome"`): expected ids `["forge", "forge.gitlab", "claude", "tool.herdr", "fast-browser"]`.
  - `"composeForm on solo ignores a leftover github.com host for GitLab"`: same probes plus the file `/fake-home/.mattstack/user/settings.user.jsonc` holding `{ "rt.integrations": { "forgeHost": "github.com" } }` (the global-level key `lib/setup/team-settings.ts` reads at about lines 89 to 94) → `forge.gitlab` `create.url` starts `https://gitlab.com/`.
- [ ] **Step 2:** `bun test lib/setup/__tests__/form-connect.test.ts` → new and updated solo cases FAIL; create and join cases PASS.
- [ ] **Step 3:** In `form.ts`:
  - `FORM_COPY.connect`: replace `soloForge` with `soloGithub`, `soloGitlab`, `soloGitlabHint` (Global Constraints copy).
  - `formOwnedIds`: on solo add `account.github` and `account.gitlab`; `drawnForge` keeps serving create and join only (update its doc comment; remove "Just me always draws GitHub").
  - Add `function soloForgeRows(i: ConnectInputs, rows: ReadonlyMap<string, Row>): ConnectRow[]` returning the GitHub row (id `forge`, built as today's solo branch with subtext `soloGithub`) and the GitLab row (`forgeAccountRow` with id `forge.gitlab`, forge `{ provider: "gitlab", host: i.confirmedHost ?? "gitlab.com" }`, role `"member"`, subtext `soloGitlab`, `connected` as the GitHub row computes it without the gh-login parse, `confirmedHost: i.confirmedHost`), each `optional: true`; when `rows.get("account.gitlab")?.status === "missing"`, set the GitLab row's `detail` to `soloGitlabHint`. `forgeRow` returns null on solo and the connect list spreads `soloForgeRows` in its place on solo.
  - `connectSection`: pass `confirmedHost` through `soloForgeOverrides(overrides, isSolo(plan.team)).forgeHost ?? null`.
- [ ] **Step 4:** Same command → PASS. Also `bun test lib/setup/__tests__/form-stage.test.ts lib/setup/__tests__/form-create.test.ts lib/setup/__tests__/form-invite.test.ts commands/__tests__/setup-form.test.ts` → PASS.
- [ ] **Step 5:** Commit `setup form: solo connect screen draws GitHub and GitLab rows (RT-349)`.

### Task 4: The connect verb on solo, and the no-side-effect pin

**Files:**
- Modify: `commands/setup.ts` (`connectCredential` at about line 1679)
- Test: `commands/__tests__/setup-connect.test.ts`

**Interfaces:**
- Consumes: `soloForgeOverrides` (Task 1); `isSolo` (`lib/setup/contract.ts`); `orgRefFromIntent` and `readIntent` (`lib/setup/intent.ts`); `cloneSlugs` (`lib/setup/team-settings.ts`).
- Produces: on a solo Mac with no `--host`, `connectCredential` checks a GitLab token against `soloForgeOverrides(overrides, true)`; nothing else in the verb changes.

- [ ] **Step 1: Write the failing tests** in a new `describe("integrationConnect on a solo Mac")`. Solo deps: `baseDeps({ probes: fakeProbes({ fetch }), teamSnapshot: () => ({ slug: "", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null }), stdin: async () => ({ token: TOKEN }) })` with no intent file and no orgs dir. `TOKEN = "glpat-solo-secret"` (GitHub cases: `"github_pat_solo_secret"`, fetch answering `api.github.com/user` 200 as the file's existing GitHub test does).
  - `"connecting GitLab writes the token and nothing else"` (store ready): `writer.write` records calls → exactly `[["rt", "gitlabToken", TOKEN]]`; `probes.calls.writes` is `{}`; no `probes.calls.exec` entry has `argv[0]` `deck` or `git`; `writeSetting` stays the default `neverCalled`; envelope `status === "ready"`; `deps.lines.join("")` and the captured stdout and stderr (`cap`) do not contain `TOKEN`.
  - `"connecting GitLab before the store exists stages one file and nothing else"`: `storeReady: async () => false` → `Object.keys(probes.calls.writes)` is exactly one key ending `rt/setup-staging/rt.json`; same exec, setting and token-absence assertions.
  - The same two cases for GitHub (`integrationConnect("github", ...)`, key `githubToken`).
  - `"--host on solo records only the user-scope host"`: GitLab, args `["--json", "--host", "gitlab.example.com"]`, fetch answering `gitlab.example.com/api/v4/user` 200 → `writeSetting` calls exactly `[["rt.integrations", { forgeHost: "gitlab.example.com" }, "user"]]`; writes and exec assertions as above.
  - `"a leftover github.com host does not reach a solo GitLab connect"`: `userIntegrationOverrides: () => ({ forgeHost: "github.com" })`, no `--host` → every `probes.calls.fetch` URL starts with `https://gitlab.com/`; status `ready`.
  - `"a confirmed self-hosted host still reaches a solo GitLab connect"`: `userIntegrationOverrides: () => ({ forgeHost: "gitlab.example.com" })`, no `--host`, fetch answering `gitlab.example.com/api/v4/user` 200 → every `probes.calls.fetch` URL starts with `https://gitlab.example.com/`; `writeSetting` never called (pins Review Focus 2 for the verb).
  - `"a team Mac keeps today's host reading"` (reuse the solo cases' recording `writer`): same leftover override, but `teamSnapshot` with slug `"acme"` and integrations `{ forge: { provider: "gitlab", host: "gitlab.com" } }` → today's `ctxFor` hands the validator `host: "github.com"`, so the first `probes.calls.fetch` URL starts with `https://github.com/` (pins Review Focus 5: team paths unchanged).
- [ ] **Step 2:** `bun test commands/__tests__/setup-connect.test.ts` → the leftover-host case FAILS; the side-effect cases may already pass (they pin today's behavior, which is the acceptance).
- [ ] **Step 3:** In `connectCredential`, when `hostFlag === undefined`, compute `solo = snapshotFor(deps).slug === "" && isSolo(orgRefFromIntent(readIntent(deps.probes), cloneSlugs(deps.probes)))` and use `soloForgeOverrides(overrides, solo)` as `confirmedOverrides`. The `--host` branch and every write stay as they are.
- [ ] **Step 4:** Same command → PASS. Also `bun test commands/__tests__/setup-github.test.ts commands/__tests__/setup-plan.test.ts` → PASS.
- [ ] **Step 5:** Commit `setup connect: solo GitLab skips a leftover github.com host; pin no team or app writes (RT-349)`.

### Task 5: Settings > Accounts check and render, and the connect screen look

**Files:**
- Modify: `rt-tray/Tests/MattstackCoreChecks/AccountsPaneChecks.swift`
- Modify: `rt-tray/Sources/Settings/SettingsExtrasSnapshot.swift`

**Interfaces:**
- Consumes: the plan rows from Task 2 and the form rows from Task 3, copied as fixtures.

All Swift building and running happens in a scratch copy of `rt-tray`, never in this worktree: the package needs the Sparkle framework at `deps/tools/sparkle-xcframework/` (a local `binaryTarget`, checked when the package loads), which this worktree lacks, and the debug rpath resolves it relative to the copy's own `.build`.

- [ ] **Step 0: Prepare the scratch copy.** `rsync -a --delete --exclude .build --exclude deps rt-tray/ "$SCRATCH/tray/"` (always this exact line, so a rerun keeps the copy's `deps/`). Fetch only the Sparkle row from `rt-tray/deps.lock` (no `fetch-deps.sh`): `curl -fsSL -o "$SCRATCH/sparkle.zip" https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-for-Swift-Package-Manager.zip`; `shasum -a 256 "$SCRATCH/sparkle.zip"` must print `17e28312b8e18ab7cdbbe09a6fb28cc55a5479ec6c371dbc07cdecd2a14fd959` (stop and report BLOCKED otherwise); `mkdir -p "$SCRATCH/tray/deps/tools/sparkle-xcframework" && unzip -q "$SCRATCH/sparkle.zip" 'Sparkle.xcframework/*' -d "$SCRATCH/tray/deps/tools/sparkle-xcframework"`. After any later edit to the worktree's Swift files, rerun only the `rsync` line.
- [ ] **Step 1: Add a check** to `accountsPaneChecks`: `"on a solo install Settings > Accounts shows the GitHub and GitLab rows, and GitLab's Connect runs gitlab connect"`. Fixture plan: `team: TeamInfo(slug: "", name: "", mode: .noTeam)`, accounts group with `account.github` and `account.gitlab` (both `required: false`, status `.missing`, `optionalNote` the Task 2 notes, action `RowAction(type: .connect, label: "Connect", integration: "gitlab", fields: [token field])`). Expect `groups(for: .accounts)` row ids `["account.github", "account.gitlab"]`, and `RowActionDispatcher.dispatch(gitlab.action!, fieldValues: ["token": "t"], alternative: nil)` equals `.rtVerb(args: ["setup", "gitlab", "connect", "--json"], stdin: <the JSON the dispatcher builds for ["token": "t"]>)`.
- [ ] **Step 2: Run the checks** in the copy (after rerunning Step 0's `rsync`): `cd "$SCRATCH/tray" && swift build --product mattstack-checks && env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin "$(swift build --show-bin-path)/mattstack-checks"`. Expected: all checks pass, including the new one.
- [ ] **Step 3: Add the render.** In `SettingsExtrasSnapshot`, under the same flag, also render the solo accounts group the way Settings > Accounts draws it (`ChecklistScreen.flatList`): `Form { Section("Accounts") { ForEach(rows) { RowView(row: $0, isChecking: false, onAction: {}) } } }.formStyle(.grouped).frame(width: 560, height: <fits both rows>)`, light and dark, to `extras-accounts-solo-light.png` and `extras-accounts-solo-dark.png`; the rows are the Step 1 fixture rows; update the printed count.
- [ ] **Step 4: Render and look.** Rerun Step 0's `rsync`, then `cd "$SCRATCH/tray" && swift build --product rt-tray && env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin "$(swift build --show-bin-path)/rt-tray" --render-settings-extras-snapshots "$SCRATCH/snaps"`. If dyld cannot load Sparkle, add `DYLD_FRAMEWORK_PATH="$(swift build --show-bin-path)"` inside the `env -i`. Read both `extras-accounts-solo-*.png`. Say plainly what reads wrong (note wrapping, the command in the GitLab note, contrast in dark) and fix before committing.
- [ ] **Step 5: Look at the connect screen (nothing committed).** In the scratch copy only, in `Sources/Setup/Fast/FastSetupSnapshot.swift`'s `("connect-solo", page(team: false, [C.soloForge, C.claudeSignIn, C.soloFastBrowser]))` entry (about line 310): set `C.soloForge`'s subtext to `Optional. Lets mattstack open PRs` and add, after it, a `FormRow(id: "forge.gitlab", title: "GitLab", subtext: "Optional. Lets mattstack open MRs", ...)` with the hint as its detail, built like `C.soloForge`. Build `rt-tray` there as in Step 4 and run it with `--render-fast-setup-snapshots "$SCRATCH/look"` under the same `env -i`. Read the `connect-solo` light and dark PNGs and report what reads wrong. Then rerun Step 0's `rsync` so the copy matches the worktree again.
- [ ] **Step 6:** Commit `settings: solo accounts check and snapshot (RT-349)` with the two Swift files.

### Task 6: Docs

**Files:**
- Modify: `sites/docs/docs/start/setup.mdx` (the Just me bullet at line 51, "Connecting a forge account" at about line 77)

- [ ] **Step 1:** Update the Just me bullet: Connect your accounts has GitHub, GitLab, Claude and Fast Browser; GitHub ("Optional. Lets mattstack open PRs") and GitLab ("Optional. Lets mattstack open MRs") and Fast Browser never hold up **Continue**.
- [ ] **Step 2:** Rewrite "Connecting a forge account"'s last line: connect GitHub or GitLab on the **Connect your accounts** screen, or later in **Settings → Accounts**, or with `rt setup github connect` / `rt setup gitlab connect`. Add: on your own GitLab server, connect from a terminal with `rt setup gitlab connect --host gitlab.example.com`.
- [ ] **Step 3:** `python3 skills/doc-standards/scripts/check_docs.py sites/docs/docs/start/setup.mdx --no-vale` → zero errors; `bun run docs:check` and `bun run docs:build` → PASS.
- [ ] **Step 4:** Commit `docs: Just me connects GitHub or GitLab (RT-349)`.

### Task 7: Branch verification

- [ ] **Step 1:** `bun run typecheck` → PASS.
- [ ] **Step 2:** `bun run purity` → PASS.
- [ ] **Step 3:** Rerun every touched test file from the worktree root (Tasks 1 to 4), plus `bun test lib/setup/__tests__ commands/__tests__/setup-*.test.ts` to catch any other solo assertion, and `bun test e2e/tests/setup.test.ts --preload ./e2e/setup.ts` → PASS. Record each command and result for the report.
