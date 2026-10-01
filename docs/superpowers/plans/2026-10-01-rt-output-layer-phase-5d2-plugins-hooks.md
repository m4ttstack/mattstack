# rt Output Layer, Phase 5d2 (Plugins, Tools, Deps, Hooks and Intercept) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every line a person reads from `rt plugin`, `rt tools`, `rt deps`, `rt hooks` and `rt intercept`, and every plugin load warning, comes from the output layer, so `commands/plugin.ts`, `tools.ts`, `deps.ts`, `hooks.ts`, `intercept.ts`, `lib/plugins.ts` and `lib/plugin-api.ts` leave the raw-output allowlist; `rt plugin validate` gains `--json`, and the plugin skill reads it.

**Architecture:** Each verb's human output becomes a pure function that returns blocks, printed with one `out.print` and pinned in tests through `renderPlain`. `plugin validate --json` prints one contract envelope and the skill that scraped the word `ok` is edited in the same PR to read it. Plugin load warnings fire under every verb, before the verb is known, so they go through 5a's `warn` with one plain title per message; the intercept shim's own notes go through `out.note`, because that process's stdout belongs to the tool it wraps.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`. No Go change (all Go work in phase 5 is 5a's).

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Block vocabulary", "Status set", "Copy style", "Guard" and "Testing". The slice is section 3 "5d" of `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md`, second half of its second cut, with its ruling 7 (`plugin validate` gains `--json`). The API it builds on is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md` ("API for slices 5b to 5f", "The breadcrumb header (nothing to call)", and rows 44 and 45 of the warnings table in its Task 1). The twelve rulings in `.superpowers/sdd/cross-phase-rulings.md` and the notes in `.superpowers/sdd/herd-notes.md` bind this plan.

**This is one of two plans for slice 5d.** The slice measures about 183 visible sites; this plan's estimate is about 1,250 changed lines (about 470 in the nine source files, about 780 in tests, the skill, the plugin guide and generated docs) and the other half's is about 1,900. Together they pass the 2,500 line mark Matt set, so the slice ships as two PRs along the scoping document's second cut: `2026-10-01-rt-output-layer-phase-5d1-skills.md` (the seven `skills` files and `lib/skills/sources.ts`) and this plan. They share no source file and no test file, and either can merge first.

**What was run while writing this plan:** nothing was compiled. The code was written against the files at `9390e493d` plus `lib/ui/__tests__/capture-out.ts` as phase 4 left it on `origin/main` (`19ceaa403`), and against 5a's signatures as its plan states them. Every expected plain string was worked out by hand from `lib/ui/out-plain.ts` with 5a's leading-failure rule applied.

## Execution notes from plan review round 2 (apply in the task named)

