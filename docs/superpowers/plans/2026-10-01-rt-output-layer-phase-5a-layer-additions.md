# rt Output Layer, Phase 5a (Layer Additions and Dispatcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the output layer the pieces the other five phase 5 slices call (a stderr note, a warning helper, a spinner that leaves nothing, a usage failure), fix what the renderer still draws wrong (hint wrap, hyphen breaks, combining marks, hidden characters, diff tints on a light terminal, faint rules), and move the dispatcher's own output (help, usage, unknown command, refusals, pre-dispatch notices) onto the layer so `cli.ts`, `lib/command-tree.ts`, `lib/arg-collector.ts`, `lib/daemon-client.ts` and `lib/repo.ts` leave the raw-output allowlist.

**Architecture:** Additions first, conversions second. `lib/ui/out.ts` gains `note`; three small files join `lib/ui/` (`warn.ts`, `usage.ts`, `transient-step.ts`) plus `screen.ts` for the one screen clear. The `steps` verb's `done` event gains a `clear` flag on the wire (TypeScript, Go and a new shared fixture), and `lib/tui/inline-spinner.ts` becomes a re-export of the transient step. All Go work in phase 5 happens here: an opt-in words-only wrap in `ui/internal/textwrap` (the mission diff wrap keeps calling `Spans` and does not change), `lineRun` wrapping hints, `Clean` dropping bidi and zero-width characters, light diff tints chosen from `COLORFGBG`, and one rule tone that reads on both backgrounds. The plain renderer drops the `[failed]` tag when a failure opens the output. Then the five dispatcher files are converted with those pieces.

**Tech Stack:** Bun + TypeScript (`lib/`, `cli.ts`), `bun:test`, Go 1.x with lipgloss v2 and `charmbracelet/x/ansi` (`ui/`), termwright for the existing pty gate (`e2e/pty/`).

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Steps", "Copy style", "Guard" and "Testing". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 2 items 1, 2, 4 to 9, section 3 "5a", and rulings 1, 2, 9 and 12). The twelve cross-phase rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan.

**What was run while writing this plan:** every Go change and Go test below, and the plain renderer change in Task 2 and Task 9, were compiled and run in a scratch copy of `ui/` and `lib/ui/out-plain.ts` on 2026-10-01; the expected strings in those tasks are real output. The rest of the TypeScript is uncompiled and was written against the files at `5bc69f231`.

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
- 5a only: exit codes do not change. Unknown command, the terminal guard and every repo refusal exit 1; `--help` and a bare branch off a terminal exit 0.
- 5a only: `PROTOCOL_VERSION` stays 1, and the wire stays readable in both mixed pairs. A source checkout falls through to the installed helper when `ui/dist/rt-ui` is missing or stale, so a new CLI can meet an old helper: the erasing ending is a `clear` flag on `done`, which an old helper ignores and draws as a plain done row, never as a coral `interrupted` row. An old CLI never sends the flag.
- 5a only: `textwrap.Spans` keeps its body and its behavior. The mission diff wrap (`ui/internal/views/mission/diff_wrap.go`) is not edited and its tests pass untouched.
- 5a only: no source file holds a literal bidi or zero-width character, and no file uses a `\u` escape for one. Code points are written as hex numbers (`0x202E`) or decimals in JSON, and strings are built with `String.fromCodePoint` or `string(rune(...))`.
- 5a only: files this slice must not edit: any file under `commands/`; `lib/ui/steps.ts` (5b); `lib/errors.ts` (phase 2); `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts` (5c); `lib/navigate.ts` (5f); `lib/repo-index.ts` (5e); `lib/cli-logger.ts`; `lib/ui/__tests__/capture-out.ts` (phase 4 extends it); everything phases 3 and 4 own.
- 5a only: `lib/ui/transient-step.ts` and `lib/ui/warn.ts` must stay importable from a file the daemon loads. Neither may import `lib/ui/spawn.ts`, `steps.ts`, `pick.ts` or `prompts.ts` statically, not even as a type (`lib/__tests__/no-eager-tui.test.ts` counts type edges).
- 5a only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.

## Review Focus

1. **A note or warning that fires while a program is reading stdout.** `rt cd`, `rt_verb` and every `--json` caller parse stdout; a notice from before dispatch or from deep in `lib/` must land on stderr and leave stdout alone. Pinned in Task 3 (`note writes to stderr and never follows payloadOnStdout`, `a shown warning is logged, then printed once on stderr`).
2. **A failure title that opens with a bracketed word.** Once a leading failure prints without `[failed]`, an error message such as `[ok] Setup complete` would read as a success row to anything that greps plain output. Pinned in Task 2 (`a leading failure whose title opens with a bracket keeps the tag`).
3. **A helper that is missing or dies while a transient step runs.** `rt port` and `rt sdm` must still return their data; a spinner is never worth a failed command. Pinned in Task 6 (`a missing helper costs the spinner, never the task`, `a helper that dies mid-step does not fail the task`).
4. **A branch or repo name carrying a right-to-left override or a zero-width character.** `main` followed by U+202E can make a name read as another; both renderers must drop it, and must leave ordinary neighbours (a hair space, a real hyphen) alone. Pinned in Task 9 (`TestCleanStripsBidiControlsAndZeroWidthCharacters`, `bidi controls and zero-width characters are stripped, by the shared cases`). An emoji joined by U+200D loses its joiner and prints as its parts; that is accepted.
5. **A pane too narrow to hold a hint column.** A status line with a long title or a 24 column pane must lose no words and paint no row wider than the pane. (Under 24 columns the wrap column is below `minWrap`, so text is emitted whole and the terminal wraps it; no word is lost.) Pinned in Task 8 (`TestATitleTooWideForAHintColumnTakesItsHintBelow`, `TestAVeryNarrowPaneLosesNoText`).

## API for slices 5b to 5f

Everything another slice may call from 5a, in one place. Nothing else in this plan is public.

### `out.note` (`lib/ui/out.ts`, Task 3)

```ts
export function note(...blocks: Block[]): void;
```

Writes the blocks to **stderr**, styled when stderr is a terminal and plain otherwise. It never moves `humanStream` and never follows `payloadOnStdout()`. Use it for a notice that can fire under any verb. A verb whose stdout is a payload (`cd`, `nav`) does not need it: it calls `out.payloadOnStdout()` and `out.print`.

Plain strings are the plain renderer's, for example:

```
out.note(out.line("warn", "The rt daemon is not running"), out.callout("next", out.cmd("rt daemon start")))
[warning] The rt daemon is not running
  next: rt daemon start
```

### The breadcrumb header (`lib/command-tree.ts`, Task 11; nothing to call)

The dispatcher draws the breadcrumb itself, before the handler runs, with `out.note(out.section("rt › daemon › status", "dev mode" | undefined))`. Slices call nothing; this is what it does around their output:

