# rt Output Layer, Phase 3 (Setup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every human line of `rt setup` (bare, `plan`, `status`, `apply`, `update`, `finish`, `intent`, `pack`, the connect and status pairs, `slack create-app`, `waive`, `unwaive`, `repo-root set`, `home remote set`), `rt verify`, `rt uninstall`, `rt accounts`, `rt logins` and `rt secrets` onto `lib/ui/out.ts`, so a setup run shows one rt-ui step per install step with its title, informational text lands on stdout, an expected failure is a `failure` block with no stack, and every `--json` shape stays as it is: keys, structure, types, exit codes and every value a program reads are byte-identical, while the human strings inside (a row's `detail`, a step's `remedy`, an error message) take plain wording in this phase.

**Architecture:** The setup engine keeps emitting `ApplyEvent`s. In `--json` mode they go through a `json` seam on each verb's deps (real implementation `out.json`), which is the app's NDJSON contract and never changes. For a person, a new `createStepEmitter` in `lib/setup/emit.ts` turns the same stream into rt-ui steps: `running` opens a step with the step's title, `log` lines become sub-lines that also reach the CLI log, the final state ends the step with a status (`partial` is `warn`, `failed` is the only `fail`), a remedy is a `fix` callout, and the closing event is a `summary`. The printed checklist becomes `section` blocks built by a pure `planBlocks` in `lib/setup/plan-blocks.ts`, shared by `setup plan`, `setup status`, bare `rt setup` and `rt verify`. Expected failures go through one `exitWithUserError` in `lib/setup/user-failure.ts`: the envelope on stdout under `--json`, an `out.fail` block on stderr otherwise.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/setup/`, `lib/ui/out.ts`), `bun:test`, termwright for the one pty gate.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369). This plan covers the spec's phase 3 only. Phase 1 (the layer) is on this branch; **phase 2 (the error seam, `lib/errors.ts`, `exitUserError`, the sops failure) must land before this plan starts**: Task 2 imports `UserActionableError`, `userErrorPayload` and `failureFor` from `lib/errors.ts`, consumes `logCliEvent` from `lib/cli-logger.ts` and the test helper `captureOut` from `lib/ui/__tests__/capture-out.ts`, all created by phase 2, and deletes the `lib/setup/errors.ts` shim phase 2 left for this plan's importers. The rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan; where this plan and a ruling disagree, the ruling wins.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command keeps its shape byte for byte: keys and their order, structure, types, exit codes and every value a program reads (ids, statuses, booleans, paths, versions, counts). A human-facing string inside it (`detail`, `remedy`, an error `message`, a title) is copy and may change wording; a characterization test compares the shape and the machine-read values and pins the copy separately. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- Phase 3's own:
  - The copy pass (Task 12) is the only task that changes the `detail`, `remedy` and error `message` strings anywhere under `lib/setup/` and in the string literals of `commands/setup.ts`, `commands/uninstall.ts`, `commands/logins.ts` and `commands/verify.ts` (the two messages Task 5 rewrites aside), and it changes them to the wording in the audit's copy table, nothing else. Tasks 1 to 11 leave those strings and their lines alone (several carry an em dash today; a line you touch for another reason keeps its dash until Task 12). A string that code reads back (`FIRST_PULL_PENDING`, `VSIX_NOT_FOUND_DETAIL`, `NO_EDITORS_DETAIL`, `NO_RECORDED_EDITORS_DETAIL`, `NO_MANIFEST_DETAIL`) changes through its one constant, so every reader follows; the `MATTSTACK_TRUST=` marker is the proxy installer's output, not rt's copy, and stays.
  - A `--json` envelope gains no key: `UserActionableError`'s `extra` is spread into `error`, so plainer words for a person ride phase 2's `why` and `next` options (which stay out of the envelope) or the call site's overlay, never `extra`.
  - The step emitter never goes through `lib/ui/steps.ts`'s plain fallback: off a TTY it prints with `out.print`; at a terminal it drives `openStep` directly.
  - The emitter is driven by a synchronous `Emit`; every rt-ui interaction is queued on one promise chain and a verb awaits `flush()` before it exits, so no step line can print after the process has gone or out of order.
  - No `console.*` anywhere in the files this phase touches, including test helpers under `commands/__tests__/helpers/` (the guard skips `__tests__`, but the habit is the point).
  - `commands/setup.ts` stays one file. It is long, and this phase does not restructure it beyond moving the plan renderer and the exit-2 helper into `lib/setup/`.

## Review Focus

1. **A streamed child line carrying escapes or a newline.** A `git clone` stderr line with `\x1b[2J` or an embedded newline must print as plain characters, the newline splitting it into two plain rows the way `verbatim` does and no escape reaching the terminal, at a terminal and in the plain fallback, and must reach the CLI log as sent. Pinned in Task 3 (`a hostile log line prints as one plain row and reaches the log unchanged`).
2. **The helper dying or missing mid-run.** With `rt-ui` gone after the first step, every remaining step line and the summary must still print plainly and the run must not hang. Pinned in Task 3 (`a helper that dies on start leaves the run on the plain path` and `a helper that cannot start leaves the run on the plain path`).
3. **A human-only warning under `--json`.** The update-stamp and finish-check warnings must never put a non-JSON line on stdout when `--json` is set; they go to the CLI log. Pinned in Task 5 (`a finish check that throws under --json reaches the log, never stdout`).
4. **Exit before the drawing.** A failed apply must print its summary before `deps.exit(2)` runs, and `rt setup update`'s exit 2 must follow its summary. Pinned in Task 5 (`the summary is printed before exit 2`).
5. **No terminal and no argument.** `rt logins remove` and `rt secrets list` with nothing on argv and no TTY must fail with the usage block on stderr and today's exit code, never prompt or hang. Pinned in Task 10 (`off a TTY with no origin remove fails with usage on stderr and exit 2`) and Task 11 (`off a TTY with no domain list fails with usage on stderr and exit 1`).

## File Structure

| File | Responsibility |
|---|---|
| `commands/__tests__/helpers/json-line.ts` (create) | Test helper over phase 2's `captureOut`: `capturePlain` (capture plus the closed human gate), `expectOneJsonLine`, `realJson` |
| `lib/setup/user-failure.ts` (create) | `userFailure`, `exitWithUserError`: the exit-2 path every setup verb shares |
| `lib/setup/errors.ts` (delete) | Phase 2's re-export shim, gone once this plan's importers point at `lib/errors.ts` |
| `lib/setup/emit.ts` (rewrite) | `createStepEmitter`: `ApplyEvent`s to rt-ui steps, sub-lines, callouts and a summary |
| `lib/setup/apply.ts` (modify) | `tip` hook on `ApplyContext` so a settings tip attaches under its step |
| `lib/setup/plan-blocks.ts` (create) | `rowStatus`, `accountConnectVerb`, `rowTitles`, `planBlocks`: the checklist as blocks |
| `lib/setup/finish-gate.ts`, `lib/setup/team-settings.ts` (modify) | Resolver warnings go to the CLI log, not stderr |
| `lib/setup/steps/home.ts` (modify) | One comment reworded so the guard no longer matches it |
| `lib/setup/update.ts` (modify) | `summarizeUpdate` removed; the emitter's summary replaces it |
| `commands/setup.ts` (modify) | Every verb's human output through `out`; `json` seam; `print` seams removed |
| `commands/uninstall.ts`, `commands/verify.ts`, `commands/accounts.ts`, `commands/logins.ts`, `commands/secrets.ts` (modify) | Converted |
| `e2e/pty/setup-apply.test.ts` (create), `.github/workflows/e2e.yml` (modify) | The `setup apply` pty gate and its path filter |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Lines deleted as files convert |
| `lib/setup/validators/*.ts`, `lib/setup/steps/*.ts`, `lib/setup/uninstall.ts`, `lib/setup/tools-install.ts`, `lib/setup/pack.ts` (modify) | The copy pass: every `detail` and `remedy` string per the copy table |
| `commands/__tests__/setup-copy.test.ts` (create) | The plan's machine view and its copy, pinned as two snapshots |
| `AGENTS.md` (modify) | The setup emitter and the shape-not-strings rule |

## Audit: every print site this phase owns

The block each site becomes and its new copy. The "Copy" column says what happens to a string that also rides `--json`: the shape around it never changes, the string itself is rewritten where named (the validators' and steps' strings in Task 12, the two error messages in Task 5) or kept where it is already plain.

### `lib/setup/emit.ts` (`createHumanEmitter`, replaced whole)

| Today | Becomes |
|---|---|
| `  N steps` on `plan` | nothing printed; titles remembered by id |
| `  … <id>` on `running` | an rt-ui step opened with the step's title (`StepDef.title`, from the `plan` event); off a TTY nothing until the step resolves |
| `      <line>` on `log` | `StepHandle.sub(line)`; the line also goes to the CLI log through `logCliEvent` at `debug`; off a TTY kept for a `verbatim` block if the step fails |
| `  ✓ <id>  detail` / `~` / `-` / `!` | `StepHandle.done(title, detail, status)` with `done`, `skipped`, `needs-you` or `warn` (partial); off a TTY `line(status, title, detail)` |
| `  ✗ <id>  detail` | `StepHandle.fail(title, detail)`; off a TTY `line("failed", title, detail)` plus `verbatim(last five log lines)` |
| `      → remedy` | `callout("fix", remedy)` under the step line |
| the `  ? <id>` waiting-for-the-app line on `need` | a sub-line "Waiting for mattstack.app to finish this step", also logged |
| `  - skipped: setup has not finished on this Mac` | `line("skipped", "Setup has not finished on this Mac yet")` |
| `  - skipped: already applied for this version` | `line("skipped", "Nothing to update")` |
| `  - skipped: another update run is in progress` | `line("skipped", "Another update is already running")` |
| `  ✗ failed: a, b` / `  ✓ done` / `  ✗ stopped at <id>` | `summary(status, label, counts)`: counts like `3 done`, `1 skipped`, `1 needs you`, `1 with a caveat`, `1 failed`; labels per verb (apply: "Setup is done" / "Setup needs you" / "Setup stopped"; update: "Everything is up to date" / "The update needs you" / "Part of the update failed"; uninstall: "mattstack is uninstalled" / "Uninstall needs you" / "Uninstall stopped") |
| a `log` arriving with no step open (`warn: setup state not persisted: …`) | `line("warn", text without its `warn: ` prefix)` |

### `commands/setup.ts`

| Site | Becomes | Copy |
|---|---|---|
| `renderPlanHuman`: group title, `  <glyph> title  detail`, dim footnote | `section(group.title, "N of M ready", line(rowStatus(r), r.title, r.detail)…)`; a `choose` footnote is `callout("note", footnote)`; `missing` is `pending`, or `needs-you` for an account or permission row; `invalid` and `error` are `failed`; `checking` is `pending` | `r.detail` rewritten in Task 12 |
| `Install: ready` / `Install: blocked by: <ids>` | `summary("done", "Install can run")` / `summary("needs-you", "Install is waiting on", <row titles>)` | |
| `renderFinishLine` | `line("done", "Finish can run")` / `line("needs-you", "Finish is waiting on", "<titles>")` | |
| the "Missing accounts" heading + `  - Title: rt setup x connect` | `callout("next", cmd("rt setup <integration> connect"))` under that account's line, status mode only | |
| `rt setup status` header line | dropped | |
| `setupInteractive`: `missingRowLines` + the `rt setup: not ready to install` line naming ids | `out.fail({ title: "This Mac is not ready to install yet", why: "Waiting on <titles>" })`, exit 2 | |
| `setupApply` catch (`rt setup apply: <message>`) | `exitWithUserError(err, json, sinkOf(deps), err.code === "not-ready" ? { title: NOT_READY_TITLE } : undefined)`; the hard gate's error carries `why` ("Apple's Command Line Tools are not installed" / "rt needs macOS 14 or newer") and `next` (`rt tools install apple-clt`) through phase 2's options, and its message is the title plus the why | message rewritten (Task 5): `This Mac is not ready to install yet: Apple's Command Line Tools are not installed` |
| `rt setup apply: update version not stamped: …` (stderr) | `warnLine(json, "The update version was not saved", message)`: CLI log always, `line("warn", …)` on stdout when not `--json` | |
| `rt setup apply: setup left unfinished, the finish check failed: …` | `warnLine(json, "Setup was left unfinished because the finish check failed", message)` | |
| `setupUpdate`: `--from is not a setup update flag…` | `exitWithUserError(err, json, sinkOf(deps))`; the message is the block's title | message rewritten (Task 5): `--from does not apply to an update, which always runs every safe step` |
| `setup update: setup has not finished on this Mac` | `line("pending", "Setup has not finished on this Mac yet")` + `callout("next", cmd("rt setup install"))` | |
| `setup update: already applied for <v>` | `line("skipped", "Nothing to update", "already applied for <v>")` | |
| `setup update: another update run is in progress` | `line("skipped", "Another update is already running")` | |
| `setup update: <summarizeUpdate>` | the emitter's `summary`; `summarizeUpdate` deleted | |
| `setup pack: <detail>` | `line("done", "Pack is set up", detail)` | detail rewritten in Task 12 (`lib/setup/pack.ts`) |
| `setup intent: <mode> <repo>` | `line("done", "Setup intent recorded", "<mode> <repo>")` | |
| `setup finish: setup is finished on this Mac` | `line("done", "Setup is finished on this Mac")` | |
| `rt setup finish: the update run after Finish did not complete: …` (stderr) | `line("warn", "The update after Finish did not finish", message)` | |
| `setup repo-root set: <path> (<tcc>)` | `line("done", "Repo folder saved", path)` + `callout("note", tccWarning)` when present | |
| `home remote set: origin -> <url>, pushed (repo created)` | `line("done", "Pushed your home repo" / "Created a private repo and pushed your home repo to it", url)` | |
| `printIntegrationResult`: `<id>: <status>` followed by the detail | `line(ready→done, missing→needs-you, invalid→failed, integrationDef(id).title, detail)` | detail rewritten in Task 12 (`lib/setup/validators/accounts.ts`) |
| `exitWithUserError`: `rt <verb>: <message>` | `out.fail(userFailure(err, human))` | the message is the block's title unless the call site passes plainer words |
| `runWaiver`: `setup waive: <id> skipped on this Mac` and the three siblings | `line("done", "Skipped on this Mac", id)`, `line("skipped", "Already skipped on this Mac", id)`, `line("done", "Re-armed on this Mac", id)`, `line("skipped", "Was not skipped on this Mac", id)` | |
| `runWaiver` store failure (`printError`, exit 1) | `out.fail({ title: "Could not save the change", why: message })`, exit 1 | |
| `rt setup waive: usage: …` | `exitWithUserError` with human `{ title: "Which row?", next: cmd("rt setup waive <row-id>") }` | the `usage:` message stays (agents read it as a usage line); the person sees the plainer block |

### `commands/uninstall.ts`

| Site | Becomes |
|---|---|
| `This would remove:` + `  - title` | `section("This would remove", undefined, changes([{ op: "-", name: title }…]))` |
| `This will:` + `  - title` | `section("This will remove", undefined, changes(…))` then the confirm |
| step stream | `createStepEmitter` with the uninstall labels |
| `Kept:` + `  - s` | `section("Kept on this Mac", undefined, line("skipped", s)…)` |
| `rt uninstall: <message>` | `exitWithUserError(err, json, sinkOf(deps))` (the message is the block's title) |

### `commands/verify.ts`

| Site | Becomes |
|---|---|
| blank, `rt verify` title, blank | dropped |
| `  <icon> <id>  <detail>` with the action label appended | `section(group.title, undefined, line(status, r.title, r.detail)…)` per group; pass→done, skip→skipped, fail→failed, warn→the row's own `rowStatus` with failed read as warn; a fail or warn row whose action is `connect`/`oauth` gets `callout("next", cmd("rt setup <integration> connect"))`, a `run` action `callout("next", cmd("rt <verb…>"))` |
| `✓ all critical checks passed  N passed, M warnings` | `summary("done", "Everything checks out", ["N passed", "M warnings"])` |
| `✗ N critical checks failed  …` | `summary("failed", "N checks failed", ["P passed", "M warnings"])` |
| `printJSON` | `out.json(verifyPayload(results, plan), 2)`; the shape is unchanged, and `checks[].detail` is the row's detail plus the action label in parentheses (Task 12 changes `actionHint`'s separator from the em dash to ` (label)`) |

### `commands/accounts.ts`

| Site | Becomes |
|---|---|
| `No credential health data yet. Run: rt accounts --recheck` | `line("pending", "No account checks have run yet")` + `callout("next", cmd("rt accounts --recheck"))` |
| padded header + dashes + rows | `table(rows, ["ACCOUNT", "STATUS", "EXPIRES", "CHECKED", "DETAIL"])`; the status cell is a role-tagged segment: ready→`working` (done), invalid→`rejected` (failed), error→`not checked` (warn) |
| `Recheck complete.` | `line("done", "Rechecked your accounts")` |
| `Recheck failed. Is the daemon running?` (stderr, exit 1) | `out.fail({ title: "Could not recheck your accounts", why: "The rt daemon did not answer", next: cmd("rt daemon start") })`, exit 1 |
| JSON `{ ok: false, error: "Recheck failed. Is the daemon running?" }` and `formatAccountsJson` | `out.json(...)`; the error string stays (already plain, nothing reads it) |

### `commands/logins.ts`

| Site | Becomes |
|---|---|
| `No dev logins saved. Add one with: rt logins add <origin>` | `line("pending", "No dev logins saved yet")` + `callout("next", cmd("rt logins add <origin>"))` |
| `origin  email` rows | `table(rows.map(r => [r.origin, r.email]))` |
| `Saved/Replaced the dev login for <origin>` | `line("done", same words)` |
| `Opened mattstack to save a dev login for <origin>` | `line("done", same words)` |
| `Deleted the dev login for <origin>` / `No dev login saved for that site` | `line("done", …)` / `line("skipped", …)` |
| `exitUserError(err, json, verb, d.print)` | `d.json(userErrorPayload(err))` under `--json`, else `out.fail(userFailure(err, …))`; `process.exit(2)` (the `usage:` messages stay; the person sees "Which site?" with the command) |

### `commands/secrets.ts`

| Site | Becomes |
|---|---|
| `rt secrets set: usage: …` (stderr, exit 1) | `out.fail({ title: "Which secret?", next: cmd("rt secrets set <domain> <key>") })`, exit 1 |
| `rt secrets list: usage: …` | `out.fail({ title: "Which domain?", next: cmd("rt secrets list <domain>") })`, exit 1 |
| `rt secrets rotate: usage: …` (two lines) | `out.fail({ title: "Which secret?", why: "Name a domain and key, or a team alone to re-encrypt every file", next: cmd("rt secrets rotate <domain> <key>") })`, exit 1 |
| `reportSecretsError`: `rt secrets: <message>` (stderr, exit 1) | `out.fail({ title: err.message })`, exit 1 |
| `rt secrets set: wrote <team/>domain.key` | `line("done", "Saved the secret", "<team/>domain.key")` |
| `rt secrets list: no secrets set for domain "x"` | `line("pending", "No secrets in x yet")` |
| `Secrets for "x":` + `  name` | `section("Secrets in x", "N keys", table(names.map(n => [n])))` |
| `rt secrets rotate: no domain files to re-encrypt for team "t"` | `line("skipped", "No secret files to re-encrypt for team t")` |
| `rt secrets rotate: re-encrypted N file(s) for team "t":` + files + the `Note:` paragraph | `line("done", "Re-encrypted N files for team t")`, `verbatim(files)`, `callout("note", "Anyone already removed from the team keeps what they decrypted before. Re-encrypting stops future reads only.")` |
| `rt secrets rotate: secrets: rotate t/domain.key` | `line("done", "Rotated the secret", "t/domain.key")` |
| `rt secrets rotate: <commit message>` | `line("done", "Rotated the secret", "domain.key")` + `copy(message, "commit message")` |

### `lib/setup/` printers behind these verbs

| File | Finding |
|---|---|
| `lib/setup/finish-gate.ts:19` `console.error` default warn | `logCliEvent("warn", "setup.finish-gate", message)`: a resolver fault is log material, and the function runs under `--json` paths where stdout is the envelope |
| `lib/setup/team-settings.ts:59` `console.error` default warn | `logCliEvent("warn", "setup.team-settings", message)`, same reason |
| `lib/setup/steps/home.ts:47` | a comment that quotes a `console.error(...)` frame; reworded so the guard regex does not match |
| `lib/setup/validators/*.ts`, `lib/setup/steps/*.ts`, `lib/setup/uninstall.ts`, `lib/setup/tools-install.ts`, `lib/setup/pack.ts` (about 330 literal `detail`/`remedy` strings, 34 with a dash) | Every one is a `Row.detail` the tray displays or a `StepOutcome.detail`/`remedy` on the NDJSON stream: copy, by the 2026-10-01 ruling. Task 12 rewrites each to the wording in the copy table below and pins the result; the human view shows them as hints under titles. |
| `lib/setup/update.ts` `summarizeUpdate` | human-only; replaced by the emitter's summary and deleted |
| `lib/setup/update.ts` `updateNotification` | a notification body, not terminal output; untouched |

### Skill text scraped from these verbs

`grep` of `plugins/mattstack`, `skills/` and `apps/board/skills` for every old human string above found no reader. The `docs/superpowers/plans/*.md` hits are historical plans, not readers.

### Copy pass: every `detail` and `remedy` string (Task 12)

The rules, in the command-description style of `lib/command-tree-def.ts`: a short plain sentence, sentence case, no row or step id, no internal name (`home.init`, `rc block`, `legacy mrs`), no shell quoting or backticks, a command named plainly when it is what the person should run, the app's button names (`Retry`, `Re-check`) kept as written. Interpolated values stay interpolated. A `(s)` plural becomes a real plural (`${n === 1 ? "" : "s"}`; where the file already has a plural helper, use it). This plan carries no dash character, so a dash in today's string is written `[dash]` below. A row whose string only passes a value through (`v.detail`, `err.message`, `result.detail`, a joined list) is listed once per file as "passthrough". Line numbers are today's `main`.

#### `lib/setup/validators/access.ts`

| Line | Today | Becomes |
|---|---|---|
| 29 | `needs Apple's Command Line Tools first (see the tool row), then re-check` | `Needs Apple's Command Line Tools first. Install them, then Re-check` |
| 31 | `Connect your ${forge} account so rt can prove access` | unchanged |
| 33 | `your ${forge} account cannot see this repo yet: ask ${ctx.grantedBy} or your org admin to grant read access` | `Your ${forge} account cannot see this repo yet. Ask ${ctx.grantedBy} or your org admin for read access` |
| 51 | `no team remote yet (screen 2)` | `No team repo yet. Create or join a team first` |
| 69 | `no forge configured yet` | `No forge chosen yet` |
| 91 | `your team declares forge host "${declaredHost}" [dash] unverified; confirm it yourself before rt reaches out to it` | `Your team uses ${declaredHost}. Confirm that address before rt connects to it` |
| 95 | `${confirmedHost} reachable (status ${res.status})` | `Reached ${confirmedHost} (HTTP ${res.status})` |
| 96, 137 | `couldn't reach ${host} [dash] check your network or proxy` | `Could not reach ${host}. Check your network or proxy` |
| 132 | `your team declares switchboard at "${declaredUrl}" [dash] unverified; confirm it yourself before rt reaches out to it` | `Your team's switchboard is at ${declaredUrl}. Confirm that address before rt connects to it` |
| 136 | `reachable` | `Reachable` |
| 138 | `switchboard /healthz returned ${res.status}` | `The switchboard answered HTTP ${res.status} to its health check` |
| 27, 35 | passthrough (`v.detail`) | |

#### `lib/setup/validators/repo-root.ts`

| Line | Today | Becomes |
|---|---|---|
| 13 (`CLI_HINT`) | `or run rt setup repo-root set <folder>` | unchanged |
| 49 | `choose where rt should clone your team's repos (${CLI_HINT})` | `Choose the folder rt clones your team's repos into (${CLI_HINT})` |
| 54 | `${check.detail} (${CLI_HINT})` | unchanged |
| 56 | `${check.path} ... ${check.tccWarning}` | `${check.path}. ${check.tccWarning}` |

#### `lib/setup/validators/accounts.ts`

| Line | Today | Becomes |
|---|---|---|
| 166 | `via gh (${user})` / `via gh` | `Signed in through the gh CLI as ${user}` / `Signed in through the gh CLI` |
| 168 | `no GitHub account connected (gh CLI not installed)` / `no GitHub account connected` | `No GitHub account connected yet, and the gh CLI is not installed` / `No GitHub account connected yet` |
| 185 | `waiting on the team's Slack app (see account.slack-app)` | `Waiting for the team's Slack app to be set up` |
| 191 | `no Slack account connected. ${hint}` | `No Slack account connected yet. ${hint}` |
| 196 | `reconnect Slack to grant: ${missing.join(", ")}` | `Reconnect Slack to grant these permissions: ${missing.join(", ")}` |
| 218 | `${result.detail}; you confirmed "${ctx.host}", this team declares "${ctx.declaredHost}". Confirm it to use it instead` | `${result.detail}. You confirmed ${ctx.host}, but this team uses ${ctx.declaredHost}. Confirm the team's address to switch` |
| 234 (`REINVITE`) | `the team's owner to re-invite your board: rt team invite --handle <your forge username>` | `the team's owner to invite you again (rt team invite --handle <your forge username>)` |
| 261 | `you joined ${teams} by invite, but this machine's board has no switchboard token, so it does not peer: ask ${REINVITE}` | `You joined ${teams} by invite, but this Mac's board has no switchboard token, so it cannot peer. Ask ${REINVITE}` |
| 264 | `could not read your secrets store (${peering.error}) to check your board's switchboard token` | `Could not read your secrets store to check the board's switchboard token (${peering.error})` |
| 266 | `your board holds a switchboard token` | `Your board holds a switchboard token` |
| 287 | `no ${def.title} account connected` | `No ${def.title} account connected yet` |
| 362 | `${r.detail} (expires in ${days} day${s}, ${health.expiresAt})` | `${r.detail}. Expires in ${days} day${s}, on ${health.expiresAt}` |
| 369 | `last checked ${ago} ago: ${health.status} (${health.detail})` | `Last checked ${ago} ago, ${CREDENTIAL_STATUS_WORD[health.status]}: ${health.detail}`, importing the one map Task 9 exports from `lib/credential-health/status-word.ts` (`working`, `rejected`, `not checked`), the same words `rt accounts` shows |
| 415 | `the team has no Slack app yet` | `The team has no Slack app yet` |
| 174, 179, 197, 198, 210, 214, 274, 284, 290, 291, 312, 398 | passthrough (`result.detail`, `short`, `err.message`) | |