- **Task 9 (intercept): tie the trace check to the real strings.** Export the trace test (`isDebugTrace(msg)` or `DEBUG_TRACE`) and add a test in `intercept-output.test.ts` that runs `runInterception` with fake deps and `callerEnv.RT_INTERCEPT_DEBUG = "1"`, collects every `warn` message, and asserts the `match ` and `claim result=` lines count as traces and a `passthrough` line does not. A later reword of `lib/endpoint/run.ts` then fails CI instead of turning traces into peach warnings.
- **Task 9: `RT_INTERCEPT_DEBUG=1` is consent for plain traces on stderr (controller ruling, replaces the earlier "log only" for this case).** With `RT_INTERCEPT_DEBUG=1` set, traces print plain on stderr as `  <msg>` (as under `RT_LOG_LEVEL=debug`) AND go to the CLI log at debug; without it, they go to the log only. This keeps the promise in `docs/superpowers/specs/2026-08-19-rt-dev-endpoint-intercept-design.md:61`. Test both.
- **Tests that leave out a positional set `process.stdin.isTTY` to false themselves** (as `apps.test.ts:94` does), restored afterwards, so an interactive `bun test` never opens a picker. Replaces the Global Constraint that assumed it.
- **Task 9: before writing the `claim result=` trace to the CLI log, check `claimRes.data`** (role, port, refs) carries nothing secret; if any field could, log the role and port only.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command keeps its shape (the 2026-10-01 ruling): keys, structure, types, exit codes and every value a program reads stay as they are; a human sentence inside an envelope may change wording, with the shape pinned and the sentence pinned separately. Plain text off a TTY takes the new wording.
- Tests that leave a positional out assume stdin is not a terminal, as under CI and an agent's Bash tool; run them from a non-interactive shell.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- 5d2 only: exit codes do not change. `plugin new` with no name, an unknown plugin, and a plugin with problems exit 1; `tools install` and `tools setup` exit 2 on a usage or user error and 1 on a failed result; `deps` exits 1 on a missing tool name and 2 on a link refusal; `hooks` exits 1 on no hooks and on an unknown hook; `intercept run` exits with the wrapped tool's code.
- 5d2 only: `rt intercept run` writes nothing of its own to stdout, ever, and nothing it prints may stop the wrapped tool from running.
- 5d2 only: `rt plugin validate` is not made agent-safe. It dry-imports a plugin's modules, which runs their top-level code, so exposing it through `rt_verb` would be a permission grant on every estate machine.
- 5d2 only: the generated shim script in `commands/hooks.ts` (`generateShims`) and the scaffolded plugin's files (`scaffoldPlugin`) are file content, not terminal output; their bytes do not change.
- 5d2 only: files this slice must not edit: anything under `ui/`; `lib/ui/**`; `lib/setup/**` (phase 3), which includes `lib/setup/tools-install.ts`; `lib/endpoint/**` (`lib/endpoint/run.ts` writes the intercept note text and is not on this slice's list); `commands/settings-keys.ts` (phase 4); every file the 5d1 plan owns (`commands/skills*.ts`, `lib/skills/**`); anything under `plugins/mattstack/`. The one skill edited is `skills/rt-create-plugin/SKILL.md`.
- 5d2 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.

## Review Focus

1. **A plugin that prints while it is being validated.** `plugin validate` dry-imports each module, which runs its top-level code; a `console.log` there would land on stdout beside the `--json` envelope the skill parses. Under `--json` stdout must be one JSON value. Pinned in Task 3 (`a plugin that prints at import cannot break the envelope`).
2. **A load warning while a program reads stdout.** A broken or colliding plugin warns under every verb, `rt cd` and every `--json` verb included. The warning must be on stderr, never stdout, and once per process. Pinned in Task 5 (`a load warning is shown once, on stderr, and logged`).
3. **A manifest whose text is hostile.** A plugin folder name or a manifest error is untrusted text; a newline followed by `[ok] forged` must not print as a row of its own in `plugin list` or `plugin validate`. Pinned in Task 4 (`a hostile problem string cannot forge a row`).
4. **`intercept run` with a dead stderr or no helper.** The shim sits in front of a person's dev server. A note that cannot be written must be dropped, and the tool must still run. Pinned in Task 9 (`a note that cannot be written never throws`).
5. **A failed row action in the app.** The tray runs `tools install <tool> --json` and `deps link <tool> --json`. On exit 2 it reads `error.message` from the envelope on stdout (`RtResult.userError`, read at `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift:139`), never stderr; on any other non-zero exit it shows the first 200 bytes of stderr (`failureCopy`, `rt-tray/Sources-core/Rt/RtClient.swift:21`). So a `deps link` refusal keeps its exit-2 envelope with exactly `code` and `message`, and a failed `tools install` leads stderr with the reason alone, with no tag and no blank line before it. Pinned in Task 6 (`tools install of a bundled tool --json, refused: the envelope, the detail alone on stderr, exit 1`, and `a failed setup under --json leads stderr with the reason`) and Task 7 (`depsLink --json also exits 2 on refusal`, which pins the message and `Object.keys(body.error)`).

## File Structure

| File | Responsibility |
|---|---|
| `commands/plugin.ts` (modify) | `validatePlugins`, the `--json` envelope, `pluginListBlocks`, `validateBlocks`, `scaffoldedBlocks`; every print through `out` |
| `lib/command-tree-def.ts` (modify, one line) | The `--json` argument on `plugin validate` |
| `website/docs/reference/plugin/validate.mdx` (regenerated) | `bun run docs:gen` |
| `skills/rt-create-plugin/SKILL.md` (modify, two lines) | Reads the envelope in place of the word `ok` |
| `lib/plugins.ts` (modify) | `PluginScaffoldError`, load warnings through `warn`, the scaffold's print line spelled so the guard does not read it as a print |
| `lib/plugin-api.ts` (modify) | The types-refresh warning through `warn` |
| `commands/tools.ts`, `commands/deps.ts` (modify) | Result lines and failures on the layer |
| `lib/deps/links.ts` (modify, four strings), `lib/deps/__tests__/links.test.ts` (modify, one line) | Plain wording for four refusals |
| `docs/plugins.md`, `website/docs/guides/plugins.mdx` (modify, two rows each) | The troubleshooting rows that quote a load warning |
| `commands/hooks.ts` (modify) | `hooksStatusBlocks`, `selectionBlocks`, two warnings through `warn` |
| `commands/intercept.ts` (modify) | `statusBlocks`, `installBlocks`, `uninstallBlocks`, `interceptNote` |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Seven lines deleted |
| `commands/__tests__/plugin.test.ts`, `intercept-output.test.ts` (create); `deps.test.ts`, `tools-setup.test.ts`, `hooks.test.ts`, `lib/__tests__/plugins.test.ts`, `plugin-api.test.ts`, `e2e/tests/plugins.test.ts` (modify) | Tests |
| `docs/design/output-layer/` (modify) | Two renders and a README row |

---

### Task 1: Check what this plan builds on is on main

No code. Stop and report if any check fails; do not work around a missing piece.

**Files:** none.

**Interfaces:**
- Consumes: 5a's merged PR (`out.note`, `warn`, `usageFailure`, the plain failure rule, the breadcrumb that skips hidden leaves) and phase 4's `captureOut({ console: true })` with `clear()`.
- Produces: a branch based on a main that has both.

- [ ] **Step 1: Fetch and rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`

- [ ] **Step 2: Confirm 5a is on main**

Run: `git log origin/main --oneline -30`
Expected: a commit titled `RT-369: output layer phase 5a, layer additions and dispatcher`.

Run: `ls lib/ui/warn.ts lib/ui/usage.ts`
Expected: both files listed.

Run: `grep -n "export function note" lib/ui/out.ts`
Expected: one line.

Run: `grep -n "export function usageFailure\|export function warn\|export function setWarningLog\|export interface ShownWarning" lib/ui/usage.ts lib/ui/warn.ts`
Expected: four lines, with signatures equivalent to `usageFailure(title: string, usage: string, why?: string): FailureInput`, `warn(module: string, message: string, opts?: WarnOptions): void`, `setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void` and `ShownWarning { title: string; hint?: string; next?: CellInput }`. 5a's code spells the two optional parameters as defaults (`opts: WarnOptions = {}`, `opts: { quiet?: boolean } = {}`); that is the same signature.

Run: `grep -n "setWarningLog" cli.ts`
Expected: at least one line (5a's Task 13 wires the CLI log, and sets it `quiet` for `rt intercept run`).

If 5a is not on main, stop here and report "5a is not on main yet"; this plan cannot start.

- [ ] **Step 3: Confirm the capture helper phase 4 extended**

Run: `grep -n "console?: boolean\|clear(): void" lib/ui/__tests__/capture-out.ts`
Expected: two lines.

- [ ] **Step 4: Confirm the seven files are still on the allowlist**

Run: `grep -n "commands/plugin.ts\|commands/tools.ts\|commands/deps.ts\|commands/hooks.ts\|commands/intercept.ts\|lib/plugins.ts\|lib/plugin-api.ts" lib/__tests__/raw-output-allowlist.json`
Expected: seven lines.

---

### Task 2: Audit of the print sites this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are at `9390e493d`. Where today's text holds a long dash, this table writes `--`.

**Files read:** `commands/plugin.ts`, `tools.ts`, `deps.ts`, `hooks.ts`, `intercept.ts`, `lib/plugins.ts`, `lib/plugin-api.ts`, `lib/deps/links.ts`, `lib/deps/resolve.ts`, `lib/endpoint/run.ts` (the text its `warn` seam carries), `lib/endpoint/shim.ts` (the shapes `intercept` prints), `lib/setup/tools-install.ts` (the `detail` strings `tools` prints), the test files in the last table, `skills/rt-create-plugin/SKILL.md`, `docs/plugins.md`.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What this plan touches |
|---|---|---|---|
| `plugin new` | partly | Yes. The name prompt (`textInput`) is rt-ui and is not changed. | The created line, the install notes, the next steps, the failures |
| `plugin list`, `plugin validate` | partly (as part of `plugin`) | Neither reaches rt-ui today. | All of their human output |
| `tools install`, `tools setup` | partly | Yes. The tool picker (`filterableSelect`) is rt-ui and is not changed. | The result line and failures |
| `deps resolve`, `link`, `unlink` | partly | Yes. The tool picker is rt-ui and is not changed. | The result lines and failures |
| `deps reconcile` | partly (as part of `deps`) | It reaches no picker. | Its two lines |
| `hooks` | partly | Yes, with one correction: rt-ui draws the hook checklist (`multiselect`), not a confirm. It is not changed. | Status, toggles, the result line after the checklist, failures |
| `intercept status`, `install`, `uninstall`, `run` | no | Yes: none reaches rt-ui today. | All of their human output; `run`'s notes |

#### Print sites

| Site | Today | Becomes | Task |
|---|---|---|---|
| `plugin.ts:7` | `import { bold, cyan, dim, green, reset, yellow } from "../lib/tui.ts"` | removed | 4 |
| `plugin.ts:18` | `usage: rt plugin new <name>` in yellow, exit 1 | `out.fail(usageFailure("What should the plugin be called?", "rt plugin new <name>"))`, exit 1 | 4 |
| `plugin.ts:22` `scaffoldPlugin` throws | a bad name or an existing folder reaches the seam as "rt hit an unexpected error", exit 1 | `out.fail({ title: "A plugin name is lowercase words joined by dashes", why: "<name> is not.", next: out.cmd("rt plugin new my-plugin") })` or `out.fail({ title: "A plugin called <name> already exists", why: "It is at <dir>." })`, exit 1 | 4 |
| `plugin.ts:23` | `created <dir>` | `out.line("done", "Created the <name> plugin", dir)` | 4 |
| `plugin.ts:28` | `<pm> install failed; run it manually in <dir>` | `out.line("warn", "<pm> install did not finish", "editor types will be missing until it does")`, `out.callout("fix", ["Run ", out.cmd("<pm> install"), " in ", out.strong(dir)])` | 4 |
| `plugin.ts:30` | `no bun/npm on PATH; for IDE types run 'bun install' in <dir>` | `out.line("skipped", "Editor types were not installed", "neither bun nor npm is on your PATH")`, `out.callout("fix", ["Install bun, then run ", out.cmd("bun install"), " in ", out.strong(dir)])` | 4 |
| `plugin.ts:33-35` | `next steps`, `edit <dir>/<name>.ts`, `run rt <name>` | `out.callout("next", ["Edit ", out.strong("<dir>/<name>.ts"), ", then run ", out.cmd("rt <name>")])` | 4 |
| `plugin.ts:45, 67` | `no plugins installed ... create one with rt plugin new` | `out.line("pending", "No plugins yet")`, `out.callout("next", out.cmd("rt plugin new"))` | 4 |
| `plugin.ts:52` | `ok    <name>  <n> commands: <names>` | `out.line("done", name, "<n> command(s): <names>")` | 4 |
| `plugin.ts:54` | `skip  <name>  <first error>` in yellow | `out.line("warn", name, "not loaded: <first error>")` | 4 |
| `plugin.ts:62` | `no plugin named "<x>"`, exit 1 | `out.fail({ title: "No plugin is called <x>", next: out.cmd("rt plugin list") })`, exit 1 | 4 |
| `plugin.ts:76` | `ok    <name>` | `out.line("done", name)` | 4 |
| `plugin.ts:79-80` | `fail  <name>`, then each problem dim and indented; exit 1 | `out.line("failed", name)`, `out.callout("why", ...problems)`; exit 1 | 4 |
| (new) `plugin validate --json` | the flag does not exist; `args[0]` would be read as the plugin's name | one contract envelope on stdout (below), same exit codes | 3 |
| `lib/plugins.ts:287` default sink | `console.error("  [rt] <msg>")` for three messages | `warn("plugins", msg, { show })` with one title per message (below) | 5 |
| `lib/plugins.ts:346` | a `console.log(...)` inside the scaffolded file's template text | the same bytes in the scaffolded file; the source spells the call in two parts so the guard does not read it as a print | 5 |
| `lib/plugin-api.ts:65` | `console.error("  [rt] could not refresh plugin-api types: <err>")` | `warn("plugins", "could not refresh plugin-api types: <err>")`, log only (row 45) | 5 |
| `tools.ts:59, 93` usage | `exitUserError(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"), ...)`: human title carries the usage string | human: `out.fail(usageFailure("Which tool?", "rt tools install <tool>"))`, exit 2; `--json`: unchanged | 6 |
| `tools.ts:74, 108` | `console.log(JSON.stringify(envelope(result)))` | `out.json(envelope(result))` (guard-only) | 6 |
| `tools.ts:76, 110` | under `--json`, on failure: `console.error(result.detail)`, exit 1 | `out.fail({ title: result.detail })`, exit 1 (off a terminal that is the detail alone on the first line, as today) | 6 |
| `tools.ts:81` | `rt tools install: <tool> (<via>) -- ok: <detail>` or `-- failed: <detail>` on stdout; exit 1 on failure | ok: `out.line("done", "Installed <tool>", detail)`; failed: `out.fail({ title: "<tool> was not installed", why: detail })`, exit 1 | 6 |
| `tools.ts:115` | `rt tools setup: <tool> -- ok: <detail>` or `-- failed: <detail>` | ok: `out.line("done", "Set up <tool>", detail)`; failed: `out.fail({ title: "<tool> was not set up", why: detail })`, exit 1 | 6 |
| `deps.ts:25` `fail` | `rt deps: usage: rt deps resolve <tool> [--json]` on stderr, exit 1 (also under `--json`) | `out.fail(usageFailure("Which tool?", "rt deps resolve <tool>"))` (and `link`, `unlink`), exit 1 | 7 |
| `deps.ts:59, 83, 95, 106` | `console.log(JSON.stringify(envelope(...)))` | `out.json(envelope(...))` (guard-only) | 7 |
| `deps.ts:63-67` | `<tool>:`, then four indented `key: value` lines | `out.kv("Tool", tool)`, `out.kv("Bundled", path or "not bundled")`, `out.kv("Your copy", path or "none on your PATH")`, `out.kv("Linked", "yes" or "no")`, `out.kv("Uses", path or "nothing found")` | 7 |
| `deps.ts:80` | `exitUserError(new UserActionableError(reason, detail), json, "deps link", console.log)`: every refusal is a coral failure | `--json`, and `no-bundle` (a real failure): the same call without the `console.log` argument, so the exit-2 envelope keeps `code` and `message`. `user-copy`, `occupied` and `dev-mode-owns-rt` are refusals by policy: `out.note(out.line("refused", detail), ...)` with `out.callout("next", out.cmd("rt deps link <tool> --force"))` for the two `--force` clears, then exit 2 | 7 |
| `deps.ts:86` | `rt deps: <tool> already linked at <path>` or `rt deps: linked <tool> at <path>` | `out.line("done", "<tool> is already linked", path)` or `out.line("done", "Linked <tool>", path)` | 7 |
| `deps.ts:99` | `rt deps: unlinked <tool>` or `rt deps: <tool> was not one of ours -- left untouched` | `out.line("done", "Unlinked <tool>")`, or an ownership call on stderr: `out.note(out.line("refused", "<tool> is not a link rt made", "left as it is"))`; exit 0 either way, as today | 7 |
| `deps.ts:111, 114` | `rt deps: nothing to reconcile`; `rt deps: auto-unlinked (user copy now on PATH): <names>` | `out.line("skipped", "Nothing to tidy")`; `out.line("done", "Removed links you no longer need", names)`, `out.callout("note", "Your own copy of each is on your PATH now.")` | 7 |
| `hooks.ts:40` | `import { bold, cyan, dim, green, yellow, red, reset } from "../lib/tui.ts"` | removed | 8 |
| `hooks.ts:97` | `console.warn("rt: ignoring \"rt.hooks\" -- <err>")`, once per process | `warn("hooks", "ignoring \"rt.hooks\" -- <err>", { show: { title: "Your hooks setting is being ignored", hint: first line of err, next: out.cmd("rt settings check") } })` | 8 |
| `hooks.ts:202` | `console.warn("rt: could not write \"rt.hooks\" to the settings store -- <err>")` | `warn("hooks", "could not write \"rt.hooks\" to the settings store -- <err>", { show: { title: "Your hooks choice could not be saved to your settings", hint: "it was saved for this repo only" } })` | 8 |
| `hooks.ts:293` | `warning: could not set core.hooksPath` in yellow | `out.line("warn", "Git was not pointed at rt's hook folder", "your choice will not take effect")` | 8 |
| `hooks.ts:299-319` `showStatus` | red bold `all hooks disabled` with dim rows, or green `hooks active` with a green check or a red cross per hook | `hooksStatusBlocks(config)`: `out.line("off", "All hooks are off")` and one `off` line per hook; or `out.line("done", "Hooks are on")`, `out.line("done", hook)` or `out.line("off", hook, "off")`. No coral: off is a choice | 8 |
| `hooks.ts:328` | `no husky hooks found in .husky/` in yellow, exit 1 | `out.fail({ title: "This repo has no husky hooks", why: "rt turns hooks on and off for repos that keep them in a .husky folder." })`, exit 1 | 8 |
| `hooks.ts:353-354` | red `all hooks disabled (<repo>)`, dim `applies to terminal, Cursor, GitHub Desktop -- all git clients` | `out.line("off", "All hooks are off", repoName)`, `out.callout("note", "This applies in every git app: the terminal, Cursor, GitHub Desktop.")` | 8 |
| `hooks.ts:367` | green `all hooks re-enabled (<repo>)` | `out.line("done", "All hooks are back on", repoName)` | 8 |
| `hooks.ts:386-387` | red `unknown hook: <name>`, dim `available: <names>`, exit 1, on stdout | `out.fail({ title: "This repo has no hook called <name>", why: "The hooks here are <names>." })`, exit 1 | 8 |
| `hooks.ts:395, 397` | red cross `<hook> disabled (<repo>)`; green check `<hook> enabled (<repo>)` | `out.line("off", "<hook> is off", repoName)`; `out.line("done", "<hook> is on", repoName)` | 8 |
| `hooks.ts:424-428` | green `all hooks run`; red `all hooks off`; red `off:` and the names | `selectionBlocks(off, total)`: `out.line("done", "All hooks run")`; `out.line("off", "All hooks are off")`; `out.line("off", "<n> hook(s) off", names)` | 8 |
| `intercept.ts:24` | `import { bold, cyan, dim, green, red, reset, yellow } from "../lib/tui.ts"` | removed | 9 |
| `intercept.ts:31` `usageFail` | `rt intercept: usage: rt intercept run <command> -- [args...]`, exit 1 | `out.fail(usageFailure("Which command should rt run?", "rt intercept run <command> -- [args...]"))`, exit 1 | 9 |
| `intercept.ts:214` | `warn: (msg) => console.error(msg)`: the shim's passthrough notes and its `RT_INTERCEPT_DEBUG` traces, one stderr line each | `warn: interceptNote`, which never throws: a passthrough note is `out.note(out.line("warn", msg))`; a debug trace (`match ...`, `claim result=...`) is never a warning: it goes to the CLI log at debug, and to stderr as a plain line only under `RT_LOG_LEVEL=debug` | 9 |
| `intercept.ts:238, 273, 290` | `console.log(JSON.stringify(...))` | `out.json(...)` (guard-only) | 9 |
| `intercept.ts:245-263` status | cyan header with `(daemon up)`, a dim no-rules line, one row per command with a green check, yellow `stale` or red `missing`, a yellow stale-cache notice | `statusBlocks(...)`: `out.line("running", "The rt daemon is running")` or `out.line("off", "The rt daemon is not running", "intercepted commands run as they are")`; `out.line("done", command, hint)`, `out.line("stale", ...)` or `out.line("pending", ...)`; `out.line("stale", "The saved rules are behind your settings", reason)`; one `out.callout("next", out.cmd("rt intercept install"))` when anything needs it. A shim that is not installed yet is pending, not coral | 9 |
| `intercept.ts:277-282` install | header with the rule count, `installed`, `already current`, `skipped (not ours)`, `no commands to shim` | `installBlocks(result)` | 9 |
| `intercept.ts:294-297` uninstall | header, `removed <names>` or `nothing to remove` | `uninstallBlocks(result)` | 9 |

Counts against the scoping document: `plugin.ts` 20 guard lines (19 visible, 1 import), `lib/plugins.ts` 2, `lib/plugin-api.ts` 1, `tools.ts` 6 (4 visible, 2 `--json`), `deps.ts` 14 guard and 1 seam (11 visible, 4 `--json`), `hooks.ts` 23 (22 visible, 1 import), `intercept.ts` 22 (18 visible; 3 `--json` and the import are guard-only). The dispatcher's breadcrumb (5a) is the header for `intercept status`, `install` and `uninstall`, so their own header lines go. `intercept run` gets none because it never reaches the dispatcher: `cli.ts:103-111` calls its handler directly, before the plugin tree loads, so no plugin load warning fires under it either.

Every verb named in a `next` exists in `lib/command-tree-def.ts`: `rt plugin new`, `rt plugin list`, `rt plugin validate`, `rt tools install`, `rt tools setup`, `rt deps resolve`, `rt deps link`, `rt deps unlink`, `rt intercept install`, `rt settings check`.

#### The `plugin validate --json` envelope (ruling 7)

```ts
export interface PluginValidation {
  /** The plugin's folder name. */
  name: string;
  dir: string;
  ok: boolean;
  /** One line per problem; empty when ok. */
  problems: string[];
}
// stdout, one line:
envelope({ ok: boolean, plugins: PluginValidation[] })
// which is { contract: 1, at: "<ISO time>", ok, plugins }
// an unknown name: envelope({ ok: false, plugins: [], error: 'no plugin named "<x>"' })
```

Exit codes are the human path's: 0 when every plugin is sound (or none is installed), 1 when a named plugin does not exist or any plugin has a problem. `problems` are the strings `deepValidate` returns today, unchanged.

#### Plugin load warnings (row 44 of 5a's table: one title per message)

The log message is today's text. A caller that passes its own sink (the tests do) still receives that text and nothing is shown.

| Call site (`lib/plugins.ts`) | Log message (unchanged) | Shown title | Hint | Next |
|---|---|---|---|---|
| 301, a plugin with errors | `skipping plugin "<dir>": <errors joined by "; ">` | `The <dir> plugin was not loaded` | the first error | `rt plugin validate <dir>` |
| 301, the plugins folder itself (`dirName` is `(plugins dir)`) | the same form | `Your plugins folder could not be read` | the first error | none |
| 306, name differs | `plugin "<dir>": manifest name "<name>" differs from directory name` | `The <dir> plugin calls itself <name>` | `rename the folder or the manifest's name so they match` | none |
| 314, a collision | `plugin "<name>": command "<cmd>" collides with built-in ("<conflict>") ... not mounted`, or `already provided by plugin "<other>"` | `<name>'s <cmd> command was not added` | `rt already has a command called <conflict>`, or `plugin "<other>" already has a command called <conflict>` | none |

#### `lib/deps/` copy audit

| String (`lib/deps/links.ts`) | Decision |
|---|---|
| 92 `dev-mode-owns-rt`: `<path> is mattstack-dev.app's source wrapper; opening mattstack.app hands rt back to it` | `The dev app runs rt for now: <path> is mattstack-dev.app's source wrapper. Open mattstack.app to switch back.` It keeps the substring `mattstack-dev.app's source wrapper`, which `lib/setup/__tests__/steps-a.test.ts:793` (phase 3's path step) pins; `lib/deps/__tests__/links.test.ts:217` pins `opening mattstack.app` and takes `Open mattstack.app to switch back` |
| 96 `no-bundle`: `no bundled tool named "<tool>" in the app's deps.lock` | `mattstack.app does not ship a tool called <tool>` |
| 110 `user-copy`: `<tool> is already on PATH at <elsewhere>; pass --force to shadow it with the bundled copy` | `You already have your own <tool> at <elsewhere>`; the `--force` advice becomes the `next` command in `commands/deps.ts` |
| 111 `occupied`: `<path> exists and is not a mattstack-managed link; pass --force to replace it` | `Something that rt did not put there is already at <path>`; the same `next` |

These four strings are the `error.message` of `deps link --json`'s exit-2 envelope (what the tray shows on a failed row action) and the `detail` of a `tools install` result and a setup log line. They are human-facing strings inside JSON, which the spec's 2026-10-01 ruling lets a phase reword; the keys, the `reason` codes and the exit codes do not change. `lib/deps/resolve.ts` holds no string a person reads.

#### What reads this output

| Reader | Where | Reads | Edit |
|---|---|---|---|
| The plugin skill | `skills/rt-create-plugin/SKILL.md:33, 83` | "its error strings name the exact schema problem"; "`rt plugin validate <name>` prints `ok`" | Yes, in Task 3: both lines read the `--json` envelope |
| The plugin guide | `docs/plugins.md:16, 174`, `website/docs/guides/plugins.mdx:21, 173` | prose that names the verb, not its text | No |
| The plugin guide's troubleshooting table | `docs/plugins.md:170-171`, `website/docs/guides/plugins.mdx:169-170` | quotes `skipping plugin "x": ...` as the symptom a person sees; after Task 5 that text is the log line only | Yes, in Task 5: both rows quote the shown warning |
| The tray's row actions | `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift:48, 51`, read at `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift:139` | `tools install <tool> --json` and `deps link <tool> --json`: on exit 2, `error.message` from the envelope on stdout (`RtResult.userError`); on any other non-zero exit, the first 200 bytes of stderr (`failureCopy`) | No: envelopes and codes unchanged; pinned before conversion in Task 6 Step 1; Review Focus 5 |
| `rt_verb` | `lib/mcp/rt-verb.ts:59` | `intercept status --json` | No: unchanged |
| Whatever called the shimmed tool | `commands/intercept.ts:161` | the tool's own stdout | No: Review Focus 4 |
| `e2e/tests/plugins.test.ts` | spawn | stderr contains `e2e-collide` and `e2e-broken`; `plugin list` stdout contains both plugin names; `plugin validate e2e-plugin` exits 0 | No edit needed; Task 3 adds one assertion on the envelope |
| `lib/endpoint/__tests__/intercept-run.test.ts:160-170` | spawn | the wrapped tool's stdout is exact; stderr has no escape bytes | No edit; Task 9 Step 6 runs it |

#### Tests that change, and the task that changes each

| File | Why | Task |
|---|---|---|
| `commands/__tests__/plugin.test.ts` (new) | the envelope, then the human blocks | 3, 4 |
| `e2e/tests/plugins.test.ts` | one `--json` assertion | 3 |
| `lib/__tests__/plugins.test.ts`, `lib/__tests__/plugin-api.test.ts` | the default warning path, the scaffold's bytes | 5 |
| `commands/__tests__/tools-setup.test.ts` | `console` spies that go silent | 6 |
| `commands/__tests__/deps.test.ts` | the capture and the pins of what the app reads (6), the wording (7) | 6, 7 |
| `lib/deps/__tests__/links.test.ts` | line 217 pins the `dev-mode-owns-rt` wording | 7 |
| `commands/__tests__/hooks.test.ts` | new block tests | 8 |
| `commands/__tests__/intercept-output.test.ts` (new) | the three `--json` lines pinned, then the blocks | 9 |

---

### Task 3: `rt plugin validate --json`, and the skill reads it

**Files:**
- Modify: `commands/plugin.ts` (`runValidate`)
- Modify: `lib/command-tree-def.ts:2543` (one argument added)
- Regenerate: `website/docs/reference/plugin/validate.mdx` (`bun run docs:gen`)
- Modify: `skills/rt-create-plugin/SKILL.md:33, 83`
- Create: `commands/__tests__/plugin.test.ts`
- Modify: `e2e/tests/plugins.test.ts`

**Interfaces:**
- Consumes: `discoverPlugins(): DiscoveredPlugin[]`, `deepValidate(plugin: DiscoveredPlugin): Promise<string[]>`, `DiscoveredPlugin { dirName: string; dir: string; manifest: PluginManifest | null; errors: string[] }` (`lib/plugins.ts`); `envelope<T extends object>(body: T, now?: Date): T & { contract: 1; at: string }` (`lib/setup/contract.ts`); `out.json(value: unknown, indent?: number): void` (`lib/ui/out.ts`); `captureOut` (`lib/ui/__tests__/capture-out.ts`); `restoreHome(saved: string | undefined): void` (`lib/__tests__/home-env.ts`).
- Produces, exported from `commands/plugin.ts`:
  - `interface PluginValidation { name: string; dir: string; ok: boolean; problems: string[] }`
  - `function validatePlugins(plugins: DiscoveredPlugin[]): Promise<PluginValidation[]>`
  - `runValidate` accepts `--json` anywhere in `args`; the plugin name is the first argument that does not start with `--`.

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/plugin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";
import { runValidate } from "../plugin.ts";

let home: string;
let savedHome: string | undefined;
let io: CapturedOut;
let exit: ReturnType<typeof spyOn>;

function writePlugin(dirName: string, manifest: unknown, files: Record<string, string> = {}): string {
  const dir = join(home, ".mattstack", "user", "plugins", dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const good = (name: string) => ({ name, apiVersion: 1, commands: { [name]: { description: "d", module: "./main.ts" } } });

beforeEach(() => {
  savedHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "rt-plugin-cmd-"));
  process.env.HOME = home;
  io = captureOut();
  out.__test__.setHuman(() => false);
  exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as typeof process.exit);
});

afterEach(() => {
  exit.mockRestore();
  io.restore();
  restoreHome(savedHome);
  rmSync(home, { recursive: true, force: true });
});

/** stdout is exactly one line, and that line is compact JSON. */
function envelopeLine(): Record<string, unknown> {
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  const line = text.slice(0, -1);
  expect(line).not.toContain("\n");
  const value = JSON.parse(line) as Record<string, unknown>;
  expect(JSON.stringify(value)).toBe(line);
  return value;
}

describe("rt plugin validate --json", () => {
  test("a sound plugin is ok with no problems", async () => {
    const dir = writePlugin("sound-tool", good("sound-tool"), { "main.ts": "export async function run() {}\n" });
    await runValidate(["sound-tool", "--json"], {});
    const body = envelopeLine();
    expect(Object.keys(body)).toEqual(["contract", "at", "ok", "plugins"]);
    expect(body.contract).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.plugins).toEqual([{ name: "sound-tool", dir, ok: true, problems: [] }]);
  });

  test("the flag may come first: the name is the first argument that is not a flag", async () => {
    writePlugin("sound-tool", good("sound-tool"), { "main.ts": "export async function run() {}\n" });
    await runValidate(["--json", "sound-tool"], {});
    expect((envelopeLine().plugins as Array<{ name: string }>).map((p) => p.name)).toEqual(["sound-tool"]);
  });

  test("a plugin with problems lists them, is not ok, and exits 1", async () => {
    const dir = writePlugin("holey-tool", good("holey-tool"));
    await expect(runValidate(["holey-tool", "--json"], {})).rejects.toThrow("exit 1");
    const body = envelopeLine();
    expect(body.ok).toBe(false);
    expect(body.plugins).toEqual([{ name: "holey-tool", dir, ok: false, problems: ["holey-tool: module ./main.ts not found"] }]);
    expect(io.stderr()).toBe("");
  });

  test("an unknown name is one envelope with an error, exit 1", async () => {
    await expect(runValidate(["nope", "--json"], {})).rejects.toThrow("exit 1");
    const body = envelopeLine();
    expect(body.ok).toBe(false);
    expect(body.plugins).toEqual([]);
    expect(body.error).toBe('no plugin named "nope"');
  });

  test("no plugins at all is ok with an empty list", async () => {
    await runValidate(["--json"], {});
    const body = envelopeLine();
    expect(body.ok).toBe(true);
    expect(body.plugins).toEqual([]);
  });

  test("a plugin that prints at import cannot break the envelope", async () => {
    const prints = ["log", "info", "debug", "dir", "table"].map((m) => `console.${m}("${m.toUpperCase()} at import");\n`).join("");
    writePlugin("loud-tool", good("loud-tool"), { "main.ts": `${prints}export async function run() {}\n` });
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await runValidate(["loud-tool", "--json"], {});
      expect(log).not.toHaveBeenCalled();
      expect(error.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual(["LOG at import", "INFO at import", "DEBUG at import", "DIR at import", "TABLE at import"]);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    expect(envelopeLine().ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/plugin.test.ts`
Expected: FAIL. With `--json` after the name, stdout is the old colored text and does not parse; with `--json` first, the verb reports no plugin named `--json`.

- [ ] **Step 3: Add the flag to the command tree**

In `lib/command-tree-def.ts`, in the `validate` node under `plugin` (line 2537), add one argument after the `Plugin` one (line 2543):

```ts
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the result as one JSON object" },
```

Do not set `agentSafe` on this node.

- [ ] **Step 4: Implement the `--json` path**

In `commands/plugin.ts`, add to the imports:

```ts
import * as out from "../lib/ui/out.ts";
import { envelope } from "../lib/setup/contract.ts";
```

and add `type DiscoveredPlugin` to the `../lib/plugins.ts` import. Above `runValidate`, add:

```ts
export interface PluginValidation {
  /** The plugin's folder name. */
  name: string;
  dir: string;
  ok: boolean;
  /** One line per problem; empty when ok. */
  problems: string[];
}

export async function validatePlugins(plugins: DiscoveredPlugin[]): Promise<PluginValidation[]> {
  const results: PluginValidation[] = [];
  for (const p of plugins) {
    const problems = await deepValidate(p);
    results.push({ name: p.dirName, dir: p.dir, ok: problems.length === 0, problems });
  }
  return results;
}

// Validating a plugin imports its modules, which runs their top-level code;
// any of these console methods there would land on stdout beside the
// envelope (Bun writes dir and table to stdout too).
const STDOUT_PRINTS = ["log", "info", "debug", "dir", "table"] as const;

async function withPluginPrintsOnStderr<T>(fn: () => Promise<T>): Promise<T> {
  const c = console as unknown as Record<(typeof STDOUT_PRINTS)[number] | "error", (...args: unknown[]) => void>;
  const saved = STDOUT_PRINTS.map((m) => [m, c[m]] as const);
  for (const m of STDOUT_PRINTS) c[m] = c.error;
  try {
    return await fn();
  } finally {
    for (const [m, f] of saved) c[m] = f;
  }
}
```

Replace the top of `runValidate` (its first two statements and the two early returns) and wrap the rest, leaving the human loop as it is for Task 4:

```ts
export async function runValidate(args: string[], _ctx: CommandContext): Promise<void> {
  const json = args.includes("--json");
  const only = args.find((a) => !a.startsWith("--"));
  const plugins = discoverPlugins().filter((p) => !only || p.dirName === only);
  if (only && plugins.length === 0) {
    if (json) out.json(envelope({ ok: false, plugins: [], error: `no plugin named "${only}"` }));
    else console.error(`\n  ${yellow}no plugin named "${only}"${reset}\n`);
    process.exit(1);
  }
  if (json) {
    const results = await withPluginPrintsOnStderr(() => validatePlugins(plugins));
    const ok = results.every((r) => r.ok);
    out.json(envelope({ ok, plugins: results }));
    if (!ok) process.exit(1);
    return;
  }
  if (plugins.length === 0) {
```

(the rest of the function, from the "no plugins installed" print on, is unchanged in this task).

- [ ] **Step 5: Run the tests**

Run: `bun test commands/__tests__/plugin.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/agent-safe.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate the reference page**

Run: `bun run docs:gen`
Expected: `website/docs/reference/plugin/validate.mdx` changes (its usage line gains `[--json]` and its arguments list gains the flag). Run `git status --short` and confirm that page is the only generated file that changed; if others changed, they are drift from an earlier merge: leave them out of this commit and name them in the report.

- [ ] **Step 7: Add the e2e assertion**

In `e2e/tests/plugins.test.ts`, in the test `rt plugin list and validate report health`, add after the existing `validate` assertion:

```ts
    const asJson = await rt(["plugin", "validate", "e2e-plugin", "--json"], { home });
    expect(asJson.exitCode).toBe(0);
    const body = JSON.parse(asJson.stdout);
    expect(body.ok).toBe(true);
    expect(body.plugins.map((p: { name: string }) => p.name)).toEqual(["e2e-plugin"]);
    const broken = await rt(["plugin", "validate", "e2e-broken", "--json"], { home });
    expect(broken.exitCode).toBe(1);
    expect(JSON.parse(broken.stdout).plugins[0].problems.length).toBeGreaterThan(0);
```

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/plugins.test.ts`
Expected: PASS for every test but `rt plugin new scaffolds a working, typecheckable plugin`, which the herd notes say fails on this machine with a mise shim error and is not this slice's.

- [ ] **Step 8: Edit the skill**

`skills/rt-create-plugin/SKILL.md` lives under the repo's own `skills/` folder, not under `plugins/mattstack`: it ships in the app bundle and is linked into `~/.claude/skills` by `rt skills link`. So no plugin version bump, no certification run and no `plugin-mattstack` CI job applies to it. Before editing, load the `superpowers:writing-skills` skill and the `mattstack:editing-skills` skill and follow them as the writing guide for these two lines; this is a contract update to an existing skill, not a new one, and nothing else in the file changes.

Line 33, the Validate step, becomes:

```markdown
4. **Validate**: `rt plugin validate <name> --json`. It checks structure, that files exist, that modules import, and that declared exports exist, and prints one JSON object: `ok` is `true` when the plugin is sound, and `plugins[0].problems` lists every problem, each naming the exact schema path, so iterate against that list. The exit code is 1 while any problem remains. Then typecheck: `bunx tsc --noEmit` in the plugin folder.
```

Line 83, under "Done means verified", becomes:

```markdown
- `rt plugin validate <name> --json` reports `"ok": true` with an empty `problems` list.
```

Run: `grep -n "prints \`ok\`\|error strings name" skills/rt-create-plugin/SKILL.md`
Expected: no hits.

- [ ] **Step 9: Commit**

```bash
git add commands/plugin.ts lib/command-tree-def.ts website/docs/reference/plugin/validate.mdx skills/rt-create-plugin/SKILL.md commands/__tests__/plugin.test.ts e2e/tests/plugins.test.ts
```

```bash
git commit -m "plugin validate: --json prints one result envelope, and the plugin skill reads it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `rt plugin` human output

**Files:**
- Modify: `commands/plugin.ts`
- Modify: `lib/plugins.ts` (`scaffoldPlugin`'s two throws)
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/plugin.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.line`, `out.callout`, `out.cmd`, `out.strong`, `Block` (`lib/ui/protocol.ts`); `usageFailure` (5a); `PluginValidation`, `validatePlugins` (Task 3); `renderPlain` (`lib/ui/out-plain.ts`).
- Produces:
  - `lib/plugins.ts`: `class PluginScaffoldError extends Error { constructor(code: "bad-name" | "exists", message: string); readonly code: "bad-name" | "exists" }`. `scaffoldPlugin` throws it with today's two messages.
  - `commands/plugin.ts`: `pluginListBlocks(plugins: DiscoveredPlugin[]): Block[]`, `validateBlocks(results: PluginValidation[]): Block[]`, `scaffoldedBlocks(name: string, dir: string, install: { pm: string; ok: boolean } | null): Block[]`.

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/plugin.test.ts` (add the imports `import { renderPlain } from "../../lib/ui/out-plain.ts";`, `import type { DiscoveredPlugin } from "../../lib/plugins.ts";` and `pluginListBlocks`, `runList`, `runNew`, `scaffoldedBlocks`, `validateBlocks` from `../plugin.ts`):

```ts
describe("plugin output", () => {
  const plugin = (dirName: string, over: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin => ({ dirName, dir: `/h/plugins/${dirName}`, manifest: null, errors: [], ...over });

  test("list: a loaded plugin names its commands, a broken one says why it is not loaded", () => {
    const loaded = plugin("my-tool", { manifest: { name: "my-tool", apiVersion: 1, commands: { standup: { description: "d", module: "./s.ts" }, notes: { description: "d", module: "./n.ts" } } } as DiscoveredPlugin["manifest"] });
    const broken = plugin("bad-tool", { errors: ["plugin.json is unreadable or not valid JSON (Unexpected token)"] });
    expect(renderPlain(pluginListBlocks([loaded, broken]))).toBe(
      "[ok] my-tool  2 commands: standup, notes\n[warning] bad-tool  not loaded: plugin.json is unreadable or not valid JSON (Unexpected token)\n",
    );
  });

  test("list and validate with no plugins say how to make one", () => {
    expect(renderPlain(pluginListBlocks([]))).toBe("[not yet] No plugins yet\n  next: rt plugin new\n");
  });

  test("validate: each plugin is a row, with its problems under it", () => {
    expect(
      renderPlain(
        validateBlocks([
          { name: "my-tool", dir: "/h/plugins/my-tool", ok: true, problems: [] },
          { name: "holey-tool", dir: "/h/plugins/holey-tool", ok: false, problems: ["standup: module ./s.ts not found", 'notes: ./n.ts does not export "run"'] },
        ]),
      ),
    ).toBe('[ok] my-tool\n[failed] holey-tool\n  why: standup: module ./s.ts not found\n       notes: ./n.ts does not export "run"\n');
  });

  test("a hostile problem string cannot forge a row", () => {
    const text = renderPlain(validateBlocks([{ name: "x\n[ok] forged", dir: "/h", ok: false, problems: ["bad\n[ok] also forged"] }]));
    expect(text.split("\n").some((l) => l.startsWith("[ok] "))).toBe(false);
    expect(text).toBe("[failed] x [ok] forged\n  why: bad [ok] also forged\n");
  });

  test("new: what comes after the scaffold, for each way the install can go", () => {
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", { pm: "bun", ok: true }))).toBe("  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n");
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", { pm: "bun", ok: false }))).toBe(
      "[warning] bun install did not finish  editor types will be missing until it does\n  fix: Run bun install in /h/plugins/my-tool\n  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n",
    );
    expect(renderPlain(scaffoldedBlocks("my-tool", "/h/plugins/my-tool", null))).toBe(
      "[skipped] Editor types were not installed  neither bun nor npm is on your PATH\n  fix: Install bun, then run bun install in /h/plugins/my-tool\n  next: Edit /h/plugins/my-tool/my-tool.ts, then run rt my-tool\n",
    );
  });

  test("new with no name off a terminal asks for one, exit 1", async () => {
    await expect(runNew([], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("What should the plugin be called?\n  next: rt plugin new <name>\n");
    expect(io.stdout()).toBe("");
  });

  test("new with a bad name says what a name looks like, exit 1", async () => {
    await expect(runNew(["Bad Name"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("A plugin name is lowercase words joined by dashes\n  why: Bad Name is not.\n  next: rt plugin new my-plugin\n");
  });

  test("new with a name already taken says where that plugin is, exit 1", async () => {
    const dir = writePlugin("my-tool", good("my-tool"));
    await expect(runNew(["my-tool"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe(`A plugin called my-tool already exists\n  why: It is at ${dir}.\n`);
    expect(io.stdout()).toBe("");
  });

  test("validate an unknown plugin points at the list, exit 1", async () => {
    await expect(runValidate(["nope"], {})).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("No plugin is called nope\n  next: rt plugin list\n");
  });

  test("list prints through the layer", async () => {
    await runList([], {});
    expect(io.stdout()).toBe("[not yet] No plugins yet\n  next: rt plugin new\n");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/plugin.test.ts`
Expected: FAIL, `pluginListBlocks` is not exported.

- [ ] **Step 3: Type the scaffold's two refusals**

In `lib/plugins.ts`, above `scaffoldPlugin`, add:

```ts
/** A scaffold the person can fix by choosing another name. */
export class PluginScaffoldError extends Error {
  constructor(
    readonly code: "bad-name" | "exists",
    message: string,
  ) {
    super(message);
  }
}
```

and change the first two lines of `scaffoldPlugin`'s body (the messages stay as they are; `lib/__tests__/plugins.test.ts:359-361` matches them):

```ts
  if (!KEBAB_RE.test(name)) throw new PluginScaffoldError("bad-name", `plugin name must be kebab-case (got "${name}")`);
  const dir = join(pluginsDir(), name);
  if (existsSync(dir)) throw new PluginScaffoldError("exists", `${dir} already exists`);
```

- [ ] **Step 4: Convert `commands/plugin.ts`**

Replace the imports and everything down to (not including) `export interface PluginValidation` with:

```ts
import { spawnSync } from "child_process";
import { join } from "path";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { envelope } from "../lib/setup/contract.ts";
import { scaffoldPlugin, discoverPlugins, deepValidate, pluginsDir, PluginScaffoldError, type DiscoveredPlugin } from "../lib/plugins.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export function scaffoldedBlocks(name: string, dir: string, install: { pm: string; ok: boolean } | null): Block[] {
  const blocks: Block[] = [];
  if (!install) {
    blocks.push(out.line("skipped", "Editor types were not installed", "neither bun nor npm is on your PATH"));
    blocks.push(out.callout("fix", ["Install bun, then run ", out.cmd("bun install"), " in ", out.strong(dir)]));
  } else if (!install.ok) {
    blocks.push(out.line("warn", `${install.pm} install did not finish`, "editor types will be missing until it does"));
    blocks.push(out.callout("fix", ["Run ", out.cmd(`${install.pm} install`), " in ", out.strong(dir)]));
  }
  blocks.push(out.callout("next", ["Edit ", out.strong(`${dir}/${name}.ts`), ", then run ", out.cmd(`rt ${name}`)]));
  return blocks;
}

export async function runNew(args: string[], _ctx: CommandContext): Promise<void> {
  let name = args[0];
  if (!name && process.stdin.isTTY) {
    const { textInput } = await import("../lib/rt-render.ts");
    name = await textInput({ message: "Plugin name (kebab-case)", placeholder: "my-plugin" });
  }
  if (!name) {
    out.fail(usageFailure("What should the plugin be called?", "rt plugin new <name>"));
    process.exit(1);
  }

  let dir: string;
  try {
    dir = scaffoldPlugin(name);
  } catch (err) {
    if (!(err instanceof PluginScaffoldError)) throw err;
    out.fail(
      err.code === "exists"
        ? { title: `A plugin called ${name} already exists`, why: `It is at ${join(pluginsDir(), name)}.` }
        : { title: "A plugin name is lowercase words joined by dashes", why: `${name} is not.`, next: out.cmd("rt plugin new my-plugin") },
    );
    process.exit(1);
  }
  out.print(out.line("done", `Created the ${name} plugin`, dir));

  const pm = Bun.which("bun") ? "bun" : Bun.which("npm") ? "npm" : null;
  const install = pm ? { pm, ok: spawnSync(pm, ["install"], { cwd: dir, stdio: "inherit" }).status === 0 } : null;
  out.print(...scaffoldedBlocks(name, dir, install));
}

export function pluginListBlocks(plugins: DiscoveredPlugin[]): Block[] {
  if (plugins.length === 0) return [out.line("pending", "No plugins yet"), out.callout("next", out.cmd("rt plugin new"))];
  return plugins.map((p) => {
    if (!p.manifest) return out.line("warn", p.dirName, `not loaded: ${p.errors[0]}`);
    const names = Object.keys(p.manifest.commands);
    return out.line("done", p.dirName, `${names.length} ${names.length === 1 ? "command" : "commands"}: ${names.join(", ")}`);
  });
}

export async function runList(_args: string[], _ctx: CommandContext): Promise<void> {
  out.print(...pluginListBlocks(discoverPlugins()));
}

export function validateBlocks(results: PluginValidation[]): Block[] {
  return results.flatMap((r) => (r.ok ? [out.line("done", r.name)] : [out.line("failed", r.name), out.callout("why", ...r.problems)]));
}
```

`pluginsDir` is already re-exported by `lib/plugins.ts` (line 233). `validateBlocks` refers to `PluginValidation`, which is declared below it; move `validateBlocks` under that interface if the linter objects to the order.

Then the two human branches of `runValidate` that Task 3 left raw. The unknown-name branch:

```ts
    if (json) out.json(envelope({ ok: false, plugins: [], error: `no plugin named "${only}"` }));
    else out.fail({ title: `No plugin is called ${only}`, next: out.cmd("rt plugin list") });
    process.exit(1);
```

and everything after the `if (json) { ... }` block, to the end of the function:

```ts
  if (plugins.length === 0) {
    out.print(...pluginListBlocks([]));
    return;
  }
  const results = await validatePlugins(plugins);
  out.print(...validateBlocks(results));
  if (results.some((r) => !r.ok)) process.exit(1);
}
```

Delete `countCommands`; nothing calls it now.

- [ ] **Step 5: Delete the allowlist line**

Run: `grep -n "console\.\(log\|error\|warn\|info\)\s*(\|process\.std\(out\|err\)\|tui.ts" commands/plugin.ts`
Expected: no hits.

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/plugin.ts",`.

- [ ] **Step 6: Run the suites**

Run: `bun test commands/__tests__/plugin.test.ts lib/__tests__/plugins.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/plugin.ts lib/plugins.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/plugin.test.ts
```

```bash
git commit -m "rt plugin: new, list and validate print through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Plugin load warnings, the types-refresh warning and the scaffold line

**Files:**
- Modify: `lib/plugins.ts` (lines 246 to 250, 285 to 318, 346)
- Modify: `lib/plugin-api.ts:65`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `lib/__tests__/plugins.test.ts`, `lib/__tests__/plugin-api.test.ts`
- Modify: `docs/plugins.md:170-171`, `website/docs/guides/plugins.mdx:169-170` (hand-written; neither is generated)

**Interfaces:**
- Consumes: `warn(module: string, message: string, opts?: { context?: Record<string, unknown>; show?: ShownWarning }): void`, `ShownWarning { title: string; hint?: string; next?: CellInput }`, `setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void`, `__test__.reset()` (`lib/ui/warn.ts`, 5a); `out.cmd` (`lib/ui/out.ts`); `captureOut`.
- Produces: `loadPluginTree(builtins: Record<string, CommandNode>, sink?: (msg: string) => void): Record<string, CommandNode>`. With a sink, each warning's text goes to it as today and nothing is shown; without one, each goes through `warn` with its shown copy. `cli.ts:174` calls it with no sink and needs no edit.

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/plugins.test.ts`, add the imports:

```ts
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../ui/warn.ts";
```

and, inside `describe("discovery + merge", ...)`:

```ts
  describe("with no sink, warnings go through the layer", () => {
    let io: ReturnType<typeof captureOut>;
    let logged: Array<{ module: string; message: string }>;

    beforeEach(() => {
      io = captureOut();
      out.__test__.setHuman(() => false);
      warnTest.reset();
      logged = [];
      setWarningLog((module, message) => {
        logged.push({ module, message });
      });
    });

    afterEach(() => {
      warnTest.reset();
      io.restore();
    });

    test("a load warning is shown once, on stderr, and logged", () => {
      writePlugin(home, "bad-plugin", "{ not json");
      loadPluginTree(BUILTINS);
      loadPluginTree(BUILTINS);

      expect(io.stdout()).toBe("");
      const lines = io.errLines();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toStartWith("[warning] The bad-plugin plugin was not loaded  plugin.json is unreadable or not valid JSON");
      expect(lines[1]).toBe("  next: rt plugin validate bad-plugin");
      expect(logged).toHaveLength(2);
      expect(logged[0]!.module).toBe("plugins");
      expect(logged[0]!.message).toStartWith('skipping plugin "bad-plugin": ');
    });

    test("a collision with a built-in names both sides", () => {
      writePlugin(home, "shadow", { name: "shadow", apiVersion: 1, commands: { version: { description: "d", module: "./v.ts" } } });
      loadPluginTree(BUILTINS);
      expect(io.errLines()).toEqual(["[warning] shadow's version command was not added  rt already has a command called version"]);
    });

    test("a collision between two plugins names the one that got there first", () => {
      writePlugin(home, "a-plugin", { name: "a-plugin", apiVersion: 1, commands: { standup: { description: "d", module: "./s.ts" } } });
      writePlugin(home, "b-plugin", { name: "b-plugin", apiVersion: 1, commands: { standup: { description: "d", module: "./s.ts" } } });
      loadPluginTree(BUILTINS);
      expect(io.errLines()).toEqual(['[warning] b-plugin\'s standup command was not added  plugin "a-plugin" already has a command called standup']);
    });

    test("a folder and a manifest that disagree on the name say how to fix it", () => {
      writePlugin(home, "folder-name", { name: "other-name", apiVersion: 1, commands: { thing: { description: "d", module: "./t.ts" } } });
      loadPluginTree(BUILTINS);
      expect(io.errLines()).toEqual(["[warning] The folder-name plugin calls itself other-name  rename the folder or the manifest's name so they match"]);
    });
  });
```

and, inside `describe("scaffoldPlugin", ...)`:

```ts
  test("the scaffolded command still prints with console.log, byte for byte", () => {
    const dir = scaffoldPlugin("my-tool");
    expect(readFileSync(join(dir, "my-tool.ts"), "utf8")).toContain("  console.log(`hello from my-tool (run #${count}, args: ${JSON.stringify(args)})`);\n");
  });
```

In `lib/__tests__/plugin-api.test.ts`, add (with the imports `import { writeFileSync } from "fs";` if missing, `import { captureOut } from "../ui/__tests__/capture-out.ts";`, `import { __test__ as warnTest } from "../ui/warn.ts";` and `ensurePluginApiDir` from `../plugin-api.ts`):

```ts
test("a types refresh that fails is one log line and never throws", () => {
  const saved = process.env.HOME;
  const blocker = join(mkdtempSync(join(tmpdir(), "rt-plugin-api-fail-")), "not-a-folder");
  writeFileSync(blocker, "x");
  process.env.HOME = blocker;
  const io = captureOut();
  warnTest.reset();
  try {
    expect(() => ensurePluginApiDir()).not.toThrow();
    expect(io.stderr()).toStartWith("rt: could not refresh plugin-api types: ");
    expect(io.stderr().trimEnd().split("\n")).toHaveLength(1);
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
    process.env.HOME = saved;
  }
});
```

With no warning log set, `warn` writes the plain `rt: <message>` line to stderr (5a's contract for the daemon and for unit tests); the CLI logs it and shows nothing, because this row passes no `show`. Use the file's own way of restoring `HOME` if it has one (`restoreHome` from `./home-env.ts`).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/plugins.test.ts lib/__tests__/plugin-api.test.ts`
Expected: FAIL. The four layer tests see nothing on the captured stderr (the default sink uses `console.error`); the plugin-api test sees an empty stderr for the same reason. The scaffold test passes already: it pins bytes that must not change.

- [ ] **Step 3: Convert the load warnings**

In `lib/plugins.ts`, add to the imports:

```ts
import * as ui from "./ui/out.ts";
import { warn, type ShownWarning } from "./ui/warn.ts";
```

(the file has locals named `out`, so the layer is `ui` here). Above `discoverPlugins`, add:

```ts
/** The entry discoverPlugins returns when the plugins folder itself cannot be read. */
const PLUGINS_DIR_ENTRY = "(plugins dir)";
```

and use it in `discoverPlugins` in place of the literal `"(plugins dir)"` (line 247).

Replace `loadPluginTree`'s signature, its comment's last sentence, and the three `warn(...)` calls:

```ts
/**
 * Merge plugin commands into the built-in tree. Built-ins always win;
 * plugin-vs-plugin, first by directory sort order wins. Collisions check
 * names AND aliases. Losing commands are not mounted; every skip warns
 * with provenance. A clean setup produces zero output. A caller's sink
 * gets each warning's text; without one a person reads it once, on stderr.
 */
export function loadPluginTree(builtins: Record<string, CommandNode>, sink?: (msg: string) => void): Record<string, CommandNode> {
  const report = (message: string, show: ShownWarning): void => {
    if (sink) sink(message);
    else warn("plugins", message, { show });
  };
```

```ts
    if (plugin.errors.length) {
      report(
        `skipping plugin "${plugin.dirName}": ${plugin.errors.join("; ")}`,
        plugin.dirName === PLUGINS_DIR_ENTRY
          ? { title: "Your plugins folder could not be read", hint: plugin.errors[0] }
          : { title: `The ${plugin.dirName} plugin was not loaded`, hint: plugin.errors[0], next: ui.cmd(`rt plugin validate ${plugin.dirName}`) },
      );
      continue;
    }
    const manifest = plugin.manifest!;
    if (manifest.name !== plugin.dirName) {
      report(`plugin "${plugin.dirName}": manifest name "${manifest.name}" differs from directory name`, {
        title: `The ${plugin.dirName} plugin calls itself ${manifest.name}`,
        hint: "rename the folder or the manifest's name so they match",
      });
    }
```

```ts
      if (conflict) {
        const owner = claimed.get(conflict)!;
        const what = owner === "built-in" ? "collides with built-in" : `already provided by ${owner}`;
        report(`plugin "${manifest.name}": command "${name}" ${what} ("${conflict}") ... not mounted`, {
          title: `${manifest.name}'s ${name} command was not added`,
          hint: owner === "built-in" ? `rt already has a command called ${conflict}` : `${owner} already has a command called ${conflict}`,
        });
        continue;
      }
```

The existing tests pass their own sink and keep receiving the same strings (`skipping plugin "bad-plugin"`, `collides with built-in`, `differs from directory name`), so they need no edit.

- [ ] **Step 4: Spell the scaffold's print so the guard does not read it**

In `lib/plugins.ts`, above `scaffoldPlugin`, add:

```ts
// The scaffolded command prints with console.log. This file is read as text
// by the raw-output guard, which would take the template for a print site,
// so the call is spelled in two parts.
const SCAFFOLD_PRINT = ["console", "log"].join(".");
```

and in the template (line 346) replace the leading `  console.log(` of that one line with `  ${SCAFFOLD_PRINT}(`. Nothing else on the line changes; the test from Step 1 pins the written bytes.

- [ ] **Step 5: Convert `lib/plugin-api.ts`**

Add `import { warn } from "./ui/warn.ts";` and replace line 65:

```ts
    warn("plugins", `could not refresh plugin-api types: ${err instanceof Error ? err.message : String(err)}`);
```

- [ ] **Step 6: The plugin guide quotes what a person now sees**

Both troubleshooting tables quote the old warning as the symptom; after Step 3 that text is the log line only. In `docs/plugins.md`, lines 170 and 171 become:

```markdown
| `The x plugin was not loaded  plugin.json is unreadable or not valid JSON` | broken manifest; fix the JSON, rt is unaffected meanwhile |
| `The x plugin was not loaded  <node>: unknown field "modle"` | manifest typo; unknown fields are rejected by design |
```

In `website/docs/guides/plugins.mdx`, lines 169 and 170 become the same two rows. Nothing else in either file changes.

Run: `grep -rn "skipping plugin" docs/plugins.md website/docs/guides`
Expected: no hits.

- [ ] **Step 7: Delete the two allowlist lines and run**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "lib/plugin-api.ts",` and `  "lib/plugins.ts",`.

Run: `bun test lib/__tests__/plugins.test.ts lib/__tests__/plugin-api.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts lib/__tests__/command-tree.test.ts`
Expected: PASS. If `no-eager-tui` or `no-daemon-sync-exec` names `lib/plugins.ts` or `lib/plugin-api.ts`, stop and report it; do not edit a guard.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/plugins.test.ts`
Expected: the tests `collision: built-in git wins, warning names the plugin` (stderr holds `e2e-collide's git command was not added`) and `malformed plugin is skipped loudly and rt keeps working` (stderr holds `The e2e-broken plugin was not loaded`) pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add lib/plugins.ts lib/plugin-api.ts lib/__tests__/raw-output-allowlist.json lib/__tests__/plugins.test.ts lib/__tests__/plugin-api.test.ts docs/plugins.md website/docs/guides/plugins.mdx
```

```bash
git commit -m "plugins: load warnings go through warn with one plain title each

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Pin what the app reads, then `rt tools`

**Files:**
- Modify: `commands/__tests__/deps.test.ts` (the capture helper and the pins; Steps 1 to 3)
- Modify: `commands/tools.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/tools-setup.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.json`, `out.line`; `usageFailure` (5a); `exitUserError(err: UserActionableError, json: boolean, verb: string, print?: (s: string) => void): never`, `UserActionableError` (`lib/errors.ts`); `InstallResult { via: InstallVia; ok: boolean; detail: string }`, `SetupResult { ok: boolean; detail: string }` (`lib/setup/tools-install.ts`, read only); `LinkOutcome` (`lib/deps/links.ts`); `captureOut(opts?: { console?: boolean })` (phase 4); `toolsInstall`, `depsLink`, `depsUnlink`.
- Produces: no new export.

- [ ] **Step 1: Pin the `--json` replies the tray reads, before any edit**

The tray's row actions run `tools install <tool> --json` and `deps link <tool> --json` (Review Focus 5). Both go through `link()` for a bundled tool, so the pins live in `commands/__tests__/deps.test.ts`, whose fixture already ships a bundled `gh`.

First, replace `runCapturingExit` (lines 30 to 56) so one capture reads console calls and stream writes alike, the same before and after the conversion:

```ts
async function runCapturingExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[]; stderr: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  const read = () => ({ logs: io.lines(), errors: io.errLines(), stderr: io.stderr() });
  try {
    await fn();
    return { exitCode: undefined, ...read() };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, ...read() };
  } finally {
    io.restore();
    exitSpy.mockRestore();
  }
}
```

Its doc comment becomes `/** Mocks process.exit to throw a sentinel so the real test process never dies, and reads console calls and stream writes through one capture. */`. Then add `import { toolsInstall } from "../tools.ts";` and, inside `describe("rt deps commands", ...)` after the last test:

```ts
  describe("what the app reads, pinned before the conversion", () => {
    test("deps link --json, linked: the envelope's keys, exit 0", async () => {
      const { exitCode, logs, stderr } = await runCapturingExit(() => depsLink(["gh", "--json"], {}, bundleProbe()));
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "ok", "path", "state"]);
      expect(body).toMatchObject({ contract: 1, ok: true, path: linkPath(home, "gh"), state: "linked" });
      expect(stderr).toBe("");
    });

    test("deps unlink --json: removed, then a file rt did not make, exit 0 both times", async () => {
      const p = bundleProbe();
      await runCapturingExit(() => depsLink(["gh"], {}, p));
      const removed = await runCapturingExit(() => depsUnlink(["gh", "--json"], {}, p));
      expect(removed.exitCode).toBeUndefined();
      const body = JSON.parse(removed.logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "removed"]);
      expect(body.removed).toBe(true);

      p.writeFile(linkPath(home, "deck"), "#!/bin/sh\necho not ours\n");
      const untouched = await runCapturingExit(() => depsUnlink(["deck", "--json"], {}, p));
      expect(untouched.exitCode).toBeUndefined();
      expect(untouched.logs).toHaveLength(1);
      expect(JSON.parse(untouched.logs[0]!).removed).toBe(false);
      expect(untouched.stderr).toBe("");
    });

    test("tools install of a bundled tool --json, linked: the envelope's keys, exit 0", async () => {
      const { exitCode, logs, stderr } = await runCapturingExit(() => toolsInstall(["gh", "--json"], {}, bundleProbe()));
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "via", "ok", "detail"]);
      expect(body).toMatchObject({ contract: 1, via: "bundled-link", ok: true, detail: `linked at ${linkPath(home, "gh")}` });
      expect(stderr).toBe("");
    });

    test("tools install of a bundled tool --json, refused: the envelope, the detail alone on stderr, exit 1", async () => {
      const path = linkPath(home, "gh");
      const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
      const { exitCode, logs, stderr } = await runCapturingExit(() => toolsInstall(["gh", "--json"], {}, p));
      expect(exitCode).toBe(1);
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "via", "ok", "detail"]);
      expect(body).toMatchObject({ contract: 1, via: "bundled-link", ok: false });
      expect(body.detail).toContain(path);
      expect(stderr).toBe(`${body.detail}\n`);
    });
  });
```

The refused detail is pinned by its path only: Task 7 rewords that sentence (Task 2's `lib/deps/` table), and the shape, the exit code and "the detail alone on stderr" are what the tray reads. The `deps link --json` refusal envelope is pinned by the existing test `depsLink --json also exits 2 on refusal`, which Task 7 tightens.

- [ ] **Step 2: Run them to verify they pass before any conversion**

Run: `bun test commands/__tests__/deps.test.ts`
Expected: PASS, every test, old and new. A failing pin means the shape is not what this step says: stop and report the real shape rather than editing the pin to match.

- [ ] **Step 3: Commit the pins**

```bash
git add commands/__tests__/deps.test.ts
```

```bash
git commit -m "deps tests: pin the --json replies the app reads from tools install, deps link and deps unlink

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing tests**

In `commands/__tests__/tools-setup.test.ts`, add the imports:

```ts
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { toolsInstall } from "../tools.ts";
```

In both `describe` blocks, replace the `console` spies with the capture: declare `let io: CapturedOut;`, set `io = captureOut(); out.__test__.setHuman(() => false);` in `beforeEach` where `log = spyOn(console, "log")...` (and `err = ...`) were, call `io.restore();` in `afterEach` where their `mockRestore()` calls were, and delete the `log` and `err` declarations. Keep the `exit` spy.

In the `--json failure` test, replace its last assertion with:

```ts
    expect(io.stderr().split("\n")[0]).toContain(refusal);
    expect(io.stderr()).not.toContain("[failed]");
    expect(io.stderr().startsWith("\n")).toBe(false);
    expect(JSON.parse(io.stdout()).ok).toBe(false);
```

and rename it `a failed setup under --json leads stderr with the reason`. Then add a third `describe`:

```ts
describe("rt tools, read by a person", () => {
  let home: string;
  let io: CapturedOut;
  let exit: ReturnType<typeof spyOn>;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-human-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
    exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
  });
  afterEach(() => {
    exit.mockRestore();
    io.restore();
    rmSync(home, { recursive: true, force: true });
  });

  test("no tool named, off a terminal: a plain question and the command, exit 2", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" } });
    await expect(toolsInstall([], {}, p)).rejects.toThrow("exit 2");
    expect(io.stderr()).toBe("Which tool?\n  next: rt tools install <tool>\n");
    expect(io.stdout()).toBe("");
    await expect(toolsSetup([], {}, p)).rejects.toThrow("exit 2");
    expect(io.stderr()).toContain("Which tool?\n  next: rt tools setup <tool>\n");
  });

  test("the --json usage error is the envelope it always was", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" } });
    await expect(toolsInstall(["--json"], {}, p)).rejects.toThrow("exit 2");
    const body = JSON.parse(io.stdout());
    expect(body.error).toEqual({ code: "usage", message: "usage: rt tools install <tool> [--json]" });
    expect(io.stderr()).toBe("");
  });

  test("a setup that worked is one done line", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ok("") });
    await toolsSetup(["fast-browser"], {}, p);
    expect(io.stdout()).toStartWith("[ok] Set up fast-browser  ");
    expect(io.stderr()).toBe("");
  });

  test("a setup that failed is a failure on stderr, exit 1", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ({ code: 1, stdout: "", stderr: "fast-browser: no host found\nmore" }) });
    await expect(toolsSetup(["fast-browser"], {}, p)).rejects.toThrow("exit 1");
    expect(io.stderr()).toStartWith("fast-browser was not set up\n  why: ");
    expect(io.stderr()).toContain("no host found");
    expect(io.stdout()).toBe("");
  });
});
```

`spyOn` stays in the `bun:test` import for the `exit` spies.

- [ ] **Step 5: Run them to verify they fail**

Run: `bun test commands/__tests__/tools-setup.test.ts`
Expected: FAIL. The usage failure's first line is `usage: rt tools install <tool> [--json]`; the result lines never reach the captured stream.

- [ ] **Step 6: Convert `commands/tools.ts`**

Add:

```ts
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

