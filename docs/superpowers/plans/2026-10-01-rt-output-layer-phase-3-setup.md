# rt Output Layer, Phase 3 (Setup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every human line of `rt setup` (bare, `plan`, `status`, `apply`, `update`, `finish`, `intent`, `pack`, the connect and status pairs, `slack create-app`, `waive`, `unwaive`, `repo-root set`, `home remote set`), `rt verify`, `rt uninstall`, `rt accounts`, `rt logins` and `rt secrets` onto `lib/ui/out.ts`, so a setup run shows one rt-ui step per install step with its title, informational text lands on stdout, an expected failure is a `failure` block with no stack, and every `--json` byte stays as it is.

**Architecture:** The setup engine keeps emitting `ApplyEvent`s. In `--json` mode they go through a `json` seam on each verb's deps (real implementation `out.json`), which is the app's NDJSON contract and never changes. For a person, a new `createStepEmitter` in `lib/setup/emit.ts` turns the same stream into rt-ui steps: `running` opens a step with the step's title, `log` lines become sub-lines that also reach the CLI log, the final state ends the step with a status (`partial` is `warn`, `failed` is the only `fail`), a remedy is a `fix` callout, and the closing event is a `summary`. The printed checklist becomes `section` blocks built by a pure `planBlocks` in `lib/setup/plan-blocks.ts`, shared by `setup plan`, `setup status`, bare `rt setup` and `rt verify`. Expected failures go through one `exitWithUserError` in `lib/setup/user-failure.ts`: the envelope on stdout under `--json`, an `out.fail` block on stderr otherwise.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/setup/`, `lib/ui/out.ts`), `bun:test`, termwright for the one pty gate.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369). This plan covers the spec's phase 3 only. Phase 1 (the layer) is on this branch; **phase 2 (the error seam, `lib/errors.ts`, `exitUserError`, the sops failure) must land before this plan starts**: Task 2 imports `UserActionableError` from `lib/errors.ts` and reads its `why` and `next` fields.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command must not change, byte for byte. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- Phase 3's own:
  - Every `detail`, `remedy` and error `message` string that rides `rt setup plan --json`, `rt setup apply --json`, `rt uninstall --json`, `rt verify --json` or an exit-2 envelope is frozen by the byte rule. Do not edit those strings, and do not move the source lines that hold them (several carry an em dash today; a moved line would be a line you wrote). Plainer words for a person are added beside them, never in place of them (see the audit's "frozen" column).
  - The step emitter never goes through `lib/ui/steps.ts`'s plain fallback: off a TTY it prints with `out.print`; at a terminal it drives `openStep` directly.
  - The emitter is driven by a synchronous `Emit`; every rt-ui interaction is queued on one promise chain and a verb awaits `flush()` before it exits, so no step line can print after the process has gone or out of order.
  - No `console.*` anywhere in the files this phase touches, including test helpers under `commands/__tests__/helpers/` (the guard skips `__tests__`, but the habit is the point).
  - `commands/setup.ts` stays one file. It is long, and this phase does not restructure it beyond moving the plan renderer and the exit-2 helper into `lib/setup/`.

## Review Focus

1. **A streamed child line carrying escapes or a newline.** A `git clone` stderr line with `\x1b[2J` or an embedded newline must print as plain characters on one row, at a terminal and in the plain fallback, and must reach the CLI log as sent. Pinned in Task 3 (`a hostile log line prints as one plain row and reaches the log unchanged`).
2. **The helper dying or missing mid-run.** With `rt-ui` gone after the first step, every remaining step line and the summary must still print plainly and the run must not hang. Pinned in Task 3 (`a helper that dies on start leaves the run on the plain path` and `a helper that cannot start leaves the run on the plain path`).
3. **A human-only warning under `--json`.** The update-stamp and finish-check warnings must never put a non-JSON line on stdout when `--json` is set; they go to the CLI log. Pinned in Task 5 (`a finish check that throws under --json reaches the log, never stdout`).
4. **Exit before the drawing.** A failed apply must print its summary before `deps.exit(2)` runs, and `rt setup update`'s exit 2 must follow its summary. Pinned in Task 5 (`the summary is printed before exit 2`).
5. **No terminal and no argument.** `rt logins remove` and `rt secrets list` with nothing on argv and no TTY must fail with the usage block on stderr and today's exit code, never prompt or hang. Pinned in Task 10 (`off a TTY with no origin remove fails with usage on stderr and exit 2`) and Task 11 (`off a TTY with no domain list fails with usage on stderr and exit 1`).

## File Structure

| File | Responsibility |
|---|---|
| `commands/__tests__/helpers/capture-out.ts` (create) | Test helper: captures stdout and stderr, forces the plain path, checks one JSON line |
| `lib/cli-logger.ts` (modify) | `logCliLine`: one structured line on the cli surface for text the screen does not keep |
| `lib/setup/user-failure.ts` (create) | `failureFor`, `exitWithUserError`: the exit-2 path every setup verb shares |
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
| `AGENTS.md` (modify) | The setup emitter and the frozen-copy rule |

## Audit: every print site this phase owns

The block each site becomes and its new copy. "Frozen" marks a string that rides `--json` and stays byte for byte; the human view then uses the row's or step's title and the frozen string as its hint, and any plainer words live beside it.

### `lib/setup/emit.ts` (`createHumanEmitter`, replaced whole)

| Today | Becomes |
|---|---|
| `  N steps` on `plan` | nothing printed; titles remembered by id |
| `  … <id>` on `running` | an rt-ui step opened with the step's title (`StepDef.title`, from the `plan` event); off a TTY nothing until the step resolves |
| `      <line>` on `log` | `StepHandle.sub(line)`; the line also goes to the CLI log through `logCliLine`; off a TTY kept for a `verbatim` block if the step fails |
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

| Site | Becomes | Frozen |
|---|---|---|
| `renderPlanHuman`: group title, `  <glyph> title  detail`, dim footnote | `section(group.title, "N of M ready", line(rowStatus(r), r.title, r.detail)…)`; a `choose` footnote is `callout("note", footnote)`; `missing` is `pending`, or `needs-you` for an account or permission row; `invalid` and `error` are `failed`; `checking` is `pending` | `r.detail` frozen (plan contract) |
| `Install: ready` / `Install: blocked by: <ids>` | `summary("done", "Install can run")` / `summary("needs-you", "Install is waiting on", <row titles>)` | |
| `renderFinishLine` | `line("done", "Finish can run")` / `line("needs-you", "Finish is waiting on", "<titles>")` | |
| the "Missing accounts" heading + `  - Title: rt setup x connect` | `callout("next", cmd("rt setup <integration> connect"))` under that account's line, status mode only | |
| `rt setup status` header line | dropped | |
| `setupInteractive`: `missingRowLines` + the `rt setup: not ready to install` line naming ids | `out.fail({ title: "This Mac is not ready to install yet", why: "Waiting on <titles>" })`, exit 2 | |
| `setupApply` catch (`rt setup apply: <message>`) | `exitWithUserError(err, json, sinkOf(deps), notReadyFailure(err))`; for the hard gate the human block is "This Mac is not ready to install yet", why "Apple's Command Line Tools are not installed" / "rt needs macOS 14 or newer", next `rt tools install apple-clt` | message frozen |
| `rt setup apply: update version not stamped: …` (stderr) | `warnLine(json, "The update version was not saved", message)`: CLI log always, `line("warn", …)` on stdout when not `--json` | |
| `rt setup apply: setup left unfinished, the finish check failed: …` | `warnLine(json, "Setup was left unfinished because the finish check failed", message)` | |
| `setupUpdate`: `--from is not a setup update flag…` | `exitWithUserError` with human `{ title: "An update always runs every safe step", why: "Updates cannot start from or stop at one step" }` | message frozen |
| `setup update: setup has not finished on this Mac` | `line("pending", "Setup has not finished on this Mac yet")` + `callout("next", cmd("rt setup install"))` | |
| `setup update: already applied for <v>` | `line("skipped", "Nothing to update", "already applied for <v>")` | |
| `setup update: another update run is in progress` | `line("skipped", "Another update is already running")` | |
| `setup update: <summarizeUpdate>` | the emitter's `summary`; `summarizeUpdate` deleted | |
| `setup pack: <detail>` | `line("done", "Pack is set up", detail)` | detail frozen |
| `setup intent: <mode> <repo>` | `line("done", "Setup intent recorded", "<mode> <repo>")` | |
| `setup finish: setup is finished on this Mac` | `line("done", "Setup is finished on this Mac")` | |
| `rt setup finish: the update run after Finish did not complete: …` (stderr) | `line("warn", "The update after Finish did not finish", message)` | |
| `setup repo-root set: <path> (<tcc>)` | `line("done", "Repo folder saved", path)` + `callout("note", tccWarning)` when present | |
| `home remote set: origin -> <url>, pushed (repo created)` | `line("done", "Pushed your home repo" / "Created a private repo and pushed your home repo to it", url)` | |
| `printIntegrationResult`: `<id>: <status>` followed by the detail | `line(ready→done, missing→needs-you, invalid→failed, integrationDef(id).title, detail)` | detail frozen |
| `exitWithUserError`: `rt <verb>: <message>` | `out.fail(failureFor(err, human))` | message frozen |
| `runWaiver`: `setup waive: <id> skipped on this Mac` and the three siblings | `line("done", "Skipped on this Mac", id)`, `line("skipped", "Already skipped on this Mac", id)`, `line("done", "Re-armed on this Mac", id)`, `line("skipped", "Was not skipped on this Mac", id)` | |
| `runWaiver` store failure (`printError`, exit 1) | `out.fail({ title: "Could not save the change", why: message })`, exit 1 | |
| `rt setup waive: usage: …` | `exitWithUserError` with human `{ title: "Which row?", next: cmd("rt setup waive <row-id>") }` | message frozen |

### `commands/uninstall.ts`

| Site | Becomes |
|---|---|
| `This would remove:` + `  - title` | `section("This would remove", undefined, changes([{ op: "-", name: title }…]))` |
| `This will:` + `  - title` | `section("This will remove", undefined, changes(…))` then the confirm |
| step stream | `createStepEmitter` with the uninstall labels |
| `Kept:` + `  - s` | `section("Kept on this Mac", undefined, line("skipped", s)…)` |
| `rt uninstall: <message>` | `exitWithUserError(err, json, sinkOf(deps))` (message frozen) |

### `commands/verify.ts`

| Site | Becomes |
|---|---|
| blank, `rt verify` title, blank | dropped |
| `  <icon> <id>  <detail>` with the action label appended | `section(group.title, undefined, line(status, r.title, r.detail)…)` per group; pass→done, skip→skipped, fail→failed, warn→the row's own `rowStatus` with failed read as warn; a fail or warn row whose action is `connect`/`oauth` gets `callout("next", cmd("rt setup <integration> connect"))`, a `run` action `callout("next", cmd("rt <verb…>"))` |
| `✓ all critical checks passed  N passed, M warnings` | `summary("done", "Everything checks out", ["N passed", "M warnings"])` |
| `✗ N critical checks failed  …` | `summary("failed", "N checks failed", ["P passed", "M warnings"])` |
| `printJSON` | `out.json(verifyPayload(results, plan), 2)` (frozen; `checks[].detail` keeps its em dash and action label) |

### `commands/accounts.ts`

| Site | Becomes |
|---|---|
| `No credential health data yet. Run: rt accounts --recheck` | `line("pending", "No account checks have run yet")` + `callout("next", cmd("rt accounts --recheck"))` |
| padded header + dashes + rows | `table(rows, ["ACCOUNT", "STATUS", "EXPIRES", "CHECKED", "DETAIL"])`; the status cell is a role-tagged segment: ready→`working` (done), invalid→`rejected` (failed), error→`not checked` (warn) |
| `Recheck complete.` | `line("done", "Rechecked your accounts")` |
| `Recheck failed. Is the daemon running?` (stderr, exit 1) | `out.fail({ title: "Could not recheck your accounts", why: "The rt daemon did not answer", next: cmd("rt daemon start") })`, exit 1 |
| JSON `{ ok: false, error: "Recheck failed. Is the daemon running?" }` and `formatAccountsJson` | `out.json(...)`, frozen |

### `commands/logins.ts`

| Site | Becomes |
|---|---|
| `No dev logins saved. Add one with: rt logins add <origin>` | `line("pending", "No dev logins saved yet")` + `callout("next", cmd("rt logins add <origin>"))` |
| `origin  email` rows | `table(rows.map(r => [r.origin, r.email]))` |
| `Saved/Replaced the dev login for <origin>` | `line("done", same words)` |
| `Opened mattstack to save a dev login for <origin>` | `line("done", same words)` |
| `Deleted the dev login for <origin>` / `No dev login saved for that site` | `line("done", …)` / `line("skipped", …)` |
| `exitUserError(err, json, verb, d.print)` | `d.json(userErrorPayload(err))` under `--json`, else `out.fail(failureFor(err))`; `process.exit(2)` (messages frozen) |

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
| `lib/setup/finish-gate.ts:19` `console.error` default warn | `logCliLine("warn", "setup.finish-gate", message)`: a resolver fault is log material, and the function runs under `--json` paths where stdout is the envelope |
| `lib/setup/team-settings.ts:59` `console.error` default warn | `logCliLine("warn", "setup.team-settings", message)`, same reason |
| `lib/setup/steps/home.ts:47` | a comment that quotes a `console.error(...)` frame; reworded so the guard regex does not match |
| `lib/setup/validators/*.ts` (171 `detail` sites), `lib/setup/steps/*.ts` (130 `detail`/`remedy` sites), `lib/setup/uninstall.ts` (26), `lib/setup/tools-install.ts` (32), `lib/setup/pack.ts` (10) | Every one of these strings is a `Row.detail` in the plan contract the tray decodes, or a `StepOutcome.detail`/`remedy` on the NDJSON stream. They are frozen by the byte rule in this project. About 90 of them carry an em dash or an id mid-sentence and would read better; that is a copy change to the app's rows as much as to the terminal, and belongs to a follow-up that changes the contract on purpose (recorded as a spec gap in this plan's report). This phase renders them as hints under titles and adds plainer words only where a string is human-only. |
| `lib/setup/update.ts` `summarizeUpdate` | human-only; replaced by the emitter's summary and deleted |
| `lib/setup/update.ts` `updateNotification` | a notification body, not terminal output; untouched |