- It is drawn up front, once per handler run, on **stderr**, only when a person is reading stderr: stderr is a terminal, no `--json` on argv, no `RT_BATCH` (`out.isHuman("stderr")`). It is never on stdout.
- It is always the first thing on screen for the command, whether the verb is converted or not, and whatever the verb paints first (a step on `/dev/tty`, a child given the terminal, an `out.print`).
- No header for a `fullscreen` leaf, and none for a `hidden` leaf: a hidden leaf is run by a program (`git credential` runs under git, at the person's terminal), never typed.
- **Amended during execution (2026-10-01, from the renders):** the dispatcher prints ONE blank line under the header, as it does today, because crumb, section title and first row stacked as three bold rows and read as one heading. The header is still its own render call on stderr. No slice test string changes: no header is drawn with the human gate closed.
- With `out.__test__.setHuman(() => false)`, the way every plain-output test runs, no header is drawn, so **no header ever appears in a test's expected strings**. When the gate passes but the helper is missing, the plain form is one line: `rt › daemon › status` or `rt › daemon › status (dev mode)`.

### `warn` (`lib/ui/warn.ts`, Task 3)

```ts
export type WarningLog = (module: string, message: string, context: Record<string, unknown>) => void;
export interface ShownWarning { title: string; hint?: string; next?: CellInput }
export interface WarnOptions { context?: Record<string, unknown>; show?: ShownWarning }

export function warn(module: string, message: string, opts?: WarnOptions): void;
export function setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void;
export const __test__: { reset(): void };
```

`warn` replaces every `console.warn("rt: ...")` under `lib/`. `message` is today's technical text without the `rt: ` prefix; it always goes to the log. `show`, when given, is what a person reads.

- **In the CLI** (`cli.ts` calls `setWarningLog` once, Task 13): `message` and `context` become one `warn` line in the CLI log through `logCliEvent("warn", module, message, context)`. With `show`, one `warn` line is also printed on stderr through `out.note`, once per process for a given title and hint.
- **In the daemon and in a unit test** (no log set): the line `rt: <message>` is written with `process.stderr.write`, and nothing is shown. The daemon's stderr is already captured into its own log.
- **Under `rt intercept run`** the log is set `quiet`: logged, never shown.

**Testing a converted warning.** A `spyOn(console, "warn")` goes silent once a line moves to `warn`, because the text no longer passes through `console`. 26 test files under `lib`, `commands` and `packages/rt-client` spy that way today; each slice repoints the ones behind its rows, one of two ways:

- With no log set: `const io = captureOut()` (from `lib/ui/__tests__/capture-out.ts`), then expect `rt: <message>\n` in `io.stderr()`.
- To assert the log line or the shown copy: `setWarningLog(fake)` and `out.__test__.setHuman(() => false)`, with `__test__.reset()` from `lib/ui/warn.ts` in both `beforeEach` and `afterEach`. The log and the set of already-shown warnings are module state; `setWarningLog(null)` alone does not clear what was shown, and `__test__.reset()` clears both.

Plain strings of a shown warning:

```
warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: { title: "Your repo folders setting could not be read", hint: "rt is looking in its usual places only", next: out.cmd("rt settings check") } })
[warning] Your repo folders setting could not be read  rt is looking in its usual places only
  next: rt settings check
```

Task 1's warnings table says, for every line, whether it passes `show` and with what copy. The slice that owns the file applies its rows.

### `withTransientStep` (`lib/ui/transient-step.ts`, Task 6)

```ts
export async function withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T>;
```

A spinner drawn by the Go step that leaves no line when the task settles, resolved or thrown. Off a terminal (`interactive()` in `lib/ui/gate.ts`: stdin is not a TTY, or `RT_BATCH`) and when rt-ui cannot start, the task just runs. The caller prints its own result. `lib/tui/inline-spinner.ts` re-exports it as `withInlineSpinner` until 5f repoints `port` and `sdm`; a new caller imports `lib/ui/transient-step.ts`. A file the daemon also loads (`lib/enrich.ts`) may import it.

Under it, `StepHandle` (`lib/ui/spawn.ts`) gains `clear(): Promise<boolean>`, which sends `{ t: "done", title: <the step's label>, clear: true }`. A helper that predates the flag ends the step with a plain done row. A test that builds its own object typed `StepHandle` needs a `clear` member.

### `usageFailure` (`lib/ui/usage.ts`, Task 4)

```ts
export function usageFailure(title: string, usage: string, why?: string): FailureInput;
```

The title is a plain sentence that asks for what is missing; the usage line becomes the `next` command and never sits in the title. A leading `usage:` on `usage` is dropped, so a call site may pass the string its `--json` error already carries. The `--json` branch of a call site does not change.

```ts
if (!json) {
  out.fail(usageFailure("Which tool?", "rt tools install <tool>"));
  process.exit(2);
}
```

Plain strings:

```
Which tool?
  next: rt tools install <tool>
```

and with a `why`:

```
Which branch?
  why: This needs the branch to rebase onto.
  next: rt git rebase onto <branch>
```

### `missingRepoFailure` (`lib/repo.ts`, Task 11)

```ts
export function missingRepoFailure(r: KnownRepo): FailureInput;
```

The failure for a repo whose folder is gone, for `out.fail`. 5c's `commands/cd.ts` and `lib/pickers.ts` call it in place of printing `missingRepoRefusal(r)`. Plain strings:

```
<label> is no longer where rt last saw it
  why: It was at <path>.
  next: rt repos locate <new-path> --repo <identity>
```

### `clearScreen` (`lib/ui/screen.ts`, Task 3)

```ts
export function clearScreen(): void;
```

Clears the terminal on stderr, only when stderr is a TTY. For the code that clears before a picker or prompt; nothing in `commands/` or `lib/` writes the escape itself.

### The plain failure rule (`lib/ui/out-plain.ts`, Task 2)

A `failure` block that is the first thing a plain render prints has no `[failed]` tag: its first line is `<title>` (and `  <hint>` when there is one). Every `out.fail(...)` is such a render. A failure printed after another block in the same call keeps `[failed] `, and so does a leading failure whose cleaned title begins with `[`. A `line` with status `failed` always keeps its tag. A test that pins a human failure off a terminal asserts the title at the start of stderr, never `[failed]`.

### Renderer changes no slice calls (transparent)

- A `line` hint wraps inside its own column; a title too wide for that takes its hint on the rows below (Task 8).
- Wrapped text breaks only at spaces: `--force-with-lease` and `feature/foo-bar` stay whole (Task 7).
- Bidi controls and zero-width characters are dropped by both renderers (Task 9). 5b, 5c and 5e each pin one hostile branch name against their own verb.
- `rt-ui render` paints the diff with pale tints and dark ink when `COLORFGBG` says the background is light, and keeps today's dark tints otherwise. For a light screenshot, render with `COLORFGBG=0;15` in the environment (Task 10).
- Table rules and tree branches use `theme.StaticRule` (Task 10).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ui/out-plain.ts` (modify) | A leading failure prints without its tag; bidi and zero-width characters are stripped |
| `lib/ui/out.ts` (modify) | `note` |
| `lib/ui/warn.ts` (create) | `warn`, `setWarningLog`: one way for `lib/` to warn, logged in the CLI, plain on stderr elsewhere |
| `lib/ui/screen.ts` (create) | `clearScreen`: the one screen clear |
| `lib/ui/usage.ts` (create) | `usageFailure` |
| `lib/ui/transient-step.ts` (create) | `withTransientStep` |
| `lib/tui/inline-spinner.ts` (modify) | A re-export of `withTransientStep` |
| `lib/ui/protocol.ts`, `lib/ui/spawn.ts` (modify) | The `clear` flag on `done` and `StepHandle.clear` |
| `ui/internal/protocol/protocol.go`, `ui/internal/steps/steps.go` (modify) | The `clear` flag decoded and honored |
| `ui/fixtures/steps-stream-clear.json`, `ui/fixtures/clean-cases.json` (create) | Shared fixtures, read by Go and TypeScript tests |
| `ui/internal/textwrap/textwrap.go` (modify) | `Options`, `SpansWith`: the words-only wrap |
| `ui/internal/render/style.go`, `blocks_basic.go`, `blocks_text.go`, `render.go` (modify), `background.go` (create) | `wrapCell` opts in, `lineRun` wraps, `Clean` strips, `Options.Light`, `LightBackground`, the rule tone |
| `ui/internal/theme/theme.go` (modify) | `DiffAddBgLight`, `DiffDelBgLight`, `StaticRule` |
| `ui/cmd/rt-ui/verbs.go` (modify) | `render` reads `COLORFGBG` |
| `lib/command-tree.ts`, `lib/arg-collector.ts` (modify) | Help, usage, unknown command, the terminal guard, `--repo` refusals, the header and the screen clear on the layer |
| `lib/repo.ts`, `lib/daemon-client.ts` (modify) | Repo refusals as failures; `missingRepoFailure`; the daemon-down note |
| `cli.ts` (modify) | The four migration notices and the first-run hint through `out.note`; the warning log wired |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Five lines deleted |
| Tests beside each of the above, and the tests that pin `[failed]` or dispatcher text (Task 2 and Tasks 11 to 13 name them) | |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | The new rules; new renders |

---

### Task 1: Audit of the print sites this slice owns

No code. This is the inventory every later task implements; it stays in the plan.

**Files read:** `cli.ts`, `lib/command-tree.ts`, `lib/arg-collector.ts`, `lib/daemon-client.ts` (lines 189 to 259), `lib/repo.ts`, `lib/repo-index.ts` (`missingRepoRefusal`), `lib/ui/*.ts`, `lib/tui/inline-spinner.ts`, every `console.warn` under `lib/`, `ui/internal/{render,textwrap,steps,theme,protocol}`, `ui/cmd/rt-ui/verbs.go`.

#### Already on rt-ui (confirming the scoping document)

| Surface | Scoping call | Confirmed | What 5a touches |
|---|---|---|---|
| The dispatcher (`lib/command-tree.ts`, `lib/arg-collector.ts`) | partly | Yes. `showPicker` (the subcommand picker) and `collectArgs` (the argument multiselect, select and text prompt) are rt-ui and are not changed. | Help, usage, unknown command, the terminal guard, the `--repo` refusals, the breadcrumb header and the two screen clears |
| `lib/repo.ts` | partly | Yes. Its repo and worktree pickers (`filterableSelect`, `pickWorktreeFromRepo`, `pickFromAllRepos`) are rt-ui and are not changed. | Eleven refusal lines |
| `cli.ts`, `lib/daemon-client.ts` | no | Yes: neither reaches rt-ui today. | Six notices |

#### Print sites

| Site (at `5bc69f231`) | Today | Becomes | Task |
|---|---|---|---|
| `cli.ts:50` | `console.error("  rt: migrated legacy ~/.rt state to ~/.mattstack/rt")` | `out.note(out.line("done", "Moved your rt data to its new folder", RT_DIR_LABEL))` | 13 |
| `cli.ts:52-53` | two `console.error` lines: `rt: WARNING`, state is split, merge by hand | `out.note(line warn "Your rt data is in two folders", callout note ["rt only reads ", strong(RT_DIR_LABEL)], callout fix ["Merge ", strong(LEGACY_RT_LABEL), " into it by hand, then delete ", strong(LEGACY_RT_LABEL)])` | 13 |
| `cli.ts:57` | `rt: moved your plugins from ~/.mattstack/rt/plugins to ~/.mattstack/user/plugins (they now travel with your home repo)` | `out.note(out.line("done", "Moved your plugins so they travel with your home repo", "~/.mattstack/user/plugins"))` | 13 |
| `cli.ts:59` | `rt: WARNING`, plugins exist in both folders | `out.note(line warn "Your plugins are in two folders", callout note ["rt only reads ", strong("~/.mattstack/user/plugins")], callout fix ["Merge ", strong("~/.mattstack/rt/plugins"), " into it by hand, then delete ", strong("~/.mattstack/rt/plugins")])` | 13 |
| `cli.ts:155` | `rt is not set up yet`, open mattstack.app, or run: rt setup install | `out.note(out.line("needs-you", "rt is not set up yet"), out.callout("next", ["Open mattstack.app, or run ", out.cmd("rt setup install")]))` | 13 |
| `lib/command-tree.ts:18` | `import { bold, cyan, dim, reset, yellow } from "./tui.ts"` | removed; `out`, `clearScreen`, `warn` imported | 11 |
| `lib/command-tree.ts:223-226` unknown command | yellow `unknown command: <name>`, dim `available: a, b`, exit 1 | `out.fail({ title: "<crumbs> has no command called <name>", next: cmd("<crumbs> --help"), details: "Commands here: a, b" })`, exit 1 | 11 |
| `lib/command-tree.ts:230-233, 272-275` bare branch off a terminal (`showUsage`, 562-570) | name and description rows on **stderr**, exit 0 | the same blocks as branch `--help`, on **stdout** through `out.print`, exit 0 (spec rule 2) | 11 |
| `lib/command-tree.ts:300-305` terminal guard | yellow `rt <label> requires an interactive terminal`, exit 1 | `out.fail({ title: "rt <label> needs an interactive terminal", why: "It asks questions or draws a screen, so a script or a pipe cannot run it." })`, exit 1 | 11 |
| `lib/command-tree.ts:345-353` `--repo` not found | yellow `"x" matches more than one repo: a, b` or `unknown repo: x`, dim `known: ...`, exit 1 | ambiguous: `out.fail({ title: "More than one repo is called <x>", why: "It could be <a> or <b>. Use the full name of the one you mean." })`; unknown: `out.fail({ title: "rt does not know a repo called <x>", details: "Repos rt knows: a, b" })`; exit 1 | 11 |
| `lib/command-tree.ts:356-359` `--repo` names a missing repo | `missingRepoRefusal(repo)` on stderr, exit 1 | `out.fail(missingRepoFailure(repo))`, exit 1 | 11 |
| `lib/command-tree.ts:493-495` `clearScreen` | `process.stderr.write("\x1b[2J\x1b[H")` when stderr is a TTY | `clearScreen()` from `lib/ui/screen.ts` (guard-only, nothing a person sees changes) | 3, 11 |
| `lib/command-tree.ts:502-512` `renderHeader` | bold cyan `rt`, dim `›`, bold parts, yellow `(dev mode)`, a blank line after; stderr, TTY only | `out.note(out.section("rt › daemon › status", IS_DEV_MODE ? "dev mode" : undefined))`, drawn before the handler runs, as today, on stderr, when a person is reading stderr (a terminal, no `--json`, no `RT_BATCH`). Not for a `fullscreen` leaf, and not for a `hidden` one. Its own render call, so no blank line follows it (rule 8) | 11 |
| `lib/command-tree.ts:541` | dim `rt.picker.hidden could not be read, listing every verb: <err>` | `warn("command-tree", <the same text>, { show: { title: "Your list of hidden commands could not be read", hint: "every command is listed", next: cmd("rt settings check") } })` | 11 |
| `lib/command-tree.ts:577-647` `--help` (`helpColors`, `printCommandListing`, `printBranchHelp`, `printLeafHelp`) | `usage:` line, description, rows, hand-colored, stdout | `out.print(kv usage, paragraph description, kv aliases, section "Arguments" (table), section "Commands" (table))`, stdout | 11 |
| `lib/arg-collector.ts:58` | `process.stderr.write("\x1b[2J\x1b[H")`, not gated on a TTY | `clearScreen()` (guard-only; it only ever ran at a terminal) | 11 |
| `lib/daemon-client.ts:246-248` `warnDaemonDown` | yellow glyph, `rt daemon is installed but not running. Run: rt daemon start`, stderr, once per process | `out.note(out.line("warn", "The rt daemon is not running"), out.callout("next", out.cmd("rt daemon start")))`, once per process, still silenced by `suppressDaemonDownWarning` | 12 |
| `lib/repo.ts:202, 269, 446` | `console.log("could not identify repo")` on **stdout**, exit 1 | `out.fail({ title: "rt could not tell which repo this is", why: "The folder it ended up in is not a git repo it can read." })` on stderr, exit 1 | 12 |
| `lib/repo.ts:211` `refuseIfMissing` | `missingRepoRefusal(repo)` on stderr, exit 1 | `out.fail(missingRepoFailure(repo))`, exit 1 | 12 |
| `lib/repo.ts:239-240, 285-286` | two `console.log` lines on stdout: not in a git repo and no known repos found; run rt from inside a git repo first to register it; exit 1 | `out.fail({ title: "You are not in a git repo, and rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" })`, exit 1 | 12 |
| `lib/repo.ts:249, 298` | `console.log` on stdout: not in a git repo, run interactively to pick one; exit 1 | `out.fail({ title: "You are not in a git repo", why: "rt knows more than one repo and cannot ask which one you mean without a terminal.", next: "Run this from inside the repo you mean" })`, exit 1 | 12 |
| `lib/repo.ts:386` | `console.log`: no known repos, run rt from inside a git repo first; exit 1 | `out.fail({ title: "rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" })`, exit 1 | 12 |
| `lib/repo.ts:323` `console.clear()` | clears stdout between two pickers | unchanged: the guard does not flag it and it prints nothing | none |
| `lib/tui/inline-spinner.ts` | a `\r` braille spinner on stderr with `cyan`, `dim`, `reset` | a re-export of `withTransientStep` | 6 |

Every verb named in a `next` above exists in `lib/command-tree-def.ts`: `rt setup install`, `rt daemon start`, `rt settings check`, `rt settings get`, `rt repos locate`, `rt daemon logs`.

Counts against the scoping document: `cli.ts` 6 guard lines (5 notices, one of them two lines), `lib/command-tree.ts` 26, `lib/arg-collector.ts` 1, `lib/daemon-client.ts` 2, `lib/repo.ts` 11. Visible sites 40, guard-only 4 (the import line, the two screen clears, `helpColors`).

#### Tests that pin `[failed] <title>` as a first line (Task 2 updates each)

| File | Lines at `5bc69f231` |
|---|---|
| `lib/ui/__tests__/out-plain.test.ts` | 83, 130 |
| `lib/ui/__tests__/out.test.ts` | 137, 206 |
| `lib/__tests__/errors.test.ts` | 106, 126, 132, 135, 152, 197, 202, 210 |
| `commands/__tests__/team-join.test.ts` | 160, 393 |
| `commands/__tests__/team.test.ts` | 133, 388 |
| `commands/__tests__/release-update-machine.test.ts` | 162 |
| `commands/__tests__/release-apps.test.ts` | 79 |
| `commands/__tests__/deps.test.ts` | 127 |
| `commands/__tests__/repos-reidentify.test.ts` | 112, 125 |
| `e2e/tests/errors.test.ts` | 44, 56, 63 |

`lib/ui/__tests__/out-plain.test.ts:20` (ten `line` blocks) and `e2e/tests/errors.test.ts:71` (`not.toContain("[failed]")`) stay as they are. Phases 3 and 4 add more such pins, and either order of merging breaks someone: if they land first, this slice fixes their pins when it rebases (Task 2 Step 6 and Task 15 Step 1 run the grep); if this slice lands first, their `[failed] <title>` first-line pins fail on their own rebase, and the fix is the same grep, `grep -rn "\[failed\] " lib commands e2e --include='*.test.ts'`, dropping the tag wherever a failure is the first thing printed. Task 15 Step 5 tells the shepherd so.

#### Tests that assert dispatcher text (Tasks 11 to 13 update each)

| File | What it asserts today | Task |
|---|---|---|
| `lib/__tests__/command-tree-help.test.ts` | help through a `console.log` spy | 11 |
| `lib/__tests__/command-tree-program-verbs.test.ts` | the same spy, lines 46 to 91 | 11 |
| `lib/__tests__/command-tree.test.ts` | lines 348 and 396: a `console.error` spy; line 409 `rt repos locate` | 11 |
| `e2e/tests/smoke.test.ts` | `listedVerbs` reads rows that start with two spaces; `rt git` usage on stderr; `unknown command` | 11 |
| `e2e/tests/glitter.test.ts:11` | `rt glitter requires an interactive terminal` | 11 |
| `lib/__tests__/repo-index-missing.test.ts:127-140` | `pickWorktree still refuses when the only row is a missing one`: a `console.error` spy and `rt repos locate`. The path is `pickWorktree` to `refuseIfMissing`. The sibling test at line 150 (`pickFromAllRepos`, `lib/pickers.ts`) is 5c's | 12 |
| `e2e/tests/first-run.test.ts` | `rt is not set up yet`, `rt setup` (both still true) | 13 |
| `lib/endpoint/__tests__/intercept-run.test.ts:168-170` | no `WARNING`, no `migrated legacy` on the intercept path | 13 |
| `e2e/pty/errors.test.ts` | the failure glyph and titles through a pty; needs no edit, must still pass | 14 |

Nothing under `plugins/mattstack`, `skills/` or `apps/board/skills` reads any dispatcher string (searched for `unknown command`, `requires an interactive terminal`, `could not identify repo`, `not in a git repo`, `is not set up yet`, `installed but not running`, `available:`): the hits there are daemon replies and other tools' text.

#### The warnings table (ruling 2)

Every `console.warn` under `lib/` at `5bc69f231` (42 lines), plus the three raw warn lines of the same kind that use `console.error`. Today's text is quoted with `<...>` for interpolated values; where today's text has a long dash, this table writes `--`. "Log only" means `warn(module, message, { context })`. "Show" means the same call with `show`, and the person reads the copy in the last column: title, then hint, then the `next` command. The log `message` is always today's text without the `rt: ` prefix.

5a builds `warn` (Task 3). The owning slice applies its rows; phase 6 applies the rows marked P6. Matt: skim the Decision column and flip any row.

| # | File:line | Owner | Today's text | Decision | Reason | Shown copy |
|---|---|---|---|---|---|---|
| 1 | `lib/run-history.ts:68` | P6 | `rt: legacy run history <path> could not be read, leaving in place: <err>` | Log only | one-time import that retries on the next read | |
| 2 | `lib/run-history.ts:82` | P6 | `rt: legacy run history <path> had no parseable entries, leaving in place` | Log only | nothing the person can do about an old file | |
| 3 | `lib/run-history.ts:91` | P6 | `rt: imported legacy run history <path> but the write did not land (db busy?) -- leaving it in place to retry on the next read` | Log only | it retries by itself | |
| 4 | `lib/run-history.ts:98` | P6 | `rt: imported legacy run history <path> but could not rename it to .migrated: <err>` | Log only | a leftover file that harms nothing | |
| 5 | `lib/run-history.ts:126` | P6 | `rt: failed to record run history for <repo>: <err>` | Log only | the run itself worked; only its history row is lost | |
| 6 | `lib/repo-index.ts:122` | 5e | `rt: legacy state file <path> is corrupt JSON, leaving in place: <err>` | Log only | a legacy file read once at migration | |
| 7 | `lib/repo-index.ts:572` | 5e | `rt: <from>'s worktree registry did not persist under <to> -- leaving it in place` | Log only | the re-key retries on the next run | |
| 8 | `lib/repo-index.ts:576` | 5e | `rt: could not move <from>'s worktree registry to <to> (<err>)` | Log only | the same re-key | |
| 9 | `lib/repo-index.ts:660` | 5e | `rt: could not read <from>'s data dir (<err>)` | Log only | migration bookkeeping | |
| 10 | `lib/repo-index.ts:687` | 5e | `rt: could not migrate <from>'s data to <to> (<err>)` | Log only | migration bookkeeping | |
| 11 | `lib/repo-index.ts:736` | 5e | `rt: <repo>'s worktree registry is corrupt JSON, leaving it in place` | Log only | fires while pruning a repo that is already gone | |
| 12 | `lib/repo-index.ts:825` | 5e | `rt: rt.repoRoots could not be resolved (<err>) -- scanning inferred roots only` | Show | a setting the person wrote is being ignored | `Your repo folders setting could not be read` / `rt is looking in its usual places only` / `rt settings check` |
| 13 | `lib/repo-index.ts:836` | 5e | `rt: skipping non-string rt.repoRoots entry: <json>` | Show | the person can fix the entry | `A repo folder in your settings is not a path` / `<json> was skipped` / `rt settings get rt.repoRoots` |
| 14 | `lib/repo-index.ts:841` | 5e | `rt: skipping rt.repoRoots entry "<entry>" -- path does not exist (<expanded>)` | Show | the person can fix or remove the entry | `A repo folder in your settings does not exist` / `<entry> was skipped` / `rt settings get rt.repoRoots` |
| 15 | `lib/repo-tracking.ts:145` | 5e | `rt: mattstack.tracking could not be resolved (<err>) -- team tracking intent contributes nothing` | Show | repos the team tracks silently stop being tracked | `The team's repo tracking setting could not be read` / `only your own tracking applies` / `rt settings check` |
| 16 | `lib/repo-tracking.ts:173` | 5e | `rt: rt.repoTracking could not be resolved (<err>) -- tracking nothing` | Show | nothing is tracked until it is fixed | `Your repo tracking setting could not be read` / `no repo is tracked until it is fixed` / `rt settings check` |
| 17 | `lib/repo-tracking.ts:187` | 5e | `rt: rt.repoTracking holds a versioned {version, repos} envelope -- store the repos map, not the versioned envelope (e.g. ...); using the inner repos map for now.` | Show | the person stored the wrong shape and can fix it | `Your repo tracking setting is in an old shape` / `rt is reading the repos inside it for now` / `rt settings get rt.repoTracking` |
| 18 | `lib/repo-tracking.ts:367` | 5e | `rt: could not re-key rt.repoTracking/<name> to an identity -- leaving it in place` | Log only | identity migration bookkeeping | |
| 19 | `lib/repo-tracking.ts:372` | 5e | `rt: rt.repoTracking/<identity> already exists; leaving legacy <name> in place` | Log only | identity migration bookkeeping | |
| 20 | `lib/repo-tracking.ts:397` | 5e | `rt: rt.repoTracking re-key of <name> → <identity> did not persist -- leaving it` | Log only | it retries on the next run | |
| 21 | `lib/worktree/config.ts:135` | 5c | `rt: ignoring "<key>" for repo "<repo>" -- <err>` | Show | a setting the person wrote is being ignored | `A worktree setting for <repo label> is being ignored` / `<first line of err>` / `rt settings check` |
| 22 | `lib/worktree/config.ts:252` | 5c | `rt: ignoring "<key>" for repo "<repo>" -- <err>` | Show | the same | the same as row 21 |
| 23 | `lib/worktree/config.ts:473` | 5c | `rt: ignoring "<key>": <err>` | Show | the same | `A worktree app setting is being ignored` / `<first line of err>` / `rt settings check` |
| 24 | `lib/state/legacy-import.ts:54` | P6 | `rt: legacy state file <path> is corrupt JSON, leaving in place: <err>` | Log only | one-time import | |
| 25 | `lib/state/legacy-import.ts:88` | P6 | `rt: imported legacy state file <path> but the write did not land (db busy?) -- leaving it in place to retry on the next read` | Log only | it retries by itself | |
| 26 | `lib/state/legacy-import.ts:95` | P6 | `rt: imported legacy state file <path> but could not rename it to .migrated: <err>` | Log only | a leftover file that harms nothing | |
| 27 | `lib/state/identity-migrate.ts:56` | P6 | `rt: could not re-key <ns>/<key> to an identity -- leaving it in place` | Log only | identity migration bookkeeping, mostly in the daemon | |
| 28 | `lib/state/identity-migrate.ts:61` | P6 | `rt: <ns>/<identity> already exists; leaving legacy <key> in place` | Log only | the same | |
| 29 | `lib/state/identity-migrate.ts:67` | P6 | `rt: <ns>/<identity> did not persist; leaving legacy <key> in place` | Log only | the same | |
| 30 | `lib/state/identity-migrate.ts:100` | P6 | `rt: could not re-key <table>.<col>=<k> to an identity -- leaving it` | Log only | the same | |
| 31 | `lib/state/identity-migrate.ts:114` | P6 | `rt: <table>.<col>=<k> (rowid <id>) collided with an existing <identity> row -- dropped the stale legacy duplicate` | Log only | the same | |
| 32 | `lib/state/identity-migrate.ts:125` | P6 | `rt: <table>.<col> re-key to <identity> did not fully persist -- leaving remaining <k> rows` | Log only | the same | |
| 33 | `lib/state/db.ts:534` | P6 | `rt: state db <path> could not be opened (corrupt), quarantining to <quarantined> and recreating empty` | Show | saved state was lost; the person should hear it once | `rt's saved state was damaged and has been reset` / `the damaged file was kept beside it` / `rt daemon logs` |
| 34 | `lib/state/db.ts:582` | P6 | `rt: legacy state file <path> is corrupt JSON, skipping import: <err>` | Log only | one-time import | |
| 35 | `lib/state/db.ts:592` | P6 | `rt: legacy import failed for <path>, skipping (file will still be renamed): <err>` | Log only | one-time import | |
| 36 | `lib/state/db.ts:667` | P6 | `rt: imported legacy state file <path> but could not rename it to .migrated: <err>` | Log only | a leftover file that harms nothing | |
| 37 | `lib/state/branch-cache.ts:93` | P6 | `rt: branch_cache key <branch> collided with an existing <want> row; dropped the stale duplicate` | Log only | a cache repairing itself | |
| 38 | `lib/state/branch-cache.ts:99` | P6 | `rt: branch_cache key repair <branch> -> <want> did not persist, leaving it` | Log only | a cache repair that retries | |
| 39 | `lib/endpoint/config.ts:235` | P6 | `rt: ignoring "<key>" for repo "<repo>" -- <err>` | Show | a setting the person wrote is being ignored | `An endpoint setting for <repo label> is being ignored` / `<first line of err>` / `rt settings check` |
| 40 | `lib/sdm/enrichment.ts:51` | 5f | `rt: ignoring "<key>" -- <err>` | Show | a setting the person wrote is being ignored | `Your sdm enrichment setting is being ignored` / `<first line of err>` / `rt settings check` |
| 41 | `lib/sdm/enrichment.ts:65` | 5f | `rt: failed to parse <path>, ignoring enrichment file: <err>` | Show | a file the person wrote is being ignored | `Your sdm enrichment file could not be read` / `rt is ignoring it` / no next; the path is in the log |
| 42 | `lib/chat-viewer-url.ts:24` | 5f | `chat.viewerUrl could not be read, posting without a link: <err>` | Log only | the post still goes out, and the caller is usually an agent | |
| 43 | `lib/skills/sources.ts:71` (`console.error`) | 5d | `rt: skipping plugin "<name>" -- installPath does not exist: <path>` | Show | it explains why that plugin's skills are missing | `Skipped the <name> plugin` / `its folder is gone` / no next |
| 44 | `lib/plugins.ts:287` (the default `warn` sink, `  [rt] <msg>`) | 5d | every plugin load warning (a name collision, a bad manifest) | Show | the person wrote the plugin and can fix it | 5d writes one title per message at the sink's call sites |
| 45 | `lib/plugin-api.ts:65` (`console.error`) | 5d | `  [rt] could not refresh plugin-api types: <err>` | Log only | editor types only; the plugin still runs | |

Module names for the log: `run-history`, `repo-index`, `repo-tracking`, `worktree-config`, `state`, `endpoint`, `sdm`, `chat`, `skills`, `plugins`.

Not in the table, on purpose: the three default sinks in `lib/team/invite.ts:139`, `join.ts:292` and `members.ts:179` (5e: each takes a caller's sink, and ruling 12 governs what `join.ts` does with a `UserActionableError`); `lib/herdr-launch.ts` (5c: human output, not a warning); the debug traces in `lib/home/age-key.ts:295` (5e) and `lib/secrets/store.ts:503` (P6); the `git lfs prune warning: <stderr>` line at `lib/state/backup-orchestrator.ts:237` (a `console.error`, P6: a state backup detail, log only when phase 6 reaches it); the default `warn` sink at `lib/setup/finish-gate.ts:19` (phase 3's file and phase 3's call); `lib/daemon-client.ts` and `lib/command-tree.ts:541`, which this plan converts itself.

---

### Task 2: A plain failure that opens the output leads with its title

**Files:**
- Modify: `lib/ui/out-plain.ts:120-125`
- Modify: `lib/ui/__tests__/out-plain.test.ts`
- Modify: the tests in Task 1's `[failed]` table

**Interfaces:**
- Consumes: `renderPlain(blocks: Block[]): string` (`lib/ui/out-plain.ts`, phase 1).
- Produces: the plain failure rule in "API for slices 5b to 5f". No signature changes.

- [ ] **Step 1: Write the failing tests**

In `lib/ui/__tests__/out-plain.test.ts`, replace the test `a failure prints why, next and details` (line 80) with:

```ts
test("a failure that opens the output leads with its title alone", () => {
  expect(
    renderPlain([{ t: "failure", title: "This Mac cannot read the team's secrets yet", why: "No key matches.", next: [{ text: "rt setup status", role: "command" }], details: "details are in the log" }]),
  ).toBe("This Mac cannot read the team's secrets yet\n  why: No key matches.\n  next: rt setup status\n  details are in the log\n");
  expect(renderPlain([{ t: "failure", title: "rt hit an unexpected error", hint: "kaboom" }])).toBe("rt hit an unexpected error  kaboom\n");
});

test("a failure after another block keeps its tag", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "Fetched" }, { t: "failure", title: "The rebase stopped" }])).toBe("[ok] Fetched\n[failed] The rebase stopped\n");
  expect(renderPlain([{ t: "section", title: "Checks", blocks: [{ t: "failure", title: "Lint failed" }] }])).toBe("Checks\n[failed] Lint failed\n");
});

test("a block that prints nothing does not count as coming first", () => {
  expect(renderPlain([{ t: "table", rows: [] }, { t: "failure", title: "Nothing to list" }])).toBe("Nothing to list\n");
});

test("a leading failure whose title opens with a bracket keeps the tag", () => {
  expect(renderPlain([{ t: "failure", title: "[ok] Setup complete" }])).toBe("[failed] [ok] Setup complete\n");
  expect(renderPlain([{ t: "failure", title: "\x1b[2J[ok] forged" }])).toBe("[failed] [ok] forged\n");
  expect(renderPlain([{ t: "failure", title: " [ok] Setup complete" }])).toBe("[failed]  [ok] Setup complete\n");
  expect(renderPlain([{ t: "failure", title: "\t[ok] Setup complete" }])).toBe("[failed]  [ok] Setup complete\n");
});

test("a failed line keeps its tag even when it comes first", () => {
  expect(renderPlain([{ t: "line", status: "failed", title: "pre-push" }])).toBe("[failed] pre-push\n");
});
```

In the test `line-oriented fields keep their lines, each inside the block prefix` (line 128), change the failure expectation from `"[failed] t\n  one\n  two\n"` to `"t\n  one\n  two\n"`.

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: FAIL. The first new test receives `[failed] This Mac cannot read the team's secrets yet...`; the empty-table test receives `[failed] Nothing to list`.

- [ ] **Step 3: Change the plain renderer**

In `lib/ui/out-plain.ts`, replace the `failure` case (lines 120 to 125):

```ts
      case "failure":
        out.push(`${TAG.failed} ${one(b.title)}${b.hint ? `  ${one(b.hint)}` : ""}`);
        if (b.why) out.push(`  why: ${one(b.why)}`);
        if (b.next) out.push(`  next: ${cellText(b.next)}`);
        if (b.details) out.push(...lines(b.details, "  "));
        break;
```

with:

```ts
      case "failure": {
        // The tray shows a person the first bytes of stderr as they are, so
        // a failure that opens the output leads with its title alone. A
        // title that opens with a bracket, leading spaces aside, keeps the
        // tag: text from an error must not pose as another status.
        const title = one(b.title);
        const bare = out.length === 0 && !title.trimStart().startsWith("[");
        out.push(`${bare ? "" : `${TAG.failed} `}${title}${b.hint ? `  ${one(b.hint)}` : ""}`);
        if (b.why) out.push(`  why: ${one(b.why)}`);
        if (b.next) out.push(`  next: ${cellText(b.next)}`);
        if (b.details) out.push(...lines(b.details, "  "));
        break;
      }
```

`out` here is the `string[]` the `render` function fills, not the output module.

- [ ] **Step 4: Run the renderer tests**

Run: `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

- [ ] **Step 5: Update every test that pins the tag on a leading failure**

Each edit below removes the nine characters `[failed] ` (the tag and its space) from an expected string. Where the old assertion was a `toContain`, a second line asserts the tag is gone, so the test still says something about the first line. The two marked "special" asserted only the tag, so each also gets a line that fails on an empty stderr.

- `lib/ui/__tests__/out.test.ts:137`: `"This Mac cannot read the team's secrets yet\n  why: No key matches.\n"`.
- `lib/ui/__tests__/out.test.ts:206`: `["rt hit an unexpected error  kaboom\nstack:\n  Error: kaboom\n      at run (boom.ts:1:7)\n"]`.
- `lib/__tests__/errors.test.ts:106` and `:152`: the first line of each four-line expectation becomes `"This Mac cannot read the acme team's secrets yet\n" +`.
- `lib/__tests__/errors.test.ts:126`: `"usage: rt tools install <tool> [--json]\n"`.
- `lib/__tests__/errors.test.ts:132`: `"first line second line\n"`.
- `lib/__tests__/errors.test.ts:135`: `const UNEXPECTED_HEAD = "rt hit an unexpected error  kaboom\n  next: rt daemon logs\n";`.
- `lib/__tests__/errors.test.ts:197`: `"rt hit an unexpected error  boom\n  next: rt daemon logs\nstack:\n  boom\n"`.
- `lib/__tests__/errors.test.ts:202`: `"rt hit an unexpected error  sops -d /x/rt.json: Failed to get the data key required to decrypt the SOPS file."`.
- `lib/__tests__/errors.test.ts:210`: `toContain("rt hit an unexpected error  evilname")`.
- `commands/__tests__/team-join.test.ts:160`: `toContain("pass the invite code on stdin, never as an argument")`.
- `commands/__tests__/team-join.test.ts:393` (special): replace `expect(io.stderr()).toStartWith("[failed] ");` with the two lines `expect(io.stderr()).not.toContain("[failed]");` and `expect(io.stderr().split("\n")[0]!.length).toBeGreaterThan(0);` (a title is on the first line; the `keychain` assertion under it stays).
- `commands/__tests__/team.test.ts:133` and `:388`: `toContain("usage:")`, and add under each `expect(io.stderr()).not.toContain("[failed]");`.
- `commands/__tests__/release-update-machine.test.ts:162`: `toContain("refuses to run state-changing legs on a non-interactive terminal without --yes")`, and add under it `expect(stderr).not.toContain("[failed]");`.
- `commands/__tests__/release-apps.test.ts:79`: `toContain("usage: rt release apps [--dry-run]")`, and add under it `expect(h.stderr).not.toContain("[failed]");`.
- `commands/__tests__/deps.test.ts:127` (special): replace `expect(stderr).toContain("[failed] ");` with the two lines `expect(stderr).not.toContain("[failed]");` and `expect(stderr.split("\n")[0]!.length).toBeGreaterThan(0);` (a title is on the first line; the `exists and is not a mattstack-managed link` assertion under it stays).
- `commands/__tests__/repos-reidentify.test.ts:112`: `toContain("refused")`, and add under it `expect(io.stderr()).not.toContain("[failed]");`.
- `commands/__tests__/repos-reidentify.test.ts:125`: `toContain("reidentify takes two identities, got 1; usage: rt repos reidentify")`, and add under it `expect(io.stderr()).not.toContain("[failed]");`.
- `e2e/tests/errors.test.ts:44`: `toContain("rt hit an unexpected error  kaboom from the seam test\n  next: rt daemon logs\nstack:\n  Error: kaboom from the seam test\n")`, and add under it `expect(result.stderr).not.toContain("[failed]");`.
- `e2e/tests/errors.test.ts:56`: `toContain("rt hit an unexpected error")`.
- `e2e/tests/errors.test.ts:63`: `toContain("reidentify takes two identities, got 1; usage: rt repos reidentify")`, and add under it `expect(result.stderr).not.toContain("[failed]");`.

Those strings still carry `usage:` in a title. That is each owning slice's to fix with `usageFailure`; this task changes the tag only.

- [ ] **Step 6: Find any pin this list missed**

Run: `grep -rn "\[failed\] " lib commands e2e --include='*.test.ts'` (the quotes matter: zsh refuses an unquoted `*`)
Expected: `lib/ui/__tests__/out-plain.test.ts` (the `every status has a word` line and the tests added in Step 1 that expect the tag) and `lib/ci/__tests__/watch.test.ts:291`, which is an array literal `[failed]` and not a pin. Any other hit where a failure is the first block printed gets the same edit. Phases 3 and 4 add such tests; Task 15 repeats this grep after the rebase.

- [ ] **Step 7: Run the affected suites**

Run: `bun test lib/ui/__tests__ lib/__tests__/errors.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team.test.ts commands/__tests__/release-update-machine.test.ts commands/__tests__/release-apps.test.ts commands/__tests__/deps.test.ts commands/__tests__/repos-reidentify.test.ts`
Expected: PASS.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/errors.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ui/out-plain.ts lib/ui/__tests__/out-plain.test.ts lib/ui/__tests__/out.test.ts lib/__tests__/errors.test.ts commands/__tests__/team-join.test.ts commands/__tests__/team.test.ts commands/__tests__/release-update-machine.test.ts commands/__tests__/release-apps.test.ts commands/__tests__/deps.test.ts commands/__tests__/repos-reidentify.test.ts e2e/tests/errors.test.ts
```

```bash
git commit -m "lib/ui: a plain failure that opens the output leads with its title

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `out.note`, `warn` and `clearScreen`

**Files:**
- Modify: `lib/ui/out.ts`
- Create: `lib/ui/warn.ts`, `lib/ui/screen.ts`
- Modify: `lib/ui/__tests__/out.test.ts`
- Create: `lib/ui/__tests__/warn.test.ts`, `lib/ui/__tests__/screen.test.ts`

**Interfaces:**
- Consumes: `emit(blocks, stream)`, `line`, `callout`, `CellInput` (`lib/ui/out.ts`); `captureOut()` (`lib/ui/__tests__/capture-out.ts`, phase 2: it returns `{ stdout(), stderr(), lines(), errLines(), reset(), restore() }` and does not close the human gate).
- Produces:
  - `lib/ui/out.ts`: `export function note(...blocks: Block[]): void`.
  - `lib/ui/warn.ts`: `WarningLog`, `ShownWarning`, `WarnOptions`, `warn(module, message, opts?)`, `setWarningLog(log, opts?)`, `__test__.reset()`, exactly as in "API for slices 5b to 5f".
  - `lib/ui/screen.ts`: `export function clearScreen(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ui/__tests__/out.test.ts`:

```ts
test("note writes to stderr and never follows payloadOnStdout", () => {
  out.__test__.setHuman(() => false);
  out.note(out.line("warn", "The rt daemon is not running"), out.callout("next", out.cmd("rt daemon start")));
  out.print(out.line("done", "Listed"));
  expect(stderr.join("")).toBe("[warning] The rt daemon is not running\n  next: rt daemon start\n");
  expect(stdout.join("")).toBe("[ok] Listed\n");
});

test("note is styled when stderr is a terminal, whatever stdout is", () => {
  out.__test__.setHuman((stream) => stream === "stderr");
  out.note(out.line("warn", "x"));
  expect(stderr.join("")).toBe("STYLED\n");
  expect(stdout.join("")).toBe("");
  const [, ...lines] = sent();
  expect(lines.map((l) => l.t)).toEqual(["hello", "line"]);
});

test("note with no blocks writes nothing", () => {
  out.note();
  expect(stderr.join("")).toBe("");
  expect(existsSync(record)).toBe(false);
});
```

Create `lib/ui/__tests__/warn.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import * as out from "../out.ts";
import { captureOut } from "./capture-out.ts";
import { warn, setWarningLog, __test__, type WarningLog } from "../warn.ts";

let io: ReturnType<typeof captureOut>;
let logged: Array<{ module: string; message: string; context: Record<string, unknown> }>;
const log: WarningLog = (module, message, context) => {
  logged.push({ module, message, context });
};

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  logged = [];
  __test__.reset();
});
afterEach(() => {
  __test__.reset();
  io.restore();
});

const shown = { title: "Your repo folders setting could not be read", hint: "rt is looking in its usual places only", next: out.cmd("rt settings check") };

test("with no log set, a warning is one rt: line on stderr and nothing is shown", () => {
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(io.stderr()).toBe("rt: rt.repoRoots could not be resolved (boom)\n");
  expect(io.stdout()).toBe("");
});

test("a log-only warning reaches the log and prints nothing", () => {
  setWarningLog(log);
  warn("state", "legacy state file /x/repos.json is corrupt JSON, leaving in place", { context: { path: "/x/repos.json" } });
  expect(logged).toEqual([{ module: "state", message: "legacy state file /x/repos.json is corrupt JSON, leaving in place", context: { path: "/x/repos.json" } }]);
  expect(io.stderr()).toBe("");
  expect(io.stdout()).toBe("");
});

test("a shown warning is logged, then printed once on stderr", () => {
  setWarningLog(log);
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(logged).toHaveLength(2);
  expect(logged[0]!.context).toEqual({});
  expect(io.stderr()).toBe("[warning] Your repo folders setting could not be read  rt is looking in its usual places only\n  next: rt settings check\n");
  expect(io.stdout()).toBe("");
});

test("two warnings with different hints both print", () => {
  setWarningLog(log);
  warn("repo-index", "a", { show: { title: "A repo folder in your settings does not exist", hint: "~/one was skipped" } });
  warn("repo-index", "b", { show: { title: "A repo folder in your settings does not exist", hint: "~/two was skipped" } });
  expect(io.errLines()).toEqual(["[warning] A repo folder in your settings does not exist  ~/one was skipped", "[warning] A repo folder in your settings does not exist  ~/two was skipped"]);
});

test("a quiet log records the warning and never shows it", () => {
  setWarningLog(log, { quiet: true });
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(logged).toHaveLength(1);
  expect(io.stderr()).toBe("");
});

test("a log that throws never breaks the caller", () => {
  setWarningLog(() => {
    throw new Error("disk full");
  });
  expect(() => warn("state", "x")).not.toThrow();
});
```

Create `lib/ui/__tests__/screen.test.ts`:

```ts
import { test, expect } from "bun:test";
import { captureOut } from "./capture-out.ts";
import { clearScreen } from "../screen.ts";

function withStderrTTY(value: boolean, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
  try {
    fn();
  } finally {
    if (descriptor) Object.defineProperty(process.stderr, "isTTY", descriptor);
    else delete (process.stderr as { isTTY?: boolean }).isTTY;
  }
}

test("clearScreen clears through stderr at a terminal", () => {
  const io = captureOut();
  try {
    withStderrTTY(true, () => clearScreen());
    expect(io.stderr()).toBe("\x1b[2J\x1b[H");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});

test("clearScreen writes nothing to a pipe", () => {
  const io = captureOut();
  try {
    withStderrTTY(false, () => clearScreen());
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/ui/__tests__/out.test.ts lib/ui/__tests__/warn.test.ts lib/ui/__tests__/screen.test.ts`
Expected: FAIL. `out.note is not a function`; the two new files cannot find `../warn.ts` and `../screen.ts`.

- [ ] **Step 3: Add `note` to `lib/ui/out.ts`**

After the `fail` function, add:

```ts
/**
 * Blocks for a person on stderr, whatever the verb. A notice that fires
 * before the verb is known, or under any verb, cannot use stdout: another
 * program may be reading it. It does not follow payloadOnStdout.
 */
export function note(...blocks: Block[]): void {
  emit(blocks, "stderr");
}
```

- [ ] **Step 4: Create `lib/ui/warn.ts`**

```ts
/**
 * The one way code under lib/ warns. The message always reaches a log; a
 * person sees a line only when the caller says what they should read.
 *
 * This module is loaded by the daemon too, which has its own log surface and
 * nobody watching its stderr. So the CLI entry sets the log; with none set a
 * warning is the plain stderr line it has always been, which the daemon's
 * stderr capture files where it belongs.
 */
import { callout, line, note, type CellInput } from "./out.ts";

export type WarningLog = (module: string, message: string, context: Record<string, unknown>) => void;

export interface ShownWarning {
  title: string;
  hint?: string;
  /** The command that looks into it. */
  next?: CellInput;
}

export interface WarnOptions {
  /** Structured detail for the log line: a path, a key, an error. */
  context?: Record<string, unknown>;
  /** What a person reads. Omit it and the warning is log only. */
  show?: ShownWarning;
}

let log: WarningLog | null = null;
let quiet = false;
const shown = new Set<string>();

/** quiet: logged, never shown. For a process whose stderr belongs to another program. */
export function setWarningLog(next: WarningLog | null, opts: { quiet?: boolean } = {}): void {
  log = next;
  quiet = opts.quiet ?? false;
}

export function warn(module: string, message: string, opts: WarnOptions = {}): void {
  if (!log) {
    process.stderr.write(`rt: ${message}\n`);
    return;
  }
  try {
    log(module, message, opts.context ?? {});
  } catch {
    /* a warning must never break the command that raised it */
  }
  if (!opts.show || quiet) return;
  // Code on a hot path warns on every call; a person needs it once.
  const key = `${opts.show.title}\n${opts.show.hint ?? ""}`;
  if (shown.has(key)) return;
  shown.add(key);
  note(line("warn", opts.show.title, opts.show.hint), ...(opts.show.next === undefined ? [] : [callout("next", opts.show.next)]));
}

export const __test__ = {
  reset(): void {
    log = null;
    quiet = false;
    shown.clear();
  },
};
```

- [ ] **Step 5: Create `lib/ui/screen.ts`**

```ts
/**
 * Screen control belongs to a terminal, never a pipe: unguarded, the clear
 * lands in logs and erases what a failing command already wrote.
 */
export function clearScreen(): void {
  if (process.stderr.isTTY) process.stderr.write("\x1b[2J\x1b[H");
}
```

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/ui/__tests__ lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. The guard exempts `lib/ui/`, so the new files need no allowlist line.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/out.ts lib/ui/warn.ts lib/ui/screen.ts lib/ui/__tests__/out.test.ts lib/ui/__tests__/warn.test.ts lib/ui/__tests__/screen.test.ts
```

```bash
git commit -m "lib/ui: a stderr note, one way for lib to warn, and the screen clear

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `usageFailure`

**Files:**
- Create: `lib/ui/usage.ts`
- Create: `lib/ui/__tests__/usage.test.ts`

**Interfaces:**
- Consumes: `cmd`, `fail`, `FailureInput` (`lib/ui/out.ts`); the plain failure rule (Task 2).
- Produces: `export function usageFailure(title: string, usage: string, why?: string): FailureInput`.

- [ ] **Step 1: Write the failing test**

Create `lib/ui/__tests__/usage.test.ts`:

```ts
import { test, expect } from "bun:test";
import * as out from "../out.ts";
import { captureOut } from "./capture-out.ts";
import { usageFailure } from "../usage.ts";

test("the usage line is the next command, never part of the title", () => {
  expect(usageFailure("Which tool?", "rt tools install <tool>")).toEqual({ title: "Which tool?", next: { text: "rt tools install <tool>", role: "command" } });
});

test("a why rides along", () => {
  expect(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto.")).toEqual({
    title: "Which branch?",
    why: "This needs the branch to rebase onto.",
    next: { text: "rt git rebase onto <branch>", role: "command" },
  });
});

