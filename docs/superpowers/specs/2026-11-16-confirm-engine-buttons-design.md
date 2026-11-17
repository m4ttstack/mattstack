# Confirm answers as engine Buttons (gate-form + mod-kit)

The plugin confirm (`kind: 'confirm'` on `$.gateForm.ask`), whose only caller
is the merged-PR leave question (`plugins/mattstack/hooks/worktree-leave.ts`).

## Problem

The confirm drew its options inside gate-form's Client. A pane opened with
`focus` takes the keyboard, but a Client gets keys only after a click, so the
dialog looked answerable from the keyboard and was not. The earlier
`solid` / `solidMuted` tones were also too coarse for hover and press.

## Fix

- gate-form's Client draws only the head: brand bar, title, context, `└`.
- The answers under it are the engine's own plain Buttons (`1: label`),
  drawn by the hooks module through mod-kit's new `hotkeyChoices`. Engine
  Buttons take a focused pane's keys the moment it appears.
- The first answer is `autoFocus`; each carries its number as a `hotkey`,
  shown only while the pane holds the keys (the Pane render's `isFocused`).
- The finishing option goes first. A press, Enter on the focused Button, or a
  number answers.

```
▤  mattstack                                   Hide ⌄

┌  MR !267 merged
│  rt is cleaning up this worktree. No answer in
│  2 minutes moves this session out.
└

   1: Exit worktree and continue
   2: Close session
```

## Look

The engine draws an engine Button's focus and pointer state (it inverts the
Button), so these rows take no kit colours. Tried and dropped:

- Numbered rows inside the Client (quiet fill, ▎ edge, a hover ramp): the
  right look, but keys only after a click.
- Kit-coloured label text on engine Buttons, the focused one pre-inverted
  and tracked through `ui.focus`: flashed and looked wrong.

## Kit changes (`packages/mod-kit`)

- `hotkeyChoices(els, { key, choices, focused, indent? })` in `patterns/`.
- `keySelected`: the ▎ edge never takes the dim of the span it marks.
- `muted`: a mark (the ▎ edge) keeps its own hue a step down.
- The WIP `solid` / `solidMuted` tones are gone.

## gate-form changes (`mods/gate-form`)

- `confirmFoot` draws only `└` and any error.
- The Client leaves a confirm's keys alone; the Pane render draws
  `hotkeyChoices` under the Client and answers through `settle`.
- README and types describe the numbered Buttons.

## Out of scope

- The gate's submit page: it already uses ↑↓ for its More actions rows.
- Light mode for the kit's own colours: the engine Buttons already follow the
  person's theme.

## Acceptance

- `/leave-demo` with an empty composer: `1`, `2`, Enter and Tab work with no
  click; the numbers hide when the pane loses focus.
- Nothing in gate-form sets a colour itself for the confirm.

Source: `.superpowers/handoff-gate-form-confirm.md`; mock `mod kit confirm.pen`.