In `toolsInstall`, replace the `else` branch of the missing-tool check:

```ts
    } else if (json) {
      exitUserError(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"), json, "tools install");
    } else {
      out.fail(usageFailure("Which tool?", "rt tools install <tool>"));
      process.exit(2);
    }
```

and its tail, from `if (json) {` to the end of the function:

```ts
  if (json) {
    out.json(envelope(result));
    if (!result.ok) {
      out.fail({ title: result.detail });
      process.exit(1);
    }
    return;
  }
  if (!result.ok) {
    out.fail({ title: `${t} was not installed`, why: result.detail });
    process.exit(1);
  }
  out.print(out.line("done", `Installed ${t}`, result.detail));
}
```

In `toolsSetup`, the same two edits with its own words:

```ts
    } else if (json) {
      exitUserError(new UserActionableError("usage", "usage: rt tools setup <tool> [--config-dir <dir>]… [--json]"), json, "tools setup");
    } else {
      out.fail(usageFailure("Which tool?", "rt tools setup <tool>"));
      process.exit(2);
    }
```

```ts
  if (json) {
    out.json(envelope(result));
    if (!result.ok) {
      out.fail({ title: result.detail });
      process.exit(1);
    }
    return;
  }
  if (!result.ok) {
    out.fail({ title: `${t} was not set up`, why: result.detail });
    process.exit(1);
  }
  out.print(out.line("done", `Set up ${t}`, result.detail));
}
```

