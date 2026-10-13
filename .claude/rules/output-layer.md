---
paths:
  - "cli.ts"
  - "commands/**"
  - "lib/**"
---

# Output layer

## Output layer

Everything rt prints for a person goes through `lib/ui/out.ts`. Builders
(`out.line`, `out.callout`, `out.kv`, `out.table`, `out.tree`, `out.section`
and the rest) return data; `out.print` draws them through the one-shot
`rt-ui render` verb at a terminal and prints the same words plainly
(`lib/ui/out-plain.ts`) off a TTY, under `--json` or `RT_BATCH`, or when the
helper is missing or fails. Before adding or changing output, read
`docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`: the block
vocabulary, the ten statuses, the color roles and the rules.

Five rules cost the most when broken:

- **Coral is for failures.** A state that is not yet done, turned off,
  stopped or refused by policy has its own status (`pending`, `off`,
  `refused`, `needs-you`). Never reach for `failed` to draw attention.
- **Never style a payload.** Text another program reads (the `rt cd` path,
  `git credential`, a key, a bare path) goes through `out.payload`, and a
  verb whose stdout is a payload calls `out.payloadOnStdout()` so its human
  text moves to stderr.
- **`--json` goes through `out.json` and is frozen.** Plain text off a TTY is
  not frozen: it carries the same wording as the styled output, so a skill
  must read `--json`, never scrape text.
- **No colors on the TS side.** `out.ts` holds no ANSI and no glyph styling;
  the theme lives in `ui/internal/theme` and nowhere else.
- **Body text takes the terminal's own foreground.** Only accents (glyphs,
  callout labels, keys, hints, rails) use theme colors, so output reads on a
  light terminal as well as a dark one. Static output takes its accents from
  `theme.StaticDark` on a dark background and `theme.StaticLight` otherwise;
  `ui/internal/background` picks from the `rt.ui.background` setting
  (`auto`, `dark`, `light`), then on `auto` `COLORFGBG`, Ghostty's configured
  background (only when `TERM_PROGRAM` is unset, `ghostty`, `herdr` or
  `tmux`, since Ghostty's environment leaks into editors and multiplexers
  started from it) and last the terminal's OSC 11 answer, and an unknown
  background gets the light set. Setting `dark` or `light` skips the
  terminal query. A new accent needs a tone in both sets that passes both
  sets' contrast tests. Never give body text a fixed color.

Plain output collapses newlines and tabs in single-line fields (titles,
hints, cells, labels) to a space and indents paragraph lines two spaces, so
untrusted text cannot forge a status row. A `copy` block prints at column 0
with no rail, at a terminal and off one, so a drag-select pastes it clean;
that is also why it must never carry untrusted multi-line text. Step
sub-lines sit under their running step: they clear when the step ends with
`done` and stay beneath it when it fails.

A callout row that is only a command prints whole. A row whose one command
is its last segment (`["Commit them, or set them aside with ", out.cmd("rt git
stash push")]`) prints its sentence on the label row and the command on the
row under it, so end the sentence where the command starts; any other row
wraps at its spaces and never splits a command. A command too wide for the
label column moves to the bar column, then to column 0 with no bar, and only
one wider than the pane runs past it. Off a terminal the row stays one line. Consecutive `kv` blocks in one `out.print` share a key column, so
print a group of them in one call.

`out.print` writes plain text to stdout under `--json` too, so a verb whose
`--json` branch can still print a note (a repo whose identity cannot derive,
a lock file that is missing) calls `out.payloadOnStdout()` as soon as it
knows `--json` was passed; otherwise the note lands inside the envelope a
program is parsing. A verb that prints a payload (`rt settings get`'s value,
a bare path) calls it unconditionally. The `--json` byte-identity tests
(`commands/__tests__/settings-json-frozen.test.ts` is the model) assert an
empty stderr as well as the frozen stdout.

Failures have one shape. A command that cannot continue throws
`UserActionableError` (`lib/errors.ts`) with what happened in a short plain
sentence, an optional `why`, the command to run as `next`, and any raw
child output as `log`; the dispatch seam in `cli.ts` draws it as a `failure`
block on stderr and exits 2, and `exitUserError` does the same for a verb
that handles its own `--json` (the envelope stays on stdout, byte for byte).
Anything else that reaches the seam prints one line, "rt hit an unexpected
error", with the message as the hint and the stack in the CLI log; the stack
also prints off a TTY or under `RT_LOG_LEVEL=debug`. Do not catch an error
only to print it: throw the typed one, or let it reach the seam. The first
converted failure is the team secrets file a Mac's age key cannot open
(`teamSecretsUnreadable` in `lib/secrets/team-store.ts`); its sops output
goes to the log, never the screen.

