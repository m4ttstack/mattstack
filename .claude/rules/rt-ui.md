---
paths:
  - "ui/**"
  - "lib/ui/**"
  - "lib/runner/**"
  - "lib/pick-wrappers.ts"
  - "commands/runner.ts"
---

# rt-ui

## rt-ui

rt's prompts and step spinners render through a bundled Go helper
(`ui/`, binary `rt-ui`, `Contents/Helpers/rt-ui`) driven over NDJSON on
stdin/stdout with `/dev/tty` for the screen. Before touching `lib/ui/*`,
`ui/`, or the prompt facade, read
`docs/superpowers/specs/2026-08-29-rt-ui-bridge-design.md`: the protocol,
the exit-code contract, the never-spawn-without-a-TTY gate, and why the
source checkout outranks the installed bundle when resolving the binary.
`bun run ui:build` after any change under `ui/`; the shared fixtures in
`ui/fixtures/` are golden-tested from both languages.

Every picker is the one-shot `rt-ui pick` verb
(`ui/internal/views/picker/`), driven from TS through the wrappers in
`lib/pick-wrappers.ts` and `lib/ui/pick.ts`; it replaced fzf outright, so no
fzf spawn path remains. Before touching picker rendering read the design
boards in `docs/design/picker/` and the spec
`docs/superpowers/specs/2026-08-31-rt-picker-redesign-design.md`: the row and
segment wire protocol, the action registry that drives the keybar and menus, the
modal overlay stack, and the headless fzf matcher (`match.go`) that is the one
piece of fzf kept, as a ranking library, never a spawn.

`rt runner` is the first `session` view: `commands/runner.ts` gates, selects
the backend, and wires; `lib/runner/runner.ts` owns the entries and the
intent loop; and `ui/internal/views/board/` paints. Services run in a
detached tmux session by default (`lib/runner/tmux-engine.ts`); `--herdr`
opts into headless herdr panes instead (`lib/runner/engine.ts`'s
`HerdrEngine`, still the only herdr socket door), and focus (`f`) is the
only tmux-mode path that touches herdr, splitting a pane that attaches the
session. Read
`docs/superpowers/specs/2026-08-29-rt-runner-design.md` before touching any
of them: the board is ephemeral and pane-owned (quit closes the workspace),
the exit code of a pane command comes only from the `__rt_exit` sentinel,
and the add flow closes and reopens the session around the rt-ui picker.

### Shared rt-ui primitives -- lift, don't duplicate

`ui/internal/views/picker/scroll.go`'s `Viewport`/`ThumbSpan`/`ThumbCell` are
the one scroll-offset/thumb implementation for every scrolling region in
rt-ui (the picker's own list, the diff pane, the Changes list, and all
three mission foldouts) -- vim-style scrolloff, a caller cap, a shared
`h*h/n` thumb formula, with the thumb's own styles passed in per caller.
`clip`/`clipOn` (`ui/internal/views/mission/topbar.go`) are the only text
clippers mission uses. A new scrolling region, thumb, or text-truncation
site imports and calls these; it does not hand-roll a second copy. When a
new cross-view need comes up (a bordered box, a keybar strip, a row's
rest/hover/cursor background), check picker/board/mission for an existing
implementation FIRST and lift the best one to a shared spot rather than
writing a third version -- this was a standing correction after mission's
own diff pane and Changes list had each grown a byte-for-byte duplicate of
the picker's viewport math independently.