Keep the `--json` usage string in `toolsSetup` exactly as the file has it today (copy it from the line being replaced; it is the envelope's `error.message`). Also reword the two long dashes in this file's header comment and in the `resolveTeamReqs` comment when touching them is unavoidable; otherwise leave comments alone.

Under `--json` the failure prints off a terminal, so it is the detail alone on the first line: what the tray shows.

- [ ] **Step 7: Delete the allowlist line and run**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/tools.ts",`.

Run: `bun test commands/__tests__/tools-setup.test.ts commands/__tests__/deps.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/errors.test.ts`
Expected: PASS, the four pins from Step 1 included, unedited.

- [ ] **Step 8: Commit**

```bash
git add commands/tools.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/tools-setup.test.ts
```

```bash
git commit -m "rt tools: result lines and failures go through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `rt deps`, and the four refusals in plain words

**Files:**
- Modify: `commands/deps.ts`
- Modify: `lib/deps/links.ts:92, 96, 110, 111`
- Modify: `lib/deps/__tests__/links.test.ts:217`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/deps.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.note`, `out.fail`, `out.json`, `out.line`, `out.kv`, `out.callout`, `out.cmd`, `Block`; `usageFailure` (5a); `exitUserError`, `UserActionableError(code, message, extra?, options?: { why?, next?, log? })` (`lib/errors.ts`); `ToolResolution { tool: string; bundled: string | null; exec: string[] | null; userCopy: string | null; linked: boolean; chosen: string | null }` (`lib/deps/resolve.ts`); `LinkOutcome` (`lib/deps/links.ts`).
- Produces, exported from `commands/deps.ts`: `resolveBlocks(r: ToolResolution): Block[]`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/deps.test.ts` (whose `runCapturingExit` already reads through `captureOut({ console: true })`, Task 6 Step 1), the pinned wording:

- `depsLink links a bundled tool and prints a success line`: `expect(logs).toEqual([`[ok] Linked gh  ${linkPath(home, "gh")}`]);`
- `depsLink exits 2 on a user-actionable refusal in human mode (F13: occupied)`: after 5a's Task 2 it carries three `stderr` assertions (`not.toContain("[failed]")`, a non-empty first line, and `toContain("exists and is not a mattstack-managed link")`). Replace all of them with

```ts
    expect(stderr).toBe(`[refused] Something that rt did not put there is already at ${path}\n  next: rt deps link gh --force\n`);
```

  keep `expect(exitCode).toBe(2)` and `expect(logs).toEqual([])`, and rename the test `a refusal by policy is refused, not a failure, with --force as the next step, exit 2`.
- `depsLink --json also exits 2 on refusal`: `expect(body.error.message).toBe(`Something that rt did not put there is already at ${path}`);` and add `expect(Object.keys(body.error)).toEqual(["code", "message"]);`. This is the pin of what the tray shows (Review Focus 5).
- `depsLink --force overrides the occupied refusal`: `expect(logs.join("\n")).toContain("[ok] Linked gh");`
- `depsUnlink ...`: `"unlinked gh"` becomes `"[ok] Unlinked gh"`; the second half becomes

```ts
    expect(untouched.exitCode).toBeUndefined();
    expect(untouched.logs).toEqual([]);
    expect(untouched.stderr).toBe("[refused] deck is not a link rt made  left as it is\n");
```

- `depsReconcile ...`: `"nothing to reconcile"` becomes `"[skipped] Nothing to tidy"`.

and add:

```ts
  test("a tool the app does not ship is a failure, not a refusal, exit 2", async () => {
    const { exitCode, stderr, logs } = await runCapturingExit(() => depsLink(["nope-tool"], {}, bundleProbe()));
    expect(exitCode).toBe(2);
    expect(stderr).toBe("mattstack.app does not ship a tool called nope-tool\n");
    expect(logs).toEqual([]);
  });

  test("resolve prints each fact on its own line", async () => {
    const { logs } = await runCapturingExit(() => depsResolve(["gh"], {}, bundleProbe()));
    expect(logs).toEqual(["Tool: gh", `Bundled: ${ghPath}`, "Your copy: none on your PATH", "Linked: no", `Uses: ${ghPath}`]);
  });

  test("no tool named, off a terminal: a plain question and the command, exit 1", async () => {
    const { exitCode, stderr, logs } = await runCapturingExit(() => depsLink([], {}, bundleProbe()));
    expect(exitCode).toBe(1);
    expect(stderr).toBe("Which tool?\n  next: rt deps link <tool>\n");
    expect(logs).toEqual([]);
  });

  test("a reconcile that removed links says what and why", async () => {
    const p = bundleProbe();
    await runCapturingExit(() => depsLink(["gh"], {}, p));
    p.env.PATH = "/opt/homebrew/bin";
    p.writeFile("/opt/homebrew/bin/gh", "real-gh-binary");
    const { logs } = await runCapturingExit(() => depsReconcile([], {}, p));
    expect(logs).toEqual(["[ok] Removed links you no longer need  gh", "  note: Your own copy of each is on your PATH now."]);
  });
```

The existing test `depsResolve (human) prints the resolution without crashing on an unbundled tool` keeps its assertion (`not bundled` is still in the output).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/deps.test.ts`
Expected: FAIL on every reworded line (`rt deps: linked gh at ...` is what prints today).

- [ ] **Step 3: Reword the four refusals in `lib/deps/links.ts`**

Line 92 (it keeps `mattstack-dev.app's source wrapper`, which phase 3's `lib/setup/__tests__/steps-a.test.ts:793` pins):

```ts
    return { ok: false, reason: "dev-mode-owns-rt", detail: `The dev app runs rt for now: ${path} is mattstack-dev.app's source wrapper. Open mattstack.app to switch back.` };
```

In `lib/deps/__tests__/links.test.ts:217`, `expect.stringContaining("opening mattstack.app")` becomes `expect.stringContaining("Open mattstack.app to switch back")`.

Line 96:

```ts
  if (!exec) return { ok: false, reason: "no-bundle", detail: `mattstack.app does not ship a tool called ${tool}` };
```

Lines 110 and 111:

```ts
    if (elsewhere && elsewhere !== path) return { ok: false, reason: "user-copy", detail: `You already have your own ${tool} at ${elsewhere}` };
    if (present) return { ok: false, reason: "occupied", detail: `Something that rt did not put there is already at ${path}` };
```

Run: `grep -rn "no bundled tool named\|already on PATH at\|not a mattstack-managed link\|hands rt back" lib commands e2e rt-tray --include='*.ts' --include='*.swift'`
Expected: no hits (Step 1 already changed the two in `commands/__tests__/deps.test.ts`). A hit in a `lib/setup` test (phase 3 may have pinned one of these as a setup row's detail) takes the new wording. The pattern leaves out `pass --force` on purpose: that phrase is also in `commands/home.ts`, `commands/settings-keys.ts`, `commands/state.ts` and `lib/state/backup-restore.ts`, which belong to other slices and phases and are not edited here.

- [ ] **Step 4: Convert `commands/deps.ts`**

Add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

and `type ToolResolution` to the `../lib/deps/resolve.ts` import. Delete `fail`. In `requireTool`, the last line becomes:

```ts
  out.fail(usageFailure("Which tool?", usage));
  process.exit(1);
```

and its three callers pass the bare command: `"rt deps resolve <tool>"`, `"rt deps link <tool>"`, `"rt deps unlink <tool>"`. Update `requireTool`'s comment: "the existing `fail`" becomes "a usage failure".

`depsResolve`'s tail:

```ts
export function resolveBlocks(r: ToolResolution): Block[] {
  return [
    out.kv("Tool", r.tool),
    out.kv("Bundled", r.bundled ?? "not bundled"),
    out.kv("Your copy", r.userCopy ?? "none on your PATH"),
    out.kv("Linked", r.linked ? "yes" : "no"),
    out.kv("Uses", r.chosen ?? "nothing found"),
  ];
}
```

```ts
  if (args.includes("--json")) {
    out.json(envelope(resolution));
    return;
  }
  out.print(...resolveBlocks(resolution));
```

`depsLink`, from the refusal to the end. The comment above the refusal is replaced by the one below:

```ts
  // Every refusal exits 2. Under --json that is the contract's {error}
  // envelope, the shape `rt tools install` uses, so an app decoding a row
  // action reads one path. Only no-bundle is a failure; the others are rt
  // declining by policy, which is never coral.
  if (!outcome.ok) {
    if (json || outcome.reason === "no-bundle") return exitUserError(new UserActionableError(outcome.reason, outcome.detail), json, "deps link");
    const forceClears = outcome.reason === "user-copy" || outcome.reason === "occupied";
    out.note(out.line("refused", outcome.detail), ...(forceClears ? [out.callout("next", out.cmd(`rt deps link ${t} --force`))] : []));
    process.exit(2);
  }

  if (json) {
    out.json(envelope(outcome));
    return;
  }
  out.print(out.line("done", outcome.state === "already" ? `${t} is already linked` : `Linked ${t}`, outcome.path));
```

The `--json` refusal keeps exactly `code` and `message` in its envelope (ruling 4), and its exit code stays 2.

`depsUnlink`'s tail (a file rt did not make is an ownership call: refused, on stderr, exit 0 as today):

```ts
  if (args.includes("--json")) {
    out.json(envelope(outcome));
    return;
  }
  if (!outcome.removed) {
    out.note(out.line("refused", `${t} is not a link rt made`, "left as it is"));
    return;
  }
  out.print(out.line("done", `Unlinked ${t}`));
```

`depsReconcile`'s tail:

```ts
  if (args.includes("--json")) {
    out.json(envelope(outcome));
    return;
  }
  if (outcome.removed.length === 0) {
    out.print(out.line("skipped", "Nothing to tidy"));
    return;
  }
  out.print(out.line("done", "Removed links you no longer need", outcome.removed.join(", ")), out.callout("note", "Your own copy of each is on your PATH now."));
```

- [ ] **Step 5: Delete the allowlist line and run**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/deps.ts",`.

Run: `bun test commands/__tests__/deps.test.ts lib/deps/__tests__ lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun test lib/setup/__tests__/steps-a.test.ts`
Expected: PASS (it pins `mattstack-dev.app's source wrapper`, which the reworded `dev-mode-owns-rt` string keeps).

- [ ] **Step 6: Commit**

```bash
git add commands/deps.ts lib/deps/links.ts lib/deps/__tests__/links.test.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/deps.test.ts
```

```bash
git commit -m "rt deps: results and refusals go through the layer, in plain words

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `rt hooks`

**Files:**
- Modify: `commands/hooks.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/hooks.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.line`, `out.callout`, `out.cmd`, `Block`; `warn`, `setWarningLog`, `__test__.reset()` (`lib/ui/warn.ts`, 5a); `HooksConfig { enabled: boolean; hooks: Record<string, boolean> }` (same file).
- Produces, exported from `commands/hooks.ts`: `hooksStatusBlocks(config: HooksConfig): Block[]`, `selectionBlocks(off: string[], total: number): Block[]`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/hooks.test.ts`, add `hooksStatusBlocks` and `selectionBlocks` to the `../hooks.ts` import, and the imports:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";
import * as settingsResolve from "../../lib/settings/resolve.ts";
```

(`getSetting` is already imported by name from that module; keep that import and add the namespace one for the spy.) Inside `describe("commands/hooks", ...)`, add:

```ts
  describe("what a person reads", () => {
    test("hooks that are on: a done line each, and off is never coral", () => {
      expect(renderPlain(hooksStatusBlocks({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } }))).toBe("[ok] Hooks are on\n[ok] pre-commit\n[off] pre-push  off\n");
    });

    test("everything off: every row is off, with what it would be otherwise", () => {
      const text = renderPlain(hooksStatusBlocks({ enabled: false, hooks: { "pre-commit": true, "pre-push": false } }));
      expect(text).toBe("[off] All hooks are off\n[off] pre-commit  on, but everything is off\n[off] pre-push  off\n");
      expect(text).not.toContain("[failed]");
    });

    test("the line after the checklist", () => {
      expect(renderPlain(selectionBlocks([], 2))).toBe("[ok] All hooks run\n");
      expect(renderPlain(selectionBlocks(["pre-commit", "pre-push"], 2))).toBe("[off] All hooks are off\n");
      expect(renderPlain(selectionBlocks(["pre-push"], 2))).toBe("[off] 1 hook off  pre-push\n");
    });

    describe("through toggleHooks", () => {
      let io: ReturnType<typeof captureOut>;
      let exit: ReturnType<typeof spyOn>;
      const ctx = (): CommandContext => ({ identity: { repoName: "repo", identity: "path:%2Frepo", repoRoot, dataDir, remoteUrl: "", baseUrl: "" } });

      beforeEach(() => {
        // toggleHooks points git at rt's hook folder; outside a git repo that
        // fails and prints its own warning line.
        execFileSync("git", ["init", "-q", repoRoot]);
        io = captureOut();
        out.__test__.setHuman(() => false);
        exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
          throw new Error(`exit ${code}`);
        }) as typeof process.exit);
      });
      afterEach(() => {
        exit.mockRestore();
        io.restore();
      });

      test("outside a git repo, the hook folder warning is a warn line, not a failure", async () => {
        rmSync(join(repoRoot, ".git"), { recursive: true, force: true });
        await toggleHooks(["status"], ctx());
        expect(io.lines()[0]).toBe("[warning] Git was not pointed at rt's hook folder  your choice will not take effect");
        expect(io.stderr()).toBe("");
      });

      test("off says so, in plain words, on stdout", async () => {
        await toggleHooks(["off"], ctx());
        expect(io.stdout()).toBe("[off] All hooks are off  repo\n  note: This applies in every git app: the terminal, Cursor, GitHub Desktop.\n");
        expect(io.stderr()).toBe("");
      });

      test("one hook off, then on", async () => {
        await toggleHooks(["pre-push", "off"], ctx());
        await toggleHooks(["pre-push", "on"], ctx());
        expect(io.lines()).toEqual(["[off] pre-push is off  repo", "[ok] pre-push is on  repo"]);
      });

      test("a hook this repo does not have is a failure that lists the ones it has, exit 1", async () => {
        await expect(toggleHooks(["pre-rebase", "off"], ctx())).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("This repo has no hook called pre-rebase\n  why: The hooks here are pre-commit, pre-push.\n");
        expect(io.stdout()).toBe("");
      });

      test("a repo with no husky hooks is a failure, exit 1", async () => {
        rmSync(join(repoRoot, ".husky"), { recursive: true, force: true });
        await expect(toggleHooks(["status"], ctx())).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("This repo has no husky hooks\n  why: rt turns hooks on and off for repos that keep them in a .husky folder.\n");
      });
    });

    test("a hooks setting rt cannot read is shown once and logged", () => {
      const io = captureOut();
      out.__test__.setHuman(() => false);
      warnTest.reset();
      const logged: string[] = [];
      setWarningLog((_module, message) => {
        logged.push(message);
      });
      const probe = spyOn(settingsResolve, "getSetting").mockImplementation(() => {
        throw new Error("rt.hooks: expected an object\n  at $.hooks");
      });
      try {
        loadHooksConfig(dataDir, ["pre-commit"], IDENTITY);
        loadHooksConfig(dataDir, ["pre-commit"], IDENTITY);
        expect(io.stderr()).toBe("[warning] Your hooks setting is being ignored  rt.hooks: expected an object\n  next: rt settings check\n");
        expect(io.stdout()).toBe("");
        expect(logged).toHaveLength(2);
        expect(logged[0]).toStartWith('ignoring "rt.hooks" -- rt.hooks: expected an object');
      } finally {
        probe.mockRestore();
        warnTest.reset();
        io.restore();
      }
    });
  });