`lib/__tests__/no-raw-output.test.ts` fails a PR that adds `console.log`,
`console.error`, `console.warn` or `console.info`, any use of
`process.stdout` or `process.stderr` beyond reading `isTTY`, `columns`,
`rows` or `fd` and attaching listeners, a raw escape or a color import, in
`cli.ts` or under `commands/` or `lib/` outside `lib/ui/`. There is no
allowlist: every print goes through the layer. A file that must touch a
stream directly (a logger, an escape parser) is listed in
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines; the guard fails if the count moves either way.

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

A usage error is `out.fail(usageFailure(title, usage, why))` from
`lib/ui/usage.ts`: the title asks for what is missing in plain words and the
usage line is the `next` command, never part of the sentence. The `--json`
error string stays as it was.

Off a terminal, a failure that opens the output prints its title with no
`[failed]` tag, because the app shows the first bytes of stderr to a person as
they are. A test of a human failure asserts the title at the start of stderr.
A failure printed after another block, a title that starts with `[` (leading
spaces aside), and a `line` with status `failed` keep the tag.

A verb that prints a report builds it in a pure function that returns blocks
(`checkBlocks`, `syncBlocks`, `linkBlocks` in `commands/skills*.ts`) and prints
it with one `out.print`; the tests pin that function through `renderPlain`,
so no test needs a console spy. A pack author's compile diagnostics (the
`lib/skills` errors that name a file, a slot and a line) keep their exact
words, because they also sit inside `--json` values: a `SkillsUsageError`'s
`message` never changes for the sake of the screen, and wording meant for a
person goes in its `shown` failure. Any other sentence a person reads takes
plain copy even when an envelope carries it, with the envelope's keys and
machine-read values kept. A refusal by policy is `out.note` with a
`refused` line, never `out.fail`.

A `print` seam on a command's deps (`TeamDeps`, `RegisterDeps`,
`ReidentifyDeps`) carries the `--json` envelope line and nothing else; its
default is `out.payload`, so a test of a human branch reads `captureOut()`
and a test of the envelope reads the seam. A sentence that rides in an
envelope and is what a person reads (an error's message, a join's
`message`, a manual step) follows the copy rules like any other: the
envelope's shape is what is frozen, not its words, so reword it and keep
every key, code and status. A command goes in the
error's `next` option, which the envelope never carries; a result string
that is the only carrier of its remedy keeps the command as its last words.

A warn sink under `lib/` that a caller can replace (`lib/team`'s three)
takes `(message, shown?)`: the message is the log text and `shown` is the
plain copy a person reads. Code that catches a `UserActionableError` and
turns it into such a warning passes `err.next` as the copy's `next`.

A command a person can run to fix something names its subject in a form the verb resolves: `rt repos locate --repo` takes a repo's `host/path` label, so printed commands use that (`repoLabelFull`), never the stored identity.

A list that belongs to a failure (the files a rebase stopped on, the lines
a child printed) is a `verbatim` block with a caption passed after the
failure (`out.fail(f, ...after)`), never the failure's `details`, which
is a one-line pointer. Something rt leaves alone because it did not create
it is worded the same everywhere: rt did not make it, so rt left it alone.

A daemon handler that declines by policy returns `failure: { code, message }` beside its `error` (`CommandResult`), and the CLI maps known codes to `refused` notes; the `error` string itself never changes, since hooks and the daemon's own retries match on it.

Warnings under `lib/state/` go through `warn`: logged always, shown only
where 5a's warnings table or the phase 6 scoping rows say so, and once per
process. The daemon sets no warning log, so it still files the plain
`rt: <message>` line from its stderr capture.

## The TypeScript CLI is UI-free

The rt TS CLI (`commands/`, `lib/`, `cli.ts`, `scripts/`) is pure Bun/TypeScript
orchestration and MUST NOT contain UI-rendering code: no UI frameworks (ink,
`@inkjs/*`, react, react-dom, preact, vue, solid, svelte), no JSX, no `.tsx`
files. All UI is rendered by the Go `rt-ui` helper (prompts, steps, board,
pickers); the TS layer only drives it over stdio and process spawn. `packages/` (for example `packages/settings-kit`, a react UI
kit for the web console) is a separate concern and is exempt from this rule.

Enforced by `lib/__tests__/no-ui-in-cli.test.ts`.