#### `lib/setup/validators/mac.ts`

| Line | Today | Becomes |
|---|---|---|
| 31 | `Could not determine your macOS version` | `Could not read your macOS version` |
| 33 | `macOS ${version}` | unchanged |
| 34 | `macOS 14 or newer required` | `rt needs macOS 14 or newer` |
| 45, 51 | `Apple command line tools not installed` | `Apple's Command Line Tools are not installed` |
| 49 | `git installed` (fallback) | `Git is installed` |
| 68 | `Could not determine your processor` | `Could not read your processor type` |
| 70 | `Apple silicon (arm64)` | unchanged |
| 71 | `${arch}: Apple silicon (arm64) required` | `This Mac is ${arch}; rt needs Apple silicon` |
| 83 | `~/.local/bin is first on PATH (${RC_FILE_DISPLAY})` | `~/.local/bin is first on your PATH, set in ${RC_FILE_DISPLAY}` |
| 86 | `~/.local/bin is on PATH but not first [dash] team intercept shims may not fire (${RC_FILE_DISPLAY})` | `~/.local/bin is on your PATH but not first, so team intercepts may not fire. Check ${RC_FILE_DISPLAY}` |
| 93 | `~/.local/bin is first on PATH, but not via rt's own ${RC_FILE_DISPLAY} entry` | `~/.local/bin is first on your PATH, but not through rt's own entry in ${RC_FILE_DISPLAY}` |
| 95 | `Install adds ~/.local/bin to PATH (${RC_FILE_DISPLAY})` | `Install adds ~/.local/bin to your PATH in ${RC_FILE_DISPLAY}` |

#### `lib/setup/validators/rt-health.ts`

| Line | Today | Becomes |
|---|---|---|
| 69 | `installed in ${editors}` | `Installed in ${editors}` |
| 70 | `not installed in ${dirsFound} [dash] run: rt settings extension` | `Not installed in ${dirsFound}. Run rt settings extension` |
| 71 | `no editor extensions directories found` | `No editor extension folders found` |
| 119 | `${firstLine} at ~/.local/bin (PATH entry added by Install)` | `${firstLine} at ~/.local/bin, which Install added to your PATH` |
| 121 | `rt not found on PATH` | `rt is not on your PATH yet` |
| 123 | `could not run rt (exit ${res.code})` | `Could not run rt (exit ${res.code})` |
| 138 | `mattstack-dev.app's source wrapper owns ~/.local/bin/rt` | `The dev app's source wrapper owns ~/.local/bin/rt` |
| 142 | `mattstack.app not found [dash] nothing to link into` | `mattstack.app not found, so there is nothing to link into` |
| 146 | `linked into the bundle` | `Linked into mattstack.app` |
| 153 | `not a link into mattstack.app [dash] run: rt deps link rt` | `Not a link into mattstack.app. Run rt deps link rt` |
| 164 | `real legacy dir${plural} present: ${list} [dash] rt reads only ${RT_DIR_LABEL}` | `Old folder${plural} still present: ${list}. rt reads only ${RT_DIR_LABEL}` |
| 169 | `compat symlink still present: ${list}` | `Old-location links still present: ${list}` |
| 171 | `state lives only in ${RT_DIR_LABEL}` | `State lives only in ${RT_DIR_LABEL}` |
| 190 | `check failed: ${message}` | `The check failed: ${message}` |
| 193 | `Not needed: your team declares no intercepts` | `Not needed: your team has no intercepts` |
| 203 | `declared but not installed: ${cmds} [dash] run rt intercept install${pathNote}` | `Not installed yet: ${cmds}. Run rt intercept install${pathNote}` |
| 206 | `stale shim content: ${cmds} [dash] run rt intercept install${pathNote}` | `Out of date: ${cmds}. Run rt intercept install${pathNote}` |
| 209 | `shims installed but ${binDir} is not on PATH [dash] intercepts will not fire` | `Installed, but ${binDir} is not on your PATH, so intercepts will not fire` |
| 212 | `shims are current but the rules cache is stale (${reason}) [dash] run rt intercept install` | `Installed, but the rules are out of date (${reason}). Run rt intercept install` |
| 214 | `${n} installed and current` | `${n} installed and up to date` |
| 227 | `mattstack.app not found in /Applications or ~/Applications` | `mattstack.app is not in /Applications or ~/Applications` |
| 232, 235 | `${root} (v${version})` then ` [dash] old bundle still present: ${hits}` | `${root} (v${version})` unchanged; the suffix becomes `. An old copy is still present: ${hits}` |
| 250 | `mattstack.app not found` | unchanged |
| 253 | `bundled extension present` | `The extension ships in the app` |
| 254 | `extension not bundled (pre-bundle build)` | `This build does not ship the extension` |
| 288 | `rtcd alias in ${rc}` | `The rtcd alias is in ${rc}` |
| 292 | `remove the old rt block from ${rc} by hand, then re-check` | `Remove the old rt block from ${rc} by hand, then Re-check` |
| 294 | `shell integration not added yet` | `Shell integration not added yet` |
| 296 | `unrecognized shell, so rt can't write shell integration automatically; add the rtcd alias yourself` | `rt does not know this shell, so add the rtcd alias yourself` |
| 313 | `not registered yet` | `Not registered yet` |
| 315 | `not booted (expected in CI)` | `Not running (expected in CI)` |
| 316 | `installed but not responding; approve in Login Items` | `Installed but not responding. Approve it in Login Items` |
| 387 | `${cli} CLI · daemon n/a` | `${cli} CLI, no daemon` |
| 390 | `${cli} CLI and daemon` | unchanged |
| 396 | `a ${daemonFlavor} daemon answers this ${cli} CLI; open ${app} (quit it first if it is running)` | `A ${daemonFlavor} daemon is answering this ${cli} CLI. Open ${app}, quitting it first if it is running` |
| 460 | `no home repo found yet... nothing to back up` | `No home repo yet, so nothing is backed up` |
| 466 | `no commits yet [dash] nothing is versioned or backed up` | `No commits yet, so nothing is versioned or backed up` |
| 470 | `local only [dash] your settings are versioned on this machine but are not backed up anywhere (rt home remote set <url>, or --create)` | `Local only: your settings are versioned on this Mac but backed up nowhere. Run rt home remote set <url>, or rt home remote set --create` |
| 474 | `remote configured, nothing pushed yet` | `Remote set, nothing pushed yet` |
| 475 | `could not determine push status [dash] the rev-list check failed` | `Could not tell whether the remote is up to date` |
| 483 | `${n} commit(s) not pushed${why ? ` [dash] the last push failed: ${why}` : ""}` | `${n} commit${s} not pushed${why ? `. The last push failed: ${why}` : ""}` |
| 494 | `${n} commit(s) queued for backup, pushes automatically within about ${sec}s` | `${n} commit${s} waiting to back up; pushes within about ${sec} seconds` |
| 498 | `${n} commit(s) not pushed; the backup daemon should have pushed by now` | `${n} commit${s} not pushed, and the backup should have run by now` |
| 505 | `in sync [dash] last pushed ${when}` | `Backed up, last pushed ${when}` |
| 506 | `in sync [dash] last commit ${when}` | `Backed up, last commit ${when}` |
| 515 (`FIRST_PULL_PENDING`) | `waiting for a first pull` | `Waiting for a first pull` (through the constant only; `isTeamSyncFirstPullPending` reads the same constant) |
| 543 | `off: rt.teamSnapshot.enabled is false, so clones move only when you run rt team pull or rt team publish` | `Off: team sync is disabled in settings, so clones move only when you run rt team pull or rt team publish` |
| 547 | `rt daemon not reachable; team clones sync once it is running` | `The rt daemon is not running. Team clones sync once it is` |
| 555 | `${slug}: not watched (no origin?)` | `${slug}: not watched (it has no origin remote)` |
| 562 | `reset it to origin or ask the team's owner` / `rebase and rt team publish by hand` | unchanged / `rebase it and run rt team publish` |
| 563 | `${slug}: rebase conflict: ${detail}; ${remedy}` | `${slug}: a rebase conflict (${detail}); ${remedy}` |
| 576 | `${slug}: pull-only clone cannot fast-forward (${skipped}); reset it to origin or ask the team's owner` | `${slug}: cannot fast-forward (${skipped}); reset it to origin or ask the team's owner` |
| 588 | `${slug}: push failing: ${err || "push failed"}` | `${slug}: pushes are failing: ${err || "push failed"}` |
| 592 | `${slug}: fetch failing: ${err || "fetch failed"}` | `${slug}: fetches are failing: ${err || "fetch failed"}` |
| 597 | `${slug}: no pull yet` | `${slug}: not pulled yet` |
| 601 | `${slug}: last pull ${n} min ago` | `${slug}: last pulled ${n} minutes ago` |
| 606 | `${FIRST_PULL_PENDING}: ${list}` / `problems.join("; ")` | unchanged |
| 614 to 616 | `${n} clone${s} in sync` + `; pull-only, never pushes: ${list}` + `; last pull skipped: ${list}` | `${n} clone${s} in sync` + `. Pull-only, never pushes: ${list}` + `. Last pull skipped: ${list}` |
| 112, 267 to 269, 358 to 362 | passthrough (`firstLine(res.stdout)`, `result.detail`, joined service words) | |

#### `lib/setup/validators/tools.ts`

| Line | Today | Becomes |
|---|---|---|
| 106 | `herdr not found` | `herdr is not installed` |
| 107 | `herdr --version timed out` | `herdr did not answer in time` |
| 108 | `could not run herdr (exit ${code})` | `Could not run herdr (exit ${code})` |
| 112 | `herdr ${version} < ${HERDR_FLOOR}` | `herdr ${version} is older than ${HERDR_FLOOR}` |
| 116 | `herdr integration status timed out` | `herdr's integration check did not answer in time` |
| 117 | `could not check herdr integration status (exit ${code})` | `Could not check herdr's Claude integration (exit ${code})` |
| 120 | `could not determine herdr's Claude integration status` | `Could not tell whether herdr's Claude integration is installed` |
| 121, 128 | `herdr ${version}, Claude integration installed` / `... ${claude.state}` | unchanged |
| 139 | `claude not found` | `Claude Code is not installed` |
| 140 | `claude --version timed out` | `Claude Code did not answer in time` |
| 141 | `could not run claude (exit ${code})` | `Could not run Claude Code (exit ${code})` |
| 145 | `claude auth status timed out` | `Claude Code's sign-in check did not answer in time` |
| 156 | `claude ${version}, signed in` | `Claude Code ${version}, signed in` |
| 157, 171 | `sign in: run claude once` | `Not signed in yet. Run claude once and sign in` |
| 168 | `claude ${version} installed, sign-in could not be checked [dash] confirm you're signed in` | `Claude Code ${version} is installed, but the sign-in could not be checked. Confirm you are signed in` |
| 172 | `claude auth status returned an unexpected response` | `Claude Code's sign-in check gave an unexpected answer` |
| 276 | `fast-browser not found` | `Fast Browser is not installed` |
| 282 | `fast-browser doctor report has no runtime-checksum check` | `Fast Browser's doctor report has no runtime check. Update Fast Browser` |
| 283 | `runtime not ready` | `The runtime is not ready yet` |
| 289 | `fast-browser doctor report has no data-permissions check` | `Fast Browser's doctor report has no permissions check. Update Fast Browser` |
| 290 | `runtime ok, but setup needs to run again` | `The runtime is ready, but setup needs to run again` |
| 291 | `the fast-browser command runs a copy that no longer exists` | `The fast-browser command points at a copy that no longer exists` |
| 292 | `runtime ok` | `Ready` |
| 320 (`DOCTOR_CHECK_MISSING_REMEDY`) | `update Fast Browser, then Re-check` | unchanged |
| 353 | `no Google Chrome to load it into` | `Google Chrome is not installed, so there is nothing to load it into` |
| 356 | `fast-browser doctor could not be read (see Fast Browser)` | `Fast Browser's doctor report could not be read. See the Fast Browser row` |
| 359, 367, 377 | `fast-browser doctor report has no <x> check; ${REMEDY}` | `Fast Browser's doctor report has no <x> check; ${REMEDY}` (x: `extension`, `extension-loaded`, `pairing`) |
| 363 | `mattstack can't read Chrome's profile; grant Full Disk Access to mattstack.app, or skip if Fast Browser shows in chrome://extensions` | `mattstack cannot read Chrome's profile. Grant Full Disk Access to mattstack.app, or skip this if Fast Browser shows in chrome://extensions` |
| 364 | `not installed in Chrome` (fallback) | `Not installed in Chrome` |
| 370 | `not loaded in Chrome` | `Not loaded in Chrome` |
| 378 | `loaded but not paired` | `Loaded in Chrome but not paired yet` |
| 379 | `loaded and paired` | `Loaded and paired` |
| 395 | `no editor found (works without this)` | `No editor found. rt works without one` |
| 413 | `Google Chrome installed` | unchanged |
| 414 | `Google Chrome not found` | `Google Chrome is not installed` |
| 428 (`optionalNote`) | `Can't be checked automatically [dash] confirm by hand.` | `Cannot be checked automatically; confirm it by hand.` |
| 431 | `Confirm Chrome is signed into ${profile}` | unchanged |
| 466 | `defaults read timed out` | `The keyboard shortcut check did not answer in time` |
| 467 | `could not read Keyboard shortcut settings` | `Could not read your keyboard shortcut settings` |
| 469 | `Control+Up is free for rt's nav picker` | `Control+Up is free for rt's picker` |
| 470 | `Control+Up is bound to Mission Control (rt nav uses it)` | `Control+Up opens Mission Control, and rt's picker needs it` |
| 511 | `${req.name} not found` | `${req.name} is not installed` |
| 512 | `${req.name} --version timed out` | `${req.name} did not answer in time` |
| 513 | `could not run ${req.name} (exit ${code})` | `Could not run ${req.name} (exit ${code})` |
| 517 | `${req.name} ${version} < ${req.floor}` | `${req.name} ${version} is older than ${req.floor}` |
| 519 | `${req.name} ${version}` | unchanged |
| 542, 590 | `claude not installed` | `Claude Code is not installed` |
| 543, 591 | `claude plugin list timed out` | `Claude Code's plugin list did not answer in time` |
| 547, 592 | `claude plugin list failed (exit ${code})` | `Could not list Claude Code's plugins (exit ${code})` |
| 550, 595 | `claude plugin list --json output could not be read` | `Claude Code's plugin list could not be read` |
| 556 | `version unknown; rt does not track this source's version` | `Version unknown; rt does not track this source's version` |
| 558 | `not installed yet` | `Not installed yet` |
| 562 | `installed ${installed}, team serves ${served}` | `Installed ${installed}; the team serves ${served}` |
| 566 | `installed` | `Installed` |
| 568 | `installed version unknown, served version unknown` / `${installed} installed, served version unknown` | `Installed, version unknown` / `${installed} installed; the served version is unknown` |
| 571 | `installed version unknown, team serves ${served}` | `Installed, version unknown; the team serves ${served}` |
| 600 | `not installed: ${list}` | `Not installed: ${list}` |
| 606 | `disabled: ${list}` | `Disabled: ${list}` |
| 608 | `${n} plugins installed` | unchanged |
| 633 | `not installed` | `Not installed` |
| 639 | `An existing portless install predates mattstack; Update proxy adopts it` | `A portless install from before mattstack is present. Update proxy adopts it` |
| 643 | `${PROXY_VERSION_PATH} could not be read` | `Could not read ${PROXY_VERSION_PATH}` |
| 646 | `bundle's deps.lock has no pinned portless version` | `This build does not pin a portless version` |
| 648 | `proxy runs portless ${deployed}, bundle pins ${pinned}` | `The proxy runs portless ${deployed}; this build ships ${pinned}` |
| 656 | `Browsers will warn until the proxy certificate is trusted` | unchanged |
| 631, 658 | `portless ${version}` | unchanged |
| 687 | `not found: ${list}` | `Not installed: ${list}` |
| 702, 704, 707 | `${bundled} from mattstack.app`; `${onPath} from your own copies on PATH`; both joined with `; ` | `on PATH` becomes `on your PATH`; otherwise unchanged |
| 727 | `${path} is not valid JSON` | unchanged |
| 728 | `${path} could not be read` | `Could not read ${path}` |
| 731 | `linear` | `Linear is set up in Claude Code` |
| 732 | `a server named linear is not a Linear MCP` | `Claude Code has a server named linear that is not Linear's` |
| 750 | `${present}; linear is not added yet, and skills call mcp__linear__*` | `${present}. Linear is not added to Claude Code yet, and the skills need it` |
| 751 | `${present}; connect Linear so Install can add linear` | `${present}. Connect Linear so Install can add it to Claude Code` |
| 754 | `no Linear account connected` | `No Linear account connected yet` |
| 755 | `Linear is connected but not added to Claude Code yet` | unchanged |
| 279, 364 (`doctorText`), 396, 540, 575, 743, 802 | passthrough (doctor text, editor names, `req.error`, `err.message`, `served.error`) | |

#### `lib/setup/validators/writing-style.ts`

| Line | Today | Becomes |
|---|---|---|
| 42 | `You'll choose this after Install` | `You choose this after Install` |
| 46 | `Not chosen yet` | unchanged |
| 50 | `${skill} is in a disabled plugin: enable ${plugin}` / `${skill} is not installed here` | `${skill} is in the disabled plugin ${plugin}. Enable it` / `${skill} is not installed on this Mac` |
| 53 | `${label} (${source})` | unchanged |
| 67 | `could not read the writing style: ${msg}` | `Could not read the writing style: ${msg}` |

#### `lib/setup/steps/claude-permissions.ts`

| Line | Today | Becomes |
|---|---|---|
| 33 | `${path} is not valid JSON`; remedy `Fix or remove that file, then Retry.` | unchanged |
| 36 | `${path} could not be read`; remedy `Check that file's permissions, then Retry.` | `Could not read ${path}`; remedy unchanged |
| 57 | `baseline permissions already present` | `Baseline permissions already present` |
| 59 | `added baseline permissions to ${n} config dir(s)` | `Added baseline permissions to ${n} Claude config folder${s}` |

#### `lib/setup/steps/deck.ts`

| Line | Today | Becomes |
|---|---|---|
| 76 | `board already adopted` | `Board already adopted` |
| 82 | `no legacy mrs to adopt` | `No old board data to adopt` |
| 87 | `deck stopped responding before it could adopt board`; remedy `Start deck, then Retry` | `Deck stopped answering before it could adopt the board`; remedy unchanged |
| 89 | fallback `deck adopt exited ${code}`; remedy `Retry` | `Deck's adopt exited ${code}`; remedy unchanged |
| 122 | `app defaults untouched (not an install)` | `App defaults left as they are (not an install)` |
| 124 | `app defaults not applied (deck answered ${status})` | `App defaults not applied: deck answered ${status}` |
| 129 | `app defaults not applied (unreadable app list)` | `App defaults not applied: the app list could not be read` |
| 135 | `no team-only apps` | `No team-only apps` |
| 148 | `app defaults not applied; failed: ${list}` | `App defaults not applied for ${list}` |
| 150 | `team apps on: ${names}` / `solo: ${names} off` | `Team apps on: ${names}` / `Solo setup: ${names} off` |
| 155 | `deck not bundled yet` | `Deck is not in this build yet` |
| 166 | `deck is not running and mattstack.app is not there to start it [dash] open the app, then Retry` | `Deck is not running and mattstack.app is not there to start it. Open the app, then Retry` |
| 168 | `deck is not answering its own /healthz [dash] cannot adopt board safely`; remedy `Start deck, then Retry` | `Deck is not answering its health check, so the board cannot be adopted safely`; remedy unchanged |
| 173 | `board adopted from legacy mrs, ${repoint}` | `Board adopted from the old data, ${repoint}` |
| 175 | `deck ready; ${adoptDetail}; ${defaults.detail}` | `Deck is ready. ${adoptDetail}. ${defaults.detail}` |

#### `lib/setup/steps/git-identity.ts`

| Line | Today | Becomes |
|---|---|---|
| 22 (`MANUAL`) | `run git config --global user.name / user.email` | `set it with git config --global user.name and user.email` |
| 43 | `already configured: ${name} <${email}>` | `Already set: ${name} <${email}>` |
| 46 | `no forge connected; ${MANUAL}` | `No forge account connected; ${MANUAL}` |
| 49 | `forge profile unavailable; ${MANUAL}` | `Your forge profile could not be read; ${MANUAL}` |
| 51 | remedy `Check that ~/.gitconfig is writable, then Retry` | unchanged |
| 54, 58, 61 | passthrough | |

#### `lib/setup/steps/home.ts`