```

Add `spyOn` to the file's `bun:test` import (it imports `mock` today, not `spyOn`) and `import { execFileSync } from "child_process";`. `toggleHooks` nudges the daemon in the background (`hooks:watch`); with no daemon in the test home that resolves to nothing, as it does for the existing `toggleHooks` tests in this file.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/hooks.test.ts`
Expected: FAIL, `hooksStatusBlocks` is not exported.

- [ ] **Step 3: Convert `commands/hooks.ts`**

Replace the color import (line 40) with:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { warn } from "../lib/ui/warn.ts";
```

`probeHooksStore`: `warn` shows a given title once per process, so the module's own latch goes. Delete `let warnedHooksStoreProbe = false;`, and replace the function's comment and body:

```ts
/**
 * Ownership-latch probe: `undefined` means the store does not own `rt.hooks`
 * for this repo, so the caller falls back to the legacy file. A probe failure
 * (thrown by getSetting) counts as unowned too, with a warning that never
 * echoes the store's value.
 */
function probeHooksStore(repoIdentity: string | null): Value<"rt.hooks"> | undefined {
  if (!repoIdentity) return undefined;
  try {
    return getSetting<Value<"rt.hooks">>(SETTING_KEY, { repoIdentity }).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("hooks", `ignoring "${SETTING_KEY}" -- ${message}`, {
      show: { title: "Your hooks setting is being ignored", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return undefined;
  }
}
```

In `saveHooksConfig`, replace the `console.warn` in the catch:

```ts
      warn("hooks", `could not write "${SETTING_KEY}" to the settings store -- ${(err as Error).message}`, {
        show: { title: "Your hooks choice could not be saved to your settings", hint: "it was saved for this repo only" },
      });
```

In `setHooksPath`, replace the catch body (keep its comment):

```ts
    out.print(out.line("warn", "Git was not pointed at rt's hook folder", "your choice will not take effect"));
```

Replace `showStatus` (lines 299 to 319) with:

```ts
export function hooksStatusBlocks(config: HooksConfig): Block[] {
  const hooks = Object.entries(config.hooks);
  if (!config.enabled) {
    return [out.line("off", "All hooks are off"), ...hooks.map(([hook, enabled]) => out.line("off", hook, enabled ? "on, but everything is off" : "off"))];
  }
  return [out.line("done", "Hooks are on"), ...hooks.map(([hook, enabled]) => (enabled ? out.line("done", hook) : out.line("off", hook, "off")))];
}

export function selectionBlocks(off: string[], total: number): Block[] {
  if (off.length === 0) return [out.line("done", "All hooks run")];
  if (off.length === total) return [out.line("off", "All hooks are off")];
  return [out.line("off", `${off.length} ${off.length === 1 ? "hook" : "hooks"} off`, off.join(", "))];
}
```

In `toggleHooks`:

- The no-hooks branch (lines 327 to 330):

```ts
  if (discoveredHooks.length === 0) {
    out.fail({ title: "This repo has no husky hooks", why: "rt turns hooks on and off for repos that keep them in a .husky folder." });
    process.exit(1);
  }
```

- `off` (lines 353 to 354): `out.print(out.line("off", "All hooks are off", repoName), out.callout("note", "This applies in every git app: the terminal, Cursor, GitHub Desktop."));`
- `on` (line 367): `out.print(out.line("done", "All hooks are back on", repoName));`
- `status` and the non-terminal fallback (lines 375 and 406): `out.print(...hooksStatusBlocks(config));` in place of `showStatus(config, repoName);`
- The unknown hook (lines 385 to 389):

```ts
    if (!(hookName in config.hooks)) {
      out.fail({ title: `This repo has no hook called ${hookName}`, why: `The hooks here are ${Object.keys(config.hooks).join(", ")}.` });
      process.exit(1);
    }
```

- The single-hook result (lines 394 to 398): `out.print(action === "off" ? out.line("off", `${hookName} is off`, repoName) : out.line("done", `${hookName} is on`, repoName));`
- After the checklist (lines 422 to 429): `out.print(...selectionBlocks(discoveredHooks.filter((h) => !next.hooks[h]), discoveredHooks.length));`

The shim script `generateShims` writes is not touched: its `echo "rt: ..."` lines run inside git, not inside rt.

- [ ] **Step 4: Delete the allowlist line and run**

Run: `grep -n "console\.\(log\|error\|warn\|info\)\s*(\|tui.ts" commands/hooks.ts`
Expected: no hits.

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/hooks.ts",`.

Run: `bun test commands/__tests__/hooks.test.ts commands/__tests__/settings-keys-hooks-regen.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `settings-keys-hooks-regen.test.ts` calls `regenerateHooksCache` through phase 4's file; it spies `console.error` only to silence it and needs no edit.

- [ ] **Step 5: Commit**

```bash
git add commands/hooks.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/hooks.test.ts
```

```bash
git commit -m "rt hooks: status and toggles print through the layer, and off is not coral

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `rt intercept`

**Files:**
- Modify: `commands/intercept.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Create: `commands/__tests__/intercept-output.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.line`, `out.callout`, `out.kv`, `out.cmd`, `out.key`, `out.verbatim`, `Block`; `usageFailure` (5a); `logCliEvent(level: CliLogLevel, module: string, message: string, context?: Record<string, unknown>): void` (`lib/cli-logger.ts`; `installCliLogging` runs at `cli.ts:91`, before the intercept fast path); `shimReport(): Array<{ command: string; repo: string; installed: boolean; current: boolean }>`, `staleIntercepts(): { stale: boolean; reason?: string }` (its reason reads `<paths> newer than the cached intercept rules`), `installShims(): Promise<{ installed: string[]; current: string[]; skipped: string[]; rules: number }>`, `uninstallShims(): { removed: string[] }` (`lib/endpoint/shim.ts`); `closeStateDb` (`lib/state/index.ts`); `captureOut`.
- Produces, exported from `commands/intercept.ts`:
  - `statusBlocks(report: ReturnType<typeof shimReport>, rulesByRepo: Record<string, number>, daemonUp: boolean, stale: { stale: boolean; reason?: string }): Block[]`
  - `installBlocks(result: { installed: string[]; current: string[]; skipped: string[]; rules: number }): Block[]`
  - `uninstallBlocks(result: { removed: string[] }): Block[]`
  - `interceptNote(msg: string): void`

- [ ] **Step 1: Write the characterization tests**

Create `commands/__tests__/intercept-output.test.ts`. Its first three tests pin the `--json` lines and pass before any conversion (the capture reads `console.log` too):

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { interceptInstall, interceptStatus, interceptUninstall } from "../intercept.ts";

const origHome = process.env.HOME;
let home: string;
let io: CapturedOut;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-intercept-out-")));
  process.env.HOME = home;
  closeStateDb();
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
});

afterEach(() => {
  io.restore();
  process.env.HOME = origHome;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
});

describe("rt intercept --json is frozen", () => {
  test("status on a fresh home", async () => {
    await interceptStatus(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"shims":[],"rulesByRepo":{},"daemonUp":false,"stale":{"stale":false}}\n');
  });

  test("install with no rules", async () => {
    await interceptInstall(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"installed":[],"current":[],"skipped":[],"rules":0}\n');
  });

  test("uninstall with nothing to remove", async () => {
    await interceptUninstall(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"removed":[]}\n');
  });
});
```

This is the fixture `lib/endpoint/__tests__/shim.test.ts` uses for `installShims` (a fresh `HOME` and `closeStateDb()` around it).

- [ ] **Step 2: Run them to verify they pass before the conversion**

Run: `bun test commands/__tests__/intercept-output.test.ts`
Expected: PASS. If `status` reports `"daemonUp":true`, the test reached a real daemon: stop and report it rather than loosening the assertion, because that means the test home is not isolating the socket.

- [ ] **Step 3: Write the failing tests for the blocks**

Append to the same file (add `spyOn` to the `bun:test` import, the imports `import { renderPlain } from "../../lib/ui/out-plain.ts";` and `import * as cliLogger from "../../lib/cli-logger.ts";`, and `installBlocks`, `interceptNote`, `statusBlocks`, `uninstallBlocks` from `../intercept.ts`):

```ts
describe("rt intercept, read by a person", () => {
  const report = [
    { command: "pnpm", repo: "example.com/acme/widgets", installed: true, current: true },
    { command: "doppler", repo: "example.com/acme/widgets", installed: true, current: false },
    { command: "vite", repo: "example.com/acme/gadgets", installed: false, current: false },
  ];

  // staleIntercepts()'s own wording (lib/endpoint/shim.ts), not this slice's to change.
  const staleReason = "/Users/sample/.mattstack/user/settings.jsonc newer than the cached intercept rules";

  test("status: a shim that is not installed yet is pending, never coral", () => {
    const text = renderPlain(statusBlocks(report, { "example.com/acme/widgets": 2, "example.com/acme/gadgets": 1 }, true, { stale: true, reason: staleReason }));
    expect(text).toBe(
      [
        "[running] The rt daemon is running",
        "[ok] pnpm  example.com/acme/widgets, 2 rules",
        "[out of date] doppler  example.com/acme/widgets, 2 rules; its shim is out of date",
        "[not yet] vite  example.com/acme/gadgets, 1 rule; not installed yet",
        `[out of date] The saved rules are behind your settings  ${staleReason}`,
        "  next: rt intercept install",
        "",
      ].join("\n"),
    );
    expect(text).not.toContain("[failed]");
  });

  test("status with no rules says how to add one", () => {
    expect(renderPlain(statusBlocks([], {}, false, { stale: false }))).toBe(
      "[off] The rt daemon is not running  intercepted commands run as they are\n[not yet] No commands are intercepted yet\n  next: Add rules under rt.intercepts in your settings, then run rt intercept install\n",
    );
  });

  test("status with everything current needs no next step", () => {
    expect(renderPlain(statusBlocks([report[0]!], { "example.com/acme/widgets": 2 }, true, { stale: false }))).toBe(
      "[running] The rt daemon is running\n[ok] pnpm  example.com/acme/widgets, 2 rules\n",
    );
  });

  test("install: what was written, what was current, and what rt left alone", () => {
    expect(renderPlain(installBlocks({ installed: ["pnpm"], current: ["vite"], skipped: ["doppler"], rules: 3 }))).toBe(
      "[ok] Installed  pnpm\n[ok] Already current  vite\n[refused] Left alone, because rt did not make them  doppler\nRules: 3\n",
    );
    expect(renderPlain(installBlocks({ installed: [], current: [], skipped: [], rules: 0 }))).toBe("[skipped] No commands to intercept\nRules: 0\n");
  });

  test("uninstall: removed, or nothing to remove", () => {
    expect(renderPlain(uninstallBlocks({ removed: ["pnpm", "vite"] }))).toBe("[ok] Removed  pnpm, vite\n");
    expect(renderPlain(uninstallBlocks({ removed: [] }))).toBe("[skipped] Nothing to remove\n");
  });

  test("the human status goes to stdout through the layer", async () => {
    await interceptStatus([]);
    expect(io.stdout()).toBe("[off] The rt daemon is not running  intercepted commands run as they are\n[not yet] No commands are intercepted yet\n  next: Add rules under rt.intercepts in your settings, then run rt intercept install\n");
  });

  test("a shim note is one warn line on stderr and nothing on stdout", () => {
    interceptNote('rt-intercept: passthrough ... role "web" is not declared for repo "widgets"');
    expect(io.stderr()).toBe('[warning] rt-intercept: passthrough ... role "web" is not declared for repo "widgets"\n');
    expect(io.stdout()).toBe("");
  });

  describe("a debug trace is a log line, never a warning", () => {
    const traces = ["rt-intercept: match command=pnpm repo=widgets role=web cwd=/w/widgets", 'rt-intercept: claim result={"ok":false}'];
    let logged: ReturnType<typeof spyOn>;
    const savedLevel = process.env.RT_LOG_LEVEL;

    beforeEach(() => {
      logged = spyOn(cliLogger, "logCliEvent").mockImplementation(() => {});
    });
    afterEach(() => {
      logged.mockRestore();
      if (savedLevel === undefined) delete process.env.RT_LOG_LEVEL;
      else process.env.RT_LOG_LEVEL = savedLevel;
    });

    test("at the default level it goes to the log at debug and prints nothing", () => {
      delete process.env.RT_LOG_LEVEL;
      for (const t of traces) interceptNote(t);
      expect(logged.mock.calls).toEqual(traces.map((t) => ["debug", "intercept", t]));
      expect(io.stderr()).toBe("");
      expect(io.stdout()).toBe("");
    });

    test("under RT_LOG_LEVEL=debug it is also a plain line on stderr", () => {
      process.env.RT_LOG_LEVEL = "debug";
      for (const t of traces) interceptNote(t);
      expect(io.stderr()).toBe(traces.map((t) => `  ${t}\n`).join(""));
      expect(io.stderr()).not.toContain("[warning]");
      expect(io.stdout()).toBe("");
    });
  });

  test("a note that cannot be written never throws", () => {
    const real = process.stderr.write;
    process.stderr.write = (() => {
      throw new Error("EPIPE");
    }) as typeof process.stderr.write;
    try {
      expect(() => interceptNote("rt-intercept: passthrough")).not.toThrow();
    } finally {
      process.stderr.write = real;
    }
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `bun test commands/__tests__/intercept-output.test.ts`
Expected: FAIL, `statusBlocks` is not exported. The three frozen tests still pass.

- [ ] **Step 5: Convert `commands/intercept.ts`**

Replace the color import (line 24) with:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
```

(`toStringEnv` has a local named `out`; it shadows the import inside that function only and prints nothing, so leave it.)

Delete `usageFail`. In `interceptRun`, the usage line becomes:

```ts
  if (!parsed) {
    out.fail(usageFailure("Which command should rt run?", "rt intercept run <command> -- [args...]"));
    process.exit(1);
  }
```

Above `interceptRun`, add:

```ts
// lib/endpoint/run.ts's two RT_INTERCEPT_DEBUG traces start this way.
const DEBUG_TRACE = /^rt-intercept: (match |claim result=)/;

/**
 * A line from the shim's core, never on stdout: this process's stdout belongs
 * to the tool it wraps. The tool must run whatever happens to the line, so a
 * stderr that is closed or broken drops it. This verb sits in front of every
 * intercepted command, so a debug trace is a log line, never a warning, and
 * reaches stderr only under RT_LOG_LEVEL=debug.
 */
export function interceptNote(msg: string): void {
  try {
    if (DEBUG_TRACE.test(msg)) {
      logCliEvent("debug", "intercept", msg);
      if (process.env.RT_LOG_LEVEL === "debug") out.note(out.verbatim([msg]));
      return;
    }
    out.note(out.line("warn", msg));
  } catch {
    // stderr is gone; the wrapped tool still runs
  }
}
```

and in the `deps` object, `warn: (msg) => console.error(msg),` (line 214) becomes `warn: interceptNote,`. A passthrough note at a terminal costs one `rt-ui render` launch before the wrapped tool starts. It fires only for a command a rule matched whose claim could not be used, after the git lookups that path already pays for; a command no rule matches never reaches it. The PR body names the cost.

`RT_INTERCEPT_DEBUG=1` alone now writes its traces to the CLI log (`rt daemon logs`, surface `cli`); `RT_LOG_LEVEL=debug` beside it also prints them. The PR body says so.

Above `interceptStatus`, add:

```ts
const rulesText = (n: number): string => `${n} ${n === 1 ? "rule" : "rules"}`;

export function statusBlocks(report: ReturnType<typeof shimReport>, rulesByRepo: Record<string, number>, daemonUp: boolean, stale: { stale: boolean; reason?: string }): Block[] {
  const blocks: Block[] = [daemonUp ? out.line("running", "The rt daemon is running") : out.line("off", "The rt daemon is not running", "intercepted commands run as they are")];
  if (report.length === 0) {
    blocks.push(out.line("pending", "No commands are intercepted yet"));
    if (!stale.stale) blocks.push(out.callout("next", ["Add rules under ", out.key("rt.intercepts"), " in your settings, then run ", out.cmd("rt intercept install")]));
  }
  for (const entry of report) {
    const hint = `${entry.repo}, ${rulesText(rulesByRepo[entry.repo] ?? 0)}`;
    if (entry.installed && entry.current) blocks.push(out.line("done", entry.command, hint));
    else if (entry.installed) blocks.push(out.line("stale", entry.command, `${hint}; its shim is out of date`));
    else blocks.push(out.line("pending", entry.command, `${hint}; not installed yet`));
  }
  // The rules are a saved copy of what the settings resolve to, so a settings
  // edit can leave them behind without any shim looking wrong: it is its own
  // line, on the empty and the populated path alike.
  if (stale.stale) blocks.push(out.line("stale", "The saved rules are behind your settings", stale.reason));
  if (stale.stale || report.some((entry) => !entry.installed || !entry.current)) blocks.push(out.callout("next", out.cmd("rt intercept install")));
  return blocks;
}
```

and replace `interceptStatus` from `if (json) {` to its end:

```ts
  if (json) {
    out.json({ ok: true, shims: report, rulesByRepo, daemonUp, stale });
    return;
  }
  out.print(...statusBlocks(report, rulesByRepo, daemonUp, stale));
}
```

(delete the `staleNotice` closure and the two comments it carried; the one constraint they stated is the comment in `statusBlocks`).

Above `interceptInstall`, add:

```ts
export function installBlocks(result: { installed: string[]; current: string[]; skipped: string[]; rules: number }): Block[] {
  const blocks: Block[] = [];
  if (result.installed.length > 0) blocks.push(out.line("done", "Installed", result.installed.join(", ")));
  if (result.current.length > 0) blocks.push(out.line("done", "Already current", result.current.join(", ")));
  if (result.skipped.length > 0) blocks.push(out.line("refused", "Left alone, because rt did not make them", result.skipped.join(", ")));
  if (blocks.length === 0) blocks.push(out.line("skipped", "No commands to intercept"));
  blocks.push(out.kv("Rules", String(result.rules)));
  return blocks;
}

export function uninstallBlocks(result: { removed: string[] }): Block[] {
  return [result.removed.length > 0 ? out.line("done", "Removed", result.removed.join(", ")) : out.line("skipped", "Nothing to remove")];
}
```

and the tails of `interceptInstall` and `interceptUninstall`:

```ts
  if (json) {
    out.json({ ok: true, ...result });
    return;
  }
  out.print(...installBlocks(result));
}
```

```ts
  if (json) {
    out.json({ ok: true, ...result });
    return;
  }
  out.print(...uninstallBlocks(result));
}
```

The header comment at the top of the file has two long dashes; reword those two lines with a colon while the file is open.

- [ ] **Step 6: Delete the allowlist line and run**

Run: `grep -n "console\.\(log\|error\|warn\|info\)\s*(\|process\.std\(out\|err\)\|tui.ts" commands/intercept.ts`
Expected: no hits.

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/intercept.ts",`.

Run: `bun test commands/__tests__/intercept-output.test.ts commands/__tests__/intercept.test.ts lib/endpoint/__tests__/intercept-run.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `intercept-run.test.ts`'s spawned run (lines 139 to 171) still sees exactly `hello\n` on stdout and no escape byte on stderr: `interceptNote` prints plain off a terminal, and `rt intercept run` never reaches the dispatcher (`cli.ts:103-111` calls the handler directly), so no breadcrumb is drawn and no plugin load warning fires.

- [ ] **Step 7: Commit**

```bash
git add commands/intercept.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/intercept-output.test.ts
```

```bash
git commit -m "rt intercept: status, install and uninstall print blocks, and shim notes go through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Renders, the reader check and every gate

**Files:**
- Modify: `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/plugins-hooks-dark.png`, `docs/design/output-layer/plugins-hooks-light.png`

**Interfaces:**
- Consumes: everything above; `ui/dist/rt-ui` (run `bun run ui:build` once if it is missing; this slice changes nothing under `ui/`).
- Produces: the renders the PR carries.

- [ ] **Step 1: Check nothing else scrapes the text this slice reworded**

Run each alone:

- `grep -rn "rt plugin validate\|rt hooks\|rt intercept\|rt deps \|rt tools " plugins/mattstack skills apps/board/skills-src --include='*.md' --include='*.sh'`
- `grep -rn "\[rt\] \|skipping plugin\|no plugins installed\|hooks active\|all hooks disabled\|rt deps: \|rt tools install: \|rt intercept status" plugins/mattstack skills apps/board/skills-src docs/plugins.md website/docs/guides --include='*.md' --include='*.mdx' --include='*.sh'`

Expected: the first lists `skills/rt-create-plugin/SKILL.md` (edited in Task 3; confirm lines 33 and 83 name `--json`) and one mention of `rt tools install apple-clt` in a pre-release note, which runs the verb and reads nothing. The second lists nothing that matches a verb's old text (Task 5 replaced the guide's two `skipping plugin` rows). A hit under `plugins/mattstack` that quotes old wording as something to match is reported, not edited: a plugin change needs its own version bump and certification run.

- [ ] **Step 2: Write the render input**

In the session scratchpad (not the repo), write `plugins-blocks.ts`, replacing `<repo>` with the worktree's absolute path. All names are invented:

```ts
// usage: bun plugins-blocks.ts > plugins.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";
import { pluginListBlocks, scaffoldedBlocks, validateBlocks } from "<repo>/commands/plugin.ts";
import { resolveBlocks } from "<repo>/commands/deps.ts";
import { hooksStatusBlocks, selectionBlocks } from "<repo>/commands/hooks.ts";
import { installBlocks, statusBlocks } from "<repo>/commands/intercept.ts";

const blocks = [
  out.section("plugin", undefined),
  out.line("done", "Created the standup plugin", "/Users/sample/.mattstack/user/plugins/standup"),
  ...scaffoldedBlocks("standup", "/Users/sample/.mattstack/user/plugins/standup", { pm: "bun", ok: false }),
  ...pluginListBlocks([
    { dirName: "standup", dir: "/p/standup", manifest: { name: "standup", apiVersion: 1, commands: { standup: { description: "d", module: "./s.ts" } } }, errors: [] },
    { dirName: "notes", dir: "/p/notes", manifest: null, errors: ["plugin.json is unreadable or not valid JSON (Unexpected token)"] },
  ] as Parameters<typeof pluginListBlocks>[0]),
  ...validateBlocks([
    { name: "standup", dir: "/p/standup", ok: true, problems: [] },
    { name: "notes", dir: "/p/notes", ok: false, problems: ["add: module ./notes.ts not found", 'list: ./notes.ts does not export "list"'] },
  ]),
  out.line("warn", "timer's git command was not added", "rt already has a command called git"),
  out.line("warn", "The notes plugin was not loaded", "plugin.json is unreadable or not valid JSON"),
  out.callout("next", out.cmd("rt plugin validate notes")),
  out.section("tools and deps", undefined),
  out.line("done", "Installed gh", "linked the copy that ships with mattstack.app"),
  out.failure({ title: "herdr was not installed", why: "brew install exited 1: no formula named herdr" }),
  out.failure(usageFailure("Which tool?", "rt tools install <tool>")),
  ...resolveBlocks({ tool: "gh", bundled: "/Applications/mattstack.app/Contents/Helpers/gh", exec: ["/Applications/mattstack.app/Contents/Helpers/gh"], userCopy: null, linked: true, chosen: "/Applications/mattstack.app/Contents/Helpers/gh" }),
  out.line("refused", "You already have your own gh at /opt/homebrew/bin/gh"),
  out.callout("next", out.cmd("rt deps link gh --force")),
  out.section("hooks", undefined),
  ...hooksStatusBlocks({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } }),
  ...hooksStatusBlocks({ enabled: false, hooks: { "pre-commit": true, "pre-push": false } }),
  ...selectionBlocks(["pre-push"], 2),
  out.failure({ title: "This repo has no hook called pre-rebase", why: "The hooks here are pre-commit, pre-push." }),
  out.section("intercept", undefined),
  ...statusBlocks(
    [
      { command: "pnpm", repo: "example.com/acme/widgets", installed: true, current: true },
      { command: "doppler", repo: "example.com/acme/widgets", installed: true, current: false },
      { command: "vite", repo: "example.com/acme/gadgets", installed: false, current: false },
    ],
    { "example.com/acme/widgets": 2, "example.com/acme/gadgets": 1 },
    true,
    { stale: true, reason: "/Users/sample/.mattstack/user/settings.jsonc newer than the cached intercept rules" },
  ),
  ...installBlocks({ installed: ["pnpm"], current: ["vite"], skipped: ["doppler"], rules: 3 }),
];
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + blocks.map(encodeLine).join(""));
```

Also write `ansi-page.ts` in the scratchpad. It turns the helper's ANSI into one HTML page on a dark or a light ground:

```ts
// usage: bun ansi-page.ts <dark|light> <title> < ansi.txt > page.html
const [mode, title] = [process.argv[2] ?? "dark", process.argv[3] ?? "render"];
const page = mode === "light" ? { bg: "#FFFFFF", fg: "#1F1F1F" } : { bg: "#161224", fg: "#E6E0FF" };
const input = await new Response(Bun.stdin.stream()).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
let open = false;
let style: Record<string, string> = {};
const flush = () => {
  if (open) html += "</span>";
  const css = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";");
  open = css !== "";
  if (open) html += `<span style="${css}">`;
};
const tokens = input.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/);
for (const token of tokens) {
  const sgr = token.match(/^\x1b\[([0-9;]*)m$/);
  if (!sgr) {
    html += esc(token);
    continue;
  }
  const codes = sgr[1] === "" ? [0] : sgr[1]!.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) style = {};
    else if (c === 1) style["font-weight"] = "bold";
    else if (c === 4) style["text-decoration"] = "underline";
    else if (c === 22) delete style["font-weight"];
    else if (c === 24) delete style["text-decoration"];
    else if (c === 39) delete style.color;
    else if (c === 49) delete style.background;
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      style[c === 38 ? "color" : "background"] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  flush();
}
if (open) html += "</span>";
process.stdout.write(
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:24px;background:${page.bg};color:${page.fg}"><pre style="font:14px/1.45 Menlo,monospace">${html}</pre></body>\n`,
);
```

- [ ] **Step 3: Render and screenshot both schemes**

From the scratchpad, one command at a time:

```bash
bun plugins-blocks.ts > plugins.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < plugins.ndjson > plugins-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < plugins.ndjson > plugins-light.ansi
bun ansi-page.ts dark plugins < plugins-dark.ansi > plugins-dark.html
bun ansi-page.ts light plugins < plugins-light.ansi > plugins-light.html
```

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4175 --bind 127.0.0.1`; `file:` is blocked) and screenshot both pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save them as `docs/design/output-layer/plugins-hooks-dark.png` and `docs/design/output-layer/plugins-hooks-light.png`.