### Skill text scraped from these verbs

`grep` of `plugins/mattstack`, `skills/` and `apps/board/skills` for every old human string above found no reader. The `docs/superpowers/plans/*.md` hits are historical plans, not readers.

---

### Task 1: The `json` seam and `--json` byte-identity tests

**Files:**
- Create: `commands/__tests__/helpers/capture-out.ts`
- Modify: `commands/setup.ts` (every deps interface and every JSON call site)
- Modify: `commands/uninstall.ts` (`UninstallDeps`, both JSON call sites, the emitter)
- Modify: `commands/__tests__/setup-plan.test.ts`, `setup-apply.test.ts`, `setup-update.test.ts`, `setup-connect.test.ts`, `setup-repo-root.test.ts`, `setup-waive.test.ts`, `setup-finish.test.ts`, `uninstall.test.ts` (add `json` to every deps object; add the byte tests)

**Interfaces:**
- Consumes: `out.json(value, indent?)`, `out.__test__.setHuman`, `out.__test__.reset` (phase 1, `lib/ui/out.ts`).
- Produces: on `SetupDeps`, `ApplyDeps`, `IntentDeps` (and so `FinishDeps`), `RepoRootDeps`, `HomeRemoteDeps`, `WaiveDeps`, `ConnectDeps` (through `SetupDeps`) and `UninstallDeps`: `json: (value: unknown) => void`, documented as "One machine line on stdout: a `--json` envelope or an NDJSON event. Never human text." Real deps set it to `(v) => out.json(v)`. Test helper exports `captureOut(): { stdout(): string; stderr(): string; restore(): void }` and `expectOneJsonLine(stdout: string): unknown`.
- `print` stays on every interface for now; Tasks 4 to 7 remove it as each verb's human output converts.