| Line | Today | Becomes |
|---|---|---|
| 78 | `already initialized` | `Already set up` |
| 86, 165 | `local age key check failed: ${msg}`; remedy `Unlock your keychain, then Retry` | `Could not check your local age key: ${msg}`; remedy unchanged |
| 155 | `restored` | `Restored` |
| 172 | `the home repo clone or its local age key could not be confirmed at ${path}` | `Could not confirm the home repo or its age key at ${path}` |
| 173 | remedy `Run \`rt setup intent restore <org>/<repo>\`, then \`rt home key import\` to paste your age key, then Retry` | `Run rt setup intent restore <org>/<repo>, then rt home key import to paste your age key, then Retry` |
| 92, 95 | passthrough (`lastLine`, `failureDetail(stderr)`, `homeInitRemedy(stderr)`); the literals inside `failureDetail` and `homeInitRemedy` follow the same rules if they carry a dash or an id (Step 6's grep is the gate) | |

#### `lib/setup/steps/path.ts`, `lib/setup/steps/index.ts`

| Line | Today | Becomes |
|---|---|---|
| path.ts 92 | `${base} · ${notes.join(" · ")}` | `${base}. ${notes.join(". ")}` |
| index.ts 34 to 36 | `no commands to shim` / `${total} shims${skipped ? ` · skipped (occupied): ${list}` : ""}` | `No commands to intercept` / `${total} intercept${s}${skipped ? `; left alone because another tool owns them: ${list}` : ""}` |

#### `lib/setup/steps/plugins.ts`

| Line | Today | Becomes |
|---|---|---|
| 49 (`RETRY_REMEDY`) | `Open Claude Code once so it finishes first-run, then Retry.` | unchanged |
| 231, 234 | `claude not found (not bundled, no user copy on PATH)`; remedy `Install Claude Code (Tools row), then Retry.` | `Claude Code is not installed (not in this build, and no copy on your PATH)`; remedy `Install Claude Code from the Tools section, then Retry.` |
| 288, 289 | `a mattstack marketplace from ${source} is already registered`; remedy `Run \`claude plugin marketplace remove mattstack\`, then Retry.` | `A mattstack marketplace from ${source} is already registered`; remedy `Run claude plugin marketplace remove mattstack, then Retry.` |
| 295 | fallback `claude plugin marketplace add exited ${code}` | `Adding the marketplace failed (exit ${code})` |
| 313, 314 | `claude plugin list --json could not be read`; remedy `Update Claude Code, then Retry.` | `Claude Code's plugin list could not be read`; remedy unchanged |
| 359 | `claude plugin update exited ${code}` | `Updating plugins failed (exit ${code})` |
| 384 | `claude plugin install exited ${code}` / `claude plugin ${plugin}: ${detail}` | `Installing plugins failed (exit ${code})` / `${plugin}: ${detail}` |
| 415 | `${m} marketplace(s), ${n} plugin(s) across ${d} config dir(s) · ${materializeDetail}${pendingNote}` | `${m} marketplace${s}, ${n} plugin${s} across ${d} Claude config folder${s}. ${materializeDetail}${pendingNote}` |

#### `lib/setup/steps/repos.ts`

| Line | Today | Becomes |
|---|---|---|
| 193 | `no repos to clone` | `No repos to clone` |
| 203 | `no repo root chosen yet ... run rt setup repo-root set <folder>, then re-run rt setup apply to clone your tracked repos` | `No repo folder chosen yet. Run rt setup repo-root set <folder>, then rt setup apply again to clone your repos` |
| 262 | `${tally} (${failed})` | `${tally}. Failed: ${failed}` |
| 263 | remedy `The step log says why. Retry this step once that is fixed (rt setup apply --from repos.clone). If you already have a clone, run rt repos register <path> first and rt uses it instead of cloning again.` | `The step log says why. Fix that, then Retry. If you already have a clone, run rt repos register <path> first and rt uses it instead of cloning again.` |
| 259 | passthrough (`tally`) | |

#### `lib/setup/steps/settings.ts`, `lib/setup/steps/services.ts`, `lib/setup/steps/secrets.ts`, `lib/setup/steps/step-utils.ts`, `lib/setup/steps/verify.ts`, `lib/setup/steps/linear-mcp.ts`

| Line | Today | Becomes |
|---|---|---|
| settings.ts 38, 39 | `running from ${path} [dash] drag mattstack.app to /Applications, then Retry`; remedy `Move mattstack.app to /Applications and relaunch it` | `Running from ${path}. Drag mattstack.app to /Applications, then Retry`; remedy unchanged |
| settings.ts 53 | `wrote: ${list}` / `nothing to seed` | `Wrote ${list}` / `Nothing to write` |
| services.ts 92 (`PROXY_INSTALLER_MISSING`) | `this build does not include the local proxy installer; apps serve on their ports` | `This build has no local proxy installer, so apps serve on their own ports` |
| services.ts 136 | `already installed` | `Already installed` |
| services.ts 160 | `${PROXY_VERSION_PATH} could not be read` | `Could not read ${PROXY_VERSION_PATH}` |
| services.ts 196 | `certificate not trusted (${trust}); browsers will warn until it is` | `The certificate is not trusted yet (${trust}); browsers will warn until it is` |
| secrets.ts 42 | `nothing staged` / `${count} staged secrets written` | `Nothing to write` / `Wrote ${count} secret${s}` |
| secrets.ts 45 | remedy `home.init did not mint a key [dash] Retry from home.init` | `Your home repo has no age key yet. Retry from the home repo step` |
| secrets.ts 52 | `${err.message} Nothing was written.` | unchanged |
| step-utils.ts 50, 53 | `Quit mattstack.app, then Retry`; `Run rt setup apply from a terminal, or use the row's button in mattstack.app` | unchanged |
| verify.ts 64, 65 | `${n} check${s} failed: ${names}${note ? ` · ${note}` : ""}`; remedy `Run \`rt verify\` for details` | `${n} check${s} failed: ${names}${note ? `. ${note}` : ""}`; remedy `Run rt verify for details` |
| verify.ts 70 | `${n} check${s} passed` | unchanged |
| linear-mcp.ts 19 | `${path} is not valid JSON`; remedy `Fix or remove that file, then Retry.` | unchanged |
| linear-mcp.ts 22 | `${path} could not be read` | `Could not read ${path}` |
| linear-mcp.ts 27 | `already configured` | `Already set up` |
| linear-mcp.ts 30 | `no Linear key stored (connect Linear, then Retry)` | `No Linear account connected yet. Connect Linear, then Retry` |
| linear-mcp.ts 35 | `added linear to ${path}` | `Added Linear to ${path}` |

#### `lib/setup/steps/skills.ts`

| Line | Today | Becomes |
|---|---|---|
| 76 | `linked personal skills only (not running from an app bundle)${note}` / `not running from an app bundle` | `Linked your personal skills only; rt is not running from the app${note}` / `rt is not running from the app` |
| 83 | `bundle ships no skills${note}` / `bundle ships no skills` | `The app ships no skills${note}` / `The app ships no skills` |
| 88 | `linked ${total} skill(s) from ${n} app(s)${note}` | `Linked ${total} skill${s} from ${n} app${s}${note}` |
| 243 | `wrote: ${list}` / `nothing to write` | `Wrote ${list}` / `Nothing to write` |
| 267 | `board.reReview not registered` | `The board's re-review hook is not registered` |
| 270 | `board.reReview disabled` | `The board's re-review hook is off` |
| 276 | `board binary not found [dash] resolve it first (\`rt deps resolve board\`)` | `The board binary was not found. Run rt deps resolve board first` |
| 280 | `installed board-triage` | `Installed the board triage skill` |
| 42, 45 | passthrough (`result.reason`, `materializeTally`) | |

#### `lib/setup/steps/team.ts`

| Line | Today | Becomes |
|---|---|---|
| 52 | `no git remote available (set RT_TEAM_REMOTE or run gh auth login)` | `No git remote available. Sign in with gh auth login, or set RT_TEAM_REMOTE` |
| 72 | remedy `Check your push access to the team repo, then Retry` | unchanged |
| 94, 96 | remedy `Ask the owner to grant access, then Retry`; `Check your network, then Retry` | unchanged |
| 105 | remedy `Unlock your keychain, then Retry [dash] the invite is already redeemed, so Retry resumes here without a new code` | `Unlock your keychain, then Retry. The invite is already redeemed, so Retry resumes here without a new code` |
| 112 | remedy `Fix the secrets store (Retry from home.init if it never ran), then Retry: the invite is already redeemed, so Retry resumes here without a new code` | `Fix the secrets store (Retry from the home repo step if it never ran), then Retry. The invite is already redeemed, so Retry resumes here without a new code` |
| 116 | remedy `Retry from home.init (or run \`rt home init\`), then Retry: no new code needed` | `Retry from the home repo step, or run rt home init, then Retry. No new code is needed` |
| 122 | `already joined [dash] no invite in progress` | `Already joined; no invite in progress` |
| 63, 69, 73, 89, 91, 104, 111, 118 | passthrough (`err.message`, `published.detail`, `result.message`, `result.peeringFix`) | |

#### `lib/setup/steps/tools.ts`

| Line | Today | Becomes |
|---|---|---|
| 38 | `fast-browser not bundled` | `Fast Browser is not in this build` |
| 50 | `no Claude Code or Codex host detected [dash] nothing to integrate with` | `No Claude Code or Codex found, so there is nothing to integrate with` |
| 52 | remedy `Run \`fast-browser setup\` in a terminal for details` | `Run fast-browser setup in a terminal for details` |
| 76 | `herdr not installed (Tools row)` | `herdr is not installed (see the Tools section)` |
| 81 | remedy `Run \`herdr integration install claude\` in a terminal for details` | `Run herdr integration install claude in a terminal for details` |
| 110 | `extension not bundled` | `The extension is not in this build` |
| 111 | `no editor found` | `No editor found` |
| 112 | `no editor rt installed the extension into` | `No editor that rt installed the extension into` |
| 113 | remedy `Install the extension manually, then Retry` | unchanged |
| 165, 166 | `mattstack.app not running`; remedy `Open mattstack.app` | `mattstack.app is not running`; remedy unchanged |
| 169 | `mattstack.app returned status ${status} starting the daemon`; remedy `Open mattstack.app` | `mattstack.app answered ${status} when asked to start the daemon`; remedy unchanged |
| 173 | `daemon running` | `The daemon is running` |
| 174 | `daemon did not come up`; remedy `Approve the background item in Login Items, then Retry` | `The daemon did not start`; remedy unchanged |
| 213 | `snapshot deferred to the daemon's next cycle (daemon unreachable)` | `The daemon is not running; the snapshot runs on its next cycle` |
| 217 | fallback `home:snapshot reported failure`; remedy `check \`git -C ~/.mattstack/user status\`` | `The snapshot failed`; remedy `Run git -C ~/.mattstack/user status to see why` |
| 221 | `snapshot skipped: ${reason}` | `Snapshot skipped: ${reason}` |
| 222 | `no changes to snapshot` | `No changes to snapshot` |
| 229 | `committed ${sha} [dash] push follows on the daemon's next cycle` / `committed ${sha} locally [dash] no remote, nothing pushed` | `Committed ${sha}; the daemon pushes it on its next cycle` / `Committed ${sha} on this Mac only; there is no remote to push to` |
| 41, 80, 109 | passthrough (`result.detail`) | |

#### `lib/setup/pack.ts`

| Line | Today | Becomes |
|---|---|---|
| 15 (`NO_MANIFEST_DETAIL`) | `no bindings file for this pack yet; run rt skills materialize` | `This pack has no bindings file yet. Run rt skills materialize` (`commands/setup.ts` compares the constant, so it follows) |
| 18 (`AWAITING_CLONE_NOTE`) | `waiting on a repo clone to check the pipeline` | `the pipeline check waits for a repo clone` |
| 64 | `${plugins}; ${AWAITING_CLONE_NOTE}` | unchanged |
| 75 | `${repo} has no git remote; no pipeline to check` | `${repo} has no git remote, so there is no pipeline to check` |
| 76 | `no team pack declares ${repo}; no pipeline to check` | `No team pack covers ${repo}, so there is no pipeline to check` |
| 84 | `stage "${stage}" is unresolved` | `The ${stage} stage has no skill bound to it` |
| 86 | `${n} stage(s) resolved for "${workType}"` | `${n} stage${s} resolved for ${workType} work` |
| 49, 52, 73 | passthrough | |

#### `lib/setup/tools-install.ts`

| Line | Today | Becomes |
|---|---|---|
| 128, 164 | `Command Line Tools already installed` | unchanged |
| 148 | `installed "${label}" headlessly [dash] ${git}` | `Installed ${label}; ${git}` |
| 156 | `xcode-select --install timed out` | `The Command Line Tools installer did not answer in time` |
| 160 | `triggered the Command Line Tools install dialog [dash] complete it, then re-run rt setup status` | `Opened Apple's Command Line Tools installer. Finish it, then run rt setup status again` |
| 166 | `xcode-select --install failed (exit ${code}): ${line}` | `The Command Line Tools installer failed (exit ${code}): ${line}` |
| 227 | `${label} timed out` | `${label} did not finish in time` |
| 228 | `${label} failed (exit ${code}): ${line}` | unchanged |
| 232 | `${label} exited 0 but "${tool} --version" still fails (exit ${code}) [dash] not claiming success` | `${label} finished, but ${tool} still does not run (exit ${code})` |
| 243 | `install URL is not a valid URL: ${url}` | `The install URL is not valid: ${url}` |
| 245 | `install URL must be https, got "${protocol}" (${url})` | `The install URL must use https, not ${protocol} (${url})` |
| 246 | `install URL host "${host}" is not on the known vendor host list` | `The install URL's host ${host} is not a known vendor` |
| 271 | `install script download timed out` | `Downloading the install script did not finish in time` |
| 272 | `install script download failed (exit ${code}): ${line}` | `Downloading the install script failed (exit ${code}): ${line}` |
| 299 | `fast-browser setup timed out` | `Fast Browser's setup did not finish in time` |
| 300 | `fast-browser setup failed (exit ${code}): ${line}` | `Fast Browser's setup failed (exit ${code}): ${line}` |
| 301 | `fast-browser setup complete` | `Fast Browser is set up` |
| 308 to 313 | per dir `timed out` / `exit ${code}` / `ok`, joined as `${dir}: ${detail}`; fallback `no config dirs to set up` | per-dir words unchanged; fallback `No Claude config folders to set up` |
| 318 (`VSIX_NOT_FOUND_DETAIL`) | `rt-context.vsix not found [dash] expected in the app bundle or next to the binary` | `The editor extension file was not found in the app or next to rt` |
| 319 (`NO_EDITORS_DETAIL`) | `no compatible editors found` | `No compatible editor found` |
| 320 (`NO_RECORDED_EDITORS_DETAIL`) | `no detected editor has the extension from an earlier setup` | `No editor on this Mac has the extension from an earlier setup` |
| 347 | `installed into ${list}` / `installed into ${list || "(none)"}; failed: ${failed}` | `Installed into ${list}` / `Installed into ${list || "none"}; failed in ${failed}` |
| 179, 234, 265 | passthrough | |

#### `lib/setup/uninstall.ts`

| Line | Today | Becomes |
|---|---|---|
| 160 | `kept for ${name}, which shares deck's registry`; stayed `deck's mattstack apps (kept for ${name})` | `Kept for ${name}, which shares deck's app list`; stayed unchanged |
| 165 | `deck is not running; nothing to unmanage` | `Deck is not running, so there is nothing to remove from it` |
| 170, 171 | `deck did not answer the managed remove` / `deck answered ${status} to the managed remove`; remedy `Retry` | `Deck did not answer` / `Deck answered ${status}`; remedy unchanged |
| 177 | `${removed}; teardown failed, record kept: ${kept}`; remedy `Retry; if deck keeps ${kept} again, deck's board shows the issue to fix first` | `${removed}. Could not remove ${kept}`; remedy `Retry. If ${kept} stays, deck's own page shows what to fix first` |
| 183 | `local proxy not installed` | `The local proxy is not installed` |
| 209 | `removed: ${list}` / `nothing to remove` | `Removed ${list}` / `Nothing to remove` |
| 218 (stayed) | `~/.zshenv PATH block needs manual removal (written before the removable marker existed)` | `The PATH block in ~/.zshenv needs removing by hand (an older rt wrote it without a marker)` |
| 220 to 223 | `rc block removed` / `rc block: manual removal needed` / `no rc block found`; `zshenv block removed` / `zshenv block: manual removal needed` / `no zshenv block found`; joined ` · ` | `Shell block removed` / `Shell block needs removing by hand` / `No shell block found`; `zshenv block removed` / `zshenv block needs removing by hand` / `No zshenv block found`; joined `. ` |
| 241 | `no editor found` | `No editor found` |
| 255 | `uninstalled from ${list || "(none)"}; failed: ${failed}`; remedy `Uninstall the extension manually, then Retry` | `Uninstalled from ${list || "none"}; failed in ${failed}`; remedy unchanged |
| 257 | `uninstalled from ${list || "(none)"}` | `Uninstalled from ${list || "none"}` |
| 262 | `claude not found` | `Claude Code is not installed` |
| 266 | `nothing recorded to remove` | `Nothing recorded to remove` |
| 306 | `removed ${n} plugin(s), ${m} marketplace(s) across ${d} config dir(s)` | `Removed ${n} plugin${s} and ${m} marketplace${s} across ${d} Claude config folder${s}` |
| 326 | `refusing to delete ${dir} [dash] HOME resolved to an unsafe value ("${home}")` | `Refusing to delete ${dir}: HOME resolved to an unsafe value (${home})` |
| 328 | `${dir} does not exist` | unchanged |
| 331 | `removed ${dir}` | `Removed ${dir}` |
| 337 | `no app bundle found` | `No app found` |
| 339 | `refusing to trash "${appPath}" [dash] does not look like an app bundle` | `Refusing to trash ${appPath}: it does not look like an app` |
| 345 | `osascript exited ${code}: ${err}`; remedy `Drag mattstack.app to the Trash yourself` | `Could not move the app to the Trash (exit ${code}): ${err}`; remedy unchanged |
| 347 | `moved ${appPath} to the Trash` | `Moved ${appPath} to the Trash` |
| 374 | `no uninstall handler for "${id}"` | `No uninstall step for ${id}` |
| 305, 379, 380 | passthrough | |

#### `lib/setup/integrations.ts` (the `result.detail` the accounts rows pass through, and every connect result)

| Line | Today | Becomes |
|---|---|---|
| 112 | `couldn't reach ${host} [dash] check your network or proxy` | `Could not reach ${host}. Check your network or proxy` |
| 151, 152 | `github /user returned ${status}` | `GitHub answered HTTP ${status} to the account check` |
| 159 | `token can't see ${owner}/${repo}` | `This token cannot see ${owner}/${repo}` |
| 160 | `github repo lookup returned ${status}` | `GitHub answered HTTP ${status} to the repo lookup` |
| 162 | `github token valid` | `GitHub token works` |
| 183 | `your team declares GitLab host "${declaredHost}" [dash] unverified; run \`rt setup gitlab connect --host ${declaredHost}\` to confirm it yourself` | `Your team uses the GitLab host ${declaredHost}. Run rt setup gitlab connect --host ${declaredHost} to confirm that address` |
| 192, 193 | `gitlab /user returned ${status}` | `GitLab answered HTTP ${status} to the account check` |
| 210 | `token can't see ${path}` | `This token cannot see ${path}` |
| 211 | `gitlab project lookup returned ${status}` | `GitLab answered HTTP ${status} to the project lookup` |
| 213 | `gitlab token valid` | `GitLab token works` |
| 231, 232 | `linear API returned ${status}` | `Linear answered HTTP ${status}` |
| 239 | `linear API returned unparsable JSON` | `Linear's answer could not be read` |
| 242 | `viewer ok` | `Linear key works` |
| 243 | `viewer ok, team ${key} found` | `Linear key works and can see team ${key}` |
| 244 | `token can't see team ${key}` | `This key cannot see team ${key}` |
| 265 | `slack auth.test returned unparsable JSON` | `Slack's answer could not be read` |
| 268 | `connected as ${team ?? "unknown team"}` | `Connected to ${team ?? "an unnamed workspace"}` |
| 269 | `slack auth.test failed (status ${status})` | `Slack answered HTTP ${status} to the sign-in check` |
| 291 | `your team declares switchboard at "${declaredHost}" [dash] unverified; run \`rt setup switchboard connect --host ${declaredHost}\` to confirm it yourself` | `Your team's switchboard is at ${declaredHost}. Run rt setup switchboard connect --host ${declaredHost} to confirm that address` |
| 295 | `switchboard host not configured` | `No switchboard address set` |
| 297 | `switchboard host "${host}" must be a valid https URL` | `The switchboard address ${host} must be a valid https URL` |
| 302 | `switchboard /healthz returned ${status}` | `The switchboard answered HTTP ${status} to its health check` |
| 303 | `switchboard reachable` | `Switchboard reachable` |
| 314 | `no email configured` | `No email set` |
| 316, 337, 351 | `sdm not installed` / `doppler not installed` / `ldcli not installed` | `sdm is not installed` / `doppler is not installed` / `ldcli is not installed` |
| 317, 338, 352 | `sdm status timed out` / `doppler me timed out` / `ldcli config --list timed out` | `sdm did not answer in time` / `doppler did not answer in time` / `ldcli did not answer in time` |
| 322, 339, 353 | `sdm session active` / `doppler session active` / `ldcli session active` | `Signed in to sdm` / `Signed in to doppler` / `Signed in to ldcli` |
| 324 | `sdm is not authenticated (run \`sdm login\`)` | `Not signed in to sdm. Run sdm login` |
| 340 | `doppler me failed` | `Not signed in to doppler` |
| 354 | `ldcli config --list failed` | `ldcli is not set up` |
| 361 | `unknown integration "${id}"` | `rt does not know an integration named ${id}` |

#### `lib/setup/need.ts`, `lib/setup/permissions.ts`, `lib/setup/plan.ts`, `lib/setup/apply.ts`, `lib/setup/repo-root.ts`, `lib/setup/finish-gate.ts`, `lib/setup/team-settings.ts`, `lib/setup/token-create.ts`, `lib/setup/skills-materialize.ts`

| Line | Today | Becomes |
|---|---|---|
| need.ts 164 | `mattstack.app answered ${path} with status ${status}` | unchanged |
| need.ts 183 | `no mattstack.app running to complete this step` | `mattstack.app is not running, and this step needs it` |
| need.ts 187 | `mattstack.app is running but cannot answer setup requests from this terminal [dash] quit it and Retry, or finish setup in the app` | `mattstack.app is running but cannot answer setup requests from this terminal. Quit it and Retry, or finish setup in the app` |
| need.ts 190 | `this step raises an admin prompt, which needs a person at an interactive terminal` | `This step raises an admin prompt, which needs a person at a terminal` |
| need.ts 191 | `timed out waiting for mattstack.app` | `mattstack.app did not answer in time` |
| need.ts 192 | `mattstack.app stopped responding` | `mattstack.app stopped answering` |
| permissions.ts 25 (`NOT_RUNNING_DETAIL`) | `mattstack.app not running [dash] permission status unavailable` | `mattstack.app is not running, so permissions cannot be checked` |
| permissions.ts 43 to 98 | `Granted`, `Not granted`, `Could not verify`, `Daemon reads all ${n} repos (checked via the daemon)`, `Enabled`, `Approve in Login Items`, `Not registered yet`, `Allowed`, `Not requested`, `Denied` | unchanged |
| permissions.ts 100 | `not checked (app not running)` | `Not checked: mattstack.app is not running` |
| plan.ts 49 | `no cloned team named "${teamOverride}" [dash] discovered teams: ${discovered}` | `No team named ${teamOverride} is cloned on this Mac. Teams here: ${discovered}` |
| apply.ts 146 | `unknown --from step id "${from}" [dash] valid ids: ${list}` | `--from does not name a step: ${from}. Steps: ${list}` |
| apply.ts 166 | `unknown --only step id "${only}"; valid ids: ${list}` | `--only does not name a step: ${only}. Steps: ${list}` |
| apply.ts 287, 393 to 396 | `bug: ${message}` | unchanged (a marker that this is rt's fault, read as written) |
| apply.ts 298 | `${step.title}: ${outcome.detail}` | unchanged |
| repo-root.ts 33 | `no path given` | `No folder given` |
| repo-root.ts 35 | `${path} does not exist` | unchanged |
| repo-root.ts 36 | `${path} is not a directory` | `${path} is not a folder` |
| repo-root.ts 37 | `${path} is not writable` | `You cannot write to ${path}` |
| finish-gate.ts 66 | `${id} is not a finish-gated row; finish-gated rows: ${list}` | `${id} is not a row that blocks Finish. Rows that do: ${list}` |
| finish-gate.ts 71 | `${id} cannot be skipped; waivable rows: ${list}` | `${id} cannot be skipped. Rows that can: ${list}` |
| team-settings.ts 51 (a log line since Task 2) | `rt: ${key} could not be resolved (${message}) [dash] treated as unset` | `${key} could not be resolved (${message}); treated as unset` |
| token-create.ts 84 | `token is missing: ${missing}${why}` | `This token is missing ${missing}${why}` |
| skills-materialize.ts 70, 122 | `set aside ${n} stale bindings file${s}`; `wrote ${n} pack file${s}: ${list}` | `Set aside ...`; `Wrote ...` (capital only) |
| skills-materialize.ts 110 | `"${repo}" matches more than one repo: ${matches}... pass the full identity` | `${repo} matches more than one repo (${matches}). Pass the full name` |
| skills-materialize.ts 115 | `"${repo}" is not a registered repo (rt repos register first)` | `${repo} is not a registered repo. Run rt repos register first` |
| skills-materialize.ts 129 | `${ENGINE_PACK_MISSING_CODE}: install the mattstack plugin first (plugins.install), then rerun` | `${ENGINE_PACK_MISSING_CODE}: install the mattstack plugin first, then run this again` (the code prefix is machine-read and stays) |
| skills-materialize.ts 142, 144 | `no git remote in ${path}`; `no team declares ${repo}` | `No git remote in ${path}`; `No team covers ${repo}` |
| probes.ts 380, skills-materialize.ts 126, slack-app.ts 31 to 51, pack-cache.ts (every `reason` and rollback `detail`) | already plain, or fragments composed into the sentences above and below | unchanged |

#### `commands/setup.ts`, `commands/uninstall.ts`, `commands/logins.ts` (string literals only: exit-2 messages and connect details)

| Line | Today | Becomes |
|---|---|---|
| setup.ts 258 | `${flag} requires a step id; valid ids: ${list}` | `${flag} needs a step. Steps: ${list}` |
| setup.ts 268 | `--from and --only cannot be combined: --from resumes from a step, --only runs just that one` | unchanged |
| setup.ts 296, 389 | the hard gate and update-flag messages | rewritten in Task 5 |
| setup.ts 581 | `a team is already set up on this Mac (${teams}); Just me needs a Mac with no team. Remove ${folders} or pick Join or Create instead.` | `A team is already set up on this Mac (${teams}), and Just me needs a Mac with no team. Remove ${folders}, or pick Join or Create instead.` |
| setup.ts 693 | `no root path provided; pipe {"root": "<path>"} on stdin instead` | `No folder given. Pipe {"root": "<path>"} on stdin` |
| setup.ts 768 | `the remote URL carries a password; drop it and let a credential helper (gh auth setup-git) supply it` | `The remote URL carries a password. Drop it and let a credential helper (gh auth setup-git) supply it` |
| setup.ts 771 | `"${url}" is not a git remote (...)` | `${url} is not a git remote (...)` |
| setup.ts 801 | `no remote provided; pipe {"url": "<git url>"} or {"alternative": "create"} on stdin instead` | `No remote given. Pipe {"url": "<git url>"} or {"alternative": "create"} on stdin` |
| setup.ts 802 | `name must be a repo name (letters, digits, dots, dashes)` | `The name must be a repo name (letters, digits, dots, dashes)` |
| setup.ts 808 | `no home repo at ${dir} yet; Install creates it (rt home init)` | `No home repo at ${dir} yet. Install creates it, or run rt home init` |
| setup.ts 816 | `gh repo create ${name} failed: ${why}` | `Could not create ${name} with gh: ${why}` |
| setup.ts 819 | `gh repo create ${name} printed no repository URL` | `gh created ${name} but printed no repository URL` |
| setup.ts 833 | `git remote ${set-url or add} failed: ${why}` | `Could not set the remote: ${why}` |
| setup.ts 842 | `the push to the new URL failed, and the previous origin could not be restored (${why}); check git remote -v in ${dir}: ${reason}` | `The push to the new URL failed, and the previous origin could not be restored (${why}). Check git remote -v in ${dir}: ${reason}` |
| setup.ts 844 | `the push to the new URL failed (origin restored to the previous remote): ${reason}` | `The push to the new URL failed, so origin is back on the previous remote: ${reason}` |
| setup.ts 846 | `origin is set, but the push failed: ${reason}` | `Origin is set, but the push failed: ${reason}` |
| setup.ts 1148 | `via gh` | `Signed in through the gh CLI` |
| setup.ts 1165 | `waiting on the team's Slack app (see account.slack-app)` | `Waiting for the team's Slack app to be set up` |
| setup.ts 1168, 1178 | `no Slack account connected`; `no ${def.title} account connected` | `No Slack account connected yet`; `No ${def.title} account connected yet` |
| setup.ts 1280 | `gh auth token failed [dash] run \`gh auth login\` first` | `Could not read a token from gh. Run gh auth login first` |
| setup.ts 1328 | `--host must be a bare hostname (e.g. gitlab.example.com), got "${hostFlag}"` / `the switchboard URL must be a valid https URL (e.g. https://switchboard.example.com), got "${hostFlag}"` | `--host takes a bare hostname such as gitlab.example.com, not ${hostFlag}` / `The switchboard address must be a valid https URL such as https://switchboard.example.com, not ${hostFlag}` |
| setup.ts 1355 | `${id} takes no interactive credential [dash] pipe JSON on stdin instead` | `${id} takes no typed credential. Pipe JSON on stdin` |
| setup.ts 1364, 1367 | `no ${field.label} provided on stdin`; `stdin did not contain a recognizable credential` | `No ${field.label} on stdin`; `Stdin held no credential rt recognizes` |
| setup.ts 1410 to 1413 | `${sourceDetail} [dash] staged until Install creates your key` / `staged until Install creates your key` | `${sourceDetail}. Saved for now; Install stores it once your key exists` / `Saved for now; Install stores it once your key exists` |
| setup.ts 1436 | `your team has no Slack app yet [dash] its owner needs to create one first` | `Your team has no Slack app yet. Its owner needs to create one first` |
| setup.ts 1466 | `the Slack client secret for team "${slug}" is not readable on this machine yet: the team owner must run \`rt team members sync\` first (the team clone pushes it on its next cycle); try again once your clone has pulled that` | `The Slack client secret for team ${slug} cannot be read on this Mac yet. The team owner must run rt team members sync first; try again once your team clone has pulled` |
| setup.ts 1477, 1595 | `couldn't reach slack.com [dash] check your network or proxy` | `Could not reach slack.com. Check your network or proxy` |
| setup.ts 1483 | `slack oauth.v2.access returned unparsable JSON` | `Slack's answer could not be read` |
| setup.ts 1507 | `Slack granted fewer scopes than the board reads with because the team's Slack app does not declare them: ${fix}, then connect again` | `Slack granted fewer permissions than the board needs, because the team's Slack app does not list them. To fix it, ${fix}, then connect again` |
| setup.ts 1575 | `no Slack app configuration token provided on stdin` | `No Slack app configuration token on stdin` |
| setup.ts 1585 | `no team to create a Slack app for [dash] set up your team first` | `No team to create a Slack app for. Set up your team first` |
| setup.ts 1599 | fallback `slack apps.manifest.create returned ok:false (status ${status})` | `Slack refused the app manifest (HTTP ${status})` |
| setup.ts 1634, 1635 | `Slack app created [dash] team secrets staged until the team has recipients` / `... until the age key exists` | `Slack app created. Its team secrets are saved for now, until the team has members to encrypt for` / `Slack app created. Its team secrets are saved for now, until your age key exists` |
| setup.ts 569, 593, 689, 792 to 796, 1246 | `usage: ...` lines | unchanged (usage lines; the person sees the overlay block) |
| setup.ts 481, 697, 1115, 1376, 1385, 1428, 1453, 1457, 1615 | passthrough (`result.detail`, `check.detail`, `err.message`, the Slack fix sentences) | |
| setup.ts 91, 169, 1012, 1098 | the skipped glyph, the "Missing accounts" heading, the forged-state `Error`, the old integration line | 91, 169 and 1098 are deleted by Tasks 4 and 6; 1012 becomes `The Slack callback's state did not match, so rt rejected a possibly forged authorization code` |
| uninstall.ts 61 to 64 | `unexpected ${argument or arguments} ${named}. It takes no app name and removes all of mattstack; to remove one app from deck, run: deck remove <name> (add --force for a mattstack app; bundled apps return when deck restarts)` | `Unexpected ${argument or arguments} ${named}. rt uninstall takes no app name and removes all of mattstack. To remove one app from deck, run deck remove <name> (add --force for a mattstack app; bundled apps return when deck restarts)` |
| uninstall.ts 80 | `--keep-data and --delete-data are mutually exclusive` | `--keep-data and --delete-data cannot be used together` |
| uninstall.ts 100 | `--delete-data needs --yes when not on a TTY (or when --json is set)` | unchanged |
| logins.ts 122 | `couldn't open mattstack; is the app installed?` | `Could not open mattstack. Is the app installed?` |
| logins.ts 69, 91, 99, 107, 143 | usage lines and stdin instructions | unchanged (already plain) |

#### `commands/verify.ts`

| Line | Today | Becomes |
|---|---|---|
| 47, 48 (`actionHint`) | ` [dash] ${action.label}` | ` (${action.label})` |
| 118 | the skip glyph in the old formatter | deleted with the formatter in Task 8 |

---

### Task 1: The `json` seam and `--json` shape tests

**Files:**
- Create: `commands/__tests__/helpers/json-line.ts`
- Modify: `commands/setup.ts` (every deps interface and every JSON call site)
- Modify: `commands/uninstall.ts` (`UninstallDeps`, both JSON call sites, the emitter)
- Modify: `commands/__tests__/setup-plan.test.ts`, `setup-apply.test.ts`, `setup-update.test.ts`, `setup-connect.test.ts`, `setup-repo-root.test.ts`, `setup-waive.test.ts`, `setup-finish.test.ts`, `uninstall.test.ts` (add `json` to every deps object; add the shape tests)

**Interfaces:**
- Consumes: `out.json(value, indent?)` (phase 1, `lib/ui/out.ts`); `captureOut(): CapturedOut` from `lib/ui/__tests__/capture-out.ts` (phase 2: `stdout()`, `stderr()`, `lines()`, `errLines()`, `reset()`, `restore()`; it swaps the two `process.*.write`s, `restore()` puts them back and resets `out.__test__`, and the human gate is the caller's). The gate matters: `bun test` run in a terminal has a TTY stdout, so without `out.__test__.setHuman(() => false)` every `out.print` would spawn the real `rt-ui render` and no plain-text assertion would hold. This plan therefore never calls `captureOut()` bare: every commands test goes through `capturePlain()` below, which closes the gate, and the one `lib/` test (Task 2) sets the gate inline. Every capture is restored in a `finally` or an `afterEach`.
- Produces: on `SetupDeps`, `ApplyDeps`, `IntentDeps` (and so `FinishDeps`), `RepoRootDeps`, `HomeRemoteDeps`, `WaiveDeps`, `ConnectDeps` (through `SetupDeps`) and `UninstallDeps`: `json: (value: unknown) => void`, documented as "One machine line on stdout: a `--json` envelope or an NDJSON event. Never human text." Real deps set it to `(v) => out.json(v)`. The helper `commands/__tests__/helpers/json-line.ts` exports `capturePlain(): CapturedOut` (phase 2's `captureOut()` followed by `out.__test__.setHuman(() => false)`; a wrapper, not a second capture), `expectOneJsonLine(stdout: string): unknown` and `realJson`.
- `print` stays on every interface for now; Tasks 4 to 7 remove it as each verb's human output converts.

- [ ] **Step 1: Write the test helper**

Create `commands/__tests__/helpers/json-line.ts` (it wraps phase 2's `captureOut` and holds only what phase 3's tests add to it):

```ts
import { expect } from "bun:test";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";

/**
 * Phase 2's capture with the human gate closed: the test reads plain text
 * and never spawns rt-ui, even when bun test runs in a terminal. restore()
 * resets the gate; so does reset(), so a test that calls cap.reset() must
 * call setHuman again.
 */
export function capturePlain(): CapturedOut {
  const cap = captureOut();
  out.__test__.setHuman(() => false);
  return cap;
}

/** Exactly one JSON object on stdout, compact, newline-terminated: the shape every --json envelope has today. Returns the parsed value. */
export function expectOneJsonLine(stdout: string): unknown {
  const parsed: unknown = JSON.parse(stdout.trimEnd());
  expect(stdout).toBe(JSON.stringify(parsed) + "\n");
  return parsed;
}

/** The real json seam for a shape test: whatever the verb hands it lands on the captured stdout exactly as rt prints it. */
export const realJson = (value: unknown): void => out.json(value);
```

- [ ] **Step 2: Write the failing shape tests**

Append to `commands/__tests__/setup-plan.test.ts` (add `import { capturePlain, expectOneJsonLine, realJson } from "./helpers/json-line.ts";`, `import { composePlan } from "../../lib/setup/plan.ts";` and `import { listTeams } from "../../lib/settings/stores.ts";` at the top; every other commands test file below imports what it uses from `./helpers/json-line.ts` the same way, and none imports `captureOut` directly):

```ts
describe("setup plan --json bytes", () => {
  test("stdout is exactly JSON.stringify(plan) plus a newline, for the same plan composePlan returns", async () => {
    const cap = capturePlain();
    try {
      const probes = fakeProbes({ exec: readyExec });
      const deps: SetupDeps = { probes, secrets: fakeSecrets(), print: () => {}, json: realJson };
      await setupPlan(["--json"], {}, deps);
      const plan = await composePlan({ p: probes, secrets: fakeSecrets(), ci: process.env.CI === "true", mode: "plan", teams: listTeams() });
      expect(cap.stdout()).toBe(JSON.stringify(plan) + "\n");
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });
});
```

Append to `commands/__tests__/setup-apply.test.ts` (import `capturePlain`, `expectOneJsonLine`, `realJson`):

```ts
describe("setup apply --json bytes", () => {
  test("the NDJSON stream is one compact object per line, newline-terminated, nothing else on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })], json: realJson });
      await setupApply(["--json"], {}, deps);
      expect(cap.stdout()).toBe(
        '{"event":"plan","steps":[{"id":"path.link","title":"path.link","kind":"rt"}]}\n' +
          '{"event":"step","id":"path.link","state":"running"}\n' +
          '{"event":"step","id":"path.link","state":"done","detail":"ok"}\n' +
          '{"event":"done","ok":true}\n',
      );
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("an exit-2 envelope is one line: contract, at, error.code, error.message, in that order", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], json: realJson });
      await runExpectingExit(() => setupApply(["--json", "--from", "bogus"], {}, deps));
      const payload = expectOneJsonLine(cap.stdout()) as { contract: number; at: string; error: { code: string; message: string } };
      expect(Object.keys(payload)).toEqual(["contract", "at", "error"]);
      expect(Object.keys(payload.error)).toEqual(["code", "message"]);
      expect(payload.at).toBe("2026-01-01T00:00:00.000Z");
      expect(payload.error.code).toBe("unknown-step");
      expect(payload.error.message).toContain("bogus");
    } finally {
      cap.restore();
    }
  });
});
```

Append to `commands/__tests__/setup-update.test.ts`:

```ts
describe("setup update --json bytes", () => {
  test("a skipped run is exactly one done event", async () => {
    const cap = capturePlain();
    try {
      const deps = updateDeps({ steps: [neverRunsStep("path.link")], json: realJson });
      await run(deps, ["--json"]);
      expect(cap.stdout()).toBe('{"event":"done","ok":true,"skipped":"not-set-up"}\n');
    } finally {
      cap.restore();
    }
  });
});
```

Append to `commands/__tests__/setup-waive.test.ts` (the file's deps factory is the `t` object with `lines`, `writes`, `store`; add `json: (v) => lines.push(JSON.stringify(v))` to it in Step 4, and give the factory an optional override so this test can pass `realJson`):

```ts
describe("setup waive --json bytes", () => {
  test("the ok envelope is contract, at, ok, id, changed, waived", async () => {
    const cap = capturePlain();
    try {
      const t = makeDeps({ json: realJson });
      await setupWaive(["tool.fast-browser-extension", "--json"], {}, t.deps);
      expect(cap.stdout()).toBe('{"contract":1,"at":"2026-01-01T00:00:00.000Z","ok":true,"id":"tool.fast-browser-extension","changed":true,"waived":["tool.fast-browser-extension"]}\n');
    } finally {
      cap.restore();
    }
  });
});
```

(`makeDeps` is whatever the file's existing factory is called; read it and use its name. If the factory takes no overrides, give it one `Partial<WaiveDeps>` parameter spread last.)

Append to `commands/__tests__/setup-repo-root.test.ts`, inside its existing describe, using the file's own happy-path fixture (the test that asserts `written` equals `[["rt.repoRoots", [dev], "machine"]]`): copy that test's setup, pass `json: realJson`, and assert:

```ts
    const payload = expectOneJsonLine(cap.stdout()) as { contract: number; at: string; path: string };
    expect(Object.keys(payload).slice(0, 3)).toEqual(["contract", "at", "path"]);
    expect(payload.path).toBe(dev);
```

Append to `commands/__tests__/setup-connect.test.ts`, copying the setup of the test that asserts `body.integration` is `"gitlab"` and `body.status` is `"ready"`, with `json: realJson`:

```ts
    const payload = expectOneJsonLine(cap.stdout()) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["contract", "at", "integration", "status", "detail", "scopesSeen"]);
```

Append to `commands/__tests__/uninstall.test.ts`, copying the `--json --dry-run` test's setup with `json: realJson` (the shape and the machine-read id are pinned here; the title is copy, pinned by the file's existing dry-run assertion):

```ts
    const payload = expectOneJsonLine(cap.stdout()) as { contract: number; at: string; actions: Array<Record<string, unknown>> };
    expect(Object.keys(payload)).toEqual(["contract", "at", "actions"]);
    expect(payload.at).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.actions.map((a) => [a.id, Object.keys(a)])).toEqual([["services.unregister", ["id", "title"]]]);
```

- [ ] **Step 3: Run them to verify they fail**

Run (repo root): `bun test commands/__tests__/setup-plan.test.ts commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-waive.test.ts commands/__tests__/setup-repo-root.test.ts commands/__tests__/setup-connect.test.ts commands/__tests__/uninstall.test.ts`
Expected: the new tests fail to typecheck or run (`json` is not a property of the deps type; stdout is empty because the verbs still print through `print`).

- [ ] **Step 4: Add the seam and route every JSON write through it**

In `commands/setup.ts`:

Add to `SetupDeps`, `ApplyDeps`, `IntentDeps`, `RepoRootDeps`, `HomeRemoteDeps` and `WaiveDeps`:

```ts
  /** One machine line on stdout: a --json envelope or an NDJSON event. Never human text. */
  json: (value: unknown) => void;
```

Add `import * as out from "../lib/ui/out.ts";` and set `json: (v) => out.json(v),` in `realSetupDeps`, `realApplyDeps`, `realIntentDeps`, `realRepoRootDeps`, `realHomeRemoteDeps`, `realWaiveDeps` and `realConnectDeps`.

Replace each JSON write:

- `runPlan`: `deps.print(JSON.stringify(plan));` becomes `deps.json(plan);`
- `setupApply` and `setupUpdate`: the `createNdjsonEmitter((line) => deps.print(...))` expression becomes `(ev: ApplyEvent) => deps.json(ev)` (import `type ApplyEvent` from `../lib/setup/contract.ts`), and `createNdjsonEmitter` leaves the `../lib/setup/emit.ts` import line in `commands/setup.ts` and `commands/uninstall.ts` (Task 3 deletes the export). Keep `createHumanEmitter(deps.print)` for the human branch for now.
- `setupApply` catch: `deps.print(json ? JSON.stringify(userErrorPayload(err, deps.probes.now())) : \`rt setup apply: ${err.message}\`);` becomes

```ts
      if (json) deps.json(userErrorPayload(err, deps.probes.now()));
      else deps.print(`rt setup apply: ${err.message}`);
```

- `setupUpdate` flag loop, `setupPack` (both the success envelope and the catch), `printIntentResult`, `setupFinish`, `setupRepoRootSet`, `homeRemoteSet`, `printIntegrationResult`, `runWaiver`: the same split, `deps.json(<the object that was stringified>)` on the JSON branch, `deps.print(...)` unchanged on the human branch.
- `exitWithUserError`: `deps.print(json ? JSON.stringify(userErrorPayload(err, deps.probes.now())) : ...)` becomes `if (json) deps.json(userErrorPayload(err, deps.probes.now())); else deps.print(\`rt ${verb}: ${err.message}\`);` and its `deps` parameter type becomes `Pick<SetupDeps, "probes" | "print" | "json" | "exit">`.
- `updateAfterFinish`: `quiet` becomes `{ ...deps, print: opts.json ? () => {} : opts.print, json: opts.json ? () => {} : deps.json, exit: ... }`.
- `setupInteractive`'s `setupDeps` literal gains `json: deps.json`.

In `commands/uninstall.ts`: add the same `json` member to `UninstallDeps` and `json: (v) => out.json(v)` to `realUninstallDeps` (import `out`); `deps.print(JSON.stringify(payload))` becomes `deps.json(payload)`; the catch's JSON branch becomes `deps.json(userErrorPayload(err, deps.probes.now()))`; the emitter's JSON branch becomes `(ev: ApplyEvent) => deps.json(ev)`.

- [ ] **Step 5: Add `json` to every test deps object**

In each test file named above, every deps literal that has `print: (s) => lines.push(s)` (or `out.push`, `t.lines`) gains `json: (v) => lines.push(JSON.stringify(v)),` writing into the same array, so every existing `deps.lines[0]` and `JSON.parse(deps.lines[...])` assertion keeps passing. Where a factory builds the deps, add the member once in the factory and let an `overrides` spread replace it.

- [ ] **Step 6: Run the suites**

Run: `bun test commands/__tests__/ && bun run typecheck`
Expected: PASS, including the new shape tests.

- [ ] **Step 7: Commit**

```bash
git add commands/setup.ts commands/uninstall.ts commands/__tests__/
git commit -m "setup: a json seam for every machine line, its shape pinned

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The shared failure path, the error shim's removal, and three small lib conversions

**Files:**
- Create: `lib/setup/user-failure.ts`
- Create: `lib/setup/__tests__/user-failure.test.ts`
- Delete: `lib/setup/errors.ts` (phase 2's re-export shim), after repointing its 22 remaining importers
- Modify: `lib/__tests__/errors.test.ts` (phase 2's shim test goes with the shim)
- Modify: `lib/setup/finish-gate.ts:19`, `lib/setup/team-settings.ts:58-60`, `lib/setup/steps/home.ts:47`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/setup/finish-gate.ts`, `lib/setup/steps/home.ts`, `lib/setup/team-settings.ts`)

**Interfaces:**
- Consumes from phase 2 (`lib/errors.ts`): `UserActionableError` with `code`, `message`, `extra`, and the optional `why?: string`, `next?: string`, `log?: string` set through its fourth `options` argument; `userErrorPayload(err, now?)`; `failureFor(err): FailureInput` (title from the message, `why`, `next` as a command segment, `details` when `log` is set). From `lib/cli-logger.ts`: `logCliEvent(level: "debug" | "warn" | "error", module: string, message: string, context?: Record<string, unknown>): void`.
- Consumes from phase 1: `out.fail`, `out.cmd`, `type FailureInput`.
- Produces: `userFailure(err: UserActionableError, human?: Partial<FailureInput>): FailureInput` (phase 2's block with the call site's words laid over it; a different name so the two exports never share one); `interface UserErrorSink { json: (value: unknown) => void; exit: (code: number) => never; now: () => Date }`; `exitWithUserError(err, json: boolean, sink: UserErrorSink, human?: Partial<FailureInput>): never`.

- [ ] **Step 1: Write the failing test**

Create `lib/setup/__tests__/user-failure.test.ts`:

```ts
import { test, expect, afterEach } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { exitWithUserError, userFailure } from "../user-failure.ts";
import * as out from "../../ui/out.ts";
import { captureOut, type CapturedOut } from "../../ui/__tests__/capture-out.ts";

let cap: CapturedOut | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

/** The gate is the caller's: closed, so the failure block is plain text and rt-ui is never spawned. */
function capture(): CapturedOut {
  const c = captureOut();
  out.__test__.setHuman(() => false);
  return c;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("userFailure is phase 2's block, with the caller's plainer words laid over it", () => {
  const err = new UserActionableError("bad-path", "/tmp/x does not exist");
  expect(userFailure(err)).toEqual({ title: "/tmp/x does not exist" });
  expect(userFailure(err, { title: "That folder does not exist", next: out.cmd("rt setup repo-root set <folder>") })).toEqual({
    title: "That folder does not exist",
    next: { text: "rt setup repo-root set <folder>", role: "command" },
  });
});

test("an error carrying why and next keeps them under an overlaid title", () => {
  const err = new UserActionableError("not-ready", "Not ready: tools missing", {}, { why: "Apple's Command Line Tools are not installed", next: "rt tools install apple-clt" });
  expect(userFailure(err, { title: "This Mac is not ready to install yet" })).toEqual({
    title: "This Mac is not ready to install yet",
    why: "Apple's Command Line Tools are not installed",
    next: { text: "rt tools install apple-clt", role: "command" },
  });
});

test("exitWithUserError under --json writes the envelope on stdout and nothing on stderr, then exits 2", () => {
  cap = capture();
  const exits: number[] = [];
  const written: unknown[] = [];
  const sink = { json: (v: unknown) => written.push(v), exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), true, sink)).toThrow("exit");
  expect(written).toEqual([{ contract: 1, at: "2026-01-01T00:00:00.000Z", error: { code: "usage", message: "usage: rt x" } }]);
  expect(cap.stderr()).toBe("");
  expect(exits).toEqual([2]);
});

test("exitWithUserError for a person writes a failure block on stderr, nothing on stdout, then exits 2", () => {
  cap = capture();
  const exits: number[] = [];
  const sink = { json: () => { throw new Error("json must not be called"); }, exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), false, sink, { title: "Which row?", next: out.cmd("rt setup waive <row-id>") })).toThrow("exit");
  expect(cap.stdout()).toBe("");
  expect(cap.stderr()).toBe("[failed] Which row?\n  next: rt setup waive <row-id>\n");
  expect(exits).toEqual([2]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/setup/__tests__/user-failure.test.ts`
Expected: FAIL, cannot find module `../user-failure.ts`.

- [ ] **Step 3: Write `lib/setup/user-failure.ts`**

```ts
/**
 * The exit-2 path every setup verb shares. The envelope on stdout is the
 * app's contract and keeps the error's own message; the failure block a
 * person sees may carry plainer words from the call site.
 */
import { failureFor, UserActionableError, userErrorPayload } from "../errors.ts";
import * as out from "../ui/out.ts";
import type { FailureInput } from "../ui/out.ts";

export function userFailure(err: UserActionableError, human: Partial<FailureInput> = {}): FailureInput {
  const base = failureFor(err);
  const pick = <K extends keyof FailureInput>(k: K) => human[k] ?? base[k];
  return {
    title: pick("title") ?? err.message,
    ...(pick("hint") ? { hint: pick("hint") } : {}),
    ...(pick("why") ? { why: pick("why") } : {}),
    ...(pick("next") ? { next: pick("next") } : {}),
    ...(pick("details") ? { details: pick("details") } : {}),
  };
}

export interface UserErrorSink {
  json: (value: unknown) => void;
  exit: (code: number) => never;
  now: () => Date;
}

export function exitWithUserError(err: UserActionableError, json: boolean, sink: UserErrorSink, human?: Partial<FailureInput>): never {
  if (json) sink.json(userErrorPayload(err, sink.now()));
  else out.fail(userFailure(err, human));
  return sink.exit(2);
}
```

- [ ] **Step 4: Repoint this phase's importers and delete the shim**

Phase 2 left `lib/setup/errors.ts` as a one-line re-export for the files this plan owns. From the repo root, list them (expect 22):

```bash
rg -l -e 'setup/errors\.ts' -e 'from "\./errors\.ts"' -e 'from "\.\./errors\.ts"' lib/setup commands/setup.ts commands/logins.ts commands/uninstall.ts commands/__tests__
```

Rewrite each import to `lib/errors.ts`, keeping every file's own relative depth:

- `lib/setup/*.ts`: `"./errors.ts"` becomes `"../errors.ts"`
- `lib/setup/steps/*.ts`, `lib/setup/validators/*.ts`, `lib/setup/__tests__/*.ts`: `"../errors.ts"` becomes `"../../errors.ts"`
- `commands/*.ts`: `"../lib/setup/errors.ts"` becomes `"../lib/errors.ts"`
- `commands/__tests__/*.ts`: `"../../lib/setup/errors.ts"` becomes `"../../lib/errors.ts"`

Then `git rm lib/setup/errors.ts`, and in `lib/__tests__/errors.test.ts` delete the test `lib/setup/errors.ts re-exports the same bindings` and the `ViaShim` import line it alone used. `bun run typecheck` is the proof: a missed importer fails to resolve.

- [ ] **Step 5: Route the two resolver warnings to the log and reword the comment**

`lib/setup/finish-gate.ts`: add `import { logCliEvent } from "../cli-logger.ts";` and change line 19 to

```ts
  const warn = opts.warn ?? ((message: string) => logCliEvent("warn", "setup.finish-gate", message));
```

`lib/setup/team-settings.ts`: add the same import and change `defaultWarn`'s body to `logCliEvent("warn", "setup.team-settings", message);`. Update the doc comment above it to: `/** The CLI log, never a stream: this runs under --json paths whose stdout is the envelope. A caller that wants silence passes its own no-op through the warn param. */`

`lib/setup/steps/home.ts`: in the comment at lines 45 to 49, the sentence that quotes a numbered `console.error(...)` frame and calls it "a frame from the compiled binary" becomes: ``the "error" the app showed was a numbered source frame from the compiled binary's own logging call``. No dash and no `console.` call shape may remain in that comment.

- [ ] **Step 6: Delete the three allowlist lines**

Remove `"lib/setup/finish-gate.ts",`, `"lib/setup/steps/home.ts",` and `"lib/setup/team-settings.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 7: Run the tests**

Run: `bun test lib/setup/__tests__/user-failure.test.ts lib/__tests__/errors.test.ts lib/__tests__/no-raw-output.test.ts lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/team-settings.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A lib/setup lib/__tests__/errors.test.ts commands/setup.ts commands/logins.ts commands/uninstall.ts commands/__tests__ lib/__tests__/raw-output-allowlist.json
git commit -m "setup: one exit-2 path, the errors shim gone, resolver warnings to the cli log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The step emitter

**Files:**
- Rewrite: `lib/setup/emit.ts`
- Rewrite: `lib/setup/__tests__/emit.test.ts`
- Modify: `lib/setup/apply.ts` (`tip` on `ApplyContext` and `CreateApplyContextDeps`, the notice sink line)
- Modify: `lib/setup/__tests__/apply.test.ts` (append one test; retarget the `wire bytes` describe off `createNdjsonEmitter`)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/setup/emit.ts`)

**Interfaces:**
- Consumes: `openStep(title): StepHandle` with `sub(text)`, `done(title?, hint?, status?)`, `fail(title?, hint?)` (phase 1, `lib/ui/spawn.ts`; `done` with no status sends no `status` key and the helper draws its default ending); `interactive()` (`lib/ui/gate.ts`); `out.print`, `out.line`, `out.callout`, `out.verbatim`, `out.summary` (phase 1); `ApplyEvent`, `EventId`, `StepState` (`lib/setup/contract.ts`); `setSettingsNoticeSink(sink | null): previous` (rt-client's `settings/write.ts`, imported in `lib/setup/apply.ts`; the test imports it from the same module `apply.ts` does).
- Produces, exported from `lib/setup/emit.ts`: `type Emit = (ev: ApplyEvent) => void` (unchanged); `interface StepEmitterLabels { done: string; needsYou: string; failed: string }`; `interface StepEmitterOptions { labels: StepEmitterLabels; log: (id: EventId, line: string) => void; interactive?: boolean }`; `interface StepEmitter { emit: Emit; tip(id: EventId, line: string): void; flush(): Promise<void> }`; `createStepEmitter(opts): StepEmitter`. `createNdjsonEmitter` and `createHumanEmitter` are deleted (Task 1 already moved both callers' JSON branch onto `deps.json` and dropped the import; Tasks 5 and 7 move the human branch onto this emitter; the one other user, `lib/setup/__tests__/apply.test.ts`, is retargeted in Step 1).
- Produces on `lib/setup/apply.ts`: `ApplyContext.tip?: (id: EventId, line: string) => void`; `CreateApplyContextDeps.tip?: (id: EventId, line: string) => void`; the engine's notice sink becomes `(line) => (ctx.tip ?? ctx.log)(step.id, line)`. The arrow declares `line` only: a one-parameter function is assignable to today's one-argument sink type and to phase 4's two-argument `(line, notice)` sink, so this line type-checks whichever phase lands second. Do not add a second parameter here.

- [ ] **Step 1: Write the failing tests**

Replace `lib/setup/__tests__/emit.test.ts` with:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createStepEmitter, type StepEmitter } from "../emit.ts";
import type { ApplyEvent, EventId } from "../contract.ts";
import * as out from "../../ui/out.ts";

const FAKE = resolve(import.meta.dir, "..", "..", "ui", "__tests__", "fake-rt-ui.ts");
const LABELS = { done: "Setup is done", needsYou: "Setup needs you", failed: "Setup stopped" };

let dir: string;
let record: string;
let stdout: string[];
let stderr: string[];
let logged: Array<[EventId, string]>;
const realOut = process.stdout.write;
const realErr = process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-emit-"));
  record = join(dir, "record.ndjson");
  stdout = [];
  stderr = [];
  logged = [];
  process.stdout.write = ((c: string | Uint8Array) => (stdout.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (stderr.push(String(c)), true)) as typeof process.stderr.write;
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

function emitter(interactive: boolean): StepEmitter {
  return createStepEmitter({ labels: LABELS, log: (id, line) => logged.push([id, line]), interactive });
}

const plan: ApplyEvent = {
  event: "plan",
  steps: [
    { id: "path.link", title: "Link rt onto your PATH", kind: "rt" },
    { id: "skills.link", title: "Link skills", kind: "rt" },
    { id: "secrets.write", title: "Write secrets", kind: "rt" },
    { id: "plugins.install", title: "Install plugins", kind: "rt" },
    { id: "repos.clone", title: "Clone your repos", kind: "rt" },
  ],
};

async function drive(e: StepEmitter, events: ApplyEvent[]): Promise<void> {
  for (const ev of events) e.emit(ev);
  await e.flush();
}

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("off a TTY every final state is one plain line with the step's title, a remedy is a fix callout, and the run ends in a summary", async () => {
  await drive(emitter(false), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "log", id: "path.link", line: "ln -s rt" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "step", id: "skills.link", state: "running" },
    { event: "step", id: "skills.link", state: "skipped", detail: "nothing to link" },
    { event: "step", id: "secrets.write", state: "running" },
    { event: "step", id: "secrets.write", state: "needs-you", detail: "Connect Slack" },
    { event: "step", id: "plugins.install", state: "running" },
    { event: "step", id: "plugins.install", state: "partial", detail: "2 of 3 installed", remedy: "Update Claude Code, then Retry." },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe(
    "[ok] Link rt onto your PATH  linked\n" +
      "[skipped] Link skills  nothing to link\n" +
      "[needs you] Write secrets  Connect Slack\n" +
      "[warning] Install plugins  2 of 3 installed\n" +
      "  fix: Update Claude Code, then Retry.\n" +
      "[needs you] Setup needs you  1 done, 1 skipped, 1 needs you, 1 with a caveat\n",
  );
  expect(stderr.join("")).toBe("");
  expect(logged).toEqual([["path.link", "ln -s rt"]]);
});

test("off a TTY a failed step keeps its streamed lines under it and the summary says the run stopped", async () => {
  await drive(emitter(false), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "log", id: "repos.clone", line: "git: fatal: could not read from remote" },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed", remedy: "Check your network, then Retry" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  expect(stdout.join("")).toBe(
    "[failed] Clone your repos  clone failed\n" +
      "  git: fatal: could not read from remote\n" +
      "  fix: Check your network, then Retry\n" +
      "[failed] Setup stopped  1 failed\n",
  );
});

test("a hostile log line prints as one plain row and reaches the log unchanged", async () => {
  const hostile = "line one\nline two\x1b[2J\u0000\tx";
  await drive(emitter(false), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "log", id: "repos.clone", line: hostile },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  const rows = stdout.join("").split("\n");
  expect(rows[1]).toBe("  line one");
  expect(rows[2]).toBe("  line two\tx");
  expect(stdout.join("")).not.toContain("\x1b[");
  expect(logged).toEqual([["repos.clone", hostile]]);
});

test("at a terminal each step is one rt-ui spawn: start with the title, sub for every log line, done carrying the status", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "log", id: "path.link", line: "ln -s rt" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "step", id: "secrets.write", state: "running" },
    { event: "need", id: "secrets.write", request: { type: "app-privileged", op: "proxy-install" } },
    { event: "step", id: "secrets.write", state: "needs-you", detail: "Connect Slack" },
    { event: "done", ok: true },
  ]);
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "Link rt onto your PATH" },
    { t: "sub", text: "ln -s rt" },
    { t: "done", title: "Link rt onto your PATH", hint: "linked" },
    { t: "hello", protocol: 1 },
    { t: "start", title: "Write secrets" },
    { t: "sub", text: "Waiting for mattstack.app to finish this step" },
    { t: "done", title: "Write secrets", hint: "Connect Slack", status: "needs-you" },
  ]);
  expect(stdout.join("")).toBe("[needs you] Setup needs you  1 done, 1 needs you\n");
  expect(logged).toEqual([["path.link", "ln -s rt"], ["secrets.write", "Waiting for mattstack.app to finish this step"]]);
});

test("at a terminal a failed step ends with fail, and partial ends with warn", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "plugins.install", state: "running" },
    { event: "step", id: "plugins.install", state: "partial", detail: "2 of 3", remedy: "Retry" },
    { event: "step", id: "repos.clone", state: "running" },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  expect(sent().filter((m) => m.t === "done" || m.t === "fail")).toEqual([
    { t: "done", title: "Install plugins", hint: "2 of 3", status: "warn" },
    { t: "fail", title: "Clone your repos", hint: "clone failed" },
  ]);
  expect(stdout.join("")).toBe("  fix: Retry\n[failed] Setup stopped  1 with a caveat, 1 failed\n");
});

test("a helper that dies on start leaves the run on the plain path", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record, dieOn: "start" });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH  linked\n[ok] Setup is done  1 done\n");
});

test("a helper that cannot start leaves the run on the plain path", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH\n[ok] Setup is done  1 done\n");
});

test("a log line with no step open is a warning line without its warn prefix", async () => {
  await drive(emitter(false), [{ event: "log", id: "verify", line: "warn: setup state not persisted: disk full" }]);
  expect(stdout.join("")).toBe("[warning] setup state not persisted: disk full\n");
  expect(logged).toEqual([["verify", "warn: setup state not persisted: disk full"]]);
});

test("a skipped run is one skipped line", async () => {
  await drive(emitter(false), [{ event: "done", ok: true, skipped: "current" }]);
  expect(stdout.join("")).toBe("[skipped] Nothing to update\n");
});

test("a tip raised while a step runs is a tip callout under that step's line", async () => {
  const e = emitter(false);
  e.emit(plan);
  e.emit({ event: "step", id: "path.link", state: "running" });
  e.tip("path.link", "Saved on this Mac only.");
  e.emit({ event: "step", id: "path.link", state: "done", detail: "linked" });
  e.emit({ event: "done", ok: true });
  await e.flush();
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH  linked\n  tip: Saved on this Mac only.\n[ok] Setup is done  1 done\n");
  expect(logged).toEqual([["path.link", "Saved on this Mac only."]]);
});

test("an id the plan never named falls back to the id", async () => {
  await drive(emitter(false), [
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] path.link\n[ok] Setup is done  1 done\n");
});
```

In `lib/setup/__tests__/apply.test.ts`, two changes. First, the describe at line 1066 (its name begins `wire bytes` and ends in `createNdjsonEmitter`) builds its context with `testCtx({ emit: createNdjsonEmitter((line) => lines.push(line)) })`; change that to `testCtx({ emit: (ev) => lines.push(JSON.stringify(ev) + "\n") })`, rename the describe to `wire bytes`, and change line 11 to `import type { Emit } from "../emit.ts";`. Its assertions stay (the stream is still one compact object per line). Second, append, using the file's `testCtx(overrides)` (a literal `ApplyContext`, so `tip` is an override once the field exists) and `fakeStep(id, outcome)`:

```ts
test("a settings tip raised inside a step reaches ctx.tip, not the log event", async () => {
  const tips: Array<[string, string]> = [];
  const { ctx, events } = testCtx({ tip: (id, line) => tips.push([id, line]) });
  const step: StepDef = {
    ...fakeStep("path.link", { state: "done" }),
    async run() {
      const engine = setSettingsNoticeSink(null);
      // The engine's sink takes the line first; whatever phase 4 adds after it, this test raises the line alone.
      (engine as unknown as (line: string) => void)("Saved on this Mac only.");
      setSettingsNoticeSink(engine);
      return { state: "done" };
    },
  };
  await runApplyWith([step], ctx);
  expect(tips).toEqual([["path.link", "Saved on this Mac only."]]);
  expect(events.some((e) => e.event === "log")).toBe(false);
});
```

Import `setSettingsNoticeSink` at the top of the test from the module `lib/setup/apply.ts` imports it from (read that import line and copy its specifier), so the test and the engine share one sink variable.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/emit.test.ts lib/setup/__tests__/apply.test.ts`
Expected: the emit file FAILS (`createStepEmitter` is not exported); in the apply file only the new tip test FAILS (`tip` is not a known field; the retargeted `wire bytes` describe passes already).

- [ ] **Step 3: Rewrite `lib/setup/emit.ts`**

```ts
/**
 * How a setup run reaches a person. The NDJSON stream is the app's contract
 * and goes through each verb's json seam; this emitter turns the same events
 * into rt-ui steps with titles, not ids. A helper that is missing or dies
 * never costs the person a line: the plain path prints the same words.
 */
import { interactive } from "../ui/gate.ts";
import * as out from "../ui/out.ts";
import type { Block, RenderStatus } from "../ui/protocol.ts";
import { openStep, type StepHandle } from "../ui/spawn.ts";
import type { ApplyEvent, EventId, StepState } from "./contract.ts";

export type Emit = (ev: ApplyEvent) => void;

export interface StepEmitterLabels {
  done: string;
  needsYou: string;
  failed: string;
}

export interface StepEmitterOptions {
  labels: StepEmitterLabels;
  /** Every streamed line, so the log keeps what the screen erases. */
  log: (id: EventId, line: string) => void;
  /** Whether rt-ui may draw the steps; defaults to the stdin gate. */
  interactive?: boolean;
}

export interface StepEmitter {
  emit: Emit;
  /** A settings tip raised while `id` ran; drawn as a tip callout under its step. */
  tip(id: EventId, line: string): void;
  /** Resolves once every step line and the summary are drawn. Await it before exiting. */
  flush(): Promise<void>;
}

type FinalState = Exclude<StepState, "pending" | "running">;
type StepEvent = Extract<ApplyEvent, { event: "step" }>;
type DoneEvent = Extract<ApplyEvent, { event: "done" }>;

interface Running {
  id: EventId;
  title: string;
  handle: StepHandle | null;
  subs: string[];
  tips: string[];
}

const FINAL_STATUS: Record<Exclude<FinalState, "failed">, Exclude<RenderStatus, "failed">> = {
  done: "done",
  skipped: "skipped",
  "needs-you": "needs-you",
  partial: "warn",
};

const SKIPPED_RUN: Record<NonNullable<DoneEvent["skipped"]>, string> = {
  "not-set-up": "Setup has not finished on this Mac yet",
  current: "Nothing to update",
  running: "Another update is already running",
};

const WAITING_FOR_APP = "Waiting for mattstack.app to finish this step";
const SUB_LINES_KEPT = 5;

// The helper only narrates a step; one that cannot start leaves the run on the plain path.
function tryOpenStep(title: string): StepHandle | null {
  try {
    return openStep(title);
  } catch {
    return null;
  }
}

interface Tally {
  done: number;
  skipped: number;
  needsYou: number;
  partial: number;
  failed: number;
}

function countsOf(t: Tally): string[] | undefined {
  const parts: string[] = [];
  if (t.done) parts.push(`${t.done} done`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  if (t.needsYou) parts.push(`${t.needsYou} ${t.needsYou === 1 ? "needs" : "need"} you`);
  if (t.partial) parts.push(`${t.partial} with a caveat`);
  if (t.failed) parts.push(`${t.failed} failed`);
  return parts.length > 0 ? parts : undefined;
}

export function createStepEmitter(opts: StepEmitterOptions): StepEmitter {
  const human = opts.interactive ?? interactive();
  const titles = new Map<string, string>();
  const tally: Tally = { done: 0, skipped: 0, needsYou: 0, partial: 0, failed: 0 };
  let current: Running | null = null;
  let queue: Promise<void> = Promise.resolve();

  const chain = (fn: () => void | Promise<void>): void => {
    queue = queue.then(fn);
  };
  const titleOf = (id: EventId): string => titles.get(id) ?? id;

  function start(id: EventId): void {
    const title = titleOf(id);
    current = { id, title, handle: human ? tryOpenStep(title) : null, subs: [], tips: [] };
  }

  function stream(line: string): void {
    if (!current) {
      out.print(out.line("warn", line.replace(/^warn: /, "")));
      return;
    }
    current.subs.push(line);
    if (current.subs.length > SUB_LINES_KEPT) current.subs.shift();
    current.handle?.sub(line);
  }

  function count(state: FinalState): void {
    if (state === "done") tally.done++;
    else if (state === "skipped") tally.skipped++;
    else if (state === "needs-you") tally.needsYou++;
    else if (state === "partial") tally.partial++;
    else tally.failed++;
  }

  async function finish(ev: StepEvent & { state: FinalState }, running: Running): Promise<void> {
    let status: RenderStatus;
    let painted = false;
    if (ev.state === "failed") {
      status = "failed";
      if (running.handle) painted = await running.handle.fail(running.title, ev.detail);
    } else {
      const ending = FINAL_STATUS[ev.state];
      status = ending;
      // A plain done passes no status: the helper's default ending is the check mark, and the wire carries no status key.
      if (running.handle) painted = await running.handle.done(running.title, ev.detail, ev.state === "done" ? undefined : ending);
    }
    const blocks: Block[] = [];
    if (!painted) {
      blocks.push(out.line(status, running.title, ev.detail));
      if (ev.state === "failed" && running.subs.length > 0) blocks.push(out.verbatim(running.subs));
    }
    if (ev.remedy) blocks.push(out.callout("fix", ev.remedy));
    if (running.tips.length > 0) blocks.push(out.callout("tip", ...running.tips));
    out.print(...blocks);
  }

  function close(ev: DoneEvent): void {
    if (ev.skipped) {
      out.print(out.line("skipped", SKIPPED_RUN[ev.skipped]));
      return;
    }
    const status: RenderStatus = !ev.ok ? "failed" : tally.needsYou > 0 ? "needs-you" : tally.partial > 0 ? "warn" : "done";
    const title = status === "failed" ? opts.labels.failed : status === "done" ? opts.labels.done : opts.labels.needsYou;
    out.print(out.summary(status, title, countsOf(tally)));
  }

  const emit: Emit = (ev) => {
    switch (ev.event) {
      case "plan":
        for (const s of ev.steps) titles.set(s.id, s.title);
        return;
      case "step": {
        if (ev.state === "pending") return;
        if (ev.state === "running") {
          chain(() => start(ev.id));
          return;
        }
        const final = ev as StepEvent & { state: FinalState };
        count(final.state);
        chain(async () => {
          const running = current ?? { id: final.id, title: titleOf(final.id), handle: null, subs: [], tips: [] };
          current = null;
          await finish(final, running);
        });
        return;
      }
      case "log":
        opts.log(ev.id, ev.line);
        chain(() => stream(ev.line));
        return;
      case "need":
        opts.log(ev.id, WAITING_FOR_APP);
        chain(() => stream(WAITING_FOR_APP));
        return;
      case "done":
        chain(() => close(ev));
        return;
    }
  };

  return {
    emit,
    tip(id, line) {
      opts.log(id, line);
      chain(() => {
        if (current) current.tips.push(line);
        else out.print(out.callout("tip", line));
      });
    },
    async flush() {
      await queue;
    },
  };
}
```

- [ ] **Step 4: Add the `tip` hook to the engine**

In `lib/setup/apply.ts`:

- Add to `ApplyContext`, after `log`:

```ts
  /** A settings tip raised while a step ran. Absent, the tip is a `log` line. A tip bypasses the redactor that wraps `emit`: it is rt's own copy, never a child's output. */
  tip?: (id: EventId, line: string) => void;
```

- Change the notice sink line in `runApplyWith` from `setSettingsNoticeSink((line) => ctx.log(step.id, line))` to `setSettingsNoticeSink((line) => (ctx.tip ?? ctx.log)(step.id, line))`. The arrow takes `line` only (see Interfaces: it must type-check against phase 4's two-argument sink too).
- Add to `CreateApplyContextDeps`: `tip?: (id: EventId, line: string) => void;`
- In `createApplyContext`'s `ctx` literal, after `log(id, line) {...},` add `...(deps.tip ? { tip: deps.tip } : {}),`.

- [ ] **Step 5: Delete the allowlist line and run the tests**

Remove `"lib/setup/emit.ts",` from `lib/__tests__/raw-output-allowlist.json`.

Run: `bun test lib/setup/__tests__/emit.test.ts lib/setup/__tests__/apply.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: the emit and apply tests PASS; `typecheck` FAILS only in `commands/setup.ts` and `commands/uninstall.ts` on the deleted `createHumanEmitter` import (Tasks 5 and 7 fix those; the guard passes because the allowlist still lists both files). If `typecheck` reports anything else, fix it here.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/emit.ts lib/setup/__tests__/emit.test.ts lib/setup/apply.ts lib/setup/__tests__/apply.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "setup: a step emitter that draws rt-ui steps from the apply stream

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The checklist as blocks: `setup plan`, `setup status`, bare `rt setup`

**Files:**
- Create: `lib/setup/plan-blocks.ts`
- Create: `lib/setup/__tests__/plan-blocks.test.ts`
- Modify: `commands/setup.ts` (`runPlan`, `setupInteractive`; delete `renderPlanHuman`, `renderFinishLine`, `GLYPH`, `GLYPH_COLOR`, `accountConnectVerb`, `missingAccountLines`, `missingRowLines`)
- Modify: `commands/__tests__/setup-plan.test.ts`, `commands/__tests__/setup-apply.test.ts` (the `setupInteractive` describe)

**Interfaces:**
- Consumes: `out.section`, `out.line`, `out.callout`, `out.summary`, `out.cmd`, `out.print`, `out.fail` (phase 1); `Plan`, `Row`, `RowStatus` (`lib/setup/contract.ts`).
- Produces, exported from `lib/setup/plan-blocks.ts`: `rowStatus(r: Pick<Row, "status" | "kind">): RenderStatus`; `accountConnectVerb(r: Pick<Row, "status" | "action">): string | null`; `rowTitles(plan: Plan, ids: readonly string[]): string[]`; `planBlocks(plan: Plan, mode: "plan" | "status"): Block[]`. Task 8 (`verify`) consumes `rowStatus`.

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/plan-blocks.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { planBlocks, rowStatus, rowTitles } from "../plan-blocks.ts";
import type { Plan, Row } from "../contract.ts";
import { renderPlain } from "../../ui/out-plain.ts";

function row(r: Partial<Row> & Pick<Row, "id" | "title" | "status">): Row {
  return { kind: "tool", why: "x", required: true, optionalNote: null, detail: "", action: null, recheck: "on-change", ...r };
}

function plan(groups: Plan["groups"], extra: Partial<Plan> = {}): Plan {
  return { contract: 1, at: "2026-01-01T00:00:00.000Z", team: { slug: "", name: "", mode: "none" }, groups, canInstall: true, requiredMissing: [], finishBlockedBy: [], ...extra };
}

describe("rowStatus", () => {
  test("ready is done; invalid and error are the only failures", () => {
    expect(rowStatus({ status: "ready", kind: "tool" })).toBe("done");
    expect(rowStatus({ status: "invalid", kind: "account" })).toBe("failed");
    expect(rowStatus({ status: "error", kind: "permission" })).toBe("failed");
  });

  test("a missing account or permission needs the person; a missing tool, access or info row is pending", () => {
    expect(rowStatus({ status: "missing", kind: "account" })).toBe("needs-you");
    expect(rowStatus({ status: "missing", kind: "permission" })).toBe("needs-you");
    expect(rowStatus({ status: "missing", kind: "tool" })).toBe("pending");
    expect(rowStatus({ status: "missing", kind: "access" })).toBe("pending");
    expect(rowStatus({ status: "missing", kind: "info" })).toBe("pending");
  });

  test("needs-you, skipped and checking map to their own states", () => {
    expect(rowStatus({ status: "needs-you", kind: "tool" })).toBe("needs-you");
    expect(rowStatus({ status: "skipped", kind: "tool" })).toBe("skipped");
    expect(rowStatus({ status: "checking", kind: "tool" })).toBe("pending");
  });
});

describe("planBlocks", () => {
  test("one section per group with a ready count, a line per row, the Install summary naming blockers by title", () => {
    const p = plan(
      [
        {
          id: "mac",
          title: "Your Mac",
          rows: [
            row({ id: "perm.fda", kind: "permission", title: "Full Disk Access", status: "missing", detail: "Not granted" }),
            row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" }),
          ],
        },
      ],
      { canInstall: false, requiredMissing: ["perm.fda"] },
    );
    expect(renderPlain(planBlocks(p, "plan"))).toBe(
      "Your Mac (1 of 2 ready)\n" +
        "[needs you] Full Disk Access  Not granted\n" +
        "[ok] Git  2.45\n" +
        "\n" +
        "[needs you] Install is waiting on  Full Disk Access\n",
    );
  });

  test("a ready plan ends in 'Install can run' and plan mode prints no Finish line", () => {
    const p = plan([{ id: "tools", title: "Tools", rows: [row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" })] }]);
    expect(renderPlain(planBlocks(p, "plan"))).toBe("Tools (1 of 1 ready)\n[ok] Git  2.45\n\n[ok] Install can run\n");
  });

  test("status mode adds the Finish line and a next callout under a missing account that has a connect verb", () => {
    const p = plan(
      [
        {
          id: "accounts",
          title: "Accounts",
          rows: [
            row({ id: "account.github", kind: "account", title: "GitHub", status: "missing", detail: "no GitHub account connected", action: { type: "connect", label: "Connect", integration: "github", fields: [] } }),
            row({ id: "account.linear", kind: "account", title: "Linear", status: "missing", detail: "no account connected" }),
          ],
        },
        { id: "tools", title: "Tools", rows: [row({ id: "tool.fast-browser-extension", title: "Fast Browser extension", status: "missing", detail: "Not loaded", finishGated: true })] },
      ],
      { canInstall: true, finishBlockedBy: ["tool.fast-browser-extension"] },
    );
    expect(renderPlain(planBlocks(p, "status"))).toBe(
      "Accounts (0 of 2 ready)\n" +
        "[needs you] GitHub  no GitHub account connected\n" +
        "  next: rt setup github connect\n" +
        "[needs you] Linear  no account connected\n" +
        "\n" +
        "Tools (0 of 1 ready)\n" +
        "[not yet] Fast Browser extension  Not loaded\n" +
        "\n" +
        "[ok] Install can run\n" +
        "[needs you] Finish is waiting on  Fast Browser extension\n",
    );
  });

  test("plan mode never prints the connect callout", () => {
    const p = plan([{ id: "accounts", title: "Accounts", rows: [row({ id: "account.github", kind: "account", title: "GitHub", status: "missing", detail: "x", action: { type: "connect", label: "Connect", integration: "github", fields: [] } })] }]);
    expect(renderPlain(planBlocks(p, "plan"))).not.toContain("next:");
  });

  test("a choose row's footnote is a note callout under its line", () => {
    const p = plan([
      {
        id: "tools",
        title: "Tools",
        rows: [
          row({
            id: "skills.writing-style",
            title: "Writing style",
            required: false,
            status: "needs-you",
            detail: "Not chosen yet",
            action: { type: "choose", label: "Choose style", verb: ["skills", "writing-style", "use"], options: [], footnote: "You can also choose from a terminal: rt skills writing-style use" },
          }),
        ],
      },
    ]);
    expect(renderPlain(planBlocks(p, "plan"))).toContain("[needs you] Writing style  Not chosen yet\n  note: You can also choose from a terminal: rt skills writing-style use\n");
  });

  test("an empty plan is only the Install summary", () => {
    expect(renderPlain(planBlocks(plan([]), "plan"))).toBe("[ok] Install can run\n");
  });

  test("rowTitles resolves ids to titles and keeps an unknown id as it is", () => {
    const p = plan([{ id: "mac", title: "Your Mac", rows: [row({ id: "perm.fda", title: "Full Disk Access", status: "ready" })] }]);
    expect(rowTitles(p, ["perm.fda", "ghost"])).toEqual(["Full Disk Access", "ghost"]);
  });
});
```

In `commands/__tests__/setup-plan.test.ts`:

- Delete the `renderPlanHuman` and `renderFinishLine` describes and the `../../lib/ansi.ts` import; import `capturePlain` from `./helpers/json-line.ts` and change the import from `../setup.ts` to `{ setupPlan, setupStatus, type SetupDeps }`.
- `captureDeps()` keeps `print` (the type still requires it until Task 6) and `json: (v) => lines.push(JSON.stringify(v))`.
- Delete the test `human mode prints the 'rt setup status' header` (line 86): Step 4 drops the header. The test `--team naming an unknown team, human mode: exit 2 with a one-line rt-prefixed message` (line 74) still passes after this task and is rewritten in Task 5, where the message's path changes.
- Rewrite the human tests:

```ts
  test("human mode prints the mac group's section title", async () => {
    const cap = capturePlain();
    try {
      await setupPlan([], {}, captureDeps());
      expect(cap.stdout()).toContain("Your Mac (");
    } finally {
      cap.restore();
    }
  });
```

and, for the existing "Missing accounts" tests (lines 110 to 128 today), assert `cap.stdout()` contains `"[needs you] GitHub"` followed on the next line by `"  next: rt setup github connect"` in status mode, and does not contain `"next: rt setup"` in plan mode. The "Install: blocked by: perm.fda" assertion (line 155) becomes `expect(cap.stdout()).toContain("[needs you] Install is waiting on  Full Disk Access")`; the "Install: ready" one (line 223) becomes `expect(cap.stdout()).toContain("[ok] Install can run")`. The `setupStatus Finish line` describe becomes:

```ts
describe("setupStatus Finish line", () => {
  test("human status prints the Finish line right after the Install summary", async () => {
    const cap = capturePlain();
    try {
      await setupStatus([], {}, captureDeps());
      const rows = cap.stdout().trimEnd().split("\n");
      const install = rows.findIndex((l) => l.includes("Install can run") || l.includes("Install is waiting on"));
      expect(install).toBeGreaterThan(0);
      // The fake home has no home repo, so the writing-style row blocks Finish here.
      expect(rows[install + 1]).toBe("[needs you] Finish is waiting on  Writing style");
    } finally {
      cap.restore();
    }
  });

  test("setup plan (human) prints no Finish line", async () => {
    const cap = capturePlain();
    try {
      await setupPlan([], {}, captureDeps());
      expect(cap.stdout()).not.toContain("Finish");
    } finally {
      cap.restore();
    }
  });
});
```

(The writing-style row's title is whatever `lib/setup/validators/writing-style.ts` sets; read it and use that exact title in the assertion above.)

In `commands/__tests__/setup-apply.test.ts`, the `setupInteractive` describe: the "prints the plan groups" test asserts `cap.stdout()` contains `"Your Mac ("`; the "not ready" test asserts `cap.stderr()` contains `"[failed] This Mac is not ready to install yet"` and `"  why: Waiting on "`. Wrap each in `capturePlain()`/`restore()`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/plan-blocks.test.ts commands/__tests__/setup-plan.test.ts`
Expected: FAIL, cannot find module `../plan-blocks.ts`.

- [ ] **Step 3: Write `lib/setup/plan-blocks.ts`**

```ts
/**
 * The readiness checklist as output blocks: what `rt setup`, `rt setup plan`,
 * `rt setup status` and `rt verify` show a person. The plan itself is the
 * app's contract and is never changed here.
 */
import * as out from "../ui/out.ts";
import type { Block, RenderStatus } from "../ui/protocol.ts";
import type { Plan, Row, RowStatus } from "./contract.ts";

const ROW_STATUS: Record<Exclude<RowStatus, "missing">, RenderStatus> = {
  ready: "done",
  invalid: "failed",
  error: "failed",
  "needs-you": "needs-you",
  skipped: "skipped",
  checking: "pending",
};

/** A missing account or permission waits on the person; anything else missing is what apply installs. */
export function rowStatus(r: Pick<Row, "status" | "kind">): RenderStatus {
  if (r.status === "missing") return r.kind === "account" || r.kind === "permission" ? "needs-you" : "pending";
  return ROW_STATUS[r.status];
}

/** The connect verb for a missing account row; only connect and oauth actions have one. */
export function accountConnectVerb(r: Pick<Row, "status" | "action">): string | null {
  if (r.status !== "missing") return null;
  if (r.action?.type !== "connect" && r.action?.type !== "oauth") return null;
  return `rt setup ${r.action.integration} connect`;
}

export function rowTitles(plan: Plan, ids: readonly string[]): string[] {
  const byId = new Map(plan.groups.flatMap((g) => g.rows).map((r) => [r.id, r.title] as const));
  return ids.map((id) => byId.get(id) ?? id);
}

function rowBlocks(r: Row, mode: "plan" | "status"): Block[] {
  const blocks: Block[] = [out.line(rowStatus(r), r.title, r.detail)];
  if (r.action?.type === "choose" && r.action.footnote) blocks.push(out.callout("note", r.action.footnote));
  const verb = mode === "status" ? accountConnectVerb(r) : null;
  if (verb) blocks.push(out.callout("next", out.cmd(verb)));
  return blocks;
}

export function planBlocks(plan: Plan, mode: "plan" | "status"): Block[] {
  const sections = plan.groups.map((g) => {
    const ready = g.rows.filter((r) => r.status === "ready").length;
    return out.section(g.title, g.rows.length > 0 ? `${ready} of ${g.rows.length} ready` : undefined, ...g.rows.flatMap((r) => rowBlocks(r, mode)));
  });
  const install = plan.canInstall ? out.summary("done", "Install can run") : out.summary("needs-you", "Install is waiting on", rowTitles(plan, plan.requiredMissing));
  const finish =
    mode !== "status" ? [] : plan.finishBlockedBy.length === 0 ? [out.line("done", "Finish can run")] : [out.line("needs-you", "Finish is waiting on", rowTitles(plan, plan.finishBlockedBy).join(", "))];
  return [...sections, install, ...finish];
}
```

- [ ] **Step 4: Convert `runPlan` and `setupInteractive`**

In `commands/setup.ts`:

- Delete `GLYPH`, `GLYPH_COLOR`, `renderPlanHuman`, `renderFinishLine`, `accountConnectVerb`, `missingAccountLines`, `missingRowLines` and the `../lib/ansi.ts` import. Import `{ planBlocks, rowTitles } from "../lib/setup/plan-blocks.ts"`.
- `runPlan` loses its `header` parameter and its tail becomes:

```ts
  if (json) {
    deps.json(plan);
    return;
  }
  out.print(...planBlocks(plan, mode));
```

`setupStatus` calls `runPlan(args, deps, "status", "setup")`.

- `setupInteractive`, after `composePlan`:

```ts
  out.print(...planBlocks(plan, "plan"));

  if (!plan.canInstall && !args.includes("--force")) {
    out.fail({ title: "This Mac is not ready to install yet", why: `Waiting on ${rowTitles(plan, plan.requiredMissing).join(", ")}` });
    return deps.exit(2);
  }
```

- [ ] **Step 5: Run the tests**

Run: `bun test lib/setup/__tests__/plan-blocks.test.ts commands/__tests__/setup-plan.test.ts commands/__tests__/setup-apply.test.ts`
Expected: PASS. (`typecheck` still fails on `createHumanEmitter` until Task 5.)

- [ ] **Step 6: Commit**

```bash
git add lib/setup/plan-blocks.ts lib/setup/__tests__/plan-blocks.test.ts commands/setup.ts commands/__tests__/setup-plan.test.ts commands/__tests__/setup-apply.test.ts
git commit -m "setup: the checklist as sections, titles not ids, missing is not failed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `setup apply`, `setup update`, `setup finish`, `setup intent`, `setup pack`

**Files:**
- Modify: `commands/setup.ts` (the apply, update, pack, intent and finish sections; `exitWithUserError` replaced by the shared one)
- Modify: `lib/setup/update.ts` (delete `summarizeUpdate`), `lib/setup/__tests__/update.test.ts` (delete its describe)
- Modify: `commands/__tests__/setup-apply.test.ts`, `setup-update.test.ts`, `setup-finish.test.ts`, `setup-plan.test.ts` (the unknown-team human test)

**Interfaces:**
- Consumes: `createStepEmitter`, `StepEmitterLabels`, `StepEmitter` (Task 3); `exitWithUserError`, `UserErrorSink` (Task 2); `logCliEvent` (phase 2, `lib/cli-logger.ts`); `out.print`, `out.line`, `out.callout`, `out.cmd`; `UserActionableError` from `lib/errors.ts` (phase 2), with its fourth `options` argument carrying `why` and `next`.
- Produces in `commands/setup.ts`: `const APPLY_LABELS: StepEmitterLabels`, `const UPDATE_LABELS: StepEmitterLabels`, `const NOT_READY_TITLE`, `const HARD_PRECONDITION_COPY: Record<string, { why: string; next?: string }>` (replacing `HARD_PRECONDITION_REMEDY`), `function sinkOf(deps: { json; exit?; probes }): UserErrorSink`, `function stepLog(module: string)`, `function warnLine(json: boolean, title: string, detail: string): void`. `ApplyDeps.printError` is deleted. `AfterFinish` becomes `{ update(opts: { json: boolean }): Promise<void>; warn(title: string, detail: string): void }`; `updateAfterFinish(opts: { json: boolean }, deps?)`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/setup-apply.test.ts`:

- Import `capturePlain` (from `./helpers/json-line.ts`) and `logsDir` (`import { logsDir } from "../../lib/rt-paths.ts";`) and `readdirSync, readFileSync` from `fs`.
- Replace the "human mode never emits JSON" test with:

```ts
  test("human mode prints the step's title and a summary, never JSON or the id", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [{ ...fakeStep("path.link", { state: "done", detail: "ok" }), title: "Link rt onto your PATH" }] });
      await setupApply([], {}, deps);
      expect(cap.stdout()).toBe("[ok] Link rt onto your PATH  ok\n[ok] Setup is done  1 done\n");
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("the summary is printed before exit 2", async () => {
    const cap = capturePlain();
    try {
      let atExit = "";
      const deps = baseApplyDeps({ steps: [{ ...fakeStep("path.link", { state: "failed", detail: "boom" }), title: "Link rt onto your PATH" }] });
      deps.exit = ((code: number) => {
        atExit = cap.stdout();
        deps.exitCodes.push(code);
        throw new Error("exit sentinel");
      }) as ApplyDeps["exit"];
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect(atExit).toBe("[failed] Link rt onto your PATH  boom\n[failed] Setup stopped  1 failed\n");
    } finally {
      cap.restore();
    }
  });
```

- Replace the "a gate that cannot be read ... says so on stderr" test with:

```ts
  test("a finish check that throws under --json reaches the log, never stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], planForFinish: async () => { throw new Error("keychain locked"); }, json: realJson });
      await setupApply(["--json"], {}, deps);
      expect(finished(deps.probes)).toBe(false);
      for (const line of cap.stdout().trim().split("\n")) expect(JSON.parse(line).event).toBeDefined();
      expect(cap.stderr()).toBe("");
      const log = readdirSync(logsDir()).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(`${logsDir()}/${f}`, "utf8")).join("");
      expect(log).toContain("keychain locked");
    } finally {
      cap.restore();
    }
  });

  test("a finish check that throws for a person is a warning line on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], planForFinish: async () => { throw new Error("keychain locked"); } });
      await setupApply([], {}, deps);
      expect(cap.stdout()).toContain("[warning] Setup was left unfinished because the finish check failed  keychain locked\n");
    } finally {
      cap.restore();
    }
  });
```

- Add to the hard-precondition describe:

```ts
  test("for a person the hard gate is a failure block with plain words and the install verb to run", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toBe("[failed] This Mac is not ready to install yet\n  why: Apple's Command Line Tools are not installed\n  next: rt tools install apple-clt\n");
    } finally {
      cap.restore();
    }
  });
```

In the same describe, the existing `--json` hard-gate test's assertion on `error.message` (today's `blocked by: tool.clt ...` wording) becomes `expect(payload.error.message).toBe("This Mac is not ready to install yet: Apple's Command Line Tools are not installed")`; its `error.code` assertion (`not-ready`) and the key-order assertion stay.

- The test `a stamp that cannot be written is reported and does not fail the run` (line 510) passes `printError`, which this task deletes. It runs under `--json`, so the warning's only home is the CLI log; it becomes:

```ts
  test("a stamp that cannot be written is logged and does not fail the run", async () => {
    const probes = fakeProbes();
    const realWrite = probes.writeFile.bind(probes);
    let writes = 0;
    probes.writeFile = (path, content, mode) => {
      if (path.includes("setup-state.json") && ++writes > 1) throw new Error("disk full");
      return realWrite(path, content, mode);
    };
    const deps = baseApplyDeps({ probes, steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });
    await setupApply(["--json"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
    for (const line of deps.lines) expect(JSON.parse(line).event).toBeDefined();
    const log = readdirSync(logsDir()).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(`${logsDir()}/${f}`, "utf8")).join("");
    expect(log).toContain("disk full");
  });
```

- Remove `print` and `printError` from `baseApplyDeps` (keep `json`).

In `commands/__tests__/setup-update.test.ts`: remove `print` from `baseApplyDeps`; the three human tests become stdout captures:

```ts
  test("human mode: not set up is a pending line with the install verb", async () => {
    const cap = capturePlain();
    try {
      await run(updateDeps({ steps: [neverRunsStep("path.link")] }), []);
      expect(cap.stdout()).toBe("[not yet] Setup has not finished on this Mac yet\n  next: rt setup install\n");
    } finally {
      cap.restore();
    }
  });
```

the "current" human assertion becomes `expect(cap.stdout()).toBe("[skipped] Nothing to update  already applied for 2.15.0\n")`, and the "prints the summary" test (line 151) asserts `cap.stdout()` ends with `"[ok] Everything is up to date  2 done\n"` and that the two step titles (`path.link`'s `title` is the id in `updateStep`, so give those two steps titles `"Link rt onto your PATH"` and `"Verify your setup"` in `updateDeps`) appear as `[ok] Link rt onto your PATH  linked` and `[ok] Verify your setup  1 check passed`. Add:

```ts
  test("a needs-you item for a person ends in a needs-you summary and exits 2 after it", async () => {
    const cap = capturePlain();
    try {
      let atExit = "";
      const deps = updateDeps({ steps: [updateStep("verify", { state: "needs-you", detail: "to connect: Slack" })] });
      deps.exit = ((code: number) => { atExit = cap.stdout(); deps.exitCodes.push(code); throw new Error("exit sentinel"); }) as ApplyDeps["exit"];
      await run(deps, []);
      expect(deps.exitCodes).toEqual([2]);
      expect(atExit).toContain("[needs you] The update needs you  1 needs you\n");
    } finally {
      cap.restore();
    }
  });
```

The `after Finish` describe (lines 249 to 270) calls `updateAfterFinish({ json, print })` and asserts the old summary string; both tests fail to compile once `print` and `summarizeUpdate` go. They become:

```ts
  describe("after Finish", () => {
    test("--json prints nothing of its own and a needs-you item does not exit", async () => {
      const deps = updateDeps({
        probes: fakeProbes({ files: { [DAEMON]: "{}" } }),
        steps: [updateStep("verify", { state: "needs-you", detail: "to connect: Slack" })],
      });
      const cap = capturePlain();
      try {
        await updateAfterFinish({ json: true }, deps);
        expect(cap.stdout()).toBe("");
      } finally {
        cap.restore();
      }
      expect(deps.lines).toEqual([]);
      expect(deps.exitCodes).toEqual([]);
      expect(deps.notifications.map((n) => n.id)).toEqual(["setup_update:2.15.0"]);
      expect(readSetupState(deps.probes).lastUpdate?.version).toBe("2.15.0");
    });

    test("human mode draws the run and ends in the update summary", async () => {
      const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}" } }) });
      const cap = capturePlain();
      try {
        await updateAfterFinish({ json: false }, deps);
        expect(cap.stdout()).toEndWith("[ok] Everything is up to date  2 done\n");
      } finally {
        cap.restore();
      }
      expect(deps.lines).toEqual([]);
    });
  });
```

In `commands/__tests__/setup-finish.test.ts`: `lines` assertion for human mode becomes `expect(cap.stdout()).toBe("[ok] Setup is finished on this Mac\n")`; the `AfterFinish` fake's `printError` becomes `warn: (title, detail) => warnings.push(\`${title}: ${detail}\`)` and the assertion `expect(a.warnings).toEqual(["The update after Finish did not finish: boom"])`.

In `lib/setup/__tests__/update.test.ts`: delete the `summarizeUpdate` describe and its import.

In `commands/__tests__/setup-plan.test.ts`: the test `--team naming an unknown team, human mode: exit 2 with a one-line rt-prefixed message` (line 74) asserts a `rt setup: ` prefix on `deps.lines[0]`; the shared `exitWithUserError` this task installs writes a failure block on stderr instead. It becomes:

```ts
  test("--team naming an unknown team, human mode: exit 2 with a failure block on stderr", async () => {
    const cap = capturePlain();
    try {
      const deps = captureDeps();
      const exitCode = await runExpectingExit(() => setupPlan(["--team", "ghost"], {}, deps));
      expect(exitCode).toBe(2);
      expect(deps.lines).toEqual([]);
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toStartWith("[failed] ");
      expect(cap.stderr()).toContain("ghost");
    } finally {
      cap.restore();
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts commands/__tests__/setup-plan.test.ts`
Expected: FAIL (the human strings are still the old ones; `printError`/`print` are still required; `updateAfterFinish` still wants `print`).

- [ ] **Step 3: Convert the verbs**

In `commands/setup.ts`:

Imports: drop `createHumanEmitter, createNdjsonEmitter`; add

```ts
import { createStepEmitter, type Emit, type StepEmitterLabels } from "../lib/setup/emit.ts";
import { exitWithUserError, type UserErrorSink } from "../lib/setup/user-failure.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
```

The `UserActionableError, userErrorPayload` import already reads `"../lib/errors.ts"` (Task 2 repointed it); drop `userErrorPayload` from it once nothing in the file calls it (Task 6 removes the last caller). Drop `summarizeUpdate` from the `update.ts` import.

Delete the local `exitWithUserError` function (the one at "Per-integration verbs") and add, near the top after `flagValue`:

```ts
function sinkOf(deps: { json: (value: unknown) => void; exit?: (code: number) => never; probes: Pick<Probes, "now"> }): UserErrorSink {
  return { json: deps.json, exit: deps.exit ?? process.exit, now: () => deps.probes.now() };
}

const APPLY_LABELS: StepEmitterLabels = { done: "Setup is done", needsYou: "Setup needs you", failed: "Setup stopped" };
const UPDATE_LABELS: StepEmitterLabels = { done: "Everything is up to date", needsYou: "The update needs you", failed: "Part of the update failed" };

/** Streamed step lines go to the log at debug: the screen erases them, the log keeps every level. */
function stepLog(module: string): (id: string, line: string) => void {
  return (id, line) => logCliEvent("debug", module, line, { step: id });
}

/** A caveat worth a line for a person; under --json only the log keeps it, since stdout is the stream. */
function warnLine(json: boolean, title: string, detail: string): void {
  logCliEvent("warn", "setup", `${title}: ${detail}`);
  if (!json) out.print(out.line("warn", title, detail));
}
```

Every remaining `exitWithUserError(err, json, verb, deps)` call in the file becomes `exitWithUserError(err, json, sinkOf(deps))` (Task 6 adds the human words where a verb has them). Delete the now-unused `verb` constants only where nothing else reads them.

`ApplyDeps`: delete `printError`. `realApplyDeps`: delete `print`.

Replace `HARD_PRECONDITION_REMEDY` and the tail of `gateHardPreconditions` (leave `HARD_PRECONDITION_IDS` and the gate's plan lookup as they are). The message is copy and the envelope gains no key, so the plain words ride phase 2's `why` and `next` options and the message carries the same words for the tray, which displays `error.message`:

```ts
const NOT_READY_TITLE = "This Mac is not ready to install yet";

const HARD_PRECONDITION_COPY: Record<string, { why: string; next?: string }> = {
  "tool.clt": { why: "Apple's Command Line Tools are not installed", next: "rt tools install apple-clt" },
  "tool.macos": { why: "rt needs macOS 14 or newer" },
};

async function gateHardPreconditions(args: string[], deps: ApplyDeps): Promise<void> {
  if (args.includes("--force")) return;
  const plan = await (deps.planForGate?.() ??
    composePlan({ p: deps.probes, secrets: deps.secretPresence ?? realSecretPresence(), ci: process.env.CI === "true", mode: "plan", teams: listTeams() }));
  const hard = plan.requiredMissing.filter((id) => HARD_PRECONDITION_IDS.has(id));
  if (hard.length === 0) return;
  // A hard id with no copy entry still names itself, so the person is never told nothing.
  const copy = hard.map((id): { why: string; next?: string } => HARD_PRECONDITION_COPY[id] ?? { why: `${id} is not ready` });
  const why = copy.map((c) => c.why).join(". ");
  const next = copy.length === 1 ? copy[0]!.next : undefined;
  throw new UserActionableError("not-ready", `${NOT_READY_TITLE}: ${why}`, {}, { why, ...(next ? { next } : {}) });
}
```

`setupApply` becomes:

```ts
export async function setupApply(args: string[], _ctx: CommandContext = {}, deps: ApplyDeps = realApplyDeps()): Promise<void> {
  const json = args.includes("--json");
  const human = json ? null : createStepEmitter({ labels: APPLY_LABELS, log: stepLog("setup.apply") });
  const emit: Emit = human ? human.emit : (ev) => deps.json(ev);

  let result: { ok: boolean; failedStep?: StepId };
  let selection: { from?: StepId; only?: StepId } = {};
  try {
    await gateHardPreconditions(args, deps);
    selection = resolveStepSelection(args);
    const ctx: ApplyContext = await createApplyContext({
      probes: deps.probes,
      emit,
      secrets: deps.secrets,
      relay: deps.relay,
      secretPresence: deps.secretPresence,
      flags: applyFlags(args),
      needOpts: deps.needOpts,
      ...(human ? { tip: human.tip } : {}),
    });
    result = await runApplyWith(deps.steps ?? STEPS, ctx, selection);
  } catch (err) {
    await human?.flush();
    if (err instanceof UserActionableError) return exitWithUserError(err, json, sinkOf(deps), err.code === "not-ready" ? { title: NOT_READY_TITLE } : undefined);
    throw err;
  }

  await human?.flush();
  if (!result.ok) return deps.exit(2);
  if (selection.from === undefined && selection.only === undefined) {
    stampUpdateWhenNothingPends(deps, json);
    await finishIfClear(deps, json);
  }
}
```

Keep the two long comments above `setupApply` and inside its catch that explain the bug-vs-user-error split; delete the sentence in the first that says "prints through `deps.print`/`emit`".

`stampUpdateWhenNothingPends(deps, json)` and `finishIfClear(deps, json)` take the `json` flag and their catches become `warnLine(json, "The update version was not saved", message)` and `warnLine(json, "Setup was left unfinished because the finish check failed", message)`.

`setupUpdate`:

```ts
export async function setupUpdate(args: string[], _ctx: CommandContext = {}, deps: ApplyDeps = realApplyDeps()): Promise<void> {
  const json = args.includes("--json");
  const human = json ? null : createStepEmitter({ labels: UPDATE_LABELS, log: stepLog("setup.update") });
  const emit: Emit = human ? human.emit : (ev) => deps.json(ev);
  const version = deps.version ?? rtVersion();

  for (const flag of ["--from", "--only"]) {
    if (args.includes(flag)) {
      const err = new UserActionableError("unknown-flag", `${flag} does not apply to an update, which always runs every safe step`);
      return exitWithUserError(err, json, sinkOf(deps));
    }
  }

  const decision = decideUpdate(deps.probes, version, args.includes("--force"));
  if (decision.kind === "not-set-up") {
    if (json) emit({ event: "done", ok: true, skipped: "not-set-up" });
    else out.print(out.line("pending", "Setup has not finished on this Mac yet"), out.callout("next", out.cmd("rt setup install")));
    return;
  }
  if (decision.kind === "current") {
    if (json) emit({ event: "done", ok: true, skipped: "current" });
    else out.print(out.line("skipped", "Nothing to update", `already applied for ${decision.version}`));
    return;
  }
  ...
  if (busy) {
    if (json) emit({ event: "done", ok: true, skipped: "running" });
    else out.print(out.line("skipped", "Another update is already running"));
    return;
  }
```

Inside the run, delete `if (!json) deps.print(\`setup update: ${summarizeUpdate(result.outcomes)}\`);` and, after the `finally { lock?.release(); }`, add `await human?.flush();` before `if (needsAttention) deps.exit(2);`. The `--from/--only` message is copy and takes the new wording above; `commands/__tests__/setup-update.test.ts:230` asserts only `error.code` (`unknown-flag`), which stays.

`setupPack`: `deps.print(json ? ... : \`setup pack: ...\`)` becomes `if (json) deps.json(envelope({ ok: true, detail: result.detail }, deps.probes.now())); else out.print(out.line("done", "Pack is set up", result.detail));` and its catch becomes `if (err instanceof UserActionableError) return exitWithUserError(err, json, sinkOf(deps));`.

`IntentDeps`: delete `print`; `realIntentDeps` likewise. `printIntentResult`:

```ts
function printIntentResult(deps: IntentDeps, json: boolean, body: Record<string, unknown>): void {
  if (json) {
    deps.json(envelope(body, deps.probes.now()));
    return;
  }
  out.print(out.line("done", "Setup intent recorded", `${body.mode}${body.homeRepo ? ` ${body.homeRepo}` : ""}`));
}
```

`setupIntent`'s catch: `return exitWithUserError(err, json, sinkOf(deps));`.

`AfterFinish` and `setupFinish`:

```ts
export interface AfterFinish {
  update(opts: { json: boolean }): Promise<void>;
  warn(title: string, detail: string): void;
}

export async function updateAfterFinish(opts: { json: boolean }, deps: ApplyDeps = realApplyDeps()): Promise<void> {
  const quiet: ApplyDeps = { ...deps, json: opts.json ? () => {} : deps.json, exit: (() => undefined) as unknown as ApplyDeps["exit"] };
  await setupUpdate(opts.json ? ["--json"] : [], {}, quiet);
}

const REAL_AFTER_FINISH: AfterFinish = {
  update: (opts) => updateAfterFinish(opts),
  warn: (title, detail) => out.print(out.line("warn", title, detail)),
};

export async function setupFinish(args: string[], _ctx: CommandContext = {}, deps: FinishDeps = realIntentDeps(), after: AfterFinish = REAL_AFTER_FINISH): Promise<void> {
  const json = args.includes("--json");
  const { finishedAt } = markSetupFinished(deps.probes);
  if (json) deps.json(envelope({ ok: true, finishedAt }, deps.probes.now()));
  else out.print(out.line("done", "Setup is finished on this Mac"));

  try {
    await after.update({ json });
  } catch (err) {
    after.warn("The update after Finish did not finish", err instanceof Error ? err.message : String(err));
  }
}
```

Keep the comment above the `try` about the launch-time update run.

In `lib/setup/update.ts`, delete `GROUPS` and `summarizeUpdate`.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts commands/__tests__/setup-plan.test.ts lib/setup/__tests__/update.test.ts && bun run typecheck`
Expected: PASS. `typecheck` may still report `commands/uninstall.ts` (Task 7) and nothing else.

- [ ] **Step 5: Commit**

```bash
git add commands/setup.ts lib/setup/update.ts lib/setup/__tests__/update.test.ts commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts commands/__tests__/setup-plan.test.ts
git commit -m "setup apply, update, finish: rt-ui steps with titles, a summary, failures as blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Integration status and connect, `slack create-app`, `waive`, `unwaive`, `repo-root set`, `home remote set`; `print` leaves `commands/setup.ts`

**Files:**
- Modify: `commands/setup.ts` (the remaining human sites; delete `print` from `SetupDeps`, `RepoRootDeps`, `HomeRemoteDeps`, `WaiveDeps` and every `real*Deps`; delete `printError` from `WaiveDeps`)
- Modify: `commands/__tests__/setup-connect.test.ts`, `setup-repo-root.test.ts`, `setup-waive.test.ts` (and any other test still passing `print` to a setup deps object)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/setup.ts`)

**Interfaces:**
- Consumes: `exitWithUserError`, `sinkOf` (Tasks 2 and 5); `integrationDef(id).title` (existing, `lib/setup/integrations.ts`); `out.line`, `out.callout`, `out.print`, `out.fail`.
- Produces: `IntegrationResult` type in `commands/setup.ts` (`{ integration: Integration; status: "ready" | "missing" | "invalid"; detail: string; scopesSeen: string[]; handle?: string; owners?: string[] }`), the typed body `printIntegrationResult` takes. After this task no setup deps interface has `print` or `printError`, and `commands/setup.ts` has no `console.*` and no color import.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/setup-connect.test.ts`: remove `print` from the deps factory; the test at line 115 (`deps.lines.join("\n")` contains `"unverified"`) becomes a stderr capture: wrap in `capturePlain()` and assert `cap.stderr()` contains `"[failed] "` and `"unverified"`. Add:

```ts
  test("human mode prints one line with the integration's title, never its id", async () => {
    const cap = capturePlain();
    try {
      // copy the setup of the "gitlab connect ready" test above, without --json
      ...
      expect(cap.stdout()).toMatch(/^\[ok\] GitLab  /);
      expect(cap.stdout()).not.toContain("gitlab:");
    } finally {
      cap.restore();
    }
  });
```

In `commands/__tests__/setup-repo-root.test.ts`: remove `print`; the TTY-usage test (line 175) under `--json` keeps its envelope assertion; add a human sibling asserting `cap.stderr()` is `"[failed] Which folder?\n  next: rt setup repo-root set <folder>\n"`. Add a human happy-path sibling asserting `cap.stdout()` is `` `[ok] Repo folder saved  ${dev}\n` ``.

In `commands/__tests__/setup-waive.test.ts`: remove `print` and `printError`; the human assertions become:

- waive changed: `expect(cap.stdout()).toBe("[ok] Skipped on this Mac  tool.fast-browser-extension\n")`
- usage (line 87): `expect(cap.stderr()).toBe("[failed] Which row?\n  next: rt setup waive <row-id>\n")`
- store failure (line 117): `expect(cap.stderr()).toBe("[failed] Could not save the change\n  why: settings.local.jsonc: duplicate key\n")` and the exit code stays 1
- unwaive changed: `"[ok] Re-armed on this Mac  tool.fast-browser-extension\n"`; unchanged: `"[skipped] Was not skipped on this Mac  tool.fast-browser-extension\n"`

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/setup-connect.test.ts commands/__tests__/setup-repo-root.test.ts commands/__tests__/setup-waive.test.ts`
Expected: FAIL on the new strings.

- [ ] **Step 3: Convert**

In `commands/setup.ts`:

`SetupDeps`, `RepoRootDeps`, `HomeRemoteDeps`, `WaiveDeps`: delete `print`; `WaiveDeps`: delete `printError`. `realSetupDeps`, `realRepoRootDeps`, `realHomeRemoteDeps`, `realWaiveDeps`, `realConnectDeps`: delete `print`/`printError`. `setupInteractive`'s `setupDeps` literal: delete `print`.

`setupRepoRootSet`: the usage throw keeps its message; the success print becomes

```ts
    if (json) deps.json(envelope({ path: check.path, tccWarning: check.tccWarning }, deps.probes.now()));
    else out.print(out.line("done", "Repo folder saved", check.path), ...(check.tccWarning ? [out.callout("note", check.tccWarning)] : []));
```

and its catch `return exitWithUserError(err, json, sinkOf(deps), err.code === "usage" ? { title: "Which folder?", next: out.cmd("rt setup repo-root set <folder>") } : undefined);`.

`homeRemoteSet` success:

```ts
    if (json) deps.json(envelope({ url, remote, pushed: true, created }, deps.probes.now()));
    else out.print(out.line("done", created ? "Created a private repo and pushed your home repo to it" : "Pushed your home repo", url));
```

catch: `return exitWithUserError(err, json, sinkOf(deps), err.code === "usage" ? { title: "Which remote?", next: out.cmd("rt home remote set <url>") } : undefined);`.

`printIntegrationResult`:

```ts
interface IntegrationResult {
  integration: Integration;
  status: IntegrationRowStatus;
  detail: string;
  scopesSeen: string[];
  handle?: string;
  owners?: string[];
}

const INTEGRATION_STATUS: Record<IntegrationRowStatus, RenderStatus> = { ready: "done", missing: "needs-you", invalid: "failed" };

function printIntegrationResult(deps: SetupDeps, json: boolean, body: IntegrationResult): void {
  if (json) {
    deps.json(envelope(body, deps.probes.now()));
    return;
  }
  out.print(out.line(INTEGRATION_STATUS[body.status], integrationDef(body.integration).title, body.detail));
}
```

(import `type RenderStatus` from `../lib/ui/protocol.ts`; move the `IntegrationRowStatus` type above this function). Every call site already builds the object in the order `integration, status, detail, scopesSeen[, handle, owners]`; `integrationStatus` builds `body` as `Record<string, unknown>` today, change it to `const body: IntegrationResult = { integration: id, status: r.status, detail: r.detail, scopesSeen: r.scopesSeen }; if (r.handle) body.handle = r.handle; if (r.owners) body.owners = r.owners;`.

`runWaiver`:

```ts
const WAIVER_LINES: Record<"waive" | "unwaive", Record<"changed" | "unchanged", [RenderStatus, string]>> = {
  waive: { changed: ["done", "Skipped on this Mac"], unchanged: ["skipped", "Already skipped on this Mac"] },
  unwaive: { changed: ["done", "Re-armed on this Mac"], unchanged: ["skipped", "Was not skipped on this Mac"] },
};
```

- the usage refusal: `return exitWithUserError(new UserActionableError("usage", \`usage: rt setup ${verb} <row-id> [--json]\`), json, sinkOf(deps), { title: "Which row?", next: out.cmd(\`rt setup ${verb} <row-id>\`) });`
- the store failure branch: `out.fail({ title: "Could not save the change", why: err instanceof Error ? err.message : String(err) }); return deps.exit(1);`
- the tail: `if (json) { deps.json(envelope({ ok: true, id, changed: change.changed, waived: change.waived }, deps.probes.now())); return; } const [status, title] = WAIVER_LINES[verb][change.changed ? "changed" : "unchanged"]; out.print(out.line(status, title, id));`

Delete `WAIVER_COPY`.

Every remaining `exitWithUserError(err, json, verb, deps)` (integrationStatus, integrationConnect, setupSlackCreateApp) becomes `exitWithUserError(err, json, sinkOf(deps))`; delete the `verb` constants they fed. Search the file for `deps.print`, `console.`, `ansi.ts`, `userErrorPayload`: none may remain (drop the `userErrorPayload` import if unused).

Remove `"commands/setup.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 4: Run every setup test, the guard and typecheck**

Run: `bun test commands/__tests__/setup-plan.test.ts commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-connect.test.ts commands/__tests__/setup-repo-root.test.ts commands/__tests__/setup-waive.test.ts commands/__tests__/setup-finish.test.ts commands/__tests__/tools-setup.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS (typecheck may still name `commands/uninstall.ts`).

- [ ] **Step 5: Commit**

```bash
git add commands/setup.ts commands/__tests__/ lib/__tests__/raw-output-allowlist.json
git commit -m "setup: connect, status, waive, repo-root and home remote on the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `rt uninstall`

**Files:**
- Modify: `commands/uninstall.ts`
- Modify: `commands/__tests__/uninstall.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/uninstall.ts`)

**Interfaces:**
- Consumes: `createStepEmitter`, `StepEmitterLabels` (Task 3); `exitWithUserError` (Task 2); `logCliEvent` (phase 2); `out.section`, `out.changes`, `out.line`, `out.print`.
- Produces: `UNINSTALL_LABELS`; `UninstallDeps` without `print`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/uninstall.test.ts`: remove `print` from `baseDeps` (keep `json`). The human test at line 217 becomes:

```ts
  test("human mode: a failure block naming the argument, nothing on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseDeps();
      await runExpectingExit(() => runUninstallCommand(["gitq"], {}, deps));
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toMatch(/^\[failed\] [Uu]nexpected argument "gitq"\. /);
    } finally {
      cap.restore();
    }
  });
```

The "stayed" test becomes `expect(cap.stdout()).toContain("Kept on this Mac\n[skipped] ~/.mattstack (kept)\n")`. Add:

```ts
  test("human --dry-run lists what would go as a changes block", async () => {
    const cap = capturePlain();
    try {
      await runUninstallCommand(["--dry-run"], {}, baseDeps());
      expect(cap.stdout()).toBe("This would remove\n- Stop and remove the rt daemon and deck services\n");
    } finally {
      cap.restore();
    }
  });

  test("a human run draws each action as a step by title and ends in a summary", async () => {
    const cap = capturePlain();
    try {
      await runUninstallCommand(["--yes"], {}, baseDeps({ isTTY: () => false }));
      expect(cap.stdout()).toContain("[ok] Stop and remove the rt daemon and deck services");
      expect(cap.stdout()).toContain("[ok] mattstack is uninstalled  1 done\n");
    } finally {
      cap.restore();
    }
  });
```

(`baseDeps` already supplies one `services.unregister` action; if that action's fake `run` does not end `done`, read the fixture and match the state it produces.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/uninstall.test.ts`
Expected: FAIL.

- [ ] **Step 3: Convert**

In `commands/uninstall.ts`: replace the `emit.ts` import, keep the `UserActionableError` import Task 2 already pointed at `../lib/errors.ts` (drop `userErrorPayload` from it), and add the rest:

```ts
import { createStepEmitter, type Emit, type StepEmitterLabels } from "../lib/setup/emit.ts";
import { exitWithUserError } from "../lib/setup/user-failure.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import * as out from "../lib/ui/out.ts";
```

Delete `print` from `UninstallDeps` and `realUninstallDeps`. Add `const UNINSTALL_LABELS: StepEmitterLabels = { done: "mattstack is uninstalled", needsYou: "Uninstall needs you", failed: "Uninstall stopped" };`.

In `runUninstallCommand`:

- dry run: `if (json) deps.json(payload); else out.print(out.section("This would remove", undefined, out.changes(payload.actions.map((a) => ({ op: "-" as const, name: a.title })))));`
- the confirm list: `out.print(out.section("This will remove", undefined, out.changes(actions.map((a) => ({ op: "-" as const, name: a.title })))));`
- the emitter:

```ts
    const human = json ? null : createStepEmitter({ labels: UNINSTALL_LABELS, log: (id, line) => logCliEvent("debug", "uninstall", line, { step: id }) });
    const emit: Emit = human ? human.emit : (ev) => deps.json(ev);
```

- after `runUninstall`: `await human?.flush();` then `if (!json && result.stayed.length > 0) out.print(out.section("Kept on this Mac", undefined, ...result.stayed.map((s) => out.line("skipped", s))));`
- the catch: `if (err instanceof UserActionableError) return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => deps.probes.now() });`

Remove `"commands/uninstall.ts",` from the allowlist.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/uninstall.test.ts commands/__tests__/daemon-uninstall-start.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add commands/uninstall.ts commands/__tests__/uninstall.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "uninstall: steps by title, a changes list, kept items as skipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `rt verify`

**Files:**
- Modify: `commands/verify.ts`
- Create: `commands/__tests__/verify-output.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/verify.ts`)

**Interfaces:**
- Consumes: `rowStatus` (Task 4); `composePlan`, `realSecretPresence` (existing); `out.section`, `out.line`, `out.callout`, `out.cmd`, `out.summary`, `out.print`, `out.json`.
- Produces: `interface VerifyDeps { probes: Probes; secrets: SecretPresence; teams: () => string[]; exit: (code: number) => never }`, `realVerifyDeps()`, `runVerify(args, _ctx?, deps?)`, `verifyPayload(results: CheckResult[], plan: Plan)` (exported; the exact object `--json` prints), `verifyBlocks(plan: Plan, opts: { ci: boolean }): Block[]` (exported). `rowsToChecks`, `rowToCheck`, `checkRtContextExtension` unchanged.

- [ ] **Step 1: Write the failing test**

Create `commands/__tests__/verify-output.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import { runVerify, rowsToChecks, verifyPayload, type VerifyDeps } from "../verify.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan } from "../../lib/setup/contract.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";

const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());
const secrets: SecretPresence = { async has() { return null; } };

function deps(): VerifyDeps & { exitCodes: number[] } {
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ exec: readyExec }),
    secrets,
    teams: () => [],
    exit: ((code: number) => { exitCodes.push(code); throw new Error("exit sentinel"); }) as VerifyDeps["exit"],
    exitCodes,
  };
}

async function run(d: VerifyDeps, args: string[]): Promise<void> {
  try {
    await runVerify(args, {}, d);
  } catch (err) {
    if (!(err instanceof Error && err.message === "exit sentinel")) throw err;
  }
}

let cap: ReturnType<typeof capturePlain> | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

describe("rt verify --json", () => {
  test("stdout is exactly the two-space-indented payload for the plan composePlan returns", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, ["--json"]);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const expected = verifyPayload(rowsToChecks(plan, { ci: false }), plan);
    expect(cap.stdout()).toBe(JSON.stringify(expected, null, 2) + "\n");
    expect(Object.keys(expected)).toEqual(["passed", "summary", "checks", "plan"]);
    expect(cap.stderr()).toBe("");
  });
});

describe("rt verify for a person", () => {
  test("one section per group, every row by title, and a summary line last", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, []);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const rows = cap.stdout().trimEnd().split("\n");
    for (const g of plan.groups) expect(rows).toContain(g.title);
    const titles = new Set(plan.groups.flatMap((g) => g.rows.map((r) => r.title)));
    const statusRows = rows.filter((l) => /^\[[a-z ]+\] /.test(l)).slice(0, -1);
    for (const l of statusRows) expect(titles.has(l.replace(/^\[[a-z ]+\] /, "").split("  ")[0]!)).toBe(true);
    expect(rows.at(-1)).toMatch(/^\[(ok|failed)\] (Everything checks out|\d+ checks? failed)  \d+ passed, \d+ warnings?$/);
    expect(cap.stderr()).toBe("");
  });

  test("a critical failure exits 1 after the summary; --ci spares the rows CI cannot satisfy", async () => {
    cap = capturePlain();
    const d = deps();
    await run(d, []);
    const plan: Plan = await composePlan({ p: d.probes, secrets, ci: false, mode: "status", teams: [] });
    const failing = rowsToChecks(plan, { ci: false }).some((c) => c.status === "fail" && c.severity === "critical");
    expect(d.exitCodes).toEqual(failing ? [1] : []);
    if (failing) expect(cap.stdout()).toMatch(/\[failed\] \d+ checks? failed/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/verify-output.test.ts`
Expected: FAIL, `verifyPayload` and `VerifyDeps` are not exported.

- [ ] **Step 3: Convert `commands/verify.ts`**

Replace the `../lib/tui.ts` import with `import * as out from "../lib/ui/out.ts";`, `import type { Block, RenderStatus } from "../lib/ui/protocol.ts";`, `import { rowStatus } from "../lib/setup/plan-blocks.ts";`, `import type { Probes } from "../lib/setup/probes.ts";`, `import type { SecretPresence } from "../lib/setup/validators/accounts.ts";` and `import type { CommandContext } from "../lib/command-tree.ts";`. Keep `rowToCheck`, `rowsToChecks` and the row-sparing tables exactly as they are.

Replace the "Output formatters" section with:

```ts
// ─── Output ──────────────────────────────────────────────────────────────────

export function verifyPayload(results: CheckResult[], plan: Plan) {
  const failures = results.filter((r) => r.status === "fail" && r.severity === "critical");
  return {
    passed: failures.length === 0,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      warn: results.filter((r) => r.status === "warn").length,
      skip: results.filter((r) => r.status === "skip").length,
    },
    checks: results,
    plan,
  };
}

function checkStatus(r: Row, c: CheckResult): RenderStatus {
  if (c.status === "pass") return "done";
  if (c.status === "skip") return "skipped";
  if (c.status === "fail") return "failed";
  const own = rowStatus(r);
  return own === "failed" ? "warn" : own;
}

/** A command the person can run for a row that is not passing; the app's other buttons have no terminal form. */
function nextVerb(r: Row): string | null {
  const a = r.action;
  if (!a) return null;
  if (a.type === "connect" || a.type === "oauth") return `rt setup ${a.integration} connect`;
  if (a.type === "run") return `rt ${a.verb.join(" ")}`;
  return null;
}

export function verifyBlocks(plan: Plan, opts: { ci: boolean }): Block[] {
  const sections = plan.groups.map((g) =>
    out.section(
      g.title,
      undefined,
      ...g.rows.flatMap((r) => {
        const c = rowToCheck(r, opts);
        const blocks: Block[] = [out.line(checkStatus(r, c), r.title, r.detail)];
        const verb = c.status === "pass" || c.status === "skip" ? null : nextVerb(r);
        if (verb) blocks.push(out.callout("next", out.cmd(verb)));
        return blocks;
      }),
    ),
  );
  const results = rowsToChecks(plan, opts);
  const failures = results.filter((r) => r.status === "fail" && r.severity === "critical").length;
  const warnings = results.filter((r) => r.status === "warn" || (r.status === "fail" && r.severity === "warning")).length;
  const passes = results.filter((r) => r.status === "pass").length;
  const counts = [`${passes} passed`, `${warnings} ${warnings === 1 ? "warning" : "warnings"}`];
  const summary = failures === 0 ? out.summary("done", "Everything checks out", counts) : out.summary("failed", `${failures} ${failures === 1 ? "check" : "checks"} failed`, counts);
  return [...sections, summary];
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export interface VerifyDeps {
  probes: Probes;
  secrets: SecretPresence;
  teams: () => string[];
  exit: (code: number) => never;
}

export function realVerifyDeps(): VerifyDeps {
  return { probes: createRealProbes(), secrets: realSecretPresence(), teams: listTeams, exit: process.exit };
}

export async function runVerify(args: string[], _ctx: CommandContext = {}, deps: VerifyDeps = realVerifyDeps()): Promise<void> {
  // One CI notion for row sparing: --ci without the env var must spare
  // account.*/access.* exactly like CI=true does.
  const ci = args.includes("--ci") || process.env.CI === "true";
  const json = args.includes("--json");

  const plan = await composePlan({ p: deps.probes, secrets: deps.secrets, ci, mode: "status", teams: deps.teams() });
  const results = rowsToChecks(plan, { ci });
  const failures = results.filter((r) => r.status === "fail" && r.severity === "critical");

  if (json) out.json(verifyPayload(results, plan), 2);
  else out.print(...verifyBlocks(plan, { ci }));

  if (failures.length > 0) return deps.exit(1);
}
```

Update the file's header comment: drop the `--ci` "minimal output" line (a CI runner has no TTY, so it gets the plain text) and keep the two other usage lines. Remove `"commands/verify.ts",` from the allowlist.

Check the command tree node for `verify` (`lib/command-tree-def.ts`, the `verify:` entry): its `fn: "runVerify"` and args are unchanged, so no `docs:gen`.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/verify-output.test.ts commands/__tests__/verify.test.ts commands/__tests__/verify-mapping.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/verify.ts commands/__tests__/verify-output.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "verify: sections by group, rows by title, a summary, json untouched

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `rt accounts`

**Files:**
- Modify: `commands/accounts.ts`
- Modify: `commands/__tests__/accounts.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/accounts.ts`)

**Interfaces:**
- Consumes: `out.table`, `out.line`, `out.callout`, `out.cmd`, `out.print`, `out.fail`, `out.json`; `readAllCredentialHealth`, `CredentialHealthRow` (existing).
- Produces: `interface AccountsDeps { db: () => Database; recheck: () => Promise<boolean>; now: () => number; exit: (code: number) => never }`, `realAccountsDeps()`, `run(args, _ctx?, deps?)`, `accountsBlocks(rows: CredentialHealthRow[], now: number): Block[]` (exported). `formatAccountsJson` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/accounts.test.ts` (add imports: `run, accountsBlocks, type AccountsDeps` from `../accounts.ts`; `capturePlain` from `./helpers/json-line.ts`; `renderPlain` from `../../lib/ui/out-plain.ts`; `afterEach` from `bun:test`):

```ts
let cap: ReturnType<typeof capturePlain> | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

function deps(over: Partial<AccountsDeps> = {}): AccountsDeps & { exitCodes: number[] } {
  const exitCodes: number[] = [];
  return { db: () => db, recheck: async () => true, now: () => 10_000_000, exit: ((code: number) => { exitCodes.push(code); throw new Error("exit sentinel"); }) as AccountsDeps["exit"], exitCodes, ...over };
}

async function go(d: AccountsDeps, args: string[]): Promise<void> {
  try {
    await run(args, {}, d);
  } catch (err) {
    if (!(err instanceof Error && err.message === "exit sentinel")) throw err;
  }
}

describe("rt accounts --json bytes", () => {
  test("stdout is exactly the compact formatAccountsJson line", async () => {
    cap = capturePlain();
    await go(deps(), ["--json"]);
    expect(cap.stdout()).toBe(JSON.stringify(formatAccountsJson(db)) + "\n");
  });

  test("a failed recheck under --json is the one-line error object and exit 1", async () => {
    cap = capturePlain();
    const d = deps({ recheck: async () => false });
    await go(d, ["--json", "--recheck"]);
    expect(cap.stdout()).toBe('{"ok":false,"error":"Recheck failed. Is the daemon running?"}\n');
    expect(d.exitCodes).toEqual([1]);
  });
});

describe("rt accounts for a person", () => {
  test("no rows yet is a pending line with the recheck command", () => {
    expect(renderPlain(accountsBlocks([], 0))).toBe("[not yet] No account checks have run yet\n  next: rt accounts --recheck\n");
  });

  test("rows are a table with a status word per account", () => {
    writeCredentialHealth(db, { integration: "github", status: "ready", detail: "ok", expiresAt: "2026-12-01", checkedAt: 10_000_000 - 120_000, lastNotifiedAt: null, lastNotifiedKind: null });
    writeCredentialHealth(db, { integration: "gitlab", status: "invalid", detail: "401", expiresAt: null, checkedAt: 10_000_000 - 3 * 3_600_000, lastNotifiedAt: null, lastNotifiedKind: null });
    const rows = readAllCredentialHealth(db);
    expect(renderPlain(accountsBlocks(rows, 10_000_000))).toBe(
      "ACCOUNT  STATUS    EXPIRES     CHECKED  DETAIL\n" +
        "github   working   2026-12-01  2m ago   ok\n" +
        "gitlab   rejected              3h ago   401\n",
    );
  });

  test("a failed recheck for a person is a failure block on stderr, exit 1", async () => {
    cap = capturePlain();
    const d = deps({ recheck: async () => false });
    await go(d, ["--recheck"]);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toBe("[failed] Could not recheck your accounts\n  why: The rt daemon did not answer\n  next: rt daemon start\n");
    expect(d.exitCodes).toEqual([1]);
  });

  test("a successful recheck prints a done line before the table", async () => {
    cap = capturePlain();
    await go(deps(), ["--recheck"]);
    expect(cap.stdout()).toMatch(/^\[ok\] Rechecked your accounts\n/);
  });
});
```

(Add `readAllCredentialHealth` to the existing `../../lib/credential-health/db.ts` import. In the table test, the rows come back in whatever order `readAllCredentialHealth` returns; if that is not insertion order, sort the expectation to match.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/accounts.test.ts`
Expected: FAIL, `run` takes no deps and `accountsBlocks` is not exported.

- [ ] **Step 3: Convert `commands/accounts.ts`**

Replace everything after `formatAccountsJson` with:

```ts
const STATUS_ROLE: Record<CredentialHealthRow["status"], RenderStatus> = { ready: "done", invalid: "failed", error: "warn" };
const STATUS_WORD = Object.fromEntries(
  (Object.keys(STATUS_ROLE) as CredentialHealthRow["status"][]).map((s) => [s, { text: CREDENTIAL_STATUS_WORD[s], role: STATUS_ROLE[s] }]),
) as Record<CredentialHealthRow["status"], { text: string; role: RenderStatus }>;

function humanAgo(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function accountsBlocks(rows: CredentialHealthRow[], now: number): Block[] {
  if (rows.length === 0) return [out.line("pending", "No account checks have run yet"), out.callout("next", out.cmd("rt accounts --recheck"))];
  return [
    out.table(
      rows.map((r) => [r.integration, STATUS_WORD[r.status], r.expiresAt ?? "", `${humanAgo(now - r.checkedAt)} ago`, r.detail]),
      ["ACCOUNT", "STATUS", "EXPIRES", "CHECKED", "DETAIL"],
    ),
  ];
}

export interface AccountsDeps {
  db: () => Database;
  /** Runs the daemon's sweep now; false when the daemon did not answer. */
  recheck: () => Promise<boolean>;
  now: () => number;
  exit: (code: number) => never;
}

export function realAccountsDeps(): AccountsDeps {
  return {
    db: () => getStateDb("cli"),
    async recheck() {
      try {
        const res = await daemonQuery("accounts-recheck", undefined, 30_000);
        return !!res?.ok;
      } catch {
        return false;
      }
    },
    now: Date.now,
    exit: process.exit,
  };
}

export async function run(args: string[], _ctx: CommandContext = {}, deps: AccountsDeps = realAccountsDeps()): Promise<void> {
  const json = args.includes("--json");

  if (args.includes("--recheck")) {
    if (!(await deps.recheck())) {
      if (json) out.json({ ok: false, error: "Recheck failed. Is the daemon running?" });
      else out.fail({ title: "Could not recheck your accounts", why: "The rt daemon did not answer", next: out.cmd("rt daemon start") });
      return deps.exit(1);
    }
    if (!json) out.print(out.line("done", "Rechecked your accounts"));
  }

  const db = deps.db();
  if (json) out.json(formatAccountsJson(db));
  else out.print(...accountsBlocks(readAllCredentialHealth(db), deps.now()));
}
```

Create `lib/credential-health/status-word.ts`, the one place the three words live (Task 12's `accounts.ts:369` row imports it too, so the setup row and `rt accounts` can never disagree):

```ts
import type { CredentialHealthRow } from "./db.ts";

/** What a person reads for a stored check result, in `rt accounts` and in a setup row's detail. */
export const CREDENTIAL_STATUS_WORD: Record<CredentialHealthRow["status"], string> = {
  ready: "working",
  invalid: "rejected",
  error: "not checked",
};
```

Imports: add `import { CREDENTIAL_STATUS_WORD } from "../lib/credential-health/status-word.ts";`, `import * as out from "../lib/ui/out.ts";`, `import type { Block, RenderStatus } from "../lib/ui/protocol.ts";`, `import type { CommandContext } from "../lib/command-tree.ts";`. The `--json` error string `"Recheck failed. Is the daemon running?"` stays as it is (already plain). Remove `"commands/accounts.ts",` from the allowlist.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/accounts.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/accounts.ts lib/credential-health/status-word.ts commands/__tests__/accounts.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "accounts: a table with status words, failures as blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `rt logins`

**Files:**
- Modify: `commands/logins.ts`
- Modify: `commands/__tests__/logins.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/logins.ts`)

**Interfaces:**
- Consumes: `UserActionableError`, `userErrorPayload` from `lib/errors.ts` (phase 2; Task 2 repointed this file's import), `userFailure` (Task 2); `out.print`, `out.fail`, `out.table`, `out.line`, `out.callout`, `out.cmd`, `out.json`.
- Produces: `LoginsDeps.json: (value: unknown) => void` replacing `print`. `exitUserError` is no longer imported here.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/logins.test.ts`: in `deps()`, replace `print: (s) => { out.push(s); }` with `json: (v) => { out.push(JSON.stringify(v)); }` (the `out` array name collides with the output module; rename the module import to `import * as outMod` or keep the array and import only `capturePlain` from `./helpers/json-line.ts`). Add:

```ts
  test("list for a person is a table, and an empty list points at add", async () => {
    const cap = capturePlain();
    try {
      const t = deps({ readStdin: async () => ({ email: "a@example.com", password: "x" }) });
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toBe("[not yet] No dev logins saved yet\n  next: rt logins add <origin>\n");
      await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toContain("https://login.example.com  a@example.com\n");
    } finally {
      cap.restore();
    }
  });

  test("off a TTY with no origin remove fails with usage on stderr and exit 2", async () => {
    const cap = capturePlain();
    trapExit();
    try {
      await expect(loginsRemove([], {}, deps().d)).rejects.toThrow("exit 2");
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toBe("[failed] Which site?\n  next: rt logins remove <origin>\n");
    } finally {
      cap.restore();
    }
  });
```

(The `loginsAdd` call is the same shape the file's existing `add` tests make with a fake `readStdin`; seeding through the verb keeps the store's own key and value shape out of the test. The `--json` line it prints lands in `t.out`, not the capture.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/logins.test.ts`
Expected: FAIL.

- [ ] **Step 3: Convert `commands/logins.ts`**

- `LoginsDeps`: replace `print` with `json: (value: unknown) => void;` (doc: "One machine line on stdout. Never human text."). `realDeps`: `json: (v) => out.json(v)`.
- Imports: the `UserActionableError, userErrorPayload` import already reads `"../lib/errors.ts"` (Task 2); drop `exitUserError` from it; add `import { userFailure } from "../lib/setup/user-failure.ts";` and `import * as out from "../lib/ui/out.ts";`.
- `fail`:

```ts
function fail(json: boolean, d: LoginsDeps, err: unknown): never {
  const user =
    err instanceof UserActionableError ? err
    : err instanceof InvalidOriginError ? new UserActionableError("bad-origin", err.message)
    : err instanceof InvalidLoginError ? new UserActionableError("bad-login", err.message)
    : err instanceof NoAgeKeyError || err instanceof CorruptLoginError || err instanceof InvalidSecretsSegmentError ? new UserActionableError("store", err.message)
    : null;
  if (!user) throw err;
  if (json) d.json(userErrorPayload(user));
  else out.fail(userFailure(user, user.code === "usage" ? USAGE_HUMAN[user.message] : undefined));
  process.exit(2);
}

const USAGE_HUMAN: Record<string, { title: string; next: Segment }> = {
  "usage: rt logins add <origin>": { title: "Which site?", next: out.cmd("rt logins add <origin>") },
  "usage: rt logins open-add <origin>": { title: "Which site?", next: out.cmd("rt logins open-add <origin>") },
  "usage: rt logins remove <origin>": { title: "Which site?", next: out.cmd("rt logins remove <origin>") },
};
```

(import `type Segment` from `../lib/ui/protocol.ts`; every `fail("verb", json, d, err)` call becomes `fail(json, d, err)`; the `usage:` messages stay as they are, since agents read them as usage lines and the person sees the plainer block.)

- `loginsList`: `if (json) return d.json(rows); if (rows.length === 0) return out.print(out.line("pending", "No dev logins saved yet"), out.callout("next", out.cmd("rt logins add <origin>"))); out.print(out.table(rows.map((r) => [r.origin, r.email])));`
- `loginsAdd`: `if (json) d.json({ ok: true, origin: saved.origin, replaced: saved.replaced }); else out.print(out.line("done", \`${saved.replaced ? "Replaced" : "Saved"} the dev login for ${saved.origin}\`));`
- `loginsOpenAdd`: `if (json) d.json({ ok: true, url }); else out.print(out.line("done", \`Opened mattstack to save a dev login for ${origin}\`));`
- `loginsRemove`: `if (json) d.json({ ok: true, removed }); else out.print(removed ? out.line("done", \`Deleted the dev login for ${normalizeOrigin(origin).origin}\`) : out.line("skipped", "No dev login saved for that site"));`

Remove `"commands/logins.ts",` from the allowlist.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/logins.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/logins.ts commands/__tests__/logins.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "logins: lines and a table, failures as blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `rt secrets`

**Files:**
- Modify: `commands/secrets.ts`
- Modify: `commands/__tests__/secrets.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/secrets.ts`)

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.line`, `out.section`, `out.table`, `out.verbatim`, `out.callout`, `out.copy`, `out.cmd`.
- Produces: nothing new; the three exported verbs keep their signatures and exit codes (1 on usage and store errors).

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/secrets.test.ts`: replace `withCapturedLogs` with a `capturePlain`-based helper (import it from `./helpers/json-line.ts`):

```ts
async function withCapturedOut<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const cap = capturePlain();
  try {
    const result = await fn();
    return { result, stdout: cap.stdout(), stderr: cap.stderr() };
  } finally {
    cap.restore();
  }
}
```

and change every `const { logs } = await withCapturedLogs(...)`/`logs.join("\n")` to `const { stdout } = await withCapturedOut(...)`/`stdout`. Add:

```ts
  test("off a TTY with no domain list fails with usage on stderr and exit 1", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    try {
      const { stderr, stdout } = await withCapturedOut(() => secretsList([], {}, teamSeams().seams).catch((e) => e));
      expect(stdout).toBe("");
      expect(stderr).toBe("[failed] Which domain?\n  next: rt secrets list <domain>\n");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("set prints a done line naming the key, never the value", async () => {
    const { seams } = teamSeams();
    const { stdout } = await withCapturedOut(() => withFakeStdin("shh\n", () => secretsSet(["--team", "acme", "board", "apiKey", "--stdin"], {}, seams)));
    expect(stdout).toBe("[ok] Saved the secret  acme/board.apiKey\n");
    expect(stdout).not.toContain("shh");
  });
```

(`withFakeStdin(value, fn)` is the file's existing stdin fake at line 136; `teamSeams` its existing seams factory at line 122. The re-encrypt test's assertion becomes `expect(stdout).toContain("[ok] Re-encrypted 2 files for team")`, and the "no domain files" one `expect(stdout).toContain("[skipped] No secret files to re-encrypt for team")`.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/secrets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Convert `commands/secrets.ts`**

Add `import * as out from "../lib/ui/out.ts";`. Then:

- `reportSecretsError`: the `console.error` becomes `out.fail({ title: err.message });` (keep `process.exit(1)` and the comment about `TeamReencryptError`).
- `secretsSet` usage: `out.fail({ title: "Which secret?", next: out.cmd("rt secrets set <domain> <key>") }); process.exit(1);`. Success: `out.print(out.line("done", "Saved the secret", \`${team ? \`${team}/\` : ""}${domain}.${key}\`));`
- `secretsList` usage: `out.fail({ title: "Which domain?", next: out.cmd("rt secrets list <domain>") }); process.exit(1);`. Empty: `out.print(out.line("pending", \`No secrets in ${label} yet\`));`. Names: `out.print(out.section(\`Secrets in ${label}\`, \`${names.length} ${names.length === 1 ? "key" : "keys"}\`, out.table(names.map((n) => [n]))));`
- `rotateTeamAll`: empty: `out.print(out.line("skipped", \`No secret files to re-encrypt for team ${team}\`));`. Otherwise: `out.print(out.line("done", \`Re-encrypted ${reencrypted.length} ${reencrypted.length === 1 ? "file" : "files"} for team ${team}\`), out.verbatim(reencrypted), out.callout("note", "Anyone already removed from the team keeps what they decrypted before. Re-encrypting stops future reads only."));`
- `secretsRotate` usage: `out.fail({ title: "Which secret?", why: "Name a domain and key, or a team alone to re-encrypt every file", next: out.cmd("rt secrets rotate <domain> <key>") }); process.exit(1);`. Team key: `out.print(out.line("done", "Rotated the secret", \`${team}/${domain}.${key}\`));`. Personal: `out.print(out.line("done", "Rotated the secret", \`${domain}.${key}\`), out.copy(message, "commit message"));`

Remove `"commands/secrets.ts",` from the allowlist.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/secrets.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/secrets.ts commands/__tests__/secrets.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "secrets: done lines, a names table, usage as a failure block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The copy pass over setup rows and step outcomes

**Files:**
- Create: `commands/__tests__/setup-copy.test.ts` (bun writes its snapshot to `commands/__tests__/__snapshots__/setup-copy.test.ts.snap`; commit it)
- Modify: every file in the audit's copy table (`lib/setup/validators/*.ts`, `lib/setup/steps/*.ts`, `lib/setup/uninstall.ts`, `lib/setup/tools-install.ts`, `lib/setup/pack.ts`, `lib/setup/integrations.ts`, `need.ts`, `permissions.ts`, `plan.ts`, `apply.ts`, `repo-root.ts`, `finish-gate.ts`, `team-settings.ts`, `token-create.ts`, `skills-materialize.ts`, and the string literals of `commands/setup.ts`, `commands/uninstall.ts`, `commands/logins.ts`, `commands/verify.ts`)
- Modify: every test under `lib/setup/__tests__/`, `commands/__tests__/` and `e2e/tests/` that pins the old wording

**Interfaces:**
- Consumes: `composePlan` (`lib/setup/plan.ts`); `fakeProbes`, `ok`, `ExecScript` (`lib/setup/__tests__/fakes.ts`); `Plan`, `Row` (`lib/setup/contract.ts`); `SecretPresence`.
- Produces: nothing new. The strings change, the shapes do not: no `id`, `kind`, `status`, `required`, `finishGated`, `waivable`, `waived`, `recheck`, no action value the app acts on (`type`, `target`, `which`, `integration`, `verb`, `tool`, `via`, `url`, `startAt`, `selected`, field `name`/`secret`/`value`, alternative and option `id`, `create.url`, `other.suggestions`), no error `code`, exit code or step `state` moves. A string a program reads back changes through its constant (`FIRST_PULL_PENDING`, `VSIX_NOT_FOUND_DETAIL`, `NO_EDITORS_DETAIL`, `NO_RECORDED_EDITORS_DETAIL`, `NO_MANIFEST_DETAIL`), so each reader follows.

- [ ] **Step 1: Write the characterization test**

Create `commands/__tests__/setup-copy.test.ts`:

```ts
/**
 * The plan in two views. The machine view is what the tray and agents read
 * and never changes without a contract change; the copy view is every string
 * a person reads, so a wording change is a deliberate snapshot update.
 */
import { describe, test, expect } from "bun:test";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan, Row } from "../../lib/setup/contract.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";

const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());
const secrets: SecretPresence = { async has() { return null; } };

async function plan(mode: "plan" | "status"): Promise<Plan> {
  return composePlan({ p: fakeProbes({ exec: readyExec }), secrets, ci: false, mode, teams: [] });
}

/** The only keys inside an action that a person reads and no program does. Everything else in an action is the app's to act on. */
const ACTION_COPY_KEYS = new Set(["label", "subtitle", "footnote", "steps", "hint", "detail", "sample"]);

/** Splits an action: the copy keys leave the machine half and land in `copy` by path; every other key and value stays. */
function splitAction(value: unknown, path: string, copy: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v, i) => splitAction(v, `${path}[${i}]`, copy));
  if (value === null || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (ACTION_COPY_KEYS.has(k)) copy[`${path}.${k}`] = v;
    else kept[k] = splitAction(v, `${path}.${k}`, copy);
  }
  return kept;
}

function views(p: Plan) {
  const { at: _at, ...rest } = p;
  const copy: Record<string, unknown> = {};
  const machine = {
    ...rest,
    groups: p.groups.map((g) => {
      copy[`${g.id}.title`] = g.title;
      const { title: _title, rows, ...group } = g;
      return {
        ...group,
        rows: rows.map((r: Row) => {
          const { title, why, detail, optionalNote, action, ...keep } = r;
          Object.assign(copy, { [`${r.id}.title`]: title, [`${r.id}.why`]: why, [`${r.id}.detail`]: detail, [`${r.id}.optionalNote`]: optionalNote });
          return { ...keep, action: splitAction(action, `${r.id}.action`, copy) };
        }),
      };
    }),
  };
  return { machine, copy };
}

const machineView = (p: Plan) => views(p).machine;
const copyView = (p: Plan) => views(p).copy;

describe("the setup plan's shape and copy", () => {
  for (const mode of ["plan", "status"] as const) {
    test(`${mode}: the machine view is unchanged`, async () => {
      expect(machineView(await plan(mode))).toMatchSnapshot();
    });
    test(`${mode}: the copy is what the copy table says`, async () => {
      expect(copyView(await plan(mode))).toMatchSnapshot();
    });
  }
});
```

The machine view keeps the whole action and strips only the copy keys, so every value the app acts on is pinned: `type`, `target`, `which`, `integration`, `verb`, `tool`, `via`, `url`, `startAt`, `selected`, `fields[].name`, `fields[].secret`, `fields[].value`, `alternatives[].id`, `create.url`, `options[].id`, `other.suggestions`. The copy view holds every stripped string by path (`<row id>.action.fields[0].label`, `<row id>.action.footnote`, ...), so an option label or a footnote is pinned by exactly one of the two views and nothing is pinned by neither. A key added to `Row`, `Group`, `Plan` or an action later lands in the machine view through the spreads, which is the safe side; a new copy key is added to `ACTION_COPY_KEYS` on purpose.

This file pins the plan only. Step outcomes on the NDJSON stream (`state`, step ids, the `done` event) are pinned by the existing step tests (`lib/setup/__tests__/steps-*.test.ts`, `apply.test.ts`, `uninstall.test.ts`) and Task 1's stream test; Step 5 guards them.

- [ ] **Step 2: Record today's copy**

Run: `bun test commands/__tests__/setup-copy.test.ts`
Expected: PASS, and bun writes `commands/__tests__/__snapshots__/setup-copy.test.ts.snap`. Read the two copy snapshots: they are today's wording and the baseline the next step changes. Snapshots are new to this repo, so two cautions. First, read the file for anything that depends on the machine or the moment (a temp-HOME path, a user name, a clock value, a version read from the real environment): if one is there, normalize it in `views` (replace the fake home prefix with `~`, drop the field) and re-record before committing, or the snapshot fails on the next machine. Second, CI never writes snapshots (bun refuses to under `CI=true`), so a missing or stale `.snap` there is a red test, never a silent rewrite; the file must be committed. Commit the test and the snapshot now, on their own:

```bash
git add commands/__tests__/setup-copy.test.ts commands/__tests__/__snapshots__/setup-copy.test.ts.snap
git commit -m "setup: pin the plan's machine view and its copy as snapshots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Apply the copy table**

Work through the audit's copy table file by file, string by string. Rules from the table's preamble apply to every edit. Where a row says "unchanged" or "passthrough", touch nothing. For `commands/verify.ts`, `actionHint` returns `` ` (${action.label})` ``. Do not edit a line the table does not name, and keep every machine-read value on its line.

- [ ] **Step 4: Prove the pin, then accept the new copy**

Run: `bun test commands/__tests__/setup-copy.test.ts`
Expected: the two `copy` tests FAIL (the snapshot still holds the old words) and the two `machine view` tests PASS. If a `machine view` test fails, a value a program reads moved: find that edit in `git diff` and undo it before going on.

Then: `bun test --update-snapshots commands/__tests__/setup-copy.test.ts` and read `git diff commands/__tests__/__snapshots__/`: every changed line is a `detail`, `title`-adjacent or `optionalNote` string from the table, and nothing else changes.

- [ ] **Step 5: Bring every assertion to the new wording**

Run: `bun test lib/setup commands/__tests__ && bun run test:e2e && bun run typecheck`
Expected: failures only on assertions that pin old wording (`lib/setup/__tests__/validators-*.test.ts`, `steps-*.test.ts`, `uninstall.test.ts`, `tools-install.test.ts`, `pack.test.ts`, `home-failure-detail.test.ts`, `commands/__tests__/verify*.test.ts`, `setup-apply.test.ts`, `e2e/tests/setup.test.ts`, `e2e/tests/verify.test.ts` among them). Change each such assertion to the table's wording. Delete no assertion and loosen none to a regex that would also match the old text. Re-run until green.

Then prove only copy moved in the tests: `git diff -U0 -- lib/setup/__tests__ commands/__tests__ e2e/tests | grep -E '^[-+]' | grep -E '\b(state|status|id|code|kind|event|exitCodes?)\b' | grep -v -E '\b(detail|remedy|message|title)\b'`
Expected: no output. A hit is a line where a `state`, `status`, `id`, `code` or exit-code expectation changed without a copy string beside it: a machine value moved, so undo the source edit behind it. (A line that pairs a state with a detail, such as `{ state: "skipped", detail: "..." }`, is filtered out; read those in the diff and confirm the state is the same on both sides.)

- [ ] **Step 6: The dash gate**

Run: `rg -n '\x{2014}|\x{2013}' lib/setup commands/setup.ts commands/uninstall.ts commands/verify.ts commands/accounts.ts commands/logins.ts commands/secrets.ts --glob '!**/__tests__/**' | grep -v -E '^[^:]+:[0-9]+:\s*(//|\*|/\*)'` (the two dash code points; BSD grep has no `-P`, so use `rg`; the trailing filter drops whole-line comments, and the path list is all of `lib/setup/` and the six command files, not just the files the first table sections name)
Expected: no hit inside a string literal (hits in trailing comments on lines you did not edit are expected, in `apply.ts` and `probes.ts` among others; only a hit inside quotes is a copy site). Then the backtick half of the same rule: `rg -n '(detail|remedy)\s*[:=][^\n]*`|UserActionableError\([^)]*`' lib/setup commands/setup.ts commands/uninstall.ts commands/logins.ts --glob '!**/__tests__/**'` (one bare backtick, which also matches an escaped one inside a template literal) finds no shell-quoted command inside a `detail`, a `remedy` or an error message. A hit inside a string literal is a copy site the table missed: rewrite it by the table's rules and add its row to the table in this plan. A hit in a comment on a line you edited goes too; a comment on a line you did not touch is not this task's.

- [ ] **Step 7: Commit**

```bash
git add lib/setup commands/setup.ts commands/uninstall.ts commands/logins.ts commands/verify.ts commands/__tests__ e2e/tests
git commit -m "setup: plain words in every row detail, step outcome and error message, the shape untouched

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The `setup apply` pty gate

**Files:**
- Create: `e2e/pty/setup-apply.test.ts`
- Modify: `.github/workflows/e2e.yml` (the path filter on line 38)

**Interfaces:**
- Consumes: `startInteractive`, `TermwrightSession` (`e2e/interactive.ts`); `createTestHome` (`e2e/harness.ts`); the built `ui/dist/rt-ui`.
- Produces: nothing; the gate.

- [ ] **Step 1: Write the test**

Create `e2e/pty/setup-apply.test.ts`:

```ts
/**
 * The whole-binary gate for a setup run at a terminal: the real rt driving
 * the real rt-ui over a pty. It waits on the one step's title, never its id,
 * and reads the final screen for a summary and the absence of a stack.
 */
import { test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 30_000;

beforeAll(() => {
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; cleanup: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.cleanup();
  open = null;
});

test("setup apply --from verify draws the verify step by its title and ends in a summary, with no stack on screen", async () => {
  const home = createTestHome();
  // The same flags e2e/tests/setup.test.ts proves stream exactly plan, verify, done: verify is the last contract step, so --from runs it alone.
  const session = await startInteractive({ args: ["setup", "apply", "--non-interactive", "--team-of-one", "--from", "verify"], home: home.path, env: { RT_UI_BIN }, cols: 100, rows: 30 });
  open = { session, cleanup: home.cleanup };

  await session.waitForText("Verify your setup", PAINT_TIMEOUT);
  await session.waitForText("Setup ", PAINT_TIMEOUT);
  const code = await session.exitCode;
  const screen = await session.screen();

  expect([0, 2]).toContain(code);
  expect(screen).toMatch(/Setup (is done|needs you|stopped)/);
  expect(screen).not.toMatch(/^\s*[✓✗◆!\-]\s+verify(\s|$)/m);
  expect(screen).not.toMatch(/^\s+at /m);
  expect(screen).not.toContain("UserActionableError");
});
```

- [ ] **Step 2: Add the paths to the e2e filter**

In `.github/workflows/e2e.yml` line 38, inside the `grep -qE` pattern, add `lib/setup/|commands/setup\.ts|` right after `lib/ui/|`, so the pattern begins `'^(ui/|lib/mission/|lib/ui/|lib/setup/|commands/setup\.ts|commands/glitter\.ts|...`.

- [ ] **Step 3: Run the gate**

Run (repo root): `bun run ui:build && bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv ./cli.ts --outfile dist/rt --define 'RT_VERSION="e2e-test"' && bun run test:pty`
Expected: both pty files PASS. If `Verify your setup` never paints, run `RT_BATCH=1 dist/rt setup apply --non-interactive --team-of-one --from verify` under `env -i HOME=<the test home>` to read the plain output and fix the cause; never run the built binary without an isolated HOME.

- [ ] **Step 4: Commit**

```bash
git add e2e/pty/setup-apply.test.ts .github/workflows/e2e.yml
git commit -m "e2e: pty gate for setup apply at a terminal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Document the emitter, run every gate, look at it

**Files:**
- Modify: `AGENTS.md` (the "Output layer" section)

**Interfaces:**
- Consumes: everything above.
- Produces: the AGENTS.md paragraph; the screenshots for the PR.

- [ ] **Step 1: Add the rule to AGENTS.md**

In the "Output layer" section, after the paragraph that ends "stay beneath it when it fails.", add:

```markdown
A setup run (`rt setup apply`, `update`, `uninstall`) reaches a person through
`createStepEmitter` in `lib/setup/emit.ts`: one rt-ui step per `step` event,
titled from the `plan` event (never the id), streamed `log` lines as sub-lines
that also go to the CLI log through `logCliEvent` at `debug`, a `fix` callout
for a remedy, and a `summary` at the end; a verb awaits `flush()` before it
exits. The NDJSON stream and the plan are the app's contract and go through
each verb's `json` seam (`out.json`): their shape (keys, structure, types,
exit codes, every value a program reads) never changes without a contract
change, while a `Row.detail`, a `StepOutcome.detail` or `remedy` and a
`UserActionableError` message are copy the tray displays and never parses.
`commands/__tests__/setup-copy.test.ts` pins both views as snapshots, so a
wording change is a deliberate `bun test --update-snapshots`, and a machine
view change is a failing test. Write that copy in the command-description
style, and never put a plain-words key into an envelope: plainer words for a
person ride the error's `why` and `next` or `exitWithUserError`'s `human`
argument.
```

- [ ] **Step 2: Grep for readers of the old text once more**

Run: `grep -rn -E 'Install: ready|Install: blocked|Finish: ready|Finish: blocked|setup update:|rt secrets set: wrote|Recheck complete|all critical checks passed|This would remove|No dev logins saved|skipped on this Mac|re-armed on this Mac' plugins/mattstack skills apps/board/skills` (repo root).
Expected: no hits outside `docs/`. A hit in a skill means that skill scrapes text; change it to read `--json` in this PR.

- [ ] **Step 3: Run every gate**

Run, from the repo root, one at a time:

```bash
bun run ui:build
bun run ui:test
bun run typecheck
bun run test
bun run test:e2e
bun run test:pty
bun run picker:check
bun run format:check
```

Expected: all PASS. `docs:gen` is not needed (no description changed). If `bun run test` shows a failure in a file this plan did not touch, check it against a clean `main` before treating it as yours (flakes rotate on this suite).

- [ ] **Step 4: Look at it**

In a real terminal, under an isolated HOME (`env -i HOME=$(mktemp -d) PATH=$PATH TERM=$TERM COLORTERM=$COLORTERM bun cli.ts ...`), run and screenshot, light and dark terminal both:

- `bun cli.ts setup status`
- `bun cli.ts setup apply --non-interactive --team-of-one --from verify`
- `bun cli.ts setup apply --from bogus` (the failure block, no stack)
- `bun cli.ts verify`
- `bun cli.ts accounts`
- `bun cli.ts secrets list` (the usage failure)

Say plainly what reads wrong. If you have no real terminal (a subagent usually does not), run each with `| cat` and `RT_BATCH=1`, paste the plain output into the task report, state that the styled form was not viewed, and leave the screenshots for the final review.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: the setup emitter and the shape-not-strings rule in AGENTS.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Setup section: emitter drives steps with titles (Task 3), `log` as sub-lines (Task 3), final states and `partial` as `warn` (Task 3), remedy as a callout (Task 3; this plan picks `fix` for every remedy, since a `StepOutcome` carries one only on `failed` and `partial`), closing event as a summary (Task 3), plan view as sections with `missing` as pending or needs-you (Task 4), the settings tip under its step (Task 3's `tip` hook; the sink itself is phase 4's). Spec rule 5, sub-lines in the log (Task 3's `log` option and phase 2's `logCliEvent` at `debug`, which cli-logger writes unfiltered). Spec "Steps" paragraph: the emitter never uses `steps.ts`'s fallback (Task 3 prints with `out.print`). Error seam: every expected failure through `out.fail` with the envelope's shape untouched (Tasks 2, 5, 6, 7, 10, 11). Spec "Plain output off a TTY", the 2026-10-01 ruling: shape tests (Tasks 1, 8, 9), the copy pass with its two-view snapshot (Task 12). Pty gate for `setup apply` (Task 13), screenshots (Task 14). Phases list: every verb named for phase 3 has a task.
- **Cross-phase rulings.** 1: Task 12 and the copy table. 2: no capture helper is created here; the human gate is the caller's, so every commands test goes through `capturePlain()` in `commands/__tests__/helpers/json-line.ts` (phase 2's `captureOut()` plus `out.__test__.setHuman(() => false)`, a wrapper and not a second capture) and the one `lib/` test sets the gate inline; no test in this plan calls `captureOut()` without closing the gate. 3: `logCliEvent(level, module, message, context?)`, sub-lines at `debug`, no `logCliLine`. 4: every import from `lib/errors.ts`; Task 2 deletes the shim. 5: the one-parameter sink arrow in Task 3. 6: no verb here prints human notes under `--json` (warnings go to the log), so `payloadOnStdout` is not needed. 7: the allowlist, the e2e filter and the AGENTS.md section are appended to, never rewritten. 8: setup and the seam keep exit 2, `secrets` and `accounts` keep exit 1.
- **Placeholder scan.** The only "copy the setup of test X" instructions point at a named existing test in the same file and say exactly what to assert; the plan-blocks, emitter, user-failure, verify, accounts and copy tests are complete.
- **Type consistency.** `json: (value: unknown) => void` everywhere; `StepEmitter { emit, tip, flush }`; `exitWithUserError(err, json, sink, human?)` with `UserErrorSink { json, exit, now }`; `userFailure(err, human?)` over phase 2's `failureFor(err)`; `logCliEvent(level, module, message, context?)`; `rowStatus`, `planBlocks(plan, mode)`, `rowTitles(plan, ids)`; `verifyPayload(results, plan)`; `accountsBlocks(rows, now)`; `FailureInput.next` is one `Segment`, never an array.
- **Review Focus.** Each of the five lines names its test and task.
