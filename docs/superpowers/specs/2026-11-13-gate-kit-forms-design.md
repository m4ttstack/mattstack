# Gate kit forms design

Status: draft, not yet approved.

Base: stacked on #1138 (`rt-572-drop-gate-next`, RT-572). Both ship in the
same release; each PR merges when it's ready.

## Intent

Every gate a Claude Code pane shows today is an AskUserQuestion form.
AskUserQuestion holds at most 4 questions with 4 options each, so the gate
tools split gates into chunks. One question with too many options turns the
whole gate into a wait. Matt wants pane gates drawn with the mod kit's form
(the gate-form mod) instead, so they match the human-todos look and lose the
4 × 4 limit.

#1138 removes the `next` question ("Happy with this, or should something
change?") from every gate, because it cost an extra tap on every gate. The
kit form brings its choices back as actions that are always there and never
asked: Submit means continue, and Pause run and Go back to stage sit behind a
More actions menu. Abandon is left out (Matt's call); the CI and ship gates keep
their own abandon option.

The kit form also replaces the keypress hack: today the daemon closes a pane's
AskUserQuestion form by sending Escape into it. The kit form closes itself.

This is a prototype. It is off by default, and only an rt setting turns it on
until Matt is happy with it.

## Goals

- With the setting on, every pane gate opened through `gate_ask` or `gate_open`
  shows whole in the kit form, with no chunking and no 4 × 4 limit.
- Submit means continue. The form never asks `next`.
- More actions ▾ offers Pause run and Go back to stage ▸, each only where it
  applies.
- mattstack closes a kit form without sending any keypress.
- With the setting off, without the mod, or where the mod can't draw, gates
  behave exactly as today.

## Non-goals

- Forms that aren't gates (wrap-up, brainstorming and other AskUserQuestion
  calls) keep AskUserQuestion. Matt picked gates only.
- Gates the board raises for MRs. They open through the board's own CLI
  (`apps/board/src/gates/verbs.ts`), never through MCP `gate_ask`, so the mod
  never sees them.
- A kit form for the board-only gates: `review-post`, `respond-plan` and
  `respond-post`. Matt ruled that these are answered on the board only, and on
  #1138 the daemon always presents them as wait (`BOARD_ONLY_KINDS` in
  `lib/daemon/handlers/gate.ts`). The mod shows an "Open on board" band for
  them instead (below).
- Pause and Go back on the plain AskUserQuestion form. With the setting off,
  they stay gone, as #1138 leaves them.
- Making the kit form the default. That's a later call.

## Anti-goals

- Never bring back a question every gate has to answer.
- Never close a kit form by sending keypresses into the pane.
- Never leave a pane stuck. A missing mod, a pane that can't draw, a failed
  answer, a closed form or a reloaded module must each leave the gate
  answerable and the agent able to wake.

## How it works today

The full map, with file and line anchors, is in the integration audit this
spec was checked against. In short:

- **Open.** `gate_ask` (`lib/mcp/gate-tools.ts` `askGate`) and `gate_open`
  (`openGate`) call the daemon's `gate:ask` (`lib/daemon/handlers/gate.ts`).
  - The daemon picks the presentation (`gatePresentation` in
    `packages/rt-client/src/gate-presentation.ts`). It's **form** only with a
    pane id, a session and at most 4 options per question.
  - It sets `nudge` (the doorbell's target) only for form.
  - A new gate supersedes any open gate with the same subject and kind.
- **Present.** The MCP tool turns that into `paneAction` (`lib/gates/form.ts`)
  and `formChunks`. Under a run it writes `waiting-gate` only on wait.
  - `present-pane-form` asks each chunk with AskUserQuestion.
  - The AskUserQuestion hook (`scripts/hooks/gate-fork.sh` → `rt gate
    fork-check`) allows it for a form gate this pane asked.
- **Answer.**
  - The pane answers through `gate_answer`, which sends `by: pane` plus the
    session.
  - The board and console answer with `override`, and the shepherd through
    `herd_gate_answer`.
  - `validateGateAnswers` (`packages/rt-client/src/gate-answers.ts`) refuses
    unknown keys, missing answers, and write-ins on questions without
    `writeIn`.
- **Notify.** An answer from another surface rings the doorbell. Before the
  doorbell, the daemon probes the pane, and if it reads a question form on
  screen it sends Escape (`gate-push.ts`, `gate-escape.ts`). The reconciler's
  retry also sends Escape, with no presentation check (`reconciler.ts`).
  - The pane's own answer (`answeredByNudgedPane`) rings no doorbell and is
    stamped consumed.
- **Reconcile.** The doorbell says "re-read the registry". The agent calls
  `gate_reconcile`, which records the decision and clears `waiting-gate`.
- **Runs.**
  - `run_next` reports `ended: waiting` while `waiting-gate` is set.
  - The Stop hook (`pipeline-gate-stop.sh`) bounces a turn that ends with
    neither `hold` nor `waiting-gate` set.
  - `nextOf` reads a `next` answer, and `run_resolve` applies `hold`,
    `redirect` and `abandon`.

## Approaches

| | How | Trade-off |
|---|---|---|
| **A. The mod picks up gate calls (picked)** | The mod hooks the `gate_ask` and `gate_open` calls, marks them as kit-capable, and opens the kit form from the result. | No skill text for presenting changes, and it falls back cleanly where the mod is missing. |
| B. A new `paneAction` value | The gate tools return `paneAction: kit-form`, and `present-pane-form` gets a branch that calls the mod's tool. | Explicit in the protocol, but it needs skill edits, and a kit-form result in a pane without the mod is a dead end. |
| C. The mod catches AskUserQuestion | The skill flow stays as it is, and the mod swaps each AskUserQuestion call for the kit form. | The skill still splits into chunks of 4 that the mod would have to stitch back together. |

Matt picked A.

## Design

### The switch: setting plus a flag from the mod

Two things have to be true for a gate to use the kit form:

1. **The rt setting is on.** My call: `rt.gates.kitForm`, a boolean in
   **machine** scope, off by default. Machine scope is right because the mod
   is installed per machine. It's registered in
   `packages/rt-client/src/settings/registry-defs.ts` with its
   `schema.lock.json` entry (the `rt:settings` skill). Rebuild rt-client's
   `dist` afterwards.
2. **The mod says it can draw the form here.** The mod's `tool.call` hook on
   `mcp__plugin_mattstack_mattstack__gate_ask` and `…__gate_open` adds
   `kitForm: true` to the call's input with `next({...e, input})`, but only
   when all of these hold:
   - this surface draws the kit form (terminal or desktop; VS Code and mobile
     don't)
   - the call isn't from a subagent (`e.agentId` is unset)
   - for `gate_open`, the call isn't `handBack: true`

So a pane without the mod, a surface that can't draw, or the setting off all
take today's path unchanged. The mod never reads settings.

### What the gate tools and the daemon do

When `kitForm: true` comes in and the setting is on:

- **The tool passes it to the daemon**, as `kitForm: true` on `gate:ask` and
  `gate:open`.
- **The daemon presents the gate as `kit`.** It sets
  `origin.presentation: "kit"`, a third value next to `form` and `wait`, set
  only by the daemon at open time.
  - The option-count cap doesn't apply to kit gates.
  - The label (200 bytes) and description (1024 bytes) limits still apply.
  - `kit` needs the same pane id and session that `form` needs. Without them
    (a session outside herdr) the gate falls back to today's rules, and the
    tool leaves `kitForm` out of its result.
  - A kit gate gets a `nudge`, like form, so the doorbell can reach the pane.
- **Every reader of `presentation` learns `kit`:**
  - the rt-client type and `invalidOrigin`
  - `withGateTokens` and `rt gate list`
  - the shepherd fan-out phrase in `gate-push.ts`
  - fork-check, which never allows AskUserQuestion for a kit gate, since the
    mod shows it
- **The tool returns `paneAction: "kit"`** and leaves `formChunks` empty.
- **Under a run, the tool writes `waiting-gate=<id>`**, as for wait, so the
  Stop hook lets the turn end. `gate_reconcile` already clears it.
- **The result keeps everything it has today** (`runErrors`, `labelsTruncated`,
  `supersededId`, `formCapExceeded`, and `gate_open`'s `mode` and
  `contextDropped`). It adds a `kitForm` block:
  - `questions`: the whole stored question set
  - `context`: the gate's context. My call: the same fitted pane prose
    `gate_open` uses today (`formContext`), so `extra.context-dropped` and
    respond-plan's rules stay true. Only the 4 × 4 limit goes.
  - `controls`, the run controls this gate can offer:
    - `pause`: the gate belongs to a run.
    - `goBack`: the run's earlier stages (`earlier()` in
      `lib/runs/engine.ts`, the manifest stages before this one that have
      started), in run order.
    - When the gate's owner is `herd:*` (a shepherd's worker), `controls` is
      empty. Runs under a shepherd are redirected by the shepherd, not from
      the worker's pane. My call.