test("a leading usage: is dropped, so the --json string can be passed as it is", () => {
  expect(usageFailure("Which tool?", "usage: rt tools install <tool> [--json]").next).toEqual({ text: "rt tools install <tool> [--json]", role: "command" });
  expect(usageFailure("Which tool?", "  Usage:   rt tools install <tool>").next).toEqual({ text: "rt tools install <tool>", role: "command" });
});

test("off a terminal it reads title, why, then the command", () => {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    out.fail(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto."));
    expect(io.stderr()).toBe("Which branch?\n  why: This needs the branch to rebase onto.\n  next: rt git rebase onto <branch>\n");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/ui/__tests__/usage.test.ts`
Expected: FAIL, cannot find module `../usage.ts`.

- [ ] **Step 3: Create `lib/ui/usage.ts`**

```ts
import { cmd, type FailureInput } from "./out.ts";

/**
 * A failure for a missing or wrong argument. The title asks for what is
 * missing in plain words; the usage line is the command to run, never part
 * of the sentence. A leading "usage:" is dropped, so a caller may pass the
 * string its --json error already carries.
 */
export function usageFailure(title: string, usage: string, why?: string): FailureInput {
  return { title, ...(why ? { why } : {}), next: cmd(usage.replace(/^\s*usage:\s*/i, "")) };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test lib/ui/__tests__/usage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/usage.ts lib/ui/__tests__/usage.test.ts
```

```bash
git commit -m "lib/ui: usageFailure keeps the usage line out of the failure title

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The `steps` verb gains an erasing ending

The ending rides `done` as a flag, `{ "t": "done", "title": "...", "clear": true }`, not as a new event. A source checkout runs the installed helper when `ui/dist/rt-ui` is missing or stale, and a helper that predates the flag must end the step with a plain done row. A new event would be skipped by that helper's decoder and the step would end as a coral `interrupted` row when stdin closes.

**Files:**
- Modify: `ui/internal/protocol/protocol.go:154-162` (`StepEvent`)
- Modify: `ui/internal/steps/steps.go` (the `done` case)
- Modify: `ui/internal/protocol/protocol_test.go`, `ui/internal/steps/steps_test.go`
- Create: `ui/fixtures/steps-stream-clear.json`
- Modify: `lib/ui/protocol.ts:64-70`, `lib/ui/spawn.ts:73-118`
- Modify: `lib/ui/__tests__/protocol.test.ts`, `lib/ui/__tests__/spawn.test.ts`

`lib/ui/__tests__/fake-rt-ui.ts` needs no edit: its `steps` verb already ends on `done`.

**Interfaces:**
- Consumes: `StepEvent`, `encodeLine` (`lib/ui/protocol.ts`); `openStep` (`lib/ui/spawn.ts`); `testutil.RunPTY`, `testutil.Screen`, `testutil.Binary` (`ui/internal/testutil`).
- Produces:
  - Wire: `done` takes an optional `clear: true`. With it the step ends, its row and sub-lines are erased, nothing is painted, and the helper exits 0. `title` is still sent (the step's label) and is what a helper without the flag paints. `PROTOCOL_VERSION` stays 1.
  - `lib/ui/protocol.ts`: the `done` member of `StepEvent` becomes `{ t: "done"; title: string; hint?: string; status?: RenderStatus; clear?: true }`.
  - `lib/ui/spawn.ts`: `StepHandle.clear(): Promise<boolean>`, true when rt-ui ended the step.
  - Shared fixture `ui/fixtures/steps-stream-clear.json`.

- [ ] **Step 1: Write the shared fixture**

Create `ui/fixtures/steps-stream-clear.json`:

```json
[
  { "t": "hello", "protocol": 1 },
  { "t": "start", "title": "scanning ports…" },
  { "t": "sub", "text": "asking lsof" },
  { "t": "done", "title": "scanning ports…", "clear": true }
]
```

- [ ] **Step 2: Write the failing Go tests**

Append to `ui/internal/protocol/protocol_test.go`:

```go
func TestStepsClearFixtureDecodes(t *testing.T) {
	var lines []json.RawMessage
	if err := json.Unmarshal(fixture(t, "steps-stream-clear.json"), &lines); err != nil {
		t.Fatal(err)
	}
	want := []string{"hello", "start", "sub", "done"}
	if len(lines) != len(want) {
		t.Fatalf("got %d lines", len(lines))
	}
	for i, raw := range lines {
		ev, err := DecodeStep(raw)
		if err != nil {
			t.Fatal(err)
		}
		if ev.T != want[i] {
			t.Fatalf("line %d: t=%q want %q", i, ev.T, want[i])
		}
		if ev.Clear != (i == len(want)-1) {
			t.Fatalf("line %d: clear=%v", i, ev.Clear)
		}
	}
}
```

Append to `ui/internal/steps/steps_test.go`:

```go
const clearDone = `{"t":"done","title":"scanning ports…","clear":true}`

func TestADoneThatClearsLeavesNothingOnScreen(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"scanning ports…"}`, `{"t":"sub","text":"asking lsof"}`, clearDone}
	stdout, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || stdout != "" {
		t.Fatalf("exit %d stdout %q", exit, stdout)
	}
	if !strings.Contains(tty, "scanning ports") {
		t.Fatalf("the spinner row never painted, so the test proves nothing: %q", tty)
	}
	if screen := testutil.Screen(tty); strings.TrimSpace(screen) != "" {
		t.Fatalf("a clearing done left text on screen: %q", screen)
	}
}

func TestADoneThatClearsAnInstantStepPaintsNothing(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"scanning ports…"}`, clearDone}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || tty != "" {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
}

func TestADoneThatClearsKeepsEarlierLogLines(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"scanning ports…"}`, `{"t":"log","level":"warn","text":"one port did not answer"}`, clearDone}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if !strings.Contains(screen, "one port did not answer") || strings.Contains(screen, "scanning ports") {
		t.Fatalf("screen %q", screen)
	}
}

// What a helper without the flag does with the same event, minus the flag:
// the row a new CLI gets from an old helper.
func TestADoneWithoutTheFlagStillPaintsItsRow(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"scanning ports…"}`, `{"t":"done","title":"scanning ports…"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if !strings.Contains(testutil.Screen(tty), "✓ scanning ports…") {
		t.Fatalf("screen %q", testutil.Screen(tty))
	}
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go -C ui test ./internal/protocol ./internal/steps`
Expected: FAIL. `protocol` does not build: `ev.Clear undefined`. Once that is commented out to see the rest, the three clearing tests fail because the flag is ignored and a `✓ scanning ports…` row is painted; `TestADoneWithoutTheFlagStillPaintsItsRow` passes already.

- [ ] **Step 4: Decode and honor the flag in Go**

In `ui/internal/protocol/protocol.go`, add one field to `StepEvent`, after `Status`:

```go
	Status   string `json:"status,omitempty"`
	// Clear, on done, erases the step and paints no final row. It rides done
	// so a helper that predates it still ends the step with a done row.
	Clear bool `json:"clear,omitempty"`
```

`DecodeStep` does not change: the event is still `done`.

In `ui/internal/steps/steps.go`, at the top of the `done` case in `Run`, before `t := ev.Title`:

```go
			case "done":
				if ev.Clear {
					clearActive()
					return Done
				}
				t := ev.Title
```

`clearActive` already erases the spinner row and any sub-lines and does nothing when no frame was painted.

- [ ] **Step 5: Run the Go tests**

Run: `go -C ui vet ./... && go -C ui test ./internal/protocol ./internal/steps`
Expected: PASS.

- [ ] **Step 6: Write the failing TypeScript tests**

Append to `lib/ui/__tests__/protocol.test.ts`:

```ts
test("the clear fixture ends a step with a done event that carries clear", () => {
  const events = fixture("steps-stream-clear.json") as StepEvent[];
  expect(events.map((e) => e.t)).toEqual(["hello", "start", "sub", "done"]);
  expect(events.at(-1)).toEqual({ t: "done", title: "scanning ports…", clear: true });
});
```

Append to `lib/ui/__tests__/spawn.test.ts`:

```ts
test("clear ends the step with a done event that carries the label and clear", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("scanning ports…");
  expect(await step.clear()).toBe(true);
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent).toEqual([{ t: "hello", protocol: 1 }, { t: "start", title: "scanning ports…" }, { t: "done", title: "scanning ports…", clear: true }]);
});

