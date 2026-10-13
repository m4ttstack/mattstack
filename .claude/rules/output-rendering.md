---
paths:
  - "lib/ui/**"
  - "ui/**"
  - "lib/command-tree.ts"
---

# Output layer: how rt-ui draws it

The dispatcher draws the breadcrumb before the handler runs, through
`out.note`, on stderr, when a person is reading stderr (a terminal, no
`--json`, no `RT_BATCH`) and the leaf is neither `fullscreen` nor `hidden`.
It is its own render call (one helper launch per command), so it is first on
screen whatever the command paints first, and one blank line follows it
(`out.blank()`, the one block that prints an empty row on purpose; never an
empty table).

A spinner that should leave nothing behind is `withTransientStep(label, task)`
from `lib/ui/transient-step.ts`: the Go step draws it and a `done` event
carrying `clear: true` erases it when the task settles. The flag rides `done`
so a helper that predates it ends the step with a plain row, on the neutral
dot when the task threw (`status: "failed"` rides along); a source checkout
runs the installed helper when `ui/dist/rt-ui` is missing or stale, so run
`bun run ui:build` after pulling. It loads `lib/ui/spawn.ts` on first use, so
a file the daemon also loads may import it; keep it that way.

Both renderers drop bidi controls and zero-width characters from every field
(`ui/fixtures/clean-cases.json` is the shared test). Wrapped text breaks at
spaces, so a flag or a branch name that fits its row is never split at a
hyphen; a word wider than its row breaks after its last `/` that fits (then
`\`, `-`, `_`, `.`, `:`), and only a word with none is cut between
characters. A `line` hint with a word too wide for its column takes the row
under its title, whole. `verbatim` wraps the same way;
`textwrap.Spans` keeps its hyphen breaks for the mission diff, and prose goes
through `textwrap.SpansWith` with `WordsOnly`. The diff takes pale tints only
when the background resolves light (the same resolver as the accents); a dark
or unknown background keeps the dark tints.

`lib/ui/steps.ts` prints nothing by hand: off a terminal a step's ending is
`out.print(out.line("done" or "failed", ...))`, and a helper that dies costs
one warning through `out.note` and a line in the CLI log. A step run with
`failSilently` prints nothing off a terminal either; at a terminal it ends
with `clear({ thrown: true })`, so its row is erased and the caller draws the
failure. The runner has no `log()`; a line between steps is an `out.print` at the call site.

`lib/prompt-secret.ts` re-exports `lib/ui/prompt-secret.ts`: the no-echo
prompt holds the terminal in raw mode and lives with the other prompts.

A table rt-ui cannot fit without cutting a leading column stacks instead: each row's first cell on its own line, the other cells under it, every cell led by its column header. A value longer than the pane wraps, an unbroken one cut between characters. On a pane 26 columns or wider no cell value is clipped; narrower than that, each stacked line is clipped to the pane. Trees still clip a leading column to keep their branches aligned.

A failure's multiline `why` keeps each reason on its own callout row. A `verbatim` block captioned `why` draws those reasons with the same thick callout bar; other verbatim captions keep the thin rail.