- [ ] **Step 1: Write the test helper**

Create `commands/__tests__/helpers/capture-out.ts`:

```ts
import { expect } from "bun:test";
import * as out from "../../../lib/ui/out.ts";

/**
 * Captures what a command writes and forces the plain path, so a test reads
 * words, not escapes, and never spawns rt-ui. Call restore() in afterEach.
 */
export function captureOut(): { stdout(): string; stderr(): string; restore(): void } {
  const o: string[] = [];
  const e: string[] = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = ((c: string | Uint8Array) => (o.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (e.push(String(c)), true)) as typeof process.stderr.write;
  out.__test__.setHuman(() => false);
  return {
    stdout: () => o.join(""),
    stderr: () => e.join(""),
    restore() {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
      out.__test__.reset();
    },
  };
}

/** Exactly one JSON object on stdout, compact, newline-terminated: the shape every --json envelope has today. Returns the parsed value. */
export function expectOneJsonLine(stdout: string): unknown {
  const parsed: unknown = JSON.parse(stdout.trimEnd());
  expect(stdout).toBe(JSON.stringify(parsed) + "\n");
  return parsed;
}

/** The real json seam for a byte test: whatever the verb hands it lands on the captured stdout exactly as rt prints it. */
export const realJson = (value: unknown): void => out.json(value);
```

- [ ] **Step 2: Write the failing byte tests**

Append to `commands/__tests__/setup-plan.test.ts` (add `import { captureOut, expectOneJsonLine, realJson } from "./helpers/capture-out.ts";` and `import { composePlan } from "../../lib/setup/plan.ts";` and `import { listTeams } from "../../lib/settings/stores.ts";` at the top):