test("done never carries clear", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("pushing…");
  await step.done("pushed");
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent.at(-1)).toEqual({ t: "done", title: "pushed" });
});

test("clear resolves false, never throws, when the child died mid-step", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const step = openStep("scanning ports…");
  await Bun.sleep(150);
  expect(await step.clear()).toBe(false);
  expect(exits).toEqual([]);
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/spawn.test.ts`
Expected: FAIL. `step.clear is not a function`. (The fixture test and `done never carries clear` pass at runtime; `bun run typecheck` rejects `clear: true` against `StepEvent` until Step 8.)

- [ ] **Step 8: Add `clear` to the TypeScript side**

In `lib/ui/protocol.ts`, change the `done` member of the `StepEvent` union from:

```ts
  | { t: "done"; title: string; hint?: string; status?: RenderStatus }
```

to:

```ts
  | { t: "done"; title: string; hint?: string; status?: RenderStatus; clear?: true }
```

In `lib/ui/spawn.ts`, add to the `StepHandle` interface after `fail`:

```ts
  /** Ends the step and erases its row and sub-lines, leaving nothing. Resolves true when rt-ui ended the step. */
  clear(): Promise<boolean>;
```

In `openStep`, replace the `finish` function's signature and first line:

```ts
  const finish = async (t: "done" | "fail", finalTitle?: string, hint?: string, status?: RenderStatus): Promise<boolean> => {
    const sent = send({ t, title: finalTitle ?? title, ...(hint ? { hint } : {}), ...(status ? { status } : {}) });
```

with:

```ts
  const finish = async (t: "done" | "fail", finalTitle?: string, hint?: string, status?: RenderStatus, clear?: true): Promise<boolean> => {
    const sent = send({ t, title: finalTitle ?? title, ...(hint ? { hint } : {}), ...(status ? { status } : {}), ...(clear ? { clear } : {}) });
```

and add to the returned object after `fail: (t, h) => finish("fail", t, h),`:

```ts
    // The label rides along as the title: a helper that predates the flag
    // paints it as a done row.
    clear: () => finish("done", undefined, undefined, undefined, true),
```

- [ ] **Step 9: Run everything this task touched**

Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__ && bun run typecheck`
Run: `go -C ui vet ./... && go -C ui test ./internal/protocol ./internal/steps`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add ui/fixtures/steps-stream-clear.json ui/internal/protocol/protocol.go ui/internal/protocol/protocol_test.go ui/internal/steps/steps.go ui/internal/steps/steps_test.go lib/ui/protocol.ts lib/ui/spawn.ts lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/spawn.test.ts
```

```bash
git commit -m "rt-ui steps: a done event that carries clear ends a step and leaves nothing on screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `withTransientStep`, and the inline spinner becomes it

**Files:**
- Create: `lib/ui/transient-step.ts`
- Modify: `lib/tui/inline-spinner.ts` (whole file)
- Create: `lib/ui/__tests__/transient-step.test.ts`

**Interfaces:**
- Consumes: `openStep(title): StepHandle` and `StepHandle.clear()` (Task 5, `lib/ui/spawn.ts`); `interactive()` and `__test__.setInteractive` (`lib/ui/gate.ts`); `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`, phase 2).
- Produces: `export async function withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T>` in `lib/ui/transient-step.ts`; `withInlineSpinner` in `lib/tui/inline-spinner.ts` is the same function under its old name.

- [ ] **Step 1: Write the failing tests**

Create `lib/ui/__tests__/transient-step.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { __test__ as gate } from "../gate.ts";
import { withTransientStep } from "../transient-step.ts";
import { withInlineSpinner } from "../../tui/inline-spinner.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-transient-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  // bun test's stdin is not a TTY; the gate is opened here and closed only
  // in the test that is about it.
  gate.setInteractive(() => true);
});
afterEach(() => {
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("runs the task under a step and ends it with clear", async () => {
  expect(await withTransientStep("scanning ports…", async () => 42)).toBe(42);
  expect(sent()).toEqual([{ t: "hello", protocol: 1 }, { t: "start", title: "scanning ports…" }, { t: "done", title: "scanning ports…", clear: true }]);
});

test("a task that throws still clears, and the error reaches the caller", async () => {
  await expect(
    withTransientStep("scanning ports…", async () => {
      throw new Error("lsof died");
    }),
  ).rejects.toThrow("lsof died");
  expect(sent().at(-1)).toEqual({ t: "done", title: "scanning ports…", clear: true });
});

test("off a terminal nothing is spawned and the task still runs", async () => {
  gate.setInteractive(() => false);
  expect(await withTransientStep("scanning ports…", async () => "ran")).toBe("ran");
  expect(existsSync(record)).toBe(false);
});

test("a missing helper costs the spinner, never the task", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  expect(await withTransientStep("scanning ports…", async () => "ran")).toBe("ran");
});

test("a helper that dies mid-step does not fail the task", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const result = await withTransientStep("scanning ports…", async () => {
    await Bun.sleep(150);
    return "ran";
  });
  expect(result).toBe("ran");
});

test("withInlineSpinner is the transient step under its old name", () => {
  expect(withInlineSpinner).toBe(withTransientStep);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/ui/__tests__/transient-step.test.ts`
Expected: FAIL, cannot find module `../transient-step.ts`.

- [ ] **Step 3: Create `lib/ui/transient-step.ts`**

```ts
/**
 * A spinner that leaves nothing behind. The Go step draws it and erases it
 * when the task settles, resolved or thrown; the caller prints the result.
 * Off a terminal, or when rt-ui cannot start, the task just runs.
 *
 * spawn.ts is loaded on first use, never imported at the top, type imports
 * included: files the daemon loads import this module, and the daemon graph
 * must not reach spawn.ts (lib/__tests__/no-eager-tui.test.ts).
 */
import { logCliEvent } from "../cli-logger.ts";
import { interactive } from "./gate.ts";

export async function withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!interactive()) return task();
  let step: { clear(): Promise<boolean> } | null = null;
  try {
    const { openStep } = await import("./spawn.ts");
    step = openStep(label);
  } catch (err) {
    logCliEvent("warn", "rt-ui", "rt-ui steps did not start; ran without a spinner", { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    return await task();
  } finally {
    await step?.clear();
  }
}
```

- [ ] **Step 4: Replace `lib/tui/inline-spinner.ts`**

The whole file becomes:

```ts
// One spinner, the Go step. This name stays for the two files that import it.
export { withTransientStep as withInlineSpinner } from "../ui/transient-step.ts";
```

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test lib/ui/__tests__/transient-step.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors. `commands/port.ts` and `commands/sdm.ts` import `withInlineSpinner` and still compile.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/transient-step.ts lib/tui/inline-spinner.ts lib/ui/__tests__/transient-step.test.ts
```

```bash
git commit -m "lib/ui: withTransientStep, and the inline spinner is the Go step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Words-only wrapping in `textwrap`, and `wrapCell` opts in

`ansi.Wrap` always treats a hyphen as a break point, so `--force-with-lease` breaks after `--`, and when it hard-cuts a long word a combining mark can start the next row without its base. `Spans` keeps both behaviors because the mission diff wraps code with it. Prose gets a second entry point.

**Files:**
- Modify: `ui/internal/textwrap/textwrap.go` (append)
- Modify: `ui/internal/textwrap/textwrap_test.go` (append)
- Modify: `ui/internal/render/style.go:143`
- Modify: `ui/internal/render/blocks_basic_test.go` (append)

**Interfaces:**
- Consumes: `Spans`, `normalizeSpaces`, `join`, `slice` (`ui/internal/textwrap/textwrap.go`); `ansi.FirstGraphemeCluster`, `ansi.GraphemeWidth`, `ansi.StringWidth` (`github.com/charmbracelet/x/ansi` v0.11.8).
- Produces:
  - `type Options struct { WordsOnly bool }`
  - `func SpansWith[T any](runs []T, width int, opts Options, text func(T) string, with func(T, string) T) [][]T`. With the zero `Options` it returns exactly what `Spans` returns.
  - `wrapCell` (`ui/internal/render/style.go`) wraps words-only, so every wrapped title, hint, callout body and details line in `rt-ui render` does.

- [ ] **Step 1: Write the failing tests**

In `ui/internal/textwrap/textwrap_test.go`, add `"reflect"` and `"unicode/utf8"` to the imports, and append:

```go
func wrapWords(runs []run, width int) [][]run {
	return SpansWith(runs, width, Options{WordsOnly: true}, runText, withText)
}

func rowTexts(rows [][]run) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = text(r)
	}
	return out
}

// Spans is the mission diff wrap: it breaks after a hyphen, and SpansWith
// must leave that alone.
func TestSpansStillBreaksAfterAHyphen(t *testing.T) {
	in := []run{{text: "push with --force-with-lease now"}}
	want := []string{"push with --", "force-with-lease", "now"}
	if got := rowTexts(wrap(in, 16)); !reflect.DeepEqual(got, want) {
		t.Fatalf("Spans rows changed: %q", got)
	}
	if got := rowTexts(SpansWith(in, 16, Options{}, runText, withText)); !reflect.DeepEqual(got, want) {
		t.Fatalf("zero Options must be Spans: %q", got)
	}
}

func TestWordsOnlyKeepsAFlagWhole(t *testing.T) {
	got := rowTexts(wrapWords([]run{{text: "push with --force-with-lease now"}}, 20))
	want := []string{"push with", "--force-with-lease", "now"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestWordsOnlyCutsAnOverlongWordBetweenClusters(t *testing.T) {
	word := strings.Repeat("e"+string(rune(0x301)), 30)
	rows := rowTexts(wrapWords([]run{{text: "a " + word}}, 20))
	if len(rows) != 3 {
		t.Fatalf("got %d rows: %q", len(rows), rows)
	}
	for i, r := range rows {
		first, _ := utf8.DecodeRuneInString(r)
		if unicode.Is(unicode.Mn, first) {
			t.Fatalf("row %d starts with a combining mark: %q", i, r)
		}
		if w := ansi.StringWidth(r); w > 20 {
			t.Fatalf("row %d is %d cells", i, w)
		}
	}
	if strings.Join(rows, "") != "a"+word {
		t.Fatalf("text lost: %q", rows)
	}
}

func TestWordsOnlyKeepsAStyleAcrossTheBreakAndTheIndentation(t *testing.T) {
	rows := wrapWords([]run{{text: "  x := "}, {text: `"a long string literal"`, style: "mint"}}, 12)
	want := []string{`  x := "a`, "long string", `literal"`}
	if got := rowTexts(rows); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
	last := rows[len(rows)-1]
	if last[len(last)-1].style != "mint" {
		t.Fatalf("the literal's tail lost its style: %+v", last)
	}
}

func TestWordsOnlyShortAndBlankLinesAreOneRow(t *testing.T) {
	if rows := wrapWords([]run{{text: "short"}}, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows := wrapWords(nil, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows := wrapWords([]run{{text: "\t\t\t      "}}, 5); len(rows) != 1 {
		t.Fatalf("a blank line wider than the row got %d rows", len(rows))
	}
}

func TestWordsOnlyLosesNoTextAtAnyWidth(t *testing.T) {
	in := []run{
		{text: "\tif", style: "keyword"},
		{text: " x := \"漢字かな漢字かな漢字　カタカナ\tabc 한국어\r텍스트\" //\v注释 done"},
	}
	want := dropSpace(text(in))
	for width := 3; width <= 40; width++ {
		rows := wrapWords(in, width)
		var joined strings.Builder
		for r, row := range rows {
			s := text(row)
			if strings.ContainsAny(s, "\t\r\v\f") {
				t.Fatalf("width %d row %d kept a control space: %q", width, r, s)
			}
			if w := ansi.StringWidth(s); w > width {
				t.Fatalf("width %d row %d is %d cells: %q", width, r, w, s)
			}
			joined.WriteString(s)
		}
		if got := dropSpace(joined.String()); got != want {
			t.Fatalf("width %d lost or duplicated text:\n got %q\nwant %q", width, got, want)
		}
	}
}
```

Append to `ui/internal/render/blocks_basic_test.go`:

```go
func TestWrappedTextNeverBreaksAFlagAtItsHyphens(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "callout", Label: "note", Body: []protocol.Cell{text("Pushing again needs --force-with-lease so nothing is lost")}})
	want := "    ▌ note Pushing again needs\n" +
		"    ▌      --force-with-lease so nothing\n" +
		"    ▌      is lost\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go -C ui test ./internal/textwrap ./internal/render`
Expected: FAIL to build in `textwrap`: `undefined: SpansWith`, `undefined: Options`. In `render`, `TestWrappedTextNeverBreaksAFlagAtItsHyphens` fails with a row ending in `--`.

- [ ] **Step 3: Add the words-only wrap**

Append to `ui/internal/textwrap/textwrap.go` (the imports it needs, `unicode`, `unicode/utf8` and `ansi`, are already there):

```go
// Options changes where a line may break. The zero value is Spans.
type Options struct {
	// WordsOnly breaks at whitespace and nowhere else: a hyphen is not a
	// break point, so a flag or a branch name stays whole, and a word wider
	// than the row is cut between grapheme clusters, so a combining mark
	// never starts a row without its base.
	WordsOnly bool
}

// SpansWith is Spans with Options applied.
func SpansWith[T any](runs []T, width int, opts Options, text func(T) string, with func(T, string) T) [][]T {
	if !opts.WordsOnly {
		return Spans(runs, width, text, with)
	}
	runs = normalizeSpaces(runs, text, with)
	plain := join(runs, text)
	if width < 1 || ansi.StringWidth(plain) <= width {
		return [][]T{runs}
	}
	bounds := wordRows(plain, width)
	if len(bounds) == 0 {
		return [][]T{nil}
	}
	out := make([][]T, len(bounds))
	for i, b := range bounds {
		out[i] = slice(runs, b[0], b[1], text, with)
	}
	return out
}

type piece struct {
	from, to, width int
	space           bool
}

// pieces splits s into alternating runs of whitespace and of everything
// else, measured in cells. A no-break space belongs to its word.
func pieces(s string) []piece {
	var out []piece
	for i := 0; i < len(s); {
		cluster, w := ansi.FirstGraphemeCluster(s[i:], ansi.GraphemeWidth)
		if cluster == "" {
			break
		}
		r, _ := utf8.DecodeRuneInString(cluster)
		space := unicode.IsSpace(r) && r != 0xA0
		if n := len(out); n > 0 && out[n-1].space == space {
			out[n-1].to += len(cluster)
			out[n-1].width += w
		} else {
			out = append(out, piece{from: i, to: i + len(cluster), width: w, space: space})
		}
		i += len(cluster)
	}
	return out
}

// wordRows returns the byte range of every row. The whitespace a row breaks
// at belongs to no row; indentation before the first word stays on its row.
func wordRows(s string, width int) [][2]int {
	var rows [][2]int
	start, end, used := -1, 0, 0
	flush := func() {
		if start >= 0 {
			rows = append(rows, [2]int{start, end})
		}
		start, used = -1, 0
	}
	gap := piece{}
	for _, p := range pieces(s) {
		if p.space {
			gap = p
			continue
		}
		lead := gap
		gap = piece{}
		switch {
		case start >= 0 && used+lead.width+p.width <= width:
			end, used = p.to, used+lead.width+p.width
			continue
		case start < 0 && len(rows) == 0 && lead.width > 0 && lead.width+p.width <= width:
			start, end, used = lead.from, p.to, lead.width+p.width
			continue
		}
		flush()
		if p.width <= width {
			start, end, used = p.from, p.to, p.width
			continue
		}
		for i := p.from; i < p.to; {
			cluster, w := ansi.FirstGraphemeCluster(s[i:p.to], ansi.GraphemeWidth)
			if cluster == "" {
				break
			}
			if start >= 0 && used+w > width {
				flush()
			}
			if start < 0 {
				start = i
			}
			i += len(cluster)
			end, used = i, used+w
		}
	}
	flush()
	return rows
}
```

- [ ] **Step 4: Opt `wrapCell` in**

In `ui/internal/render/style.go`, in `wrapCell`, change:

```go
	rows := textwrap.Spans(clean, w, segText, withSegText)
```

to:

```go
	rows := textwrap.SpansWith(clean, w, textwrap.Options{WordsOnly: true}, segText, withSegText)
```

- [ ] **Step 5: Run the Go suite, the mission view included**

Run: `go -C ui vet ./... && go -C ui test ./internal/textwrap ./internal/render ./internal/views/mission`
Expected: PASS. No existing render test changes its expectation, and the mission tests pass untouched: `diff_wrap.go` still calls `Spans`.

- [ ] **Step 6: Commit**

```bash
git add ui/internal/textwrap/textwrap.go ui/internal/textwrap/textwrap_test.go ui/internal/render/style.go ui/internal/render/blocks_basic_test.go
```

```bash
git commit -m "rt-ui render: wrapped text breaks at spaces only, so a flag stays whole

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: A `line` hint wraps inside its own column

**Files:**
- Modify: `ui/internal/render/blocks_basic.go:15-37` (`lineRun`)
- Modify: `ui/internal/render/blocks_basic_test.go` (append)

**Interfaces:**
- Consumes: `wrapCell(c protocol.Cell, w int) []protocol.Cell` (words-only after Task 7), `cell`, `pad`, `Clean`, `glyph`, `minWrap` (20), `calloutIndent` (four spaces), `indent` (two spaces), `plainAt`, `rows`, `checkWidth` (`blocks_basic_test.go`).
- Produces: no new names. `lineRun` behavior:
  - Hinted lines whose title is at most `width - 4 - 2 - 20` cells wide share one hint column, as today. A hint wider than that column wraps inside it.
  - A hinted line with a wider title stays out of the alignment. If title and hint fit on one row it prints as today; otherwise the title wraps under itself at four spaces and the hint follows on its own rows at four spaces.
  - A hintless title wider than the pane wraps under itself at four spaces.

- [ ] **Step 1: Write the failing tests**

Append to `ui/internal/render/blocks_basic_test.go`:

```go
func TestLineHintWrapsInsideItsOwnColumn(t *testing.T) {
	got := plainAt(40,
		protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "on"},
		protocol.Block{T: "line", Status: "off", Title: "pre-push", Hint: "you turned this one off last week and it stays off"},
	)
	want := "  ✓ pre-commit  on\n" +
		"  ○ pre-push    you turned this one off\n" +
		"                last week and it stays\n" +
		"                off\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	checkWidth(t, got, 40)
}

func TestATitleTooWideForAHintColumnTakesItsHintBelow(t *testing.T) {
	got := plainAt(40,
		protocol.Block{T: "line", Status: "done", Title: "short", Hint: "h"},
		protocol.Block{T: "line", Status: "warn", Title: "a title that is far too long to leave a hint column", Hint: "the hint goes below"},
		protocol.Block{T: "line", Status: "done", Title: "a title of exactly some width", Hint: "x"},
		protocol.Block{T: "line", Status: "done", Title: "a hintless title that is far too long to fit on one row of the pane"},
	)
	want := "  ✓ short  h\n" +
		"  ! a title that is far too long to\n" +
		"    leave a hint column\n" +
		"    the hint goes below\n" +
		"  ✓ a title of exactly some width  x\n" +
		"  ✓ a hintless title that is far too\n" +
		"    long to fit on one row of the pane\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	checkWidth(t, got, 40)
}

func TestAWrappedHintKeepsItsFaintToneOnEveryRow(t *testing.T) {
	out := render.Render([]protocol.Block{{T: "line", Status: "off", Title: "pre-push", Hint: "you turned this one off last week and it stays off"}}, render.Options{Width: 40})
	const faint = "38;2;127;120;160"
	for i, row := range rows(out) {
		if !strings.Contains(row, faint) {
			t.Fatalf("row %d lost the hint tone: %q", i, row)
		}
	}
}

func TestAVeryNarrowPaneLosesNoText(t *testing.T) {
	for _, w := range []int{20, 24, 30} {
		got := plainAt(w,
			protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "turned on for this repo"},
			protocol.Block{T: "line", Status: "off", Title: "pre-push"},
		)
		for _, want := range []string{"pre-commit", "turned", "on", "for", "this", "repo", "pre-push"} {
			if !strings.Contains(got, want) {
				t.Fatalf("width %d lost %q:\n%s", w, want, got)
			}
		}
		// At 20 the text column (16) is under minWrap: rows are emitted whole
		// and the terminal wraps them.
		if w >= 24 {
			checkWidth(t, got, w)
		}
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go -C ui test ./internal/render -run "TestLineHintWraps|TestATitleTooWide|TestAWrappedHint|TestAVeryNarrow"`
Expected: FAIL. `TestLineHintWrapsInsideItsOwnColumn` gets one 68 cell row for `pre-push`; `checkWidth` reports a row wider than 40.

- [ ] **Step 3: Rewrite `lineRun`**

In `ui/internal/render/blocks_basic.go`, replace the whole `lineRun` function and its comment (lines 15 to 37) with:

```go
// lineRun renders consecutive lines, with any callouts between them, and
// pads hinted titles to one width so the hints line up. A hint wraps inside
// its own column; a title too wide to leave the hint a column worth wrapping
// into takes the hint on the rows below it and stays out of the alignment.
func (r *renderer) lineRun(run []protocol.Block) {
	textW := r.width - len(calloutIndent)
	titleCap := textW - 2 - minWrap
	w := 0
	for _, b := range run {
		if b.T != "line" || b.Hint == "" {
			continue
		}
		if tw := lipgloss.Width(Clean(b.Title)); tw <= titleCap {
			w = max(w, tw)
		}
	}
	for _, b := range run {
		if b.T == "callout" {
			r.callout(b)
			continue
		}
		head := indent + glyph(b.Status) + " "
		titleW := lipgloss.Width(Clean(b.Title))
		hint := protocol.Cell{{Text: b.Hint, Role: "faint"}}
		if b.Hint != "" && titleW <= titleCap {
			for i, row := range wrapCell(hint, textW-w-2) {
				if i == 0 {
					r.emit(head + textStyle.Render(pad(Clean(b.Title), w)) + "  " + cell(row))
					continue
				}
				r.emit(calloutIndent + strings.Repeat(" ", w+2) + cell(row))
			}
			continue
		}
		title := wrapCell(protocol.Cell{{Text: b.Title}}, textW)
		inline := b.Hint != "" && len(title) == 1 && titleW+2+lipgloss.Width(Clean(b.Hint)) <= textW
		for i, row := range title {
			s := calloutIndent + cell(row)
			if i == 0 {
				s = head + cell(row)
			}
			if inline {
				s += "  " + cell(hint)
			}
			r.emit(s)
		}
		if b.Hint != "" && !inline {
			for _, row := range wrapCell(hint, textW) {
				r.emit(calloutIndent + cell(row))
			}
		}
	}
}
```

`strings` and `lipgloss` are already imported in this file.

- [ ] **Step 4: Run the render tests**

Run: `go -C ui vet ./... && go -C ui test ./internal/render`
Expected: PASS, the four new tests and every existing one (`TestConsecutiveLinesAlignTheirHints`, `TestLineWithoutHintIsNotPadded` and `TestCalloutAttachesUnderALineAndKeepsTheRunAligned` keep their exact strings at 80 columns).

- [ ] **Step 5: Commit**

```bash
git add ui/internal/render/blocks_basic.go ui/internal/render/blocks_basic_test.go
```

```bash
git commit -m "rt-ui render: a status line's hint wraps inside its own column

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Both renderers drop bidi controls and zero-width characters

The set, from the scoping document: U+061C, U+200B to U+200F, U+202A to U+202E, U+2060, U+2066 to U+2069, U+FEFF.

**Files:**
- Create: `ui/fixtures/clean-cases.json`
- Modify: `ui/internal/render/style.go:66-80` (`Clean`)
- Modify: `ui/internal/render/blocks_basic_test.go` (append)
- Modify: `lib/ui/out-plain.ts:25-36`
- Modify: `lib/ui/__tests__/out-plain.test.ts` (append)

**Interfaces:**
- Consumes: `render.Clean(s string) string`; `one`, `lines`, `renderPlain` (`lib/ui/out-plain.ts`).
- Produces: the shared fixture `ui/fixtures/clean-cases.json`, an array of `{ "name": string, "codepoints": number[], "clean": number[] }`. Both sides build the input from `codepoints`, clean it, and compare with the string built from `clean`. No signature changes.

- [ ] **Step 1: Write the shared fixture**

Create `ui/fixtures/clean-cases.json`. Every character is a decimal code point, so the file holds nothing invisible:

```json
[
  { "name": "plain text is untouched", "codepoints": [109, 97, 105, 110], "clean": [109, 97, 105, 110] },
  { "name": "a right-to-left override inside a branch name", "codepoints": [109, 97, 105, 110, 8238, 116, 120, 116], "clean": [109, 97, 105, 110, 116, 120, 116] },
  { "name": "the embedding and override controls, 202A to 202E", "codepoints": [97, 8234, 8235, 8236, 8237, 8238, 98], "clean": [97, 98] },
  { "name": "the isolate controls, 2066 to 2069", "codepoints": [97, 8294, 8295, 8296, 8297, 98], "clean": [97, 98] },
  { "name": "the marks 200E, 200F and 061C", "codepoints": [97, 8206, 8207, 1564, 98], "clean": [97, 98] },
  { "name": "zero-width space, non-joiner and joiner", "codepoints": [97, 8203, 8204, 8205, 98], "clean": [97, 98] },
  { "name": "word joiner and the byte order mark", "codepoints": [97, 8288, 65279, 98], "clean": [97, 98] },
  { "name": "the characters next to each range stay", "codepoints": [8202, 8208, 8239, 8304], "clean": [8202, 8208, 8239, 8304] }
]
```

Keep one case per line as shown; prettier ignores `/ui`, so `format:check` does not reflow it.

- [ ] **Step 2: Write the failing tests**

In `ui/internal/render/blocks_basic_test.go`, add `"encoding/json"`, `"os"` and `"path/filepath"` to the imports, and append:

```go
func runes(codepoints []int) string {
	var b strings.Builder
	for _, c := range codepoints {
		b.WriteRune(rune(c))
	}
	return b.String()
}

func TestCleanStripsBidiControlsAndZeroWidthCharacters(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "fixtures", "clean-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name       string `json:"name"`
		Codepoints []int  `json:"codepoints"`
		Clean      []int  `json:"clean"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		if got := render.Clean(runes(c.Codepoints)); got != runes(c.Clean) {
			t.Errorf("%s: got %q want %q", c.Name, got, runes(c.Clean))
		}
	}
}
```

Append to `lib/ui/__tests__/out-plain.test.ts`:

```ts
test("bidi controls and zero-width characters are stripped, by the shared cases", () => {
  const cases = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures", "clean-cases.json"), "utf8")) as Array<{ name: string; codepoints: number[]; clean: number[] }>;
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const raw = String.fromCodePoint(...c.codepoints);
    const clean = String.fromCodePoint(...c.clean);
    expect(renderPlain([{ t: "line", status: "done", title: raw }]), c.name).toBe(`[ok] ${clean}\n`);
    expect(renderPlain([{ t: "verbatim", lines: [raw] }]), c.name).toBe(`  ${clean}\n`);
  }
});

