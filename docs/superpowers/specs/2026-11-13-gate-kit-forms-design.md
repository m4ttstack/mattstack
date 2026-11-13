# Gate kit forms design

Status: draft, not yet approved.

## Intent

Every gate a Claude Code pane shows today is an AskUserQuestion form.
AskUserQuestion holds at most 4 questions with 4 options each, so the gate
tools split gates into chunks, and one question with too many options turns
the whole gate into a wait. Matt wants pane gates drawn with the mod kit's
form (the gate-form mod) instead. The kit form has no caps and matches the
human-todos look.

#1138 (RT-572) removed the `next` question ("Happy with this, or should
something change?") from every gate because it cost an extra tap on every
gate. The kit form brings its choices back as actions that are always there
and never asked: submitting means continue, and Pause, Go back and Abandon
sit behind a More actions menu.

This is a prototype. It is off by default and only an rt setting turns it on,
until Matt is happy with it.

## Goals

- With the setting on, every pane gate opened through `gate_ask` or `gate_open`
  shows in the kit form, whole, with no chunking and no option cap.
- Submit means continue. The form never asks `next`.
- More actions ▾ offers Pause run, Go back to stage ▸ and Abandon run, each only
  where it applies.
- With the setting off, or without the mod installed, gates behave exactly as
  today.

## Non-goals

- Forms that aren't gates (wrap-up, brainstorming and other AskUserQuestion
  calls) keep AskUserQuestion. Matt picked gates only.
- Gates the board raises for MRs. After Darla's board-parking change they come
  back `presentation: wait` and never reach a pane form.
- Changing the skills' gate text. The compiled skills don't change.
- Making the kit form the default. That's a later call, once Matt is happy.

## Anti-goals

- Never bring back a question every gate has to answer. If the run controls
  ever cost a tap on a gate where nobody wants them, this has failed.
- Never close a kit form by sending keypresses into the pane.
- Never leave a pane stuck: a missing mod, a failed answer or a closed form must
  each leave the gate answerable some other way.

## How it works today

- `gate_ask` and `gate_open` (`lib/mcp/gate-tools.ts`) return
  `{id, presentation, subject, supersededId, paneAction, formChunks, formContext}`.
- `paneActionFor` (`lib/gates/form.ts`) gives `form` or `wait`. `formChunks`
  splits the questions 4 to a form.
- `present-pane-form` (gate-protocol) has the skill ask each chunk with
  AskUserQuestion, then call `gate_answer`, which records the answer as this
  pane.
- An answer from another surface (the board, the console) rings the
  doorbell. The agent's next input says "re-read the registry", and it calls
  `gate_reconcile`.
- `validateGateAnswers` (`packages/rt-client/src/gate-answers.ts`) refuses an
  answer key the gate didn't ask (`unknown question id`), and it refuses an
  answer that leaves any question unanswered.
- The skills still route `next` answers (`hold`, `go-back` with `to`,
  `abandon`) through `nextOf` and `run_resolve`. #1138 kept that on purpose.
- gate-form (`mods/gate-form/`, built into `plugins/gate-form/`) draws a gate
  in the `gate_ask` question shape with no caps. Today it opens only through its
  own `ask` tool or `/gate-form-demo`, and it sends its answers back as the
  agent's next prompt.

## Approaches

| | How | Trade-off |
|---|---|---|
| **A. The mod picks up gate results (picked)** | The mod hooks the `gate_ask` and `gate_open` calls, reads each result, and opens the kit form itself when the setting is on. It then rewrites the result the agent sees. | No skill edits, and it falls back cleanly when the mod isn't installed. The daemon only adds a setting flag and run controls to the result, plus reserved answer keys. |
| B. A new `paneAction` value | The gate tools return `paneAction: kit-form`, and `present-pane-form` gets a branch that calls the mod's tool. | Explicit in the protocol, but it means compiled skill edits, and a kit-form result in a pane without the mod is a dead end. |
| C. The mod catches AskUserQuestion | The skill flow stays as it is, and the mod swaps each AskUserQuestion call for the kit form. | The skill still splits into chunks of 4, and the mod would have to stitch them back together, which defeats the point. |

Matt picked A because it takes over at the one place every pane gate already
passes through.

## Design

### The setting

- An rt setting turns it on, off by default. My call for the key:
  `gates.kitForm`, a boolean in user scope. The builder registers it through
  the rt settings resolver (the `rt:settings` skill), never a config file of
  its own.
- The gate tools read it. The mod never reads settings itself.

### What the gate tools add

When the setting is on and `paneAction` is `form`, `gate_ask` and `gate_open`
add a `kitForm` block to their result:

- `questions`: the whole question set, never chunked or capped, with option
  text as stored.
- `context`: the gate's context for the pane.
- `controls`: the run controls this gate can offer:
  - `pause`: true when the gate belongs to a run.
  - `abandon`: true when the gate belongs to a run.
  - `goBack`: the earlier stages the run can go back to, in run order. It's
    empty unless the gate belongs to an inherited run with earlier stages,
    which is the same rule the old `go-back` option followed.

With the setting on, the form cap no longer turns the gate into a wait,
because the kit form has no cap. `formChunks` stays in the result, so a pane
without the mod still has something to show.

### What the mod does

- A `tool.call` hook on the mattstack server's `gate_ask` and `gate_open` runs
  `await next(e)` and reads the result. With no `kitForm` block, it passes the
  result through unchanged.