### What the mod does with the result

- The hook awaits `next(e)` and reads the result.
  - A result without `paneAction: "kit"` passes through unchanged.
  - If the result text isn't JSON (a large result spilled to a file), the mod
    reads the gate with `rt gate list --json` instead.
- **It opens the gate in the kit form pane** and replaces the agent's result
  with the original fields minus `kitForm`, plus one instruction: "The gate is
  open in the kit form. Open any boards first (per `boards_to_open`), then end
  your turn holding at gate `<id>`. The answer arrives as your next input."
- **Several gates.**
  - The mod keeps one form per gate id.
  - A gate superseded by a newer one is replaced.
  - Other open gates queue in open order, and the band above the prompt shows
    how many are waiting.
- **Recording an answer.** When the person submits, the mod runs
  `rt gate answer <id> --by pane --session <this session>` with the form's
  answers. It finds `rt` the way `enter-worktree-check.ts` does.
  - That counts as the pane's own answer: no doorbell, stamped consumed.
  - So **the mod wakes the agent itself** with `$.prompt.submit`, naming the
    gate id and `gate_reconcile`, as gate-form does today.
  - The agent never maps form picks to option values.
- **If `rt gate answer` fails**, the form stays open with the error shown, and
  the person's picks are kept.
- **A form closed without answering** waits above the prompt with Show. The
  gate stays open, and nothing re-presents it.
- **"Set aside to chat" (Ctrl-X)** means the same as closing: the gate stays
  open, and the mod tells the agent the person wants to talk about gate
  `<id>` first. It never says "ask again".

### The form

```
┃ Plan tier
┃ ● Standard   ○ Light   ○ Heavy
┃
┃ [ Submit ]  More actions ▾
┃              ├ Pause run
┃              └ Go back to stage ▸  plan
┃                                    provision
┃                                    implement
```

- **Submit** sends the site's own answers. It means continue, and it adds no
  `next`. It stays disabled until every question has an answer, because the
  daemon refuses missing answers.
- **"Something else"** (typed text) appears only on questions the gate marks
  `writeIn: true`. Typed text on those still means "change something", as
  after #1138.