test("a leading failure that hides its bracket behind a zero-width space keeps the tag", () => {
  expect(renderPlain([{ t: "failure", title: `${String.fromCodePoint(0x200b)}[ok] forged` }])).toBe("[failed] [ok] forged\n");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `go -C ui test ./internal/render -run TestCleanStripsBidi`
Expected: FAIL: the case `a right-to-left override inside a branch name` gets back its input with the override still in it where it wants `maintxt`, and five more cases fail the same way.

Run: `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: FAIL on the same case.

- [ ] **Step 4: Strip them in Go**

In `ui/internal/render/style.go`, replace `Clean` (keep its comment) with:

```go
func Clean(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return ' '
		case r < 0x20 || (r >= 0x7f && r <= 0x9f) || invisible(r):
			return -1
		}
		return r
	}, ansi.Strip(s))
}

// invisible reports the bidi controls and the zero-width characters: text
// carrying them can read as something other than what it is.
func invisible(r rune) bool {
	switch {
	case r == 0x061C, r == 0x200E, r == 0x200F, r == 0x2060, r == 0xFEFF:
		return true
	case r >= 0x200B && r <= 0x200D, r >= 0x202A && r <= 0x202E, r >= 0x2066 && r <= 0x2069:
		return true
	}
	return false
}
```

`steps.go` cleans its sub-lines through `render.Clean`, so the step verb inherits the change.

- [ ] **Step 5: Strip them in the plain renderer**

In `lib/ui/out-plain.ts`, replace the `one` and `lines` functions (lines 28 to 36, the `CONTROLS` line above them stays) with:

```ts
// The bidi controls and the zero-width characters: text carrying them can
// read as something other than what it is. Built from code points so this
// file holds none of them; the ranges match Clean in ui/internal/render.
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2060],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join("")}]`, "g");

/** Single-line fields: a newline in untrusted text must not start a forged row. */
function one(s: string): string {
  return s.replace(ESCAPES, "").replace(/[\r\n\t]+/g, " ").replace(CONTROLS, "").replace(INVISIBLE, "");
}

/** Line-oriented fields: every line gets the block's prefix. Tabs are kept. */
function lines(s: string, prefix: string): string[] {
  return s.split(/\r\n|\r|\n/).map((l) => prefix + l.replace(ESCAPES, "").replace(CONTROLS, "").replace(INVISIBLE, ""));
}
```

- [ ] **Step 6: Run both sides**

Run: `go -C ui vet ./... && go -C ui test ./internal/render ./internal/steps`
Run: `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/fixtures/clean-cases.json ui/internal/render/style.go ui/internal/render/blocks_basic_test.go lib/ui/out-plain.ts lib/ui/__tests__/out-plain.test.ts
```

```bash
git commit -m "output layer: both renderers drop bidi controls and zero-width characters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Diff tints for a light terminal, and a rule tone that reads on both

`rt-ui render` writes to a pipe and, by the spec, never opens `/dev/tty`, so it cannot ask the terminal for its background. The one thing it is told is `COLORFGBG`, which iTerm2, Konsole and rxvt set. With it saying light, the diff is painted with pale tints and fixed dark ink. Without it, or with it saying dark, today's tints stay. The ink is fixed in both variants, so a diff row reads even when the variable is wrong.

**Files:**
- Modify: `ui/internal/theme/theme.go` (after the `DiffAddBg` block, line 172)
- Create: `ui/internal/render/background.go`
- Modify: `ui/internal/render/render.go:9-29`, `ui/internal/render/blocks_text.go:75-77`, `ui/internal/render/style.go:51`
- Modify: `ui/cmd/rt-ui/verbs.go:317`
- Modify: `ui/internal/theme/theme_test.go`, `ui/internal/render/blocks_text_test.go`, `ui/internal/render/blocks_layout_test.go`, `ui/internal/render/verb_test.go` (append)

**Interfaces:**
- Consumes: `blendToward`, `diffTintBlend`, `Mint`, `Coral`, `Bg`, `Rule`, `Hex`, `relLuminance` (`ui/internal/theme`); `runVerb`, `helloLine`, `styled`, `cells`, `text`, `coral` (render test helpers).
- Produces:
  - `theme.DiffAddBgLight` (`#E5FBF1`), `theme.DiffDelBgLight` (`#FFE9E9`), `theme.StaticRule` (`#655E88`).
  - `render.Options.Light bool`; `func render.LightBackground(colorfgbg string) bool`.
  - `rt-ui render` reads `COLORFGBG` from its environment. `lib/ui/out.ts` already passes the whole environment, so no TypeScript changes.

- [ ] **Step 1: Write the failing tests**

Append to `ui/internal/theme/theme_test.go`:

```go
func contrast(a, b float64) float64 {
	if a < b {
		a, b = b, a
	}
	return (a + 0.05) / (b + 0.05)
}

func TestLightDiffTintsArePaleAndKeepTheirHue(t *testing.T) {
	if Hex(DiffAddBgLight) != "#E5FBF1" || Hex(DiffDelBgLight) != "#FFE9E9" {
		t.Fatalf("light tints %s %s", Hex(DiffAddBgLight), Hex(DiffDelBgLight))
	}
	for name, tint := range map[string]color.Color{"add": DiffAddBgLight, "del": DiffDelBgLight} {
		if c := contrast(relLuminance(Bg), relLuminance(tint)); c < 7 {
			t.Fatalf("%s: dark ink on the light tint is only %.1f:1", name, c)
		}
	}
}

func TestStaticRuleReadsOnDarkAndOnLight(t *testing.T) {
	rule := relLuminance(StaticRule)
	if c := contrast(rule, relLuminance(Bg)); c < 3 {
		t.Fatalf("StaticRule on a dark background is %.2f:1, under 3:1", c)
	}
	if c := contrast(rule, relLuminance(lipgloss.Color("#FFFFFF"))); c < 4.5 {
		t.Fatalf("StaticRule on a light background is %.2f:1, under 4.5:1", c)
	}
	if contrast(relLuminance(Rule), relLuminance(Bg)) >= contrast(rule, relLuminance(Bg)) {
		t.Fatal("StaticRule must read stronger on dark than Rule does")
	}
}
```

Append to `ui/internal/render/blocks_text_test.go`:

```go
func TestLightBackgroundReadsColorfgbg(t *testing.T) {
	for value, want := range map[string]bool{
		"": false, "15;0": false, "7;8": false, "12;default": false, "0;99": false,
		"0;15": true, "0;default;15": true, "0;7": true,
	} {
		if got := render.LightBackground(value); got != want {
			t.Errorf("COLORFGBG=%q: got %v want %v", value, got, want)
		}
	}
}

func TestDiffTintsFollowTheBackground(t *testing.T) {
	blocks := []protocol.Block{{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1 +1 @@", Lines: []protocol.DiffLine{{Kind: "del", Text: "old();"}, {Kind: "add", Text: "next();"}}}}}}
	dark := render.Render(blocks, render.Options{Width: 80})
	light := render.Render(blocks, render.Options{Width: 80, Light: true})
	for _, want := range []string{"48;2;59;34;49", "48;2;34;51;57"} {
		if !strings.Contains(dark, want) {
			t.Fatalf("dark render lost its tint %s: %q", want, dark)
		}
	}
	for _, want := range []string{"38;2;22;18;36;48;2;255;233;233", "38;2;22;18;36;48;2;229;251;241"} {
		if !strings.Contains(light, want) {
			t.Fatalf("light render has no dark ink on a pale tint %s: %q", want, light)
		}
	}
	if strings.Contains(light, coral) {
		t.Fatalf("light render kept coral text, which washes out on the pale tint: %q", light)
	}
}
```

If `blocks_text_test.go` does not import `rt-ui/internal/render` yet, add it (it uses `plain` and `styled` today, which live in `blocks_basic_test.go`).

Append to `ui/internal/render/blocks_layout_test.go`:

```go
func TestTableRuleAndTreeBranchesUseTheStaticRuleTone(t *testing.T) {
	const staticRule = "38;2;101;94;136"
	table := styled(protocol.Block{T: "table", Headers: []string{"KEY"}, Rows: []protocol.TableRow{cells("a")}})
	if !strings.Contains(table, "\x1b["+staticRule+"m───") {
		t.Fatalf("table rule tone: %q", table)
	}
	tree := styled(protocol.Block{T: "tree", Root: text("root"), Children: [][]protocol.Cell{{text("child")}}})
	if !strings.Contains(tree, "\x1b["+staticRule+"m╰── ") {
		t.Fatalf("tree branch tone: %q", tree)
	}
}
```

Append to `ui/internal/render/verb_test.go`:

```go
func TestRenderVerbTakesALightBackgroundFromColorfgbg(t *testing.T) {
	stdin := helloLine + `{"t":"diff","hunks":[{"header":"@@ -1 +1 @@","lines":[{"kind":"add","text":"next();"}]}]}` + "\n"
	env := []string{"COLORTERM=truecolor", "TERM=xterm-256color"}
	out, _, exit := runVerb(t, nil, append([]string{"COLORFGBG=0;15"}, env...), stdin)
	if exit != 0 || !strings.Contains(out, "48;2;229;251;241") {
		t.Fatalf("exit %d, no light tint in %q", exit, out)
	}
	out, _, _ = runVerb(t, nil, env, stdin)
	if !strings.Contains(out, "48;2;34;51;57") {
		t.Fatalf("a terminal that says nothing should keep the dark tint: %q", out)
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go -C ui test ./internal/theme ./internal/render`
Expected: FAIL to build: `undefined: DiffAddBgLight`, `undefined: StaticRule`, `undefined: render.LightBackground`, `unknown field Light in struct literal`.

- [ ] **Step 3: Add the tokens**

In `ui/internal/theme/theme.go`, after the `var ( DiffAddBg ... DiffDelGutterBg ... )` block, add:

```go
// Static output lands on the terminal's own background, which rt-ui never
// paints and cannot ask about. The light tints are the diff tints for a
// terminal that says its background is light, and StaticRule is one tone
// that reads as a quiet line on a dark background and on a light one.
var (
	paper          = lipgloss.Color("#FFFFFF")
	DiffAddBgLight = blendToward(Mint, paper, diffTintBlend)
	DiffDelBgLight = blendToward(Coral, paper, diffTintBlend)
	StaticRule     = lipgloss.Color("#655E88")
)
```

- [ ] **Step 4: Read `COLORFGBG`**

Create `ui/internal/render/background.go`:

```go
package render

import (
	"strconv"
	"strings"
)

// LightBackground reads a COLORFGBG value ("fg;bg" or "fg;default;bg"), the
// one thing a piped process is told about the terminal's background. The
// colors 0 to 6 and 8 are dark; anything else that parses is light. A value
// that is absent or unreadable is not light.
func LightBackground(colorfgbg string) bool {
	parts := strings.Split(colorfgbg, ";")
	n, err := strconv.Atoi(strings.TrimSpace(parts[len(parts)-1]))
	if err != nil || n < 0 || n > 15 {
		return false
	}
	return n == 7 || n > 8
}
```

In `ui/internal/render/render.go`, replace the `Options` and `renderer` types:

```go
type Options struct {
	// Width is the terminal's column count; values under 20 fall back to 80.
	Width int
	// Light says the terminal's background is light. The zero value keeps the
	// dark tints, which is also what a terminal that says nothing gets.
	Light bool
}

type renderer struct {
	width int
	light bool
	out   strings.Builder
}
```

and in `Render`, change `r := &renderer{width: w}` to `r := &renderer{width: w, light: opts.Light}`.

In `ui/cmd/rt-ui/verbs.go`, in `runRender`, change:

```go
	if _, err := w.WriteString(render.Render(blocks, render.Options{Width: width})); err != nil {
```

to:

```go
	if _, err := w.WriteString(render.Render(blocks, render.Options{Width: width, Light: render.LightBackground(os.Getenv("COLORFGBG"))})); err != nil {
```

- [ ] **Step 5: Paint with them**

In `ui/internal/render/blocks_text.go`, in `diff`, after the two lines that build `add` and `del`, add:

```go
	if r.light {
		// Mint and coral text wash out on a pale tint. The ink is fixed, not
		// the terminal's own, so the row reads even when COLORFGBG is wrong.
		add = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffAddBgLight)
		del = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffDelBgLight)
	}
```

In `ui/internal/render/style.go`, change:

```go
	ruleStyle    = fg(theme.Rule)
```

to:

```go
	ruleStyle    = fg(theme.StaticRule)
```

`railStyle` stays on `theme.Panel`: spec rule 7 names that tone for the `copy` and `verbatim` rail.

- [ ] **Step 6: Run the Go suite and rebuild the helper**

Run: `go -C ui vet ./... && go -C ui test ./...`
Expected: PASS, every package, the mission and picker views included (`theme.Rule` is unchanged and they do not use `StaticRule`).

Run: `bun run ui:build`
Expected: `ui/dist/rt-ui` is rebuilt.

- [ ] **Step 7: Commit**

```bash
git add ui/internal/theme/theme.go ui/internal/theme/theme_test.go ui/internal/render/background.go ui/internal/render/render.go ui/internal/render/blocks_text.go ui/internal/render/style.go ui/internal/render/blocks_text_test.go ui/internal/render/blocks_layout_test.go ui/internal/render/verb_test.go ui/cmd/rt-ui/verbs.go
```

