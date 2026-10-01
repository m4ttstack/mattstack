# rt output layer design

Ticket: RT-369. Date: 2026-09-30.

## Problem

A person running rt at a terminal sees output that reads as broken when it is not.

- Notes and tips go to stderr. Some terminals paint stderr red, so information looks like an error.
- Red marks states that are not failures: not installed yet, turned off by choice, stopped, refused by policy. The audit found about 20 such sites.
- An expected failure (a Mac that cannot read the team's secrets yet) prints bundled source lines and a stack trace, because `cli.ts` rethrows every error.
- `rt setup apply` prints each step twice, shows step ids, and gives its one real failure no visual weight.
- About 70 command files print by hand with raw ANSI codes from `lib/ansi.ts`: roughly 1,000 `console.log` sites and 200 `console.error` sites. None of it matches the rt-ui pickers, prompts and steps.

## Goal

Every human-facing line rt prints comes from one output layer, drawn in the rt-ui theme, with coral reserved for real failures.

## Non-goals

- The interactive `rt setup` checklist view. It is a later project that sits on top of these commands.
- Agent-only verbs: `gate`, the herd worker verbs, `ci`, `events`, `runs find`, the run-tracking writes, `mcp`, and the hook verbs under `worktree`.
- `rt runner` and `rt glitter`, which are already rt-ui session views. Only their preflight errors are touched.
- Any change to a `--json` envelope.

## Architecture

Two pieces. Go draws; TypeScript says what to draw and decides whether to draw at all.

### Go: `rt-ui render`

A new one-shot verb next to `prompt`, `pick`, `steps` and `session` in `ui/cmd/rt-ui/main.go`.

- Reads blocks as NDJSON on stdin until EOF. The first line is the same `hello` line the other verbs use, carrying `PROTOCOL_VERSION`.
- Prints the blocks to its stdout and exits 0. It takes no screen, reads no keys and never opens `/dev/tty`.
- All styling comes from `ui/internal/theme`. The render package lays out tables and trees itself, with lipgloss for styling and width math, so a cell can carry role-tagged segments and a table can carry group labels.
- New package `ui/internal/render`, one file per block family, golden-tested.

### TypeScript: `lib/ui/out.ts`

The only way code under `commands/` prints.

```ts
out.print(...blocks)        // human blocks, one rt-ui spawn per call
out.fail(failure)           // a failure block, on stderr
out.json(value)             // a --json envelope, untouched
out.payload(text)           // machine text on stdout, never styled
```

Block builders (`line()`, `callout()`, `kv()`, `table()` and the rest) are plain functions that return data. They hold no colors and no glyphs.

`out.print` does three things:

1. **Gate.** Human rendering needs the target stream to be a TTY, no `--json`, and no `RT_BATCH`. This is the picker gate applied to the output stream.
2. **Render.** When the gate passes, it resolves the binary through `lib/ui/resolve.ts` and runs `rt-ui render` with `Bun.spawnSync`, blocks on stdin, the child's stdout inherited.
3. **Fall back.** When the gate fails, or the helper is missing or exits non-zero, it prints the same blocks through a plain TS renderer: no color, ASCII-safe glyphs, same words. A dead helper never costs the user the message. This is the pattern `lib/ui/steps.ts` already uses.

One call is one spawn (about 15 ms in the spike), so output stays in order with step spinners. Blocks that must align with each other (hints across consecutive lines, table columns) go in the same call.

### Plain output off a TTY

`--json` output is frozen: byte-identical before and after, proven by a characterization test per converted verb.

Plain text off a TTY (a pipe, an agent that did not pass `--json`) comes from the plain renderer, so it carries the new wording without color. It is not byte-identical to today's text. Keeping the old strings would mean two message sets per command. Each conversion PR greps `plugins/mattstack`, `skills/` and `apps/board/skills` for text scraped from the verbs it converts and fixes any reader in the same PR.

Ruled 2026-09-30: only `--json` is frozen; plain text off a TTY takes the new wording.

## Block vocabulary

| Block | Carries | Used by |
|---|---|---|
| `line` | status, title, optional hint | nearly every verb |
| `callout` | label (`tip`, `next`, `fix`, `why`, `note`), body lines; attaches under the block before it | settings notices, setup remedies, failures |
| `kv` | key, value, optional source line | `settings get`, `deps resolve`, `team status` |
| `table` | optional headers, rows of cells, optional group labels between rows, optional marker column | `settings list`, `worktree list`, `chat rooms`, `accounts` |
| `tree` | root, children, each child a row of cells | `settings explain`, `repos status`, `port` |
| `section` | title, optional subtitle, nested blocks | `setup status`, `runs show`, `sync all`, `worktree each` |
| `summary` | status, title, counts | `setup apply`, `verify`, `release preflight` |
| `paragraph` | prose, wrapped to the terminal (capped at 76 columns) | `skills audit`, the `secrets` note, `home` messages |
| `copy` | optional caption, literal text; never wrapped, never restyled inside | `team invite`, long commands |
| `verbatim` | optional caption, literal lines, dim | log excerpts, JSON values, captured child output |
| `changes` | rows of `+` or `-` with a name and hint | `skills surface`, `skills expand` |
| `diff` | hunk header and lines, using the mission view's tints | `git diff` |
| `banner` | danger label, subject, hint | the sdm production confirm |
| `failure` | title, optional `why`, optional `next`, optional details pointer | the error seam |

A cell is a list of segments, each `{ text, role }`. Roles: `text`, `strong`, `dim`, `faint`, `key`, `command`, `link` (with a `url`, drawn as an OSC 8 hyperlink), and the status roles. This is the shape picker rows already use (`PickSegment`), so `worktree list` rows with a name, a label, a branch and an MR tag need no fixed columns.

Steps stay on the existing `steps` verb, with one addition (see Steps).

## Status set

Ten states. Every `line`, `summary` and status cell names one.

| State | Glyph | Color | Meaning |
|---|---|---|---|
| done | `✓` | mint | it worked |
| failed | `✗` | coral | a real failure |
| needs-you | `◆` | peach | waiting on something only the person can do |
| pending | `◌` | dim | has not run, or is not installed yet |
| stale | `↻` | peach | works, but behind |
| refused | `⊘` | dim | rt chose not to, by policy |
| off | `○` | dim | turned off or stopped, not broken |
| skipped | `-` | faint | nothing to do |
| running | `●` | mint | live |
| warn | `!` | peach | worked, with a caveat |

The glyphs avoid Nerd Font code points and heavy filled shapes, which rendered badly in the spike.

## Color roles

- **Mint:** done and running.
- **Coral:** failures. One named exception: the `banner` block, shown only before a destructive or production confirm.
- **Peach:** needs-you, stale, warn, and the `next` and `fix` callout labels.
- **Lavender:** setting keys, branch names and the `tip` label.
- **Bright bold text:** a command to run. The callout label carries the color; the command does not.
- **Dim and faint:** hints, sources, captions, rails.

## Rules

1. **Never style a payload.** Text another program reads goes through `out.payload` or straight to the child and is never touched: the `rt cd` and `rt nav` path, `git credential`, the `home key export` key, `pane peek`, `skills compile --preview`, bare-path outputs (`settings source-path`, `settings schema lock`), and any child process given the terminal (`git push`, `git pull`, `rt run`, `daemon logs`, the login flows).
2. **Human text goes to stdout.** The exception is a verb whose stdout is a payload (`cd`, `nav`): its human text goes to stderr on purpose and the gate tests stderr.
3. **Failures go to stderr,** drawn as a `failure` block. Nothing else does in human mode.
4. **One spinner.** The Go step is the spinner. `lib/tui/inline-spinner.ts` and the `\r` line in `lib/enrich.ts` move onto it.
5. **Sub-lines clear on success.** Lines streamed under a running step vanish when it resolves to done and stay when it fails. They are always in the log.
6. **Hints align.** Consecutive `line` blocks in one call pad their titles to a common width.
7. **Rails.** Callouts use the thick `▌` bar in the label's color. `copy` and `verbatim` use a thin `│` rail in the theme's `Panel` tone.
8. **Spacing.** One blank line before a `section` unless it is the first block; one before a `summary`. Blocks never print trailing blank lines.
9. **Removed is not failed.** The `-` in a `changes` block is dim. Deleted lines in a `diff` keep the mission view's coral tint.

## Steps

`rt-ui steps` gains one event, `{ t: "sub", text }`: a transient dim line under the running step, drawn with the thin rail. On `done` the sub-lines are erased; on `fail` they stay. The existing `log` event keeps its meaning (a permanent line).

`sdm connect`, `sdm login` and `setup apply` use it for the child output and step logs they stream today.

## Error seam

`cli.ts` stops rethrowing. Its dispatch catch sorts errors into three kinds:

- **`ExecFailure`:** unchanged, exits with the plugin's code.
- **Expected failure:** rendered as a `failure` block (what happened, `why`, `next`), exit 2. The type is today's `UserActionableError`, moved from `lib/setup/errors.ts` to `lib/errors.ts` and given optional `why` and `next` fields.
- **Anything else:** one line, "rt hit an unexpected error", with the error's message as the hint and a pointer to the CLI log. The stack is written through the CLI logging seam before exit 1. Off a TTY, or with `RT_LOG_LEVEL=debug`, the stack also prints, as it does today.

`exitUserError` sends its human message to stderr. Its `--json` payload stays on stdout.

Known expected failures are converted as they are found. The first is the sops decrypt failure in `readTeamSecret`: "This Mac cannot read the <team> team's secrets yet", why "No age key on this machine matches the team's recipients", and a `next` that names a real verb. The raw sops output goes to the log.

## Setup

`createHumanEmitter` in `lib/setup/emit.ts` is replaced by an emitter that drives the step runner from the same `ApplyEvent` stream:

- A step's `running` event opens a step with the step's title (`StepDef.title` or `titleFor`). The id stays in `--json` and the log.
- `log` events become sub-lines.
- `done`, `partial`, `skipped`, `failed` and `needs-you` resolve the step to a line in the matching state, with `detail` as the hint.
- `remedy` becomes a `next` or `fix` callout holding the command.
- The closing event becomes a `summary` with counts per state.

The printed plan (`renderPlanHuman` in `commands/setup.ts`) becomes `section` blocks. Its `missing` rows render as `pending` or `needs-you`; only `invalid` and `error` render as `failed`.

Settings share tips reach setup through the existing notice sink (`setSettingsNoticeSink`). Inside `setup apply` the sink attaches the tip as a callout under the step that caused it. Outside setup it prints a `tip` callout under the confirmation line.

## Copy style

Messages follow the plain-language style of the command descriptions (commits `32c34927b` and `3b39da973`, and the "Command descriptions are plain language" section of `AGENTS.md`):

- Say what happened for the person, in a short plain sentence.
- Speak to "you" and "this": "your home repo", "this Mac".
- Use everyday verbs.
- Leave out internals: flags, implementation notes, store names, file paths, step ids.
- Put the command to run in a `next` callout, never mid-sentence.
- Name only verbs that exist. A conversion PR checks each command it prints against the command tree.

Technical detail (raw child output, internal names, paths) goes to the log behind the `failure` block's details pointer.

The `AGENTS.md` section is extended to cover output messages as well as descriptions.

## Guard

`lib/__tests__/no-raw-output.test.ts`, named `no-*` so it runs on every PR.

It fails when a file under `commands/`, or a `lib/` file that prints for a command, does any of:

- import a color from `lib/ansi.ts` or `lib/tui.ts`;
- contain a raw `\x1b[` literal;
- call `console.log`, `console.error`, `console.warn`, `process.stdout.write` or `process.stderr.write`.

The test starts with an allowlist of every current offender. Each phase removes the files it converts. The project is done when the allowlist is empty, at which point `lib/ansi.ts`, the `lib/tui.ts` shim and any unused part of `lib/tui/palette.ts` are deleted.

## Testing

- **Go:** a layout test per block on the escape-stripped output, color assertions for the coral rule, and black-box tests of the verb with color on and off.
- **Shared fixture:** `ui/fixtures/render-document.json` holds one block of every type and is decoded by both a Go and a TS test, so the two sides cannot drift on the wire shape.
- **TS unit:** the gate (TTY, `--json`, `RT_BATCH`, payload verbs), the fallback when the helper is missing or dies, the stream choice, and the plain renderer.
- **Characterization:** before a verb is converted, a test pins its `--json` output. It must pass unchanged after.
- **pty gate:** one settings verb, `setup apply` and one failure, driven through the real binary in `e2e/pty/`. The new paths are added to the filter in `.github/workflows/e2e.yml` so the gate runs.
- **Eyes:** each phase's PR carries terminal screenshots of the converted verbs.

## Phases

One PR each, in this order.

1. **Foundation.** `rt-ui render`, `lib/ui/out.ts`, the plain renderer, fixtures, the `sub` step event, the guard with its full allowlist, and the `AGENTS.md` section. Converts nothing.
2. **Errors.** The dispatch seam, `lib/errors.ts`, `exitUserError`'s stream, and the sops failure.
3. **Setup.** `setup` (bare, `plan`, `status`, `apply`, `update`, the connect and status pairs, `waive`, `repo-root`, `home remote`), `verify`, `uninstall`, `accounts`, `logins`, `secrets`.
4. **Settings.** `get`, `set`, `unset`, `list`, `explain`, `check`, `migrate`, and the notice sink.
5. **Visible verbs.** `git`, `sync`, `worktree`, `port`, `repos`, `code`, `hooks`, `intercept`, `skills`, `team`, `plugin`, `tools`, `deps`, `extension`, `release`, `sdm`, `home`, `runs`, the human `chat` verbs, and the notes in `cd` and `nav`. Split into more than one PR if the diff is too large to review.
6. **Hidden verbs.** `daemon`, `services`, `state`, `state backup`, `bg`, `cron`, `apps`, `reconciler`, `endpoint`, `flavor`. Then delete the raw color modules and empty the allowlist.

Leath's and Ed's pain is fixed by the end of phase 3.

## Known gaps in the audit

The audit read every print call in `commands/`. It did not read all the printers under `lib/`: the setup validators and steps, `lib/team`, `lib/skills`, `lib/release`, `lib/home`, and herd's status renderer. Their detail strings are unaudited. They are expected to need copy work, not new block types; each phase audits the `lib/` printers behind the verbs it converts.

## Source

Onboarding sessions with two new users on 2026-09-29 and 2026-09-30. A five-part audit of human output in every command file, and two throwaway lipgloss spikes reviewed in color, on 2026-09-30.