Read both PNGs and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- Coral appears only on the three failures (herdr not installed, which tool, no hook called pre-rebase) and on the one failed validate row. The refused `deps link` line is not coral, and neither is a hook that is off, a shim that is not installed or a refused shim.
- Bold ends where it should: the page script now honors SGR 22, 24, 39 and 49, so a title's bold that runs on into its hint, the next row or the rest of the page is a real fault in the render, not the script.
- The two all-hooks states side by side: is "on, but everything is off" clear, or does the row read as on?
- The validate row's `why` callout: two problems, aligned under each other.
- The three intercept states (`done`, `stale`, `pending`) are told apart by glyph as well as color.
- The plugin load warnings: one line each, the hint readable beside the title at 100 columns.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add one row to its table:

```markdown
| `plugins-hooks-dark.png`, `plugins-hooks-light.png` | `rt plugin`, `tools`, `deps`, `hooks` and `intercept` at 100 columns: a scaffold with a failed install, the plugin list and a failed validate, two load warnings, tool results, a failure and a refusal, hooks on and off, and intercept status with a current, a stale and a not-yet-installed shim |
```

`AGENTS.md` needs no new paragraph from this plan: it adds no rule. (`rt plugin validate --json` is documented by the generated reference page and the skill.)

- [ ] **Step 5: Run every gate**