```bash
git commit -m "rt-ui render: light diff tints from COLORFGBG, and a rule tone that reads on both backgrounds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The dispatcher prints through the layer

**Files:**
- Modify: `lib/command-tree.ts` (lines 18, 207-233, 270-275, 298-305, 328-359, 487-512, 536-544, 562-647)
- Modify: `lib/arg-collector.ts:58`
- Modify: `lib/repo.ts` (one import and one new function; Task 12 converts the rest of the file)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/arg-collector.ts"` and `"lib/command-tree.ts"`)
- Modify: `lib/__tests__/command-tree-help.test.ts`, `lib/__tests__/command-tree-program-verbs.test.ts`, `lib/__tests__/command-tree.test.ts`, `lib/__tests__/repo.test.ts`
- Create: `lib/__tests__/command-tree-header.test.ts`, `lib/__tests__/command-tree-hidden-warning.test.ts`
- Modify: `e2e/tests/smoke.test.ts`, `e2e/tests/glitter.test.ts`

**Interfaces:**
- Consumes: `out.note` (Task 3) and `out.isHuman(stream?: Stream): boolean` (phase 2: the gate `print` and `fail` apply, swappable through `out.__test__.setHuman`); `out.print`, `out.fail`, `out.kv`, `out.paragraph`, `out.section`, `out.table`, `out.strong`, `out.dim`, `out.cmd`, `FailureInput` (`lib/ui/out.ts`); `clearScreen` (`lib/ui/screen.ts`, Task 3); `warn` (`lib/ui/warn.ts`, Task 3); `repoLabel(serialized: string): string` (`lib/repo-label.ts`); `KnownRepo` (`lib/repo-index.ts`); `captureOut()` (`lib/ui/__tests__/capture-out.ts`).
- Produces: `export function missingRepoFailure(r: KnownRepo): FailureInput` in `lib/repo.ts` (Task 12 and slice 5c call it). `dispatch`, `showPicker`, `walkTree`, `isNodeVisible`, `BACK` keep their signatures. Plain output, fixed:
  - Branch help and a bare branch off a terminal, on stdout: `usage: <crumbs> <command>`, then `  <description>` when the node has one, then a blank line, `Commands`, and one `name  description` row per visible subcommand.
  - Leaf help, on stdout: `usage: <crumbs> <tokens>`, `  <description>`, `aliases: a, b` when there are any, then a blank line, `Arguments` and one row per declared arg, then for a node with subcommands a blank line, `Commands` and its rows.
  - Unknown command, on stderr, exit 1: `<crumbs> has no command called <name>`, `  next: <crumbs> --help`, `  Commands here: a, b`.
  - Terminal guard, on stderr, exit 1: `rt <label> needs an interactive terminal`, `  why: It asks questions or draws a screen, so a script or a pipe cannot run it.`
  - The breadcrumb: before the handler runs, `out.note(out.section("rt › <crumbs>", "dev mode" or undefined))` on stderr, only when `out.isHuman("stderr")` and the leaf is neither `fullscreen` nor `hidden`. It is its own render call: nothing follows it in that call and no blank line is printed under it, whatever block the command prints first. Plain form when the helper is missing: `rt › <crumbs>` or `rt › <crumbs> (dev mode)`.

- [ ] **Step 1: Rewrite the help test harness and add the exact-output tests**

In `lib/__tests__/command-tree-help.test.ts`:

Change the first import line to drop nothing and add two imports under the existing ones:

```ts
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
```

Replace the harness (the three `let ...Spy` declarations, `beforeEach`, `afterEach` and the `stdout` helper, lines 44 to 62) with:

```ts
let io: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;
let batch: string | undefined;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit sentinel");
  });
});

afterEach(() => {
  io.restore();
  exitSpy.mockRestore();
  if (batch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = batch;
});

const stdout = () => io.stdout();
```

Every existing test in the file keeps its body: they read `stdout()` and assert with `toContain`.

Append:

```ts
const fruit = (): Record<string, CommandNode> => ({
  fruit: {
    description: "Work with fruit",
    subcommands: {
      peel: { description: "Peel one", handler: noop },
      slice: { description: "Slice one", handler: noop },
    },
  },
});

const FRUIT_HELP = "usage: rt fruit <command>\n  Work with fruit\n\nCommands\npeel   Peel one\nslice  Slice one\n";

describe("the dispatcher's plain output", () => {
  test("branch help is a usage line, the description and the commands, on stdout", async () => {
    await expect(dispatch(fruit(), ["fruit", "--help"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toBe(FRUIT_HELP);
    expect(io.stderr()).toBe("");
  });

  test("a bare branch off a terminal prints the same help on stdout and exits 0", async () => {
    await expect(dispatch(fruit(), ["fruit"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(0);
    expect(stdout()).toBe(FRUIT_HELP);
    expect(io.stderr()).toBe("");
  });

  test("leaf help lists its arguments under a heading", async () => {
    await expect(dispatch(makeTree(), ["join", "--help"])).rejects.toThrow("exit sentinel");
    expect(stdout()).toBe(
      "usage: rt join <room> [--as <handle>] [--force]\n" +
        "  Join a room\n" +
        "aliases: j\n" +
        "\n" +
        "Arguments\n" +
        "<room>         room to join\n" +
        "--as <handle>  post as this handle\n" +
        "--force        skip confirmation\n",
    );
  });

  test("an unknown command is a failure on stderr that names where to look, exit 1", async () => {
    await expect(dispatch(fruit(), ["fruit", "bogus"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
    expect(stdout()).toBe("");
    expect(io.stderr()).toBe("rt fruit has no command called bogus\n  next: rt fruit --help\n  Commands here: peel, slice\n");
  });

  test("an unknown command name carrying an escape cannot repaint the terminal", async () => {
    await expect(dispatch(fruit(), ["fruit", "bo\x1b[2Jgus"])).rejects.toThrow("exit sentinel");
    expect(io.stderr()).not.toContain("\x1b");
    expect(io.stderr()).toStartWith("rt fruit has no command called bogus\n");
  });

  test("a command that needs a terminal says so on stderr and exits 1", async () => {
    const tree: Record<string, CommandNode> = { needy: { description: "Needs a terminal", requiresTTY: true, handler: noop } };
    await expect(dispatch(tree, ["needy"])).rejects.toThrow("exit sentinel");
    expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
    expect(stdout()).toBe("");
    // toEndWith: run from a terminal, the dispatcher's screen clear comes first.
    expect(io.stderr()).toEndWith("rt needy needs an interactive terminal\n  why: It asks questions or draws a screen, so a script or a pipe cannot run it.\n");
    expect(io.stderr()).not.toContain("[failed]");
  });
});
```

In `lib/__tests__/command-tree-program-verbs.test.ts`, add the same two imports, and in the `describe("rt.picker.hidden in listings", ...)` block replace the `logSpy`, `errSpy` and `stdout` declarations, `beforeEach` and `afterEach` (lines 46 to 67) with:

```ts
  let io: ReturnType<typeof captureOut>;
  let exitSpy: ReturnType<typeof spyOn>;
  const stdout = () => io.stdout();

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-program-verbs-")));
    process.env.HOME = home;
    io = captureOut();
    ui.__test__.setHuman(() => false);
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit sentinel");
    });
  });

  afterEach(() => {
    io.restore();
    exitSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });
```

and in the test `--all --help lists hidden verbs, and the next listing hides them again`, replace `logSpy.mockClear();` with:

```ts
    io.restore();
    io = captureOut();
    ui.__test__.setHuman(() => false);
```

In `lib/__tests__/command-tree.test.ts`, add the same two imports, and one file-level hook under the imports, so a test that fails before its own `io.restore()` cannot leave the human gate closed for the tests after it:

```ts
afterEach(() => ui.__test__.reset());
```

Then:

- In the test that ends at line 357 (the ambiguous `--repo`), replace `const errSpy = spyOn(console, "error").mockImplementation(() => {});` with:

```ts
    const io = captureOut();
    ui.__test__.setHuman(() => false);
```

  and replace `errSpy.mockRestore();` with:

```ts
    expect(io.stderr()).toContain("More than one repo is called app\n  why: It could be ");
    io.restore();
```

- In the test `context:"worktree" node: --repo <missing repo> refuses before any chdir` (line 381), replace `const errSpy = spyOn(console, "error").mockImplementation(() => {});` with the same two lines, replace `expect(errSpy.mock.calls.flat().join(" ")).toContain("rt repos locate");` with:

```ts
      expect(io.stderr()).toContain("is no longer where rt last saw it\n");
      expect(io.stderr()).toContain("  next: rt repos locate <new-path> --repo moved\n");
```

  and replace `errSpy.mockRestore();` in the `finally` with `io.restore();`.

- Add, right after the ambiguous `--repo` test and inside the same `describe` (its `afterEach` puts the module mocks back):

```ts
  test('context:"worktree" node: --repo <unknown name> fails and lists the repos rt knows', async () => {
    const real = realRepoModule;
    const known: KnownRepo = { repoName: "app", worktrees: [{ path: process.cwd(), branch: "main", isBare: false }], dataDir: "/fake/app-data" };
    mock.module("../repo.ts", () => ({
      ...real,
      getKnownRepos: () => [known],
      pickWorktreeFromRepo: async () => null,
      getRepoIdentity: () => null,
    }));
    mock.module("../repo-arg.ts", () => ({
      ...realRepoArgModule,
      tryResolveRepoArg: async () => ({ kind: "none" }),
    }));

    let reached = false;
    const exitSpy = spyOn(process, "exit").mockImplementation((() => { throw new Error("exited"); }) as never);
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    const tree: Record<string, CommandNode> = {
      cmd: { description: "test", context: "worktree", handler: async () => { reached = true; } },
    };

    await dispatch(tree, ["cmd", "--repo", "nope"]).catch(() => {});

    expect(reached).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
    // toEndWith: run from a terminal, the dispatcher's screen clear comes first.
    expect(io.stderr()).toEndWith("rt does not know a repo called nope\n  Repos rt knows: app\n");
    exitSpy.mockRestore();
    io.restore();
  });
```

Create `lib/__tests__/command-tree-header.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { dispatch, type CommandNode } from "../command-tree.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const FAKE = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
const CLEAR = "\x1b[2J\x1b[H";
let dir: string;
let record: string;
let io: ReturnType<typeof captureOut>;
let ttyDescriptor: PropertyDescriptor | undefined;
let batch: string | undefined;
const argv = process.argv;

function stderrIsTTY(value: boolean): void {
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
}

// The real gate, with only stderr's isTTY pinned: --json and RT_BATCH must
// close it the way they do for a person's run.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-header-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  io = captureOut();
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  stderrIsTTY(true);
});
afterEach(() => {
  process.argv = argv;
  if (ttyDescriptor) Object.defineProperty(process.stderr, "isTTY", ttyDescriptor);
  else delete (process.stderr as { isTTY?: boolean }).isTTY;
  if (batch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = batch;
  io.restore();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = (): Array<Record<string, unknown>> => (existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
// One entry per recorded line: "call" for the argv line that opens each
// render call, then the t of every wire line.
const wire = () => sent().map((l) => (typeof l.t === "string" ? l.t : "call"));

test("at a terminal the breadcrumb is drawn once, on stderr, before the handler runs", async () => {
  let drawnBeforeHandler = "";
  const tree: Record<string, CommandNode> = {
    show: {
      description: "Show it",
      handler: async () => {
        drawnBeforeHandler = io.stderr();
      },
    },
  };
  await dispatch(tree, ["show"]);
  expect(drawnBeforeHandler).toBe(CLEAR + "STYLED\n");
  expect(io.stderr()).toBe(CLEAR + "STYLED\n");
  expect(io.stdout()).toBe("");
  expect(wire()).toEqual(["call", "hello", "section"]);
  expect(sent()[2]).toMatchObject({ t: "section", title: "rt › show" });
});

test("a nested command's breadcrumb names the whole path", async () => {
  const tree: Record<string, CommandNode> = { fruit: { description: "Fruit", subcommands: { peel: { description: "Peel one", handler: async () => {} } } } };
  await dispatch(tree, ["fruit", "peel"]);
  expect(sent()[2]!.title).toBe("rt › fruit › peel");
});

test("with no helper the breadcrumb is one plain line on stderr", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(io.stderr()).toMatch(/^\x1b\[2J\x1b\[Hrt › show( \(dev mode\))?\n$/);
  expect(io.stdout()).toBe("");
});

test("a fullscreen command draws no breadcrumb", async () => {
  const tree: Record<string, CommandNode> = { board: { description: "Owns the screen", fullscreen: true, handler: async () => {} } };
  await dispatch(tree, ["board"]);
  expect(wire()).toEqual([]);
  expect(io.stderr()).toBe(CLEAR);
});

test("a hidden command draws no breadcrumb: a program runs it, at the person's terminal", async () => {
  const tree: Record<string, CommandNode> = { credential: { description: "Answers git", hidden: true, handler: async () => ui.payload("username=sample\n") } };
  await dispatch(tree, ["credential"]);
  expect(wire()).toEqual([]);
  expect(io.stdout()).toBe("username=sample\n");
  expect(io.stderr()).toBe(CLEAR);
});

test("no breadcrumb when stderr is not a terminal", async () => {
  stderrIsTTY(false);
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(wire()).toEqual([]);
  expect(io.stderr()).toBe("");
});

test("no breadcrumb under --json", async () => {
  process.argv = [...argv, "--json"];
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => ui.json({ ok: true }) } };
  await dispatch(tree, ["show", "--json"]);
  expect(wire()).toEqual([]);
  expect(io.stdout()).toBe('{"ok":true}\n');
});

test("no breadcrumb under RT_BATCH", async () => {
  process.env.RT_BATCH = "1";
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(wire()).toEqual([]);
});
```

Create `lib/__tests__/command-tree-hidden-warning.test.ts`:

```ts
import { test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { dispatch, type CommandNode } from "../command-tree.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../ui/warn.ts";

// mock.module mutates the live namespace in place, so the real binding is
// captured before any mock is installed.
const realResolve = await import("../settings/resolve.ts");
const realGetSetting = realResolve.getSetting;

const noop = async () => {};
const tree: Record<string, CommandNode> = {
  cd: { description: "Pick a directory", handler: noop },
  herd: { description: "Run a herd", handler: noop },
};

let io: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  warnings.reset();
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit sentinel");
  });
  mock.module("../settings/resolve.ts", () => ({
    ...realResolve,
    getSetting: () => {
      throw new Error("store unreadable");
    },
  }));
});
afterEach(() => {
  mock.module("../settings/resolve.ts", () => ({ ...realResolve, getSetting: realGetSetting }));
  warnings.reset();
  exitSpy.mockRestore();
  io.restore();
});

test("an unreadable hidden-commands setting still lists every command, and warns on stderr", async () => {
  await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
  expect(io.stderr()).toBe("rt: rt.picker.hidden could not be read, listing every verb: store unreadable\n");
  expect(io.stdout()).toContain("herd");
  expect(io.stdout()).toContain("cd");
});

test("in the CLI the person reads one warn line and the command that checks settings", async () => {
  const logged: string[] = [];
  setWarningLog((module, message) => {
    logged.push(`${module}: ${message}`);
  });
  await expect(dispatch(tree, ["--help"])).rejects.toThrow("exit sentinel");
  expect(logged).toEqual(["command-tree: rt.picker.hidden could not be read, listing every verb: store unreadable"]);
  expect(io.stderr()).toBe("[warning] Your list of hidden commands could not be read  every command is listed\n  next: rt settings check\n");
});
```

In `lib/__tests__/repo.test.ts`, add this import beside the file's other imports:

```ts
import { missingRepoFailure, type KnownRepo } from "../repo.ts";
```

and append (the file already imports `describe`, `expect` and `test` from `bun:test`):

```ts
describe("missingRepoFailure", () => {
  const moved: KnownRepo = { repoName: "moved", worktrees: [{ path: "/nonexistent/gone", branch: "", isBare: false }], dataDir: "/fake/moved-data", missing: true };

  test("says the repo is gone, where it was, and the command that points rt at it", () => {
    expect(missingRepoFailure(moved)).toEqual({
      title: "moved is no longer where rt last saw it",
      why: "It was at /nonexistent/gone.",
      next: { text: "rt repos locate <new-path> --repo moved", role: "command" },
    });
  });

  test("a row with no path leaves the why out", () => {
    expect(missingRepoFailure({ ...moved, worktrees: [] }).why).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/command-tree-help.test.ts lib/__tests__/command-tree-program-verbs.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/command-tree-header.test.ts lib/__tests__/command-tree-hidden-warning.test.ts lib/__tests__/repo.test.ts`
Expected: FAIL. Help still goes through `console.log`, which never passes through the `process.stdout.write` that `captureOut` patches, so `stdout()` is empty and the exact-output tests fail on their first `toBe`. The header test sees today's hand-colored breadcrumb on stderr and no render call; its hidden-leaf, `--json` and `RT_BATCH` cases see a breadcrumb where none should be. The hidden-warning test sees no `rt:` line (today's goes through `console.error`). `repo.test.ts` fails to load: `missingRepoFailure` is not exported.

- [ ] **Step 3: Add `missingRepoFailure` to `lib/repo.ts`**

`lib/repo.ts` has two locals named `out` today (`const out = execSync(...)` at lines 73 and 95, in `readOriginRemoteForIdentity` and in `toplevelOf`). Rename each to `text`, with every use inside its function, so neither shadows the import below.

Add to the imports (after the `repoLabel` import on line 23):

```ts
import * as out from "./ui/out.ts";
```

and add, after the import block:

```ts
/** The failure every caller draws in place of working in a repo whose folder is gone. */
export function missingRepoFailure(r: KnownRepo): out.FailureInput {
  const gone = r.worktrees[0]?.path;
  return {
    title: `${repoLabel(r.repoName)} is no longer where rt last saw it`,
    ...(gone ? { why: `It was at ${gone}.` } : {}),
    next: out.cmd(`rt repos locate <new-path> --repo ${r.repoName}`),
  };
}
```

Nothing else in `lib/repo.ts` changes in this task; it stays on the allowlist until Task 12.

- [ ] **Step 4: Convert `lib/command-tree.ts`**

Replace line 18:

```ts
import { bold, cyan, dim, reset, yellow } from "./tui.ts";
```

with:

```ts
import * as out from "./ui/out.ts";
import { clearScreen } from "./ui/screen.ts";
import { warn } from "./ui/warn.ts";
```

and change the type import on line 23 to:

```ts
import type { Block, PickAction, PickRow } from "./ui/protocol.ts";
```

In `dispatch`, replace the unknown-command block (lines 221 to 227; its one comment line is left out of the quote below):

```ts
    if (name) {
      const { yellow } = await import("./tui.ts");
      console.error(`\n  ${yellow}unknown command: ${name}${reset}`);
      console.error(`  ${dim}available: ${(await visibleEntries(tree, breadcrumb)).map(([k]) => k).join(", ")}${reset}\n`);
      process.exit(1);
    }
```

with:

```ts
    if (name) {
      const here = (await visibleEntries(tree, breadcrumb)).map(([k]) => k);
      const crumbs = breadcrumb.join(" ");
      out.fail({
        title: `${crumbs} has no command called ${name}`,
        next: out.cmd(`${crumbs} --help`),
        ...(here.length ? { details: `Commands here: ${here.join(", ")}` } : {}),
      });
      process.exit(1);
    }
```

Change the two `showUsage` calls to pass the root:

```ts
      await showUsage(tree, breadcrumb, root);
```

and

```ts
        await showUsage(node.subcommands, [...breadcrumb, resolvedName], root);
```

Replace the terminal guard body (lines 300 to 305):

```ts
  if (needsTTY && !process.stdin.isTTY && !process.env.RT_BATCH) {
    const { yellow } = await import("./tui.ts");
    const label = breadcrumb.slice(1).concat(resolvedName).join(" ");
    console.error(`\n  ${yellow}rt ${label} requires an interactive terminal${reset}\n`);
    process.exit(1);
  }
```

with:

```ts
  if (needsTTY && !process.stdin.isTTY && !process.env.RT_BATCH) {
    const label = breadcrumb.slice(1).concat(resolvedName).join(" ");
    out.fail({ title: `rt ${label} needs an interactive terminal`, why: "It asks questions or draws a screen, so a script or a pipe cannot run it." });
    process.exit(1);
  }
```

In the `--repo` branch, change the destructuring import on line 330 to name `missingRepoFailure` in place of `missingRepoRefusal`:

```ts
      const { getKnownRepos, pickWorktreeFromRepo, getRepoIdentity, missingRepoFailure } = await import("./repo.ts");
```

and replace lines 345 to 359 (from `if (!repo) {` through the closing brace of `if (repo.missing) { ... }`):

```ts
      if (!repo) {
        const { repoLabel, repoLabelQualified } = await import("./repo-label.ts");
        const known = repos.map((r) => repoLabel(r.repoName)).join(", ");
        out.fail(
          resolution.kind === "ambiguous"
            ? { title: `More than one repo is called ${repoFlag}`, why: `It could be ${resolution.matches.map(repoLabelQualified).join(" or ")}. Use the full name of the one you mean.` }
            : { title: `rt does not know a repo called ${repoFlag}`, ...(known ? { details: `Repos rt knows: ${known}` } : {}) },
        );
        process.exit(1);
      }
      // A missing row still resolves by name (that's the point... locate it),
      // but its one synthetic worktree is a dead path: never chdir into it.
      if (repo.missing) {
        out.fail(missingRepoFailure(repo));
        process.exit(1);
      }
```