- With a `kitForm` block, it opens the gate in the kit form pane and replaces
  the agent's result with the gate id plus: "The gate is open in the kit form.
  End your turn: the answer arrives as the doorbell, then call
  `gate_reconcile`."
- When the gate is answered, the mod records it with `rt gate answer` as this
  pane (`decidedBy` pane), with the same compare-and-swap a board or console
  answer uses. That rings the doorbell, and the agent re-enters through
  `gate_reconcile`. The agent never maps form picks back to option values.
- An answer from another surface closes the form without any keypress. See
  "Dismissing without keypresses" below.
- A form the person closes without answering waits above the prompt with Show,
  like gate-form today. The gate stays open, and the agent never presents it
  again itself (as `present-pane-form` says today).
- If `rt gate answer` fails, the form stays open with the error shown, and the
  person's picks are kept.

### The form

```
┃ Plan tier
┃ ● Standard   ○ Light   ○ Heavy
┃
┃ [ Submit ]  More actions ▾
┃              ├ Pause run
┃              ├ Go back to stage ▸  plan
┃              │                     provision
┃              │                     implement
┃              └ Abandon run
```

- Submit sends the site's own answers. It means continue and adds no `next`.
- Typing your own answer (write-in) still means "change something": the skill
  redoes the step, as after #1138.
- More actions ▾ is one quiet button beside Submit. Matt picked the
  wording: **More actions**, **Pause run**, **Go back to stage ▸** opening a
  list of stage names, **Abandon run**.
  - Rows the `controls` block doesn't allow are left out.
  - With no rows at all, the More actions button is left out.
- A run control sends only the reserved keys, with no other answers:

  | Row | Answers sent |
  |---|---|
  | Pause run | `{next: "hold"}` |
  | Go back to stage ▸ `<stage>` | `{next: "go-back", to: "<stage>"}` |
  | Abandon run | `{next: "abandon"}` |

- Abandon run asks for a confirm under the buttons first, since it can't be
  undone. My call, using the kit's existing confirm pattern.
- Keyboard: More actions is a button like the others. Enter or a click opens
  the menu, the arrows move through it, Enter picks a row, and Escape closes
  it.
- The menu is a new kit widget, because the kit has no menu today. It goes
  in `@mattstack/mod-kit` so other mods can use it.

### Dismissing without keypresses

Today, when a gate is answered on another surface (the board, the console, a
shepherd), the daemon rings the doorbell and then sends a Escape keypress
into the pane (`lib/daemon/gate-escape.ts`, `gate-push.ts`) to close the
AskUserQuestion form that blocks it. It reads the pane's screen to decide,
and it falls back through session and worktree when the pane id is stale.
Matt wants mattstack to be able to close a gate without sending keypresses.

- The gate row records that the kit form is showing it, for example
  `origin.presentation: "kit"`. The mod sets this when it takes the gate
  over.
- For a kit form gate, the daemon never sends Escape. The doorbell still
  rings, so the agent re-enters through `gate_reconcile` as it does today.
- The mod closes its own form. While the form is open, the mod keeps one
  watcher per gate, for example `rt gate wait <id>` through
  `$.process.spawn`, which streams and can outlive a hook call. When the
  gate is answered or closed anywhere else, the watcher returns, and the mod
  marks the form answered elsewhere and closes it.
- A gate superseded by a newer one (`supersededId`) closes the same way.
- If the watcher dies, the mod checks the gate once the next time the form
  is drawn or focused (`rt gate list` or `gate_list`), so a stale form never
  lets you submit an answer that's already been settled. The compare-and-swap
  refuses that answer anyway.
- With the setting off, Escape injection stays exactly as today for
  AskUserQuestion forms.

### The daemon's answer check

`validateGateAnswers` accepts the reserved keys on every gate, even when the
gate didn't ask them:

- `next`: one of `proceed`, `hold`, `go-back` or `abandon`.
- `to`: allowed only with `next: "go-back"`.
- An answer whose `next` is `hold`, `go-back` or `abandon` may leave the
  gate's own questions unanswered.
- Everything else keeps today's error strings, which are a wire contract
  pinned by `packages/rt-client/test/gate-answers.test.ts`.

### Installing the mod

gate-form is built into `plugins/gate-form/` but isn't listed in
`marketplace.json` (an earlier decision). **Open: how Matt installs it for the
prototype** (see Open questions).

## Constraints

- The engine's mod rules from the kit work hold: one `on(event)` per event,
  literal atom refs, no `import(`, and Client props under the 100,000-character
  cap.
- A mod tool call has a 10s budget, so the mod never waits for the person
  inside the hooked call. It returns at once and answers later.
- Never put a mattstack ticket id in employer-visible surfaces. This work is
  mattstack-only.

## Left to the builder

- How `rt gate answer` is run from the mod (`$.process`), and how the pane's
  `decidedBy` is filled in.
- How the gate tools find the run's earlier stages for `goBack` (the run
  snapshot they already read).
- The menu widget's drawing and focus details, within the kit's existing look.
- Tests: the mod's hook pass-through and takeover, the reserved-key checks,
  and the `kitForm` block with the setting on and off.

## Open questions

- How should gate-form be installed for the prototype: listed in
  `marketplace.json`, or installed by hand from the repo?