Run each from the repo root, one at a time:

- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run picker:check`
- `bun run format:check`
- `bun run docs:gen` (then `git status --short`: expected no change, since Task 3 committed the regenerated page)
- `bun run check` (what the `static` CI job runs)

Expected: all pass. `bun run ui:build`, `ui:test` and `test:pty` are not needed for a change of this slice's own: nothing under `ui/` changed and the spec names no pty test for these verbs; run `bun run test:pty` anyway if the rebase in Task 11 brought `ui/` changes in. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine (a mise shim error). A failure in a file this slice did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Run: `grep -n "commands/plugin.ts\|commands/tools.ts\|commands/deps.ts\|commands/hooks.ts\|commands/intercept.ts\|lib/plugins.ts\|lib/plugin-api.ts" lib/__tests__/raw-output-allowlist.json`
Expected: no lines.

- [ ] **Step 6: Commit**

```bash
git add docs/design/output-layer/README.md docs/design/output-layer/plugins-hooks-dark.png docs/design/output-layer/plugins-hooks-light.png
```

```bash
git commit -m "docs: output layer renders for plugin, tools, deps, hooks and intercept

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`

Other slices and phase 3 may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `docs/design/output-layer/README.md`: keep their rows, then this slice's.
- `lib/command-tree-def.ts`: this slice adds one argument line under `plugin validate`; keep it beside whatever another slice changed.

Then run: `grep -rn "no bundled tool named\|already on PATH at\|not a mattstack-managed link\|hands rt back" lib commands --include='*.test.ts'`
A hit is a test phase 3 added that pins one of the four refusals Task 7 reworded; give it the new wording from Task 2's `lib/deps/` table. A phase 3 test that pins `mattstack-dev.app's source wrapper` needs nothing: the new wording keeps it.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run picker:check`, `bun run format:check`, `bun run docs:gen`, `bun run check`.
Expected: all pass, with the same known noise as Task 10 Step 5. If `docs:gen` changes a file after the rebase, commit it with the message `docs: regenerate the command reference` and the trailer.