(The comment above `if (repo.missing)` exists today with a long dash; rewrite it as shown, since this plan's files carry none.)

Replace the Rendering section's `clearScreen` and `renderHeader` (lines 487 to 512) with:

```ts
/**
 * Drawn before the handler runs, so it is the first thing on screen whatever
 * the command paints first: a step on /dev/tty, a child given the terminal,
 * its own output. Decoration belongs to a person's terminal, and to stderr:
 * stdout may be a payload, and a caller reading a piped stderr for a failure
 * reason must find the error first. A hidden leaf is run by a program (git
 * runs the credential helper at the person's terminal), so it gets none.
 */
function renderHeader(node: CommandNode, breadcrumb: string[]): void {
  if (node.fullscreen || node.hidden || !out.isHuman("stderr")) return;
  out.note(out.section(breadcrumb.join(" › "), IS_DEV_MODE ? "dev mode" : undefined));
}
```

`clearScreen` is now the imported one; its call sites do not change. `renderHeader` takes the node now, so each of its six call sites (lines 296, 375, 389, 402, 439 and 479), which all read `if (!node.fullscreen) renderHeader([...breadcrumb, resolvedName]);`, becomes:

```ts
renderHeader(node, [...breadcrumb, resolvedName]);
```

with the indentation each had. The five after the first redraw the breadcrumb after a picker cleared the screen; each is one more render call, as each was one more print before.

Replace the `catch` in `readHiddenVerbs` (line 540 to 543):

```ts
  } catch (err) {
    warn("command-tree", `rt.picker.hidden could not be read, listing every verb: ${err instanceof Error ? err.message : String(err)}`, {
      show: { title: "Your list of hidden commands could not be read", hint: "every command is listed", next: out.cmd("rt settings check") },
    });
    return [];
  }
```

Replace `showUsage` (lines 562 to 570) with:

```ts
async function showUsage(tree: Record<string, CommandNode>, breadcrumb: string[], root: Record<string, CommandNode>): Promise<void> {
  out.print(...(await branchHelp(tree, breadcrumb, root)));
}
```

Replace everything from the `helpColors` doc comment through the end of `printLeafHelp` (lines 576 to 647), keeping `const HELP_FLAGS`, `slugArg` and `argToken` as they are, with:

```ts
function listing(visible: [string, CommandNode][]): Block {
  return out.table(visible.map(([name, sub]) => [out.strong(name), out.dim(sub.description)]));
}

async function branchHelp(tree: Record<string, CommandNode>, breadcrumb: string[], root: Record<string, CommandNode>): Promise<Block[]> {
  const node = nodeAtPath(root, breadcrumb.slice(1));
  const visible = await visibleEntries(tree, breadcrumb);
  return [
    out.kv("usage", `${breadcrumb.join(" ")} <command>`),
    ...(node?.description ? [out.paragraph(node.description)] : []),
    ...(visible.length ? [out.section("Commands", undefined, listing(visible))] : []),
  ];
}

async function printBranchHelp(tree: Record<string, CommandNode>, breadcrumb: string[], root: Record<string, CommandNode>): Promise<void> {
  out.print(...(await branchHelp(tree, breadcrumb, root)));
}

async function printLeafHelp(node: CommandNode, breadcrumb: string[]): Promise<void> {
  const args = node.args ?? [];
  const tokens = [...args.filter((a) => !a.flag).map(argToken), ...args.filter((a) => a.flag).map(argToken)];
  if (node.subcommands) tokens.push("[<command>]");

  const blocks: Block[] = [out.kv("usage", [...breadcrumb, ...tokens].join(" ")), out.paragraph(node.description)];
  if (node.aliases?.length) blocks.push(out.kv("aliases", node.aliases.join(", ")));

  if (args.length) {
    const rows = args.map((a) => {
      const token = a.flag ? (a.type === "boolean" ? a.flag : `${a.flag} <${slugArg(a.name)}>`) : `<${slugArg(a.name)}>`;
      let detail = a.hint ?? a.name;
      if (a.default !== undefined) detail += `  (default: ${a.default})`;
      return [out.strong(token), out.dim(detail)];
    });
    blocks.push(out.section("Arguments", undefined, out.table(rows)));
  }

  if (node.subcommands) {
    const visible = await visibleEntries(node.subcommands, breadcrumb);
    if (visible.length) blocks.push(out.section("Commands", undefined, listing(visible)));
  }
  out.print(...blocks);
}
```

Delete `printCommandListing`; `listing` replaces it.

After this step the file has no `console.` call, no `process.stdout`, no `process.stderr` beyond `isTTY`, no color import and no escape literal. The file header comment (lines 1 to 16) holds a breadcrumb example with `›`, which is fine.

- [ ] **Step 5: Convert `lib/arg-collector.ts`**

Add under the existing import:

```ts
import { clearScreen } from "./ui/screen.ts";
```

and replace line 58, `process.stderr.write("\x1b[2J\x1b[H");`, with:

```ts
    clearScreen();
```

- [ ] **Step 6: Delete the two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete the lines `"lib/arg-collector.ts",` and `"lib/command-tree.ts",`.

- [ ] **Step 7: Run the unit tests and the guards**

Run: `bun test lib/__tests__/command-tree-help.test.ts lib/__tests__/command-tree-program-verbs.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/command-tree-header.test.ts lib/__tests__/command-tree-hidden-warning.test.ts lib/__tests__/repo.test.ts lib/__tests__/command-tree-devonly.test.ts lib/__tests__/arg-collector.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Update the e2e assertions on dispatcher text**

In `e2e/tests/smoke.test.ts`:

- Change `listedVerbs` so it reads the plain table, whose rows start at column 0:

```ts
  const listedVerbs = (stdout: string) =>
    stdout.split("\n").map((line) => line.match(/^([a-z-]+) {2,}\S/)?.[1]).filter(Boolean);
```

- In `rt git in non-TTY lists subcommands`, change `const output = result.stderr;` to `const output = result.stdout;` and add `expect(output).toStartWith("usage: rt git <command>\n");`.
- In `rt nonexistent exits non-zero with error`, change the last assertion to:

```ts
    expect(result.stderr).toStartWith("rt has no command called nonexistent\n  next: rt --help\n");
    expect(result.stdout).toBe("");
```

In `e2e/tests/glitter.test.ts:11`, change the expected string to `"rt glitter needs an interactive terminal"`.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/smoke.test.ts e2e/tests/glitter.test.ts e2e/tests/plugins.test.ts e2e/tests/skills-sync.test.ts e2e/tests/state-db.test.ts`
Expected: PASS, apart from the `rt plugin new` test in `plugins.test.ts`, which fails on this machine with a mise shim error and is not this slice's (herd notes).

- [ ] **Step 9: Commit**

```bash
git add lib/command-tree.ts lib/arg-collector.ts lib/repo.ts lib/__tests__/raw-output-allowlist.json lib/__tests__/command-tree-help.test.ts lib/__tests__/command-tree-program-verbs.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/command-tree-header.test.ts lib/__tests__/command-tree-hidden-warning.test.ts lib/__tests__/repo.test.ts e2e/tests/smoke.test.ts e2e/tests/glitter.test.ts
```

```bash
git commit -m "dispatcher: help, usage, unknown command and refusals print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Repo refusals and the daemon-down note

**Files:**
- Modify: `lib/repo.ts` (at `5bc69f231`: lines 200 to 212, 238 to 251, 268 to 271, 284 to 300, 385 to 388, 445 to 448; Task 11 added a few lines above them)
- Modify: `lib/daemon-client.ts` (imports, lines 243 to 249, and a `__test__` export)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/daemon-client.ts"` and `"lib/repo.ts"`)
- Create: `lib/__tests__/daemon-client-down-notice.test.ts`
- Modify: `lib/__tests__/repo-index-missing.test.ts:127-140`
- Modify: `e2e/tests/errors.test.ts` (append one test)

**Interfaces:**
- Consumes: `out.fail`, `out.note`, `out.line`, `out.callout`, `out.cmd` (`lib/ui/out.ts`); `missingRepoFailure(r: KnownRepo): FailureInput` and the `import * as out from "./ui/out.ts"` line in `lib/repo.ts` (both added in Task 11).
- Produces:
  - `lib/repo.ts`: `requireIdentity`, `requireRepoIdentity`, `pickWorktree`, `pickRepoInteractive` keep their signatures and exit codes; their refusals move from stdout to stderr.
  - `lib/daemon-client.ts`: `export const __test__ = { warnDaemonDown, resetDownWarning }`. `suppressDaemonDownWarning` is unchanged.

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/repo-index-missing.test.ts`, add two imports beside the others:

```ts
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
```

and replace the body of `pickWorktree still refuses when the only row is a missing one` (lines 127 to 140) with:

```ts
  test("pickWorktree still refuses when the only row is a missing one", async () => {
    setKvValue("repo-index", "gone", join(scratch, "gone-away"));
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit sentinel");
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await expect(pickWorktree("Pick a repo")).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toStartWith("gone is no longer where rt last saw it\n");
      expect(io.stderr()).toContain("  next: rt repos locate <new-path> --repo gone\n");
    } finally {
      io.restore();
      exitSpy.mockRestore();
    }
  });
```

The test at line 150 (`pickFromAllRepos refuses to cd into a missing repo`) goes through `lib/pickers.ts` and is 5c's; leave it. If `spyOn` is still used by that test, its import stays.

Create `lib/__tests__/daemon-client-down-notice.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { __test__, suppressDaemonDownWarning } from "../daemon-client.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  __test__.resetDownWarning();
});
afterEach(() => {
  __test__.resetDownWarning();
  io.restore();
});

test("the daemon-down note is one warn line and the command to run, on stderr, once", () => {
  __test__.warnDaemonDown();
  __test__.warnDaemonDown();
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[warning] The rt daemon is not running\n  next: rt daemon start\n");
});

test("a caller that owns the screen can silence it", () => {
  suppressDaemonDownWarning();
  __test__.warnDaemonDown();
  expect(io.stderr()).toBe("");
});
```

Append to `e2e/tests/errors.test.ts`, inside the `describe`:

```ts
  test("a repo verb run outside any repo, with none known, fails on stderr and leaves stdout empty", async () => {
    const fresh = createTestHome();
    try {
      const result = await rt(["hooks"], { home: fresh.path });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "You are not in a git repo, and rt does not know any repos yet\n  next: Run rt once from inside a git repo, so it learns where that repo is\n",
      );
    } finally {
      fresh.cleanup();
    }
  }, 30_000);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/daemon-client-down-notice.test.ts lib/__tests__/repo-index-missing.test.ts`
Expected: FAIL: `__test__` is undefined; and the `pickWorktree` test finds an empty stderr capture, because today's refusal goes through `console.error`.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/errors.test.ts`
Expected: the new test FAILS: stdout holds today's two `not in a git repo and no known repos found` lines and stderr is empty.

- [ ] **Step 3: Convert `lib/repo.ts`**

`lib/repo.ts` already imports `out` and defines `missingRepoFailure` (Task 11). Under that function, add:

```ts
const LEARN_A_REPO = "Run rt once from inside a git repo, so it learns where that repo is";

function failNoRepos(title: string): never {
  out.fail({ title, next: LEARN_A_REPO });
  process.exit(1);
}

function failCannotAsk(): never {
  out.fail({
    title: "You are not in a git repo",
    why: "rt knows more than one repo and cannot ask which one you mean without a terminal.",
    next: "Run this from inside the repo you mean",
  });
  process.exit(1);
}

function failUnidentified(): never {
  out.fail({ title: "rt could not tell which repo this is", why: "The folder it ended up in is not a git repo it can read." });
  process.exit(1);
}
```

Then replace each site:

- `requireIdentity` (lines 201 to 204):

```ts
  if (!identity) failUnidentified();
  return identity;
```

- `refuseIfMissing` (lines 209 to 212):

```ts
  if (!repo.missing) return;
  out.fail(missingRepoFailure(repo));
  process.exit(1);
```

- `requireRepoIdentity`, the empty-index block (lines 238 to 242):

```ts
  if (repos.length === 0) failNoRepos("You are not in a git repo, and rt does not know any repos yet");
```

- `requireRepoIdentity`, the non-TTY block (lines 248 to 251):

```ts
    if (!process.stdin.isTTY) failCannotAsk();
```

- `requireRepoIdentity`, the tail (lines 268 to 272):

```ts
  if (!identity) failUnidentified();
  return identity;
```

- `pickWorktree`, the empty-index block (lines 284 to 288):

```ts
  if (repos.length === 0) failNoRepos("You are not in a git repo, and rt does not know any repos yet");
```

- `pickWorktree`, the non-TTY block (lines 297 to 300):

```ts
  if (!process.stdin.isTTY) failCannotAsk();
```

- `pickRepoInteractive`, the empty-index block (lines 385 to 388):

```ts
  if (repos.length === 0) failNoRepos("rt does not know any repos yet");
```

- `pickRepoInteractive`, the tail (lines 445 to 449):

```ts
  if (!identity) failUnidentified();
  return identity;
```

`missingRepoRefusal` stays imported and re-exported: `commands/cd.ts` and `lib/pickers.ts` (5c) still call it. If the import on line 22 becomes unused in this file, keep the re-export on line 17 and drop only the unused local import name.

- [ ] **Step 4: Convert `lib/daemon-client.ts`**

Add to the imports:

```ts
import * as out from "./ui/out.ts";
```

Replace `warnDaemonDown` (lines 243 to 249):

```ts
function warnDaemonDown(): void {
  if (hasWarnedThisSession || _warningSuppressed) return;
  hasWarnedThisSession = true;
  out.note(out.line("warn", "The rt daemon is not running"), out.callout("next", out.cmd("rt daemon start")));
}
```

and add at the end of the file:

```ts
export const __test__ = {
  warnDaemonDown,
  resetDownWarning(): void {
    hasWarnedThisSession = false;
    _warningSuppressed = false;
  },
};
```

- [ ] **Step 5: Delete the two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete `"lib/daemon-client.ts",` and `"lib/repo.ts",`.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/__tests__/repo.test.ts lib/__tests__/repo-index-missing.test.ts lib/__tests__/daemon-client-down-notice.test.ts lib/__tests__/daemon-client-attribution.test.ts lib/__tests__/daemon-client-tray.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-daemon-sync-exec.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors. The three `fail...` helpers are declared `never`, so `identity` narrows after each call.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/errors.test.ts`
Expected: PASS, the new test included.

- [ ] **Step 7: Commit**

```bash
git add lib/repo.ts lib/daemon-client.ts lib/__tests__/raw-output-allowlist.json lib/__tests__/daemon-client-down-notice.test.ts lib/__tests__/repo-index-missing.test.ts e2e/tests/errors.test.ts
```

```bash
git commit -m "repo refusals and the daemon-down note print through the output layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `cli.ts` leaves the allowlist

**Files:**
- Modify: `cli.ts` (lines 33 to 61, 85 to 92, 152 to 156)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"cli.ts"`)
- Modify: `e2e/tests/first-run.test.ts` (append two tests)
- Modify: `lib/endpoint/__tests__/intercept-run.test.ts:148-170`

**Interfaces:**
- Consumes: `out.note`, `out.line`, `out.callout`, `out.strong`, `out.cmd` (`lib/ui/out.ts`, Task 3); `setWarningLog(log, { quiet })` (`lib/ui/warn.ts`, Task 3); `logCliEvent`, `installCliLogging` (`lib/cli-logger.ts`); `migrateLegacyRtDir`, `migrateLegacyPluginsDir`, `LEGACY_RT_LABEL` (`~/.rt`), `RT_DIR_LABEL` (`~/.mattstack/rt`) (`lib/rt-paths.ts`).
- Produces: no exports. Plain strings on stderr:
  - `[ok] Moved your rt data to its new folder  ~/.mattstack/rt`
  - `[warning] Your rt data is in two folders` / `  note: rt only reads ~/.mattstack/rt` / `  fix: Merge ~/.rt into it by hand, then delete ~/.rt`
  - `[ok] Moved your plugins so they travel with your home repo  ~/.mattstack/user/plugins`
  - `[warning] Your plugins are in two folders` / `  note: rt only reads ~/.mattstack/user/plugins` / `  fix: Merge ~/.mattstack/rt/plugins into it by hand, then delete ~/.mattstack/rt/plugins`
  - `[needs you] rt is not set up yet` / `  next: Open mattstack.app, or run rt setup install`

- [ ] **Step 1: Write the failing tests**

In `e2e/tests/first-run.test.ts`, add `mkdirSync` to the `fs` import and `rt` to the harness import, and append inside the `describe`:

```ts
  test("a legacy rt folder moved into place is reported once, on stderr", async () => {
    const fresh = createTestHome();
    try {
      mkdirSync(join(fresh.path, ".rt", "logs"), { recursive: true });
      const result = await rt(["--version"], { home: fresh.path });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^rt /);
      expect(result.stderr).toBe("[ok] Moved your rt data to its new folder  ~/.mattstack/rt\n");
    } finally {
      fresh.cleanup();
    }
  }, 30_000);

  test("rt data in two folders is one warning with the fix, and stdout stays the payload", async () => {
    const fresh = createTestHome();
    try {
      mkdirSync(join(fresh.path, ".rt", "logs"), { recursive: true });
      mkdirSync(join(fresh.path, ".mattstack", "rt"), { recursive: true });
      const result = await rt(["--version"], { home: fresh.path });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^rt /);
      expect(result.stderr).toBe(
        "[warning] Your rt data is in two folders\n  note: rt only reads ~/.mattstack/rt\n  fix: Merge ~/.rt into it by hand, then delete ~/.rt\n",
      );
    } finally {
      fresh.cleanup();
    }
  }, 30_000);
```

`logs` is one of the three entries (`state.db`, `logs`, `repos.json`) that mark a `~/.rt` as rt's own (`RT_SIGNATURE_ENTRIES` in `lib/rt-paths.ts`).

In `lib/endpoint/__tests__/intercept-run.test.ts`, make the split state real and assert the new wording stays off the intercept path. Change `mkdirSync(join(tmpHome, ".rt"), { recursive: true });` to:

```ts
    mkdirSync(join(tmpHome, ".rt", "logs"), { recursive: true });
```

and replace the last two assertions (`not.toContain("WARNING")` and `not.toContain("migrated legacy")`) with:

```ts
    expect(stderr).not.toContain("two folders"); // no legacy-state warning
    expect(stderr).not.toContain("Moved your");
    expect(stderr).toBe("");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/first-run.test.ts`
Expected: FAIL: stderr is today's `  rt: migrated legacy ~/.rt state to ~/.mattstack/rt`.

Run: `bun test lib/endpoint/__tests__/intercept-run.test.ts`
Expected: PASS already, and it must still pass after Step 3. The new `expect(stderr).toBe("")` is stricter than the assertions it replaces, so this run is what shows whether it holds today (it did when this plan was written: `rt intercept run echo -- hello` under a split-state home printed nothing on stderr). If it fails here, before any `cli.ts` edit, something else on the intercept path writes to stderr: drop that one line, keep the two `not.toContain` lines, and name what was printed in the report.

- [ ] **Step 3: Convert `cli.ts`**

Replace the legacy migration block (lines 33 to 61, from the `// ─── Legacy state migration (RT-46)` rule through the closing brace of the block) with:

```ts
// ─── Legacy state migration (RT-46) ──────────────────────────────────────────
// Move a real legacy rt dir into place BEFORE anything (the CLI logger
// included) can create the new tree and turn a clean rename into a conflict.
// The daemon entry runs its own copy of this (lib/daemon.ts) for the
// `bun run lib/daemon.ts` source path; the call is idempotent.
//
// The migration runs on EVERY entry path, intercepts included: an
// intercepted command really can be the first rt invocation after an upgrade.
const stateMigration = migrateLegacyRtDir();
const pluginsMigration = migrateLegacyPluginsDir();

// Called from __main: the output layer loads on demand, and a top-level
// await here would block bytecode compilation. The intercept path stays
// silent, since its stderr belongs to the wrapped command and a split-state
// warning would land there on every invocation.
async function reportMigrations(): Promise<void> {
  if (isInterceptRun) return;
  const acted = (result: string) => result === "migrated" || result === "conflict";
  if (!acted(stateMigration) && !acted(pluginsMigration)) return;
  const out = await import("./lib/ui/out.ts");
  if (stateMigration === "migrated") {
    out.note(out.line("done", "Moved your rt data to its new folder", RT_DIR_LABEL));
  } else if (stateMigration === "conflict") {
    out.note(
      out.line("warn", "Your rt data is in two folders"),
      out.callout("note", ["rt only reads ", out.strong(RT_DIR_LABEL)]),
      out.callout("fix", ["Merge ", out.strong(LEGACY_RT_LABEL), " into it by hand, then delete ", out.strong(LEGACY_RT_LABEL)]),
    );
  }
  if (pluginsMigration === "migrated") {
    out.note(out.line("done", "Moved your plugins so they travel with your home repo", "~/.mattstack/user/plugins"));
  } else if (pluginsMigration === "conflict") {
    out.note(
      out.line("warn", "Your plugins are in two folders"),
      out.callout("note", ["rt only reads ", out.strong("~/.mattstack/user/plugins")]),
      out.callout("fix", ["Merge ", out.strong("~/.mattstack/rt/plugins"), " into it by hand, then delete ", out.strong("~/.mattstack/rt/plugins")]),
    );
  }
}
```