- **More actions ▾** is one quiet button beside Submit, worded as Matt picked:
  **More actions**, **Pause run**, **Go back to stage ▸** opening a list of
  stage names. No Abandon row (Matt's call).
  - Rows `controls` doesn't allow are left out.
  - With no rows, the button is left out.
- **A run control sends only the reserved keys:**

  | Row | Answers sent |
  |---|---|
  | Pause run | `{next: "hold"}` |
  | Go back to stage ▸ `<stage>` | `{next: "go-back", to: "<stage>"}` |

- **Keyboard.** More actions is a button like the others. Enter or a click
  opens the menu, the arrows move through it, Enter picks a row, and Escape
  closes it.
- **The menu is a new kit widget,** in `@mattstack/mod-kit`, so other mods
  can use it.

### Run controls through the skills

- **The answer check.** `validateGateAnswers` and the shepherd's own
  `invalidAnswers` (`lib/mcp/herd-tools.ts`) accept reserved keys on every
  gate:
  - `next`: `hold` or `go-back`, optionally wrapped as
    `{value, note}`.
  - `to`: allowed only with `next: "go-back"`, checked by `run_resolve`.
  - An answer whose `next` is set may leave the gate's own questions
    unanswered.
  - Everything else keeps today's error strings, which are a wire contract.
- **Recording.** My call: an answer that's only a run control isn't recorded
  as the scope's gate decision. `gate_reconcile` returns it with `next` set,
  and the skill hands it to `run_resolve`. A resumed run therefore asks the
  gate again instead of treating it as decided.
- **Routing.** `gate-protocol` gains one shared rule: an answer with `next`
  set goes to `run_resolve` (`hold`, or `redirect` to `to`) at every site,
  so every run gate that shows More actions handles both rows.
- **Showing it.** The board and console answered views
  (`packages/gate-kit/src/summary.ts`) show a run control as its row label
  ("Paused the run"), not "(none)".

### Dismissing without keypresses

- **No Escape for kit gates.** `gate-push`'s probe already acts only on
  `form`. The reconciler's retry Escape (`reconciler.ts`) gets the same
  presentation check.
- **One watcher per gate.** While a form is open, the mod keeps one watcher
  per gate: `rt gate wait <id>` through `$.process.spawn`.
  - It runs with `CLAUDE_CODE_SESSION_ID` empty, so it never stamps another
    surface's answer as consumed before the agent reconciles.
  - When the gate is answered, closed or superseded elsewhere, the watcher
    returns. The mod closes that gate's form only (matching the id) and
    shows "Answered on the board" (or the other surface).
  - The doorbell still rings for answers from other surfaces, so the agent
    wakes as today.
- **Reloads and resumes.**
  - Watchers die with the module. On `session.start` (which includes a
    reload, a resume and a compaction), the mod lists this session's open kit
    gates and reopens their forms and watchers.
  - It checks again whenever a form is drawn after being hidden.
  - The compare-and-swap still refuses a stale answer.
- **With the setting off,** Escape injection stays exactly as today for
  AskUserQuestion forms.

### Attention signals

The agent is idle at a kit gate, not blocked inside a tool call, so the
signals that read "blocked" need a kit case:

- **Run attention** (`lib/runs/attention.ts`) treats an open kit gate as
  "at gate", not stale.
- **The herd watchdog** (`lib/daemon/herd-watchdog.ts`) treats a worker with
  an open kit gate as at a gate.
- **The tray notification** on `gate/opened` (`lib/notify-bridge.ts`) stays
  as is.
- **The herdr bell.** The mod rings it when it opens a form, since the
  AskUserQuestion hook no longer fires. The builder picks the call that
  `herdr-doorbell.sh` uses.

### Board-only gates: an "Open on board" band

For a board-only gate raised in this pane, the mod shows a band just above the
Claude Code prompt (an `AbovePrompt` band, not the sidebar pane), as Matt asked:

```
  Review findings are waiting on the board        [ Open on board ]
```

- **When.** The hooked `gate_ask` or `gate_open` call carried the mod's
  `kitForm: true`, and the result came back `presentation: wait` for a
  board-only kind. The tool adds `boardOnly: true` to the result so the mod
  doesn't need its own copy of the kind list. My call.
- **The button** opens the gate on the board with `$.process.run(['open',
  <url>])`. The URL is the board's local address plus `?gate=<id>`, a deep link
  the board already handles (`apps/board/src/client/board/Board.tsx`).
  - The address comes from `deck list` (today `http://localhost:11006`). A
    `*.mattstack` URL won't open in a browser, so it's never used. The builder
    picks how the mod reads it (`deck list --json`, or an rt verb that
    returns it).
  - If the address can't be found, the band says so and shows no button.
- **Going away.** The same per-gate watcher as a kit form clears the band when
  the gate is answered, closed or superseded. On `session.start` the mod
  restores bands for this session's open board-only gates.
- **The result is untouched.** The agent still gets the wait result and runs
  `rt gate wait` as today. The band only adds a shortcut.
- With several board-only gates open, the band names the newest and how many
  more are waiting. Its button opens the newest.

### Installing the mod

Matt picked the human-todos pattern: list gate-form in
`marketplace/marketplace.json` and add it to the mattstack plugin's
`dependencies`. It installs with mattstack, and the rt setting keeps it off
until turned on. The gate hook lives in gate-form.

## Constraints

- The engine's mod rules from the kit work hold: one `on(event)` per event,
  literal atom refs, no `import(`, and Client props under the 100,000-character
  cap.
- A hook's budget counts only its own time; awaiting `next(e)` or a `$` call
  is free. The hook still never waits for the person: a gate can sit open for
  hours, and a held tool call blocks the agent's turn from ending.
- Never put a mattstack ticket id in employer-visible surfaces. This work is
  mattstack-only.

## Left to the builder

- How the pane's session id reaches the mod's `rt gate answer`.
- The menu widget's drawing and focus details, within the kit's existing look.
- The exact wording of the mod's wake-up prompt and the "answered elsewhere"
  note.
- Tests:
  - the hook's pass-through and takeover, including the surface and
    subagent checks
  - the reserved-key checks in both validators
  - presentation `kit` in the daemon, with and without pane and session
  - `waiting-gate` on kit gates
  - no Escape for kit gates, from either the push or the reconciler
  - the watcher closing only its own gate's form
  - reopening forms on `session.start`
  - the board-only band: shown for board-only kinds, the `?gate=<id>` URL from
    the deck address, cleared by the watcher

## Open questions

None.