- [ ] **Step 3: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 4: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5d2, plugins, tools, deps, hooks and intercept" --body-file <scratchpad>/pr-body-5d2.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Plugins**: `plugin validate --json` with its envelope and the skill that now reads it, `new`, `list` and `validate` on blocks, load warnings through `warn` with one title each; **Tools and deps**: result lines, usage failures, four refusals reworded, `deps link`'s policy refusals drawn as refused (not coral) with `--force` as the next step where it applies, the `--json` replies the app reads pinned before the change; **Hooks**: status and toggles, off is not coral, two settings warnings through `warn`; **Intercept**: status, install and uninstall on blocks, passthrough notes through `out.note` (at a terminal each costs one `rt-ui render` launch before the wrapped tool starts), `RT_INTERCEPT_DEBUG` traces now go to the CLI log at debug and reach stderr only under `RT_LOG_LEVEL=debug`; **Also**: `lib/command-tree-def.ts` gains one argument and the reference page is regenerated, the plugin guide's troubleshooting rows quote the new warning, seven files off the allowlist; **Follow-up**: 5d1 carries the `skills` verbs; the intercept note text still carries its `rt-intercept:` prefix and a long dash in `lib/endpoint/run.ts`, and the stale reason (`<paths> newer than the cached intercept rules`) is `lib/endpoint/shim.ts`'s wording, both for whoever owns those files; `tools install` of a bundled tool whose link is refused still reads as a coral "gh was not installed", because `InstallResult` carries no reason code and `lib/setup` is phase 3's); the two renders; a verification line with the gate results; an **After pulling** line: the plugin skill reaches a Mac through the app bundle at the next release, and a checkout that links its skills with `rt skills link` has it at once; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

Report the PR url, the gate results, the flakes seen with both results, and what the renders showed. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **The `plugin validate --json` envelope's shape.** Ruling 7 asks for "a result envelope" and does not give one. This plan uses the contract envelope `tools` and `deps` already print: `{ contract: 1, at, ok, plugins: [{ name, dir, ok, problems }] }`, with `error` added for an unknown name. Exit codes are the human path's (0 and 1), not the setup contract's 2, so a script that reads only the code sees no change.
2. **`plugin validate` is not agent-safe.** It runs a plugin's top-level code. The skill keeps calling it through Bash.
3. **A plugin's own prints are moved to stderr while it is validated under `--json`.** Without that, one `console.log` at the top of a plugin's module breaks the envelope the skill parses. A plugin that writes to `process.stdout` directly still can; the skill is told nothing about that case.
4. **`lib/command-tree-def.ts` is edited** (one argument line), though no slice's file list names it. The ruling cannot be met without it.
5. **Four refusal strings in `lib/deps/links.ts` are reworded, and three of them are drawn as refusals.** They are human-facing strings inside a `--json` envelope and a setup row. `user-copy`, `occupied` and `dev-mode-owns-rt` are rt declining by policy, so the human `deps link` draws them `refused` on stderr through `out.note`, never coral, with exit 2 as today; only `no-bundle` stays a failure. The `--force` advice moves out of the sentence into a `next` callout on the human refusal, which means the tray, which shows `error.message` from the exit-2 envelope, no longer shows a flag it cannot pass. The `dev-mode-owns-rt` sentence keeps the substring `mattstack-dev.app's source wrapper` that a phase 3 test pins. `deps unlink` of a file rt did not make is refused the same way (an ownership call), exit 0 as today.
6. **A bad plugin name and an existing plugin folder become expected failures.** Today they reach the seam as "rt hit an unexpected error". The exit code stays 1.
7. **`rt intercept run`'s passthrough notes stay visible; its debug traces become log lines.** 5a sets the warning log quiet under `intercept run`, which silences `lib/` warnings there. The shim's own passthrough notes ("the daemon is unavailable, so this ran unclaimed") are the verb's output, not a lib warning, and a person debugging a port needs them, so they go through `out.note` as one `warn` line each. Its `RT_INTERCEPT_DEBUG` traces (`match ...`, `claim result=...`) sit in front of every intercepted command and are never warnings (controller ruling): they go to the CLI log at debug and to stderr as plain lines only under `RT_LOG_LEVEL=debug`. The verb gets no breadcrumb and no plugin load warning because it never reaches the dispatcher: `cli.ts:103-111` calls its handler directly. The note text comes from `lib/endpoint/run.ts`, which is not this slice's: it keeps its `rt-intercept:` prefix and a long dash until whoever owns that file rewords it, and `interceptNote` tells a trace from a note by the two prefixes that file writes.
8. **Two `console.warn("rt: ...")` lines in `commands/hooks.ts` go through `warn`, both shown.** 5a's warnings table covers `lib/` only; these are the same kind of line (a setting rt had to ignore, a setting rt could not save), so they follow rows 21 to 23's pattern. The module's own once-per-process latch goes, since `warn` shows a title once.
9. **Hooks that are off are `off`, not coral,** and so is "all hooks are off". Today both are red.
10. **The intercept header lines go.** The dispatcher's breadcrumb (5a) is the header for `status`, `install` and `uninstall`; the daemon's state and the rule count become lines of their own.

## Self-Review

**Spec coverage.** Scoping section 3 "5d", second half of the second cut: `commands/plugin.ts` (Tasks 3 and 4), `lib/plugins.ts` and `lib/plugin-api.ts` (Task 5, with the scaffold line reworded rather than converted, as the scoping document says), `commands/tools.ts` (Task 6), `commands/deps.ts` and the `lib/deps/` copy audit (Tasks 2 and 7), `commands/hooks.ts` (Task 8), `commands/intercept.ts` (Task 9). Ruling 7 (Task 3: the flag, the envelope, the skill in the same PR, with the skill's home and its checks stated). Shared item 1 (rows 44 and 45, Task 5) and item 8 (`usageFailure` at `plugin` 1, `tools` 2, `deps` 3, `intercept` 1). Section 5 readers: the plugin skill (Task 3), the tray's row actions (Tasks 6 and 7, Review Focus 5), `intercept run` (Task 9, Review Focus 4), `e2e/tests/plugins.test.ts` (Tasks 3 and 5). Must-not-touch: `lib/setup/tools-install.ts` is not edited. Spec "Testing": characterization (Task 9 Step 1 for `intercept`; Task 6 Step 1 pins the `--json` replies the tray reads from `tools install`, `deps link` and `deps unlink` before either file changes, beside the existing `deps` envelope tests; `plugin validate --json` is new and is pinned in Task 3), plain-renderer assertions per verb, both-scheme renders (Task 10). The spec names no pty test for these verbs.

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 10 and 11 are the implementer's own absolute paths, named as such.

**Type consistency.** `PluginValidation`, `validatePlugins`, `pluginListBlocks`, `validateBlocks`, `scaffoldedBlocks`, `PluginScaffoldError`, `loadPluginTree(builtins, sink?)`, `resolveBlocks`, `hooksStatusBlocks`, `selectionBlocks`, `statusBlocks`, `installBlocks`, `uninstallBlocks` and `interceptNote` are spelled the same in the Interfaces blocks, the code, the tests and the render script.

**Review Focus.** Five lines, each pinned to a named test in Tasks 3, 4, 5, 6, 7 and 9.