In `__main`, replace the logging block (lines 89 to 92):

```ts
if (args[0] !== "--daemon") {
  const { installCliLogging } = await import("./lib/cli-logger.ts");
  installCliLogging(args);
}
```

with:

```ts
if (args[0] !== "--daemon") {
  const { installCliLogging, logCliEvent } = await import("./lib/cli-logger.ts");
  installCliLogging(args);
  // The daemon never sets this: its warnings stay on its own log surface.
  const { setWarningLog } = await import("./lib/ui/warn.ts");
  setWarningLog((module, message, context) => logCliEvent("warn", module, message, context), { quiet: isInterceptRun });
}
await reportMigrations();
```

Replace the first-run hint's print (lines 154 to 156):

```ts
    if (!existsSync(join(rtDir(), "daemon.json"))) {
      const out = await import("./lib/ui/out.ts");
      out.note(out.line("needs-you", "rt is not set up yet"), out.callout("next", ["Open mattstack.app, or run ", out.cmd("rt setup install")]));
    }
```

The comment block above the first-run hint has a long dash in its first sentence (`owns getting a machine set up`); while editing next to it, rewrite that dash as `...`. The file header comment on line 4 (`rt`, then a long dash, then `Zero-footprint repo CLI.`) gets the same edit.

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete `"cli.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/endpoint/__tests__/intercept-run.test.ts lib/__tests__/command-tree.test.ts`
Expected: PASS. The guard scans `cli.ts` and finds nothing raw.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/first-run.test.ts e2e/tests/smoke.test.ts e2e/tests/errors.test.ts e2e/tests/state-db.test.ts`
Expected: PASS. `first run prints the not-set-up hint` still finds `rt is not set up yet` and `rt setup`; `rt --help leaves no database behind` still holds, since wiring the warning log opens nothing.

- [ ] **Step 6: Commit**

```bash
git add cli.ts lib/__tests__/raw-output-allowlist.json e2e/tests/first-run.test.ts lib/endpoint/__tests__/intercept-run.test.ts
```

```bash
git commit -m "cli: pre-dispatch notices go through out.note, and lib warnings reach the cli log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Renders, AGENTS.md, the spec, and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` ("Rules" rule 3 and "Steps")
- Modify: `docs/design/output-layer/README.md`
- Create or replace under `docs/design/output-layer/`: `fixture-dark.png`, `fixture-light.png`, `dispatcher-dark.png`, `dispatcher-light.png`, `wrap-narrow-dark.png`, `wrap-narrow-light.png`

**Interfaces:**
- Consumes: everything above; `ui/dist/rt-ui` built by `bun run ui:build`.
- Produces: the renders the PR carries, and the rules the other slices read in `AGENTS.md`.

- [ ] **Step 1: Build the helper and write the render inputs**

Run: `bun run ui:build`

In the session scratchpad (not the repo), write `blocks.ts`. It prints NDJSON for one named set, using the real builders:

```ts
// usage: bun blocks.ts <fixture|dispatcher|wrap> > in.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";

const fixture = JSON.parse(await Bun.file("<repo>/ui/fixtures/render-document.json").text()) as object[];
const sets: Record<string, object[]> = {
  fixture,
  dispatcher: [
    out.section("rt › daemon › status", "dev mode"),
    out.kv("usage", "rt git <command>"),
    out.paragraph("Git shortcuts for the branch you are on"),
    out.section("Commands", undefined, out.table([[out.strong("rebase"), out.dim("Rebase onto the latest main")], [out.strong("push"), out.dim("Push this branch")]])),
    out.kv("usage", "rt join <room> [--as <handle>] [--force]"),
    out.paragraph("Join a room"),
    out.kv("aliases", "j"),
    out.section("Arguments", undefined, out.table([[out.strong("<room>"), out.dim("room to join")], [out.strong("--as <handle>"), out.dim("post as this handle")], [out.strong("--force"), out.dim("skip confirmation")]])),
    out.failure({ title: "rt git has no command called bogus", next: out.cmd("rt git --help"), details: "Commands here: rebase, reset, commit, push, pull" }),
    out.failure({ title: "rt glitter needs an interactive terminal", why: "It asks questions or draws a screen, so a script or a pipe cannot run it." }),
    out.failure({ title: "sample-app is no longer where rt last saw it", why: "It was at /Users/sample/code/sample-app.", next: out.cmd("rt repos locate <new-path> --repo github.com/example/sample-app") }),
    out.failure(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto.")),
    out.line("warn", "The rt daemon is not running"),
    out.callout("next", out.cmd("rt daemon start")),
    out.line("needs-you", "rt is not set up yet"),
    out.callout("next", ["Open mattstack.app, or run ", out.cmd("rt setup install")]),
    out.line("warn", "Your rt data is in two folders"),
    out.callout("note", ["rt only reads ", out.strong("~/.mattstack/rt")]),
    out.callout("fix", ["Merge ", out.strong("~/.rt"), " into it by hand, then delete ", out.strong("~/.rt")]),
    out.line("warn", "Your repo folders setting could not be read", "rt is looking in its usual places only"),
    out.callout("next", out.cmd("rt settings check")),
  ],
  wrap: [
    out.line("done", "pre-commit", "on"),
    out.line("off", "pre-push", "you turned this one off last week and it stays off until you turn it on"),
    out.line("warn", "a status title that is far too long to leave any room for a hint column", "so its hint goes below"),
    out.callout("note", "Pushing again needs --force-with-lease so nothing on the remote is lost"),
    out.table([[out.strong("rebase"), out.dim("Rebase onto the latest main")]], ["COMMAND", "WHAT IT DOES"]),
    out.tree("rt.worktreeApp", [["user", out.dim("not set")], ["team", out.dim("true")]]),
  ],
};
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + sets[process.argv[2] ?? "fixture"]!.map(encodeLine).join(""));
```

Replace `<repo>` with the worktree's absolute path. All sample names are invented.

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

- [ ] **Step 2: Render six pages**

For each of `fixture` (width 80), `dispatcher` (width 100) and `wrap` (width 48), render twice. The dark page uses no `COLORFGBG`; the light page sets `COLORFGBG=0;15`, which is how a light terminal that reports its background reaches the light diff tints:

```bash
bun blocks.ts fixture > fixture.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 80 < fixture.ndjson > fixture-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 80 < fixture.ndjson > fixture-light.ansi
bun ansi-page.ts dark fixture < fixture-dark.ansi > fixture-dark.html
bun ansi-page.ts light fixture < fixture-light.ansi > fixture-light.html
```

Run these one at a time from the scratchpad, then the same five lines for `dispatcher` and `wrap` with their widths.

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`bunx serve -l 4173 .` or `python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot each of the six pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the six PNGs into `docs/design/output-layer/` under the names in this task's Files list.

Then read each PNG and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- The diff rows: dark bands with mint and coral text on dark; pale green and pale pink bands with dark text on light.
- The table rule and the tree branches: visible on dark, not heavier than a hint on light.
- The wrapped hint sits in its own column; the long title's hint sits under the title; `--force-with-lease` is whole.
- The breadcrumb header directly above a block with no blank line between them (rule 8): does it crowd the output? Render it twice: above a `kv`, and above a command whose first block is a `section` (two bold rows stacking can read as one heading). If the second reads wrong, the dispatcher writes one blank line after the header as today does, and `command-tree-header.test.ts` pins it; say which you chose in the report. (In the `dispatcher` set the header is the first block of one call; on a real run it is a call of its own and the command's output is the next, which paints the same rows.)
- Help: the `usage` key in lavender, the command line in bold, the `Commands` and `Arguments` headings.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

Then measure what one helper launch costs, since the breadcrumb is a render call of its own on every non-fullscreen command at a terminal. From the scratchpad, time twenty runs of the helper on the `dispatcher` input and report the median:

```ts
// usage: bun time-render.ts <repo>/ui/dist/rt-ui dispatcher.ndjson
const [bin, file] = process.argv.slice(2) as [string, string];
const input = await Bun.file(file).arrayBuffer();
const times: number[] = [];
for (let i = 0; i < 20; i++) {
  const t0 = performance.now();
  const r = Bun.spawnSync([bin, "render", "--width", "100"], { stdin: new Uint8Array(input), stdout: "pipe" });
  if (r.exitCode !== 0) throw new Error(`render exited ${r.exitCode}`);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`median ${times[10]!.toFixed(1)} ms, min ${times[0]!.toFixed(1)} ms, max ${times[19]!.toFixed(1)} ms`);
```

The number goes in the report and the PR body. The spec's spike measured about 15 ms; say so if this is far from it.

- [ ] **Step 4: Update `docs/design/output-layer/README.md`**

Add three rows to the table:

```markdown
| `dispatcher-dark.png`, `dispatcher-light.png` | the dispatcher at 100 columns: the breadcrumb header, branch and leaf `--help`, an unknown command, the terminal guard, a missing repo, a usage failure, and the notes for a stopped daemon, a first run, split rt data and an unreadable setting |
| `wrap-narrow-dark.png`, `wrap-narrow-light.png` | 48 columns: a hint wrapping in its own column, a long title taking its hint below, a flag kept whole, and the rule and tree tone |
```

and replace the paragraph that begins "Known at the time of these renders" with:

```markdown
The light pages are rendered with `COLORFGBG=0;15`, which is how a light
terminal that reports its background gets the pale diff tints. A light
terminal that does not set `COLORFGBG` still gets the dark diff bands:
`rt-ui render` writes to a pipe and never opens the terminal, so it cannot ask.
The rail beside a `copy` or `verbatim` block keeps the `Panel` tone and is
faint on dark.
```

- [ ] **Step 5: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
`out.note(...blocks)` prints for a person on stderr whatever the verb: use it
for a notice that fires before the verb is known or under any verb, since
stdout may be a payload or a `--json` envelope. It does not follow
`payloadOnStdout`. Code under `lib/` never calls `console.warn`: it calls
`warn(module, message, { context, show })` from `lib/ui/warn.ts`. The message
always reaches a log (the CLI log in the CLI; a plain `rt:` stderr line in the
daemon, whose stderr is already captured), and a person sees a line only when
`show` says what they should read, once per process. A test of such a line
reads stderr through `captureOut()` or sets a fake with `setWarningLog`, and
calls `__test__.reset()` from `lib/ui/warn.ts` before and after; a
`console.warn` spy sees nothing.

The dispatcher draws the breadcrumb before the handler runs, through
`out.note`, on stderr, when a person is reading stderr (a terminal, no
`--json`, no `RT_BATCH`) and the leaf is neither `fullscreen` nor `hidden`.
It is its own render call (one helper launch per command), so it is first on
screen whatever the command paints first, and no blank line follows it.

A spinner that should leave nothing behind is `withTransientStep(label, task)`
from `lib/ui/transient-step.ts`: the Go step draws it and a `done` event
carrying `clear: true` erases it when the task settles. The flag rides `done`
so a helper that predates it ends the step with a plain row; a source checkout
runs the installed helper when `ui/dist/rt-ui` is missing or stale, so run
`bun run ui:build` after pulling. It loads `lib/ui/spawn.ts` on first use, so
a file the daemon also loads may import it; keep it that way.

A usage error is `out.fail(usageFailure(title, usage, why))` from
`lib/ui/usage.ts`: the title asks for what is missing in plain words and the
usage line is the `next` command, never part of the sentence. The `--json`
error string stays as it was.

Off a terminal, a failure that opens the output prints its title with no
`[failed]` tag, because the app shows the first bytes of stderr to a person as
they are. A test of a human failure asserts the title at the start of stderr.
A failure printed after another block, a title that starts with `[` (leading
spaces aside), and a `line` with status `failed` keep the tag.

Both renderers drop bidi controls and zero-width characters from every field
(`ui/fixtures/clean-cases.json` is the shared test). Wrapped text breaks at
spaces only, so a flag or a branch name is never split at a hyphen;
`textwrap.Spans` keeps its hyphen breaks for the mission diff, and prose goes
through `textwrap.SpansWith` with `WordsOnly`. `rt-ui render` reads
`COLORFGBG` and paints the diff with pale tints on a light background; with no
`COLORFGBG` it keeps the dark tints.
```

Wrap the new paragraphs at about 78 columns like the ones above them; prettier ignores root Markdown files, so nothing reflows them.

- [ ] **Step 6: Bring the spec in line**

In `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`:

Under "Rules", rule 3 reads `**Failures go to stderr,** drawn as a `failure` block. Nothing else does in human mode, apart from rule 2's payload verbs.` Append to that item:

```markdown
 Ruled 2026-10-01: one more exception, `out.note`. A notice that fires before the verb is known, or under any verb (the first-run hint, a stopped daemon, a setting rt had to ignore), goes to stderr, because stdout may be a payload or a `--json` envelope by then.
```

Under "Steps", after the bullet that begins `**A `status` on `done`,**`, add a third bullet, and change the sentence above the list from "gains two things in phase 1" to "gains two things in phase 1 and a third in phase 5":

```markdown
- **A `clear` on `done`,** `{ t: "done", title, clear: true }` (phase 5): the step ends and its row and sub-lines are erased, leaving nothing. This is the spinner that vanishes (`withTransientStep`). It is a flag on `done`, not an event of its own, so a helper that predates it still ends the step with a done row.
```

- [ ] **Step 7: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run ui:test`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run test:pty`
- `bun run picker:check`
- `bun run format:check`
- `bun run check` (what the `static` CI job runs)

Expected: all pass. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this slice did not touch that passes when its file runs alone is a flake; say so in the report with both results. `bun run docs:gen` is not needed: no command description changed.

`e2e/pty/errors.test.ts` drives the dispatcher's failure through a real pty and needs no edit: it asserts the glyph, `takes two identities`, `rt hit an unexpected error` and `rt daemon logs`, all of which still paint.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-09-30-rt-output-layer-design.md docs/design/output-layer/README.md docs/design/output-layer/fixture-dark.png docs/design/output-layer/fixture-light.png docs/design/output-layer/dispatcher-dark.png docs/design/output-layer/dispatcher-light.png docs/design/output-layer/wrap-narrow-dark.png docs/design/output-layer/wrap-narrow-light.png
```

```bash
git commit -m "docs: output layer rules for notes, warnings, spinners and usage, with renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase and re-check what other phases added**

Run: `git fetch origin`
Run: `git rebase origin/main`

Phases 3 and 4 may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this slice's.
- `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts`: keep their tests, then re-apply Task 2's edits to any new assertion.

Then run: `grep -rn "\[failed\] " lib commands e2e --include='*.test.ts'`
For every hit where a failure is the first block of a plain render, drop the tag from the expectation, as in Task 2 Step 5. That covers phases 3 and 4 having landed first. If either is still open when this slice merges, its own `[failed] <title>` first-line pins break when it rebases over this one, and the same grep is the fix on its side; Step 5 says so to the shepherd.

Then run: `grep -rn "StepHandle = {\|: StepHandle = \|as StepHandle" lib commands --include='*.ts'`
Any object typed `StepHandle` that phase 3 added needs a `clear: async () => true` member.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 14 Step 7.

- [ ] **Step 3: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 4: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5a, layer additions and dispatcher" --body-file <scratchpad>/pr-body-5a.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Layer**: `out.note`, `warn`, `withTransientStep` and the `clear` flag on the step's `done` event, `usageFailure`, the plain failure rule; **Renderer**: hint wrap, words-only wrap, hidden characters, light diff tints, the rule tone; **Dispatcher**: help, usage, unknown command, refusals, pre-dispatch notices, five files off the allowlist; **Also**: bare `rt <branch>` off a terminal now prints its help on stdout; **Follow-up**: the warnings table rows are applied by 5c to 5f and phase 6); the six renders; a verification line with the gate results and the measured cost of one helper launch (median of twenty), which is what the breadcrumb adds to every command at a terminal; an **After pulling** line: run `bun run ui:build` in the shared checkout, or the dev helper there is the old one and a transient step leaves a done row where it should leave nothing; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

Report the PR url, the gate results, the flakes seen with both results, the measured render cost, and what the renders showed. Add two notes for the shepherd: after this merges and the shared checkout is pulled, `bun run ui:build` there so the dev helper erases a transient step instead of leaving a done row; and any phase still open (3, 4) will find its `[failed] <title>` first-line pins failing when it rebases over this slice, fixed by `grep -rn "\[failed\] " lib commands e2e --include='*.test.ts'` and dropping the tag where a failure is printed first. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **The erasing ending rides `done` as `clear: true`** (ruled 2026-10-01, replacing this plan's first draft of a new event). The title sent with it is the step's label, so a helper that predates the flag paints a plain done row and never a coral `interrupted` one.
2. **`warn` is a new file, and it is process-aware.** The scoping document names `out.note` and "the helper"; this plan puts the helper in `lib/ui/warn.ts` and has `cli.ts` set its log. Without that, a warning raised inside the daemon (repo index, state db, identity migration) would be written into the CLI log file under the daemon's pid, which is the mislabeling `lib/state/busy.ts` already had to fix once.
3. **`lib/ui/screen.ts` is a new file** for the one screen clear, so `lib/command-tree.ts` and `lib/arg-collector.ts` can leave the allowlist and `lib/ui/out.ts` stays free of escapes.
4. **The breadcrumb is drawn up front and its helper launch is paid** (Matt, 2026-10-01, replacing the round 1 pending-header ruling: a step on `/dev/tty`, a child given the terminal, or a verb not yet converted would have painted above it). The dispatcher draws it before the handler through `out.note(out.section(...))`. Three things the ruling leaves to the plan: the gate is `out.isHuman("stderr")`, so `--json` and `RT_BATCH` now suppress it where today only a piped stderr did; a `hidden` leaf draws none, which is how `git credential` stays quiet under git at a terminal (fourteen nodes are `hidden: true` today, among them `gate fork-check`, `intercept run`, `worktree hydrate-clone`, the hook verbs, `mcp serve` and `setup apply`, `intent` and `finish`: all run by a program or the app. If Matt wants a breadcrumb on one of them, the alternative is a flag on the `credential` leaf alone); and no blank line follows it, where today's header printed one. The bare-branch usage path (`showUsage`) no longer draws a breadcrumb; its help opens with its own usage line.
5. **A bare branch off a terminal (`rt git` in a pipe) prints its help on stdout,** where it printed name rows on stderr. Spec rule 2 says human text goes to stdout; exit 0 is unchanged.
6. **Wrapped prose never breaks at a hyphen.** The scoping document says "hyphen break points"; this plan reads that as "stop breaking there", since the fault on record is a flag split after `--`. A long hyphenated word moves to the next row whole.
7. **A leading failure keeps its hint on the first line** (`<title>  <hint>`); only the tag goes. And a title that starts with `[`, leading spaces aside, keeps the tag, so error text cannot pose as another status.
8. **Light diff tints depend on `COLORFGBG`.** A light terminal that does not set it (Apple Terminal, Ghostty) still gets the dark bands. The complete fix is asking the terminal for its background, which needs `/dev/tty`, and the spec says `rt-ui render` never opens it.
9. **The `copy` and `verbatim` rail keeps the `Panel` tone,** because spec rule 7 names it, though the phase 1 renders note it is faint on dark too. Only the table rule and tree branches move to `StaticRule`.
10. **The warnings table covers 45 lines, not about 35:** all 42 `console.warn` lines under `lib/` plus three `console.error` lines of the same kind. Twenty-one of them sit in phase 6 files; their rows are marked P6.

## Self-Review

**Spec coverage.** Scoping section 2: item 1 (`out.note`, Task 3; the warnings table, Task 1; the helper, Task 3); the header ruling (drawn up front by the dispatcher, Task 11; the launch cost, Task 14); item 2 (`withTransientStep`, Task 6; the erasing ending on the wire, in Go and in a fixture, Task 5; the spec's "Steps" text, Task 14; `inline-spinner.ts` as a re-export, Task 6); item 4 (Task 10); item 5 (Task 9); item 6 (Task 8); item 7 (Task 7); item 8 (`usageFailure`, Task 4; the dispatcher's own usage and help, Task 11); item 9 (Task 10). Ruling 9 (Task 2, with every pinned test). The five files leave the allowlist in Tasks 11, 12 and 13. "Tests it must move": `first-run.test.ts` (Task 13), `smoke.test.ts` (Task 11), `errors.test.ts` (Tasks 2 and 12), `e2e/pty/errors.test.ts` (Task 14, no edit needed). Item 12 (picker wrappers take a stream) is 5c's and 5f's; no file 5a owns swaps a stream, so 5a has nothing to do for it.

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 14 and 15 are the implementer's own absolute paths, named as such.

**Type consistency.** `warn(module, message, opts?)`, `setWarningLog(log, opts?)`, `ShownWarning`, `WarnOptions`, `withTransientStep`, `usageFailure`, `missingRepoFailure`, `clearScreen`, `StepHandle.clear`, `SpansWith`, `Options{WordsOnly}`, `render.Options{Light}`, `LightBackground`, `StaticRule`, `DiffAddBgLight`, `DiffDelBgLight` are spelled the same in the API section, the Interfaces blocks, the code and the tests.

**Review Focus.** Five lines, each pinned to a named test in Tasks 2, 3, 6, 8 and 9.
