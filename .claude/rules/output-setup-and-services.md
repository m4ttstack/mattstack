---
paths:
  - "lib/setup/**"
  - "commands/setup.ts"
  - "commands/uninstall.ts"
  - "commands/sdm.ts"
  - "commands/home.ts"
  - "commands/release.ts"
  - "lib/release/**"
  - "commands/daemon.ts"
  - "commands/services.ts"
  - "commands/apps.ts"
  - "commands/flavor.ts"
  - "commands/bg.ts"
  - "commands/cron.ts"
  - "commands/reconciler.ts"
  - "commands/endpoint.ts"
  - "commands/intercept.ts"
---

# Output layer: setup, sdm, daemon and service verbs

A setup run (`rt setup apply`, `rt setup update`, `rt uninstall`) reaches a
person through `createStepEmitter` in `lib/setup/emit.ts`: one rt-ui step per
`step` event, titled from the `plan` event (never the id), streamed `log`
lines as sub-lines that also go to the CLI log through `logCliEvent` at
`debug`, a `fix` callout for a remedy, and a `summary` at the end; a verb
awaits `flush()` before it exits. The NDJSON stream and the plan are the app's
contract and go through each verb's `json` seam (`out.json`): their shape
(keys, structure, types, exit codes, every value a program reads) never
changes without a contract change, while a `Row.detail`, a
`StepOutcome.detail` or `remedy` and a `UserActionableError` message are copy
the tray displays and never parses. `commands/__tests__/setup-copy.test.ts`
pins both views as snapshots, so a wording change is a deliberate
`bun test --update-snapshots`, and a machine view change is a failing test.
Write that copy in the command-description style, and never put a plain-words
key into an envelope: plainer words for a person ride the error's `why` and
`next` or `exitWithUserError`'s `human` argument.

A verb that streams a child's output (`rt sdm connect`, `rt sdm login`) runs
the child under `withProgress` in `commands/sdm.ts`: at a terminal the lines
are a step's sub-lines, every line goes to the CLI log at `debug`, the step
is erased when the task settles, and a failure prints the last five lines
under its `failure` block. Every line passes through `redact` first, which
replaces the one-time token in a StrongDM auth url, so neither the log nor
an excerpt keeps it. No prompt and no child that owns the terminal may run
inside it. Under `--json` nothing is drawn and child output stays off
stderr. A sentence inside an sdm envelope that a person also reads (a
connect's `hint`, a health `message`) never quotes a command: the command
rides apart, in the failed result's `next`, and the CLI shows it as the
`next:` line.

A release row's `detail` is copy a person reads, but the data in it (a
version, a sha, a tool's output) stays as it is.

A run a person watches step by step (`home init` and its refresh steps)
opens one rt-ui step per stage through `openStep` and ends each in its own
line, with the stage's progress as sub-lines; off a terminal each ending
prints as one plain line. Every sub-line also goes to the CLI log, and always
through `withoutUrls`, since a clone url can carry a token. A program that
reads such a run's text (the setup app's `home.init` step) keys on constants
both sides import (`INIT_STEP_FAILED`, `INIT_OUTPUT_CAPTION`), never on a
copy of the words.

`rt daemon` draws a stopped or uninstalled daemon as `off` and a slow one as
`pending`; only `crash-looping` and `boot-failed` are failures. Its waits on
the tray run under `withTransientStep` and print one result line after.
The log viewer's seams take blocks (`print`, `fail`), so the tray, which
shows the first stderr line when `rt daemon logs --no-open` exits early,
reads a failure title.

The service verbs (`services`, `apps`, `flavor takeover`, `bg`, `cron`,
`reconciler`, `endpoint`) draw everything a person reads with blocks and
keep their `--json` envelopes unchanged. `services`, `apps` and
`flavor takeover` keep an envelope seam that writes through `out.payload`;
`bg`, `cron`, `reconciler` and `endpoint` write theirs through `out.json`.
Human failures go to stderr; the envelopes the tray reads did not change.
`rt intercept run`'s passthrough notes are plain sentences; only its debug
traces keep the `rt-intercept:` prefix, because `commands/intercept.ts`
routes them to the log by that prefix.