```ts
describe("setup plan --json bytes", () => {
  test("stdout is exactly JSON.stringify(plan) plus a newline, for the same plan composePlan returns", async () => {
    const cap = captureOut();
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

Append to `commands/__tests__/setup-apply.test.ts` (import `captureOut`, `expectOneJsonLine`, `realJson`):

```ts
describe("setup apply --json bytes", () => {
  test("the NDJSON stream is one compact object per line, newline-terminated, nothing else on stdout", async () => {
    const cap = captureOut();
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
    const cap = captureOut();
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
    const cap = captureOut();
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
    const cap = captureOut();
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

Append to `commands/__tests__/uninstall.test.ts`, copying the `--json --dry-run` test's setup with `json: realJson`:

```ts
    expect(cap.stdout()).toBe('{"contract":1,"at":"2026-01-01T00:00:00.000Z","actions":[{"id":"services.unregister","title":"Stop and remove the rt daemon and deck services"}]}\n');
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
- `setupApply` and `setupUpdate`: the `createNdjsonEmitter((line) => deps.print(...))` expression becomes `(ev: ApplyEvent) => deps.json(ev)` (import `type ApplyEvent` from `../lib/setup/contract.ts`). Keep `createHumanEmitter(deps.print)` for the human branch for now.
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
Expected: PASS, including the new byte tests.

- [ ] **Step 7: Commit**

```bash
git add commands/setup.ts commands/uninstall.ts commands/__tests__/
git commit -m "setup: a json seam for every machine line, pinned byte for byte

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The shared failure path, the CLI log line, and three small lib conversions

**Files:**
- Create: `lib/setup/user-failure.ts`
- Create: `lib/setup/__tests__/user-failure.test.ts`
- Modify: `lib/cli-logger.ts` (widen `writeCliLogLine`'s level, export `logCliLine`)
- Modify: `lib/setup/finish-gate.ts:19`, `lib/setup/team-settings.ts:58-60`, `lib/setup/steps/home.ts:47`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/setup/finish-gate.ts`, `lib/setup/steps/home.ts`, `lib/setup/team-settings.ts`)

**Interfaces:**
- Consumes from phase 2: `UserActionableError` exported by `lib/errors.ts`, with readable `code: string`, `message`, `extra: Record<string, unknown>`, and the optional fields `why?: string` and `next?: string` (the command to run). `userErrorPayload(err, now)` from `lib/setup/errors.ts` (if phase 2 moved it to `lib/errors.ts`, change this one import). If phase 2 spelled the two optional fields differently, `failureFor` is the only place that reads them.
- Consumes from phase 1: `out.fail`, `out.cmd`, `type FailureInput`.
- Produces: `failureFor(err: UserActionableError, human?: Partial<FailureInput>): FailureInput`; `interface UserErrorSink { json: (value: unknown) => void; exit: (code: number) => never; now: () => Date }`; `exitWithUserError(err, json: boolean, sink: UserErrorSink, human?: Partial<FailureInput>): never`; `logCliLine(level: "info" | "warn" | "error", module: string, message: string, context?: Record<string, unknown>): void` from `lib/cli-logger.ts`.

- [ ] **Step 1: Write the failing test**

Create `lib/setup/__tests__/user-failure.test.ts`:

```ts
import { test, expect, afterEach } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { exitWithUserError, failureFor } from "../user-failure.ts";
import * as out from "../../ui/out.ts";

let stdout: string[] = [];
let stderr: string[] = [];
const realOut = process.stdout.write;
const realErr = process.stderr.write;

function capture(): void {
  stdout = [];
  stderr = [];
  process.stdout.write = ((c: string | Uint8Array) => (stdout.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (stderr.push(String(c)), true)) as typeof process.stderr.write;
  out.__test__.setHuman(() => false);
}

afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  out.__test__.reset();
});

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("failureFor uses the message as the title and the caller's plainer words when given", () => {
  const err = new UserActionableError("bad-path", "/tmp/x does not exist");
  expect(failureFor(err)).toEqual({ title: "/tmp/x does not exist" });
  expect(failureFor(err, { title: "That folder does not exist", next: out.cmd("rt setup repo-root set <folder>") })).toEqual({
    title: "That folder does not exist",
    next: [{ text: "rt setup repo-root set <folder>", role: "command" }],
  });
});

test("exitWithUserError under --json writes the envelope on stdout and nothing on stderr, then exits 2", () => {
  capture();
  const exits: number[] = [];
  const written: unknown[] = [];
  const sink = { json: (v: unknown) => written.push(v), exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), true, sink)).toThrow("exit");
  expect(written).toEqual([{ contract: 1, at: "2026-01-01T00:00:00.000Z", error: { code: "usage", message: "usage: rt x" } }]);
  expect(stderr.join("")).toBe("");
  expect(exits).toEqual([2]);
});

test("exitWithUserError for a person writes a failure block on stderr, nothing on stdout, then exits 2", () => {
  capture();
  const exits: number[] = [];
  const sink = { json: () => { throw new Error("json must not be called"); }, exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), false, sink, { title: "Which row?", next: out.cmd("rt setup waive <row-id>") })).toThrow("exit");
  expect(stdout.join("")).toBe("");
  expect(stderr.join("")).toBe("[failed] Which row?\n  next: rt setup waive <row-id>\n");
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
import { UserActionableError } from "../errors.ts";
import * as out from "../ui/out.ts";
import type { FailureInput } from "../ui/out.ts";
import { userErrorPayload } from "./errors.ts";

export function failureFor(err: UserActionableError, human: Partial<FailureInput> = {}): FailureInput {
  const why = human.why ?? err.why;
  const next = human.next ?? (err.next ? out.cmd(err.next) : undefined);
  return {
    title: human.title ?? err.message,
    ...(human.hint ? { hint: human.hint } : {}),
    ...(why ? { why } : {}),
    ...(next ? { next } : {}),
    ...(human.details ? { details: human.details } : {}),
  };
}

export interface UserErrorSink {
  json: (value: unknown) => void;
  exit: (code: number) => never;
  now: () => Date;
}

export function exitWithUserError(err: UserActionableError, json: boolean, sink: UserErrorSink, human?: Partial<FailureInput>): never {
  if (json) sink.json(userErrorPayload(err, sink.now()));
  else out.fail(failureFor(err, human));
  return sink.exit(2);
}
```

- [ ] **Step 4: Export a log line from the CLI logger**

In `lib/cli-logger.ts`, change `writeCliLogLine`'s first parameter type from `level: "warn" | "error"` to `level: "info" | "warn" | "error"`, and add after it:

```ts
/** One structured line on the cli surface for text the screen does not keep: a step's streamed output, a resolver warning. */
export function logCliLine(level: "info" | "warn" | "error", module: string, message: string, context: Record<string, unknown> = {}): void {
  writeCliLogLine(level, module, message, context);
}
```

- [ ] **Step 5: Route the two resolver warnings to the log and reword the comment**

`lib/setup/finish-gate.ts`: add `import { logCliLine } from "../cli-logger.ts";` and change line 19 to

```ts
  const warn = opts.warn ?? ((message: string) => logCliLine("warn", "setup.finish-gate", message));
```

`lib/setup/team-settings.ts`: add the same import and change `defaultWarn`'s body to `logCliLine("warn", "setup.team-settings", message);`. Update the doc comment above it to: `/** The CLI log, never a stream: this runs under --json paths whose stdout is the envelope. A caller that wants silence passes its own no-op through the warn param. */`

`lib/setup/steps/home.ts`: in the comment at lines 45 to 49, the sentence that quotes a numbered `console.error(...)` frame and calls it "a frame from the compiled binary" becomes: ``the "error" the app showed was a numbered source frame from the compiled binary's own logging call``. No dash and no `console.` call shape may remain in that comment.

- [ ] **Step 6: Delete the three allowlist lines**

Remove `"lib/setup/finish-gate.ts",`, `"lib/setup/steps/home.ts",` and `"lib/setup/team-settings.ts",` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 7: Run the tests**

Run: `bun test lib/setup/__tests__/user-failure.test.ts lib/__tests__/no-raw-output.test.ts lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/team-settings.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/setup/user-failure.ts lib/setup/__tests__/user-failure.test.ts lib/cli-logger.ts lib/setup/finish-gate.ts lib/setup/team-settings.ts lib/setup/steps/home.ts lib/__tests__/raw-output-allowlist.json
git commit -m "setup: one exit-2 path, resolver warnings to the cli log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The step emitter

**Files:**
- Rewrite: `lib/setup/emit.ts`
- Rewrite: `lib/setup/__tests__/emit.test.ts`
- Modify: `lib/setup/apply.ts` (`tip` on `ApplyContext` and `CreateApplyContextDeps`, the notice sink line)
- Modify: `lib/setup/__tests__/apply.test.ts` (append one test)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/setup/emit.ts`)

**Interfaces:**
- Consumes: `openStep(title): StepHandle` with `sub(text)`, `done(title?, hint?, status?)`, `fail(title?, hint?)` (phase 1, `lib/ui/spawn.ts`); `interactive()` (`lib/ui/gate.ts`); `out.print`, `out.line`, `out.callout`, `out.verbatim`, `out.summary` (phase 1); `ApplyEvent`, `EventId`, `StepState` (`lib/setup/contract.ts`); `setSettingsNoticeSink` (existing, `lib/settings/write.ts`).
- Produces, exported from `lib/setup/emit.ts`: `type Emit = (ev: ApplyEvent) => void` (unchanged); `interface StepEmitterLabels { done: string; needsYou: string; failed: string }`; `interface StepEmitterOptions { labels: StepEmitterLabels; log: (id: EventId, line: string) => void; interactive?: boolean }`; `interface StepEmitter { emit: Emit; tip(id: EventId, line: string): void; flush(): Promise<void> }`; `createStepEmitter(opts): StepEmitter`. `createNdjsonEmitter` and `createHumanEmitter` are deleted (Task 1 already moved both callers' JSON branch onto `deps.json`; Tasks 5 and 7 move the human branch onto this emitter).
- Produces on `lib/setup/apply.ts`: `ApplyContext.tip?: (id: EventId, line: string) => void`; `CreateApplyContextDeps.tip?: (id: EventId, line: string) => void`; the engine's notice sink calls `(ctx.tip ?? ctx.log)(step.id, line)`.

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

Append to `lib/setup/__tests__/apply.test.ts` (read the file's existing context factory and step helper names first and use them; the body below assumes a `makeCtx(overrides)` that returns an `ApplyContext` built through `createApplyContext`, and a `step(id, run)` helper. If the file names them differently, use its names):

```ts
test("a settings tip raised inside a step reaches ctx.tip, not the log event", async () => {
  const tips: Array<[string, string]> = [];
  const events: ApplyEvent[] = [];
  const ctx = await makeCtx({ emit: (ev) => events.push(ev), tip: (id, line) => tips.push([id, line]) });
  const { setSettingsNoticeSink } = await import("../../settings/write.ts");
  await runApplyWith(
    [
      step("path.link", async () => {
        const engine = setSettingsNoticeSink(null);
        engine("Saved on this Mac only.");
        setSettingsNoticeSink(engine);
        return { state: "done" };
      }),
    ],
    ctx,
  );
  expect(tips).toEqual([["path.link", "Saved on this Mac only."]]);
  expect(events.some((e) => e.event === "log")).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/emit.test.ts lib/setup/__tests__/apply.test.ts`
Expected: FAIL, `createStepEmitter` is not exported; the apply test fails on `tip` not being a known dep.

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
    const failed = ev.state === "failed";
    const status: RenderStatus = failed ? "failed" : FINAL_STATUS[ev.state];
    const painted = running.handle
      ? await (failed ? running.handle.fail(running.title, ev.detail) : running.handle.done(running.title, ev.detail, FINAL_STATUS[ev.state]))
      : false;
    const blocks: Block[] = [];
    if (!painted) {
      blocks.push(out.line(status, running.title, ev.detail));
      if (failed && running.subs.length > 0) blocks.push(out.verbatim(running.subs));
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
  /** A settings tip raised while a step ran. Absent, the tip is a `log` line. */
  tip?: (id: EventId, line: string) => void;
```

- Change the notice sink line in `runApplyWith` from `setSettingsNoticeSink((line) => ctx.log(step.id, line))` to `setSettingsNoticeSink((line) => (ctx.tip ?? ctx.log)(step.id, line))`.
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

- Delete the `renderPlanHuman` and `renderFinishLine` describes and the `../../lib/ansi.ts` import; import `captureOut` from `./helpers/capture-out.ts` and change the import from `../setup.ts` to `{ setupPlan, setupStatus, type SetupDeps }`.
- `captureDeps()` loses `print`, keeps `json: (v) => lines.push(JSON.stringify(v))`.
- Rewrite the human tests:

```ts
  test("human mode prints the mac group's section title", async () => {
    const cap = captureOut();
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
    const cap = captureOut();
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
    const cap = captureOut();
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

In `commands/__tests__/setup-apply.test.ts`, the `setupInteractive` describe: the "prints the plan groups" test asserts `cap.stdout()` contains `"Your Mac ("`; the "not ready" test asserts `cap.stderr()` contains `"[failed] This Mac is not ready to install yet"` and `"  why: Waiting on "`. Wrap each in `captureOut()`/`restore()`.

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
- Modify: `commands/__tests__/setup-apply.test.ts`, `setup-update.test.ts`, `setup-finish.test.ts`

**Interfaces:**
- Consumes: `createStepEmitter`, `StepEmitterLabels`, `StepEmitter` (Task 3); `exitWithUserError`, `UserErrorSink` (Task 2); `logCliLine` (Task 2); `out.print`, `out.line`, `out.callout`, `out.cmd`; `UserActionableError` from `lib/errors.ts` (phase 2).
- Produces in `commands/setup.ts`: `const APPLY_LABELS: StepEmitterLabels`, `const UPDATE_LABELS: StepEmitterLabels`, `function sinkOf(deps: { json; exit?; probes }): UserErrorSink`, `function warnLine(json: boolean, title: string, detail: string): void`, `function notReadyFailure(err: UserActionableError): Partial<FailureInput> | undefined`. `ApplyDeps.printError` is deleted. `AfterFinish` becomes `{ update(opts: { json: boolean }): Promise<void>; warn(title: string, detail: string): void }`; `updateAfterFinish(opts: { json: boolean }, deps?)`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/setup-apply.test.ts`:

- Import `captureOut` and `logsDir` (`import { logsDir } from "../../lib/rt-paths.ts";`) and `readdirSync, readFileSync` from `fs`.
- Replace the "human mode never emits JSON" test with:

```ts
  test("human mode prints the step's title and a summary, never JSON or the id", async () => {
    const cap = captureOut();
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
    const cap = captureOut();
    try {
      let atExit = "";
      const deps = baseApplyDeps({
        steps: [{ ...fakeStep("path.link", { state: "failed", detail: "boom" }), title: "Link rt onto your PATH" }],
        exit: ((code: number) => {
          atExit = cap.stdout();
          deps.exitCodes.push(code);
          throw new Error("exit sentinel");
        }) as ApplyDeps["exit"],
      });
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect(atExit).toBe("[failed] Link rt onto your PATH  boom\n[failed] Setup stopped  1 failed\n");
    } finally {
      cap.restore();
    }
  });
```

(`baseApplyDeps` returns `deps` before `exit` can close over it; declare `const deps = baseApplyDeps({...})` first with the default exit, then reassign `deps.exit` to the closure above.)

- Replace the "a gate that cannot be read ... says so on stderr" test with:

```ts
  test("a finish check that throws under --json reaches the log, never stdout", async () => {
    const cap = captureOut();
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
    const cap = captureOut();
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
    const cap = captureOut();
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

- Remove `print` and `printError` from `baseApplyDeps` (keep `json`).

In `commands/__tests__/setup-update.test.ts`: remove `print` from `baseApplyDeps`; the three human tests become stdout captures:

```ts
  test("human mode: not set up is a pending line with the install verb", async () => {
    const cap = captureOut();
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
    const cap = captureOut();
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

In `commands/__tests__/setup-finish.test.ts`: `lines` assertion for human mode becomes `expect(cap.stdout()).toBe("[ok] Setup is finished on this Mac\n")`; the `AfterFinish` fake's `printError` becomes `warn: (title, detail) => warnings.push(\`${title}: ${detail}\`)` and the assertion `expect(a.warnings).toEqual(["The update after Finish did not finish: boom"])`.

In `lib/setup/__tests__/update.test.ts`: delete the `summarizeUpdate` describe and its import.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts`
Expected: FAIL (the human strings are still the old ones; `printError`/`print` are still required).

- [ ] **Step 3: Convert the verbs**

In `commands/setup.ts`:

Imports: drop `createHumanEmitter, createNdjsonEmitter`; add

```ts
import { createStepEmitter, type Emit, type StepEmitterLabels } from "../lib/setup/emit.ts";
import { exitWithUserError, type UserErrorSink } from "../lib/setup/user-failure.ts";
import { logCliLine } from "../lib/cli-logger.ts";
import type { FailureInput } from "../lib/ui/out.ts";
```

and change `import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";` to `import { UserActionableError } from "../lib/errors.ts";` plus `import { userErrorPayload } from "../lib/setup/errors.ts";` (drop the second if nothing in the file still calls it after this task; Task 6 removes the last caller). Drop `summarizeUpdate` from the `update.ts` import.

Delete the local `exitWithUserError` function (the one at "Per-integration verbs") and add, near the top after `flagValue`:

```ts
function sinkOf(deps: { json: (value: unknown) => void; exit?: (code: number) => never; probes: Pick<Probes, "now"> }): UserErrorSink {
  return { json: deps.json, exit: deps.exit ?? process.exit, now: () => deps.probes.now() };
}

const APPLY_LABELS: StepEmitterLabels = { done: "Setup is done", needsYou: "Setup needs you", failed: "Setup stopped" };
const UPDATE_LABELS: StepEmitterLabels = { done: "Everything is up to date", needsYou: "The update needs you", failed: "Part of the update failed" };

function stepLog(module: string): (id: string, line: string) => void {
  return (id, line) => logCliLine("info", module, line, { step: id });
}

/** A caveat worth a line for a person; under --json only the log keeps it, since stdout is the stream. */
function warnLine(json: boolean, title: string, detail: string): void {
  logCliLine("warn", "setup", `${title}: ${detail}`);
  if (!json) out.print(out.line("warn", title, detail));
}
```

Every remaining `exitWithUserError(err, json, verb, deps)` call in the file becomes `exitWithUserError(err, json, sinkOf(deps))` (Task 6 adds the human words where a verb has them). Delete the now-unused `verb` constants only where nothing else reads them.

`ApplyDeps`: delete `printError`. `realApplyDeps`: delete `print`.

Replace `HARD_PRECONDITION_REMEDY`'s neighbour with the human table (leave `HARD_PRECONDITION_IDS`, `HARD_PRECONDITION_REMEDY` and `gateHardPreconditions` exactly as they are):

```ts
const HARD_PRECONDITION_HUMAN: Record<string, { why: string; next?: string }> = {
  "tool.clt": { why: "Apple's Command Line Tools are not installed", next: "rt tools install apple-clt" },
  "tool.macos": { why: "rt needs macOS 14 or newer" },
};

/** The envelope message is the app's contract and names row ids; the person gets plain words built from the same ids. */
function notReadyFailure(err: UserActionableError): Partial<FailureInput> | undefined {
  if (err.code !== "not-ready") return undefined;
  const hard = Object.keys(HARD_PRECONDITION_HUMAN).filter((id) => err.message.includes(id));
  if (hard.length === 0) return undefined;
  const only = hard.length === 1 ? HARD_PRECONDITION_HUMAN[hard[0]!] : undefined;
  return {
    title: "This Mac is not ready to install yet",
    why: hard.map((id) => HARD_PRECONDITION_HUMAN[id]!.why).join(". "),
    ...(only?.next ? { next: out.cmd(only.next) } : {}),
  };
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
    if (err instanceof UserActionableError) return exitWithUserError(err, json, sinkOf(deps), notReadyFailure(err));
    throw err;
  }

  await human.flush();
  if (!result.ok) return deps.exit(2);
  if (selection.from === undefined && selection.only === undefined) {
    stampUpdateWhenNothingPends(deps, json);
    await finishIfClear(deps, json);
  }
}
```

(Write `await human?.flush();` in both places; the second is after the try, where `human` may be null.) Keep the two long comments above `setupApply` and inside its catch that explain the bug-vs-user-error split; delete the sentence in the first that says "prints through `deps.print`/`emit`".

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
      const err = new UserActionableError("unknown-flag", `${flag} is not a setup update flag: an update run always runs every update-safe step`);
      return exitWithUserError(err, json, sinkOf(deps), { title: "An update always runs every safe step", why: "Updates cannot start from or stop at one step" });
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

Inside the run, delete `if (!json) deps.print(\`setup update: ${summarizeUpdate(result.outcomes)}\`);` and, after the `finally { lock?.release(); }`, add `await human?.flush();` before `if (needsAttention) deps.exit(2);`. The `--from/--only` message string stays exactly as it is today (it is frozen; this task only re-indents it if the formatter asks).

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

Run: `bun test commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts lib/setup/__tests__/update.test.ts && bun run typecheck`
Expected: PASS. `typecheck` may still report `commands/uninstall.ts` (Task 7) and nothing else.

- [ ] **Step 5: Commit**

```bash
git add commands/setup.ts lib/setup/update.ts lib/setup/__tests__/update.test.ts commands/__tests__/setup-apply.test.ts commands/__tests__/setup-update.test.ts commands/__tests__/setup-finish.test.ts
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

In `commands/__tests__/setup-connect.test.ts`: remove `print` from the deps factory; the test at line 115 (`deps.lines.join("\n")` contains `"unverified"`) becomes a stderr capture: wrap in `captureOut()` and assert `cap.stderr()` contains `"[failed] "` and `"unverified"`. Add:

```ts
  test("human mode prints one line with the integration's title, never its id", async () => {
    const cap = captureOut();
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
- Consumes: `createStepEmitter`, `StepEmitterLabels` (Task 3); `exitWithUserError` (Task 2); `logCliLine` (Task 2); `out.section`, `out.changes`, `out.line`, `out.print`.
- Produces: `UNINSTALL_LABELS`; `UninstallDeps` without `print`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/uninstall.test.ts`: remove `print` from `baseDeps` (keep `json`). The human test at line 217 becomes:

```ts
  test("human mode: a failure block naming the argument, nothing on stdout", async () => {
    const cap = captureOut();
    try {
      const deps = baseDeps();
      await runExpectingExit(() => runUninstallCommand(["gitq"], {}, deps));
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toMatch(/^\[failed\] unexpected argument "gitq"\. /);
    } finally {
      cap.restore();
    }
  });
```

The "stayed" test becomes `expect(cap.stdout()).toContain("Kept on this Mac\n[skipped] ~/.mattstack (kept)\n")`. Add:

```ts
  test("human --dry-run lists what would go as a changes block", async () => {
    const cap = captureOut();
    try {
      await runUninstallCommand(["--dry-run"], {}, baseDeps());
      expect(cap.stdout()).toBe("This would remove\n- Stop and remove the rt daemon and deck services\n");
    } finally {
      cap.restore();
    }
  });

  test("a human run draws each action as a step by title and ends in a summary", async () => {
    const cap = captureOut();
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

In `commands/uninstall.ts`: replace the `emit.ts`, `errors.ts` imports with

```ts
import { createStepEmitter, type Emit, type StepEmitterLabels } from "../lib/setup/emit.ts";
import { UserActionableError } from "../lib/errors.ts";
import { exitWithUserError } from "../lib/setup/user-failure.ts";
import { logCliLine } from "../lib/cli-logger.ts";
import * as out from "../lib/ui/out.ts";
```

Delete `print` from `UninstallDeps` and `realUninstallDeps`. Add `const UNINSTALL_LABELS: StepEmitterLabels = { done: "mattstack is uninstalled", needsYou: "Uninstall needs you", failed: "Uninstall stopped" };`.

In `runUninstallCommand`:

- dry run: `if (json) deps.json(payload); else out.print(out.section("This would remove", undefined, out.changes(payload.actions.map((a) => ({ op: "-" as const, name: a.title })))));`
- the confirm list: `out.print(out.section("This will remove", undefined, out.changes(actions.map((a) => ({ op: "-" as const, name: a.title })))));`
- the emitter:

```ts
    const human = json ? null : createStepEmitter({ labels: UNINSTALL_LABELS, log: (id, line) => logCliLine("info", "uninstall", line, { step: id }) });
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
import { captureOut } from "./helpers/capture-out.ts";

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

let cap: ReturnType<typeof captureOut> | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

describe("rt verify --json", () => {
  test("stdout is exactly the two-space-indented payload for the plan composePlan returns", async () => {
    cap = captureOut();
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
    cap = captureOut();
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
    cap = captureOut();
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

Append to `commands/__tests__/accounts.test.ts` (add imports: `run, accountsBlocks, type AccountsDeps` from `../accounts.ts`; `captureOut` from `./helpers/capture-out.ts`; `renderPlain` from `../../lib/ui/out-plain.ts`; `afterEach` from `bun:test`):

```ts
let cap: ReturnType<typeof captureOut> | null = null;
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
    cap = captureOut();
    await go(deps(), ["--json"]);
    expect(cap.stdout()).toBe(JSON.stringify(formatAccountsJson(db)) + "\n");
  });

  test("a failed recheck under --json is the frozen error line and exit 1", async () => {
    cap = captureOut();
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
    cap = captureOut();
    const d = deps({ recheck: async () => false });
    await go(d, ["--recheck"]);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toBe("[failed] Could not recheck your accounts\n  why: The rt daemon did not answer\n  next: rt daemon start\n");
    expect(d.exitCodes).toEqual([1]);
  });

  test("a successful recheck prints a done line before the table", async () => {
    cap = captureOut();
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
const STATUS_WORD: Record<CredentialHealthRow["status"], { text: string; role: RenderStatus }> = {
  ready: { text: "working", role: "done" },
  invalid: { text: "rejected", role: "failed" },
  error: { text: "not checked", role: "warn" },
};

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

Imports: add `import * as out from "../lib/ui/out.ts";`, `import type { Block, RenderStatus } from "../lib/ui/protocol.ts";`, `import type { CommandContext } from "../lib/command-tree.ts";`. The `--json` error string `"Recheck failed. Is the daemon running?"` stays byte for byte. Remove `"commands/accounts.ts",` from the allowlist.

- [ ] **Step 4: Run the tests**

Run: `bun test commands/__tests__/accounts.test.ts lib/__tests__/no-raw-output.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/accounts.ts commands/__tests__/accounts.test.ts lib/__tests__/raw-output-allowlist.json
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
- Consumes: `UserActionableError` from `lib/errors.ts` (phase 2), `userErrorPayload` (`lib/setup/errors.ts`, or where phase 2 left it), `failureFor` (Task 2); `out.print`, `out.fail`, `out.table`, `out.line`, `out.callout`, `out.cmd`, `out.json`.
- Produces: `LoginsDeps.json: (value: unknown) => void` replacing `print`. `exitUserError` is no longer imported here.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/logins.test.ts`: in `deps()`, replace `print: (s) => { out.push(s); }` with `json: (v) => { out.push(JSON.stringify(v)); }` (the `out` array name collides with the output module; rename the module import to `import * as outMod` or keep the array and import `captureOut` only). Add:

```ts
  test("list for a person is a table, and an empty list points at add", async () => {
    const cap = captureOut();
    try {
      const t = deps();
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toBe("[not yet] No dev logins saved yet\n  next: rt logins add <origin>\n");
      t.data["https://login.example.com"] = JSON.stringify({ email: "a@example.com", password: "x" });
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toContain("https://login.example.com  a@example.com\n");
    } finally {
      cap.restore();
    }
  });

  test("off a TTY with no origin remove fails with usage on stderr and exit 2", async () => {
    const cap = captureOut();
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

(How `data` stores a login depends on `saveLogin`'s key and value shape; read `lib/logins/store.ts` and seed `t.data` the way `saveLogin` would, or call `saveLogin(t.d.backend(), ...)` instead of writing `t.data` directly.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/logins.test.ts`
Expected: FAIL.

- [ ] **Step 3: Convert `commands/logins.ts`**

- `LoginsDeps`: replace `print` with `json: (value: unknown) => void;` (doc: "One machine line on stdout. Never human text."). `realDeps`: `json: (v) => out.json(v)`.
- Imports: `import { UserActionableError } from "../lib/errors.ts";`, `import { userErrorPayload } from "../lib/setup/errors.ts";`, `import { failureFor } from "../lib/setup/user-failure.ts";`, `import * as out from "../lib/ui/out.ts";`.
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
  else out.fail(failureFor(user, user.code === "usage" ? USAGE_HUMAN[user.message] : undefined));
  process.exit(2);
}

const USAGE_HUMAN: Record<string, { title: string; next: Segment }> = {
  "usage: rt logins add <origin>": { title: "Which site?", next: out.cmd("rt logins add <origin>") },
  "usage: rt logins open-add <origin>": { title: "Which site?", next: out.cmd("rt logins open-add <origin>") },
  "usage: rt logins remove <origin>": { title: "Which site?", next: out.cmd("rt logins remove <origin>") },
};
```

(import `type Segment` from `../lib/ui/protocol.ts`; every `fail("verb", json, d, err)` call becomes `fail(json, d, err)`; the usage messages stay as they are, they are the JSON contract.)

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

In `commands/__tests__/secrets.test.ts`: replace `withCapturedLogs` with a `captureOut`-based helper:

```ts
async function withCapturedOut<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const cap = captureOut();
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
    const { stdout } = await withCapturedOut(() => withStdin("shh\n", () => secretsSet(["--team", "acme", "board", "apiKey", "--stdin"], {}, seams)));
    expect(stdout).toBe("[ok] Saved the secret  acme/board.apiKey\n");
    expect(stdout).not.toContain("shh");
  });
```

(`withStdin` is the file's existing stdin fake; `teamSeams` its existing seams factory. The re-encrypt test's assertion becomes `expect(stdout).toContain("[ok] Re-encrypted 2 files for team")`, and the "no domain files" one `expect(stdout).toContain("[skipped] No secret files to re-encrypt for team")`.)

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

### Task 12: The `setup apply` pty gate

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

test("setup apply --only verify draws the verify step by its title and ends in a summary, with no stack on screen", async () => {
  const home = createTestHome();
  const session = await startInteractive({ args: ["setup", "apply", "--only", "verify"], home: home.path, env: { RT_UI_BIN }, cols: 100, rows: 30 });
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
Expected: both pty files PASS. If `Verify your setup` never paints, run `RT_BATCH=1 dist/rt setup apply --only verify` under `env -i HOME=<the test home>` to read the plain output and fix the cause; never run the built binary without an isolated HOME.

- [ ] **Step 4: Commit**

```bash
git add e2e/pty/setup-apply.test.ts .github/workflows/e2e.yml
git commit -m "e2e: pty gate for setup apply at a terminal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Document the emitter, run every gate, look at it

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
that also go to the CLI log through `logCliLine`, a `fix` callout for a
remedy, and a `summary` at the end; a verb awaits `flush()` before it exits.
The NDJSON stream is the app's contract and goes through each verb's `json`
seam (`out.json`). Every `Row.detail`, `StepOutcome.detail`, `remedy` and
`UserActionableError` message rides `--json`, so those strings are frozen
copy: the human view shows them as hints under titles, and plainer words for
a person are passed beside them (`exitWithUserError`'s `human` argument),
never written over them.
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
- `bun cli.ts setup apply --only verify`
- `bun cli.ts setup apply --from bogus` (the failure block, no stack)
- `bun cli.ts verify`
- `bun cli.ts accounts`
- `bun cli.ts secrets list` (the usage failure)

Say plainly what reads wrong. If you have no real terminal (a subagent usually does not), run each with `| cat` and `RT_BATCH=1`, paste the plain output into the task report, state that the styled form was not viewed, and leave the screenshots for the final review.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: the setup emitter and the frozen-copy rule in AGENTS.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Setup section: emitter drives steps with titles (Task 3), `log` as sub-lines (Task 3), final states and `partial` as `warn` (Task 3), remedy as a callout (Task 3; this plan picks `fix` for every remedy, since a `StepOutcome` carries one only on `failed` and `partial`), closing event as a summary (Task 3), plan view as sections with `missing` as pending or needs-you (Task 4), the settings tip under its step (Task 3's `tip` hook; the sink itself is phase 4's). Spec rule 5, sub-lines in the log (Task 3's `log` option and Task 2's `logCliLine`). Spec "Steps" paragraph: the emitter never uses `steps.ts`'s fallback (Task 3 prints with `out.print`). Error seam: every expected failure through `out.fail` with the envelope untouched (Tasks 2, 5, 6, 7, 10, 11). Testing: `--json` characterization (Tasks 1, 8, 9), pty gate for `setup apply` (Task 12), screenshots (Task 13). Phases list: every verb named for phase 3 has a task.
- **Placeholder scan.** The only "copy the setup of test X" instructions point at a named existing test in the same file and say exactly what to assert; the plan-blocks, emitter, user-failure, verify and accounts tests are complete.
- **Type consistency.** `json: (value: unknown) => void` everywhere; `StepEmitter { emit, tip, flush }`; `exitWithUserError(err, json, sink, human?)` with `UserErrorSink { json, exit, now }`; `logCliLine(level, module, message, context?)`; `rowStatus`, `planBlocks(plan, mode)`, `rowTitles(plan, ids)`; `verifyPayload(results, plan)`; `accountsBlocks(rows, now)`.
- **Review Focus.** Each of the five lines names its test and task.
