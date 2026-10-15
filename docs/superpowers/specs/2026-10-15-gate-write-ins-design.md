# Gate write-ins and a preselected Proceed

Date: 2026-10-15
Status: approved design, awaiting spec review

## Problem

A gate question with options can only be answered by picking one. The note
box under each question only rides along with a pick, so typing your own
answer and leaving the options alone leaves Next disabled. This held on a
work run's gate in the console, and the board's stage, review and respond
sheets behave the same way.

The rule is enforced at three layers:

- the daemon: `validateGateAnswers` (`packages/rt-client/src/gate-answers.ts`)
  refuses any value that is not one of the question's options;
- gate-kit: `gateAnswerPayload` (`packages/gate-kit/src/payload.ts`) returns
  null while a single-select has no pick, and its doc states "strict option
  membership ... never a freeform QuestionnaireInput";
- the UIs: the console's `GatePanel` (`isAnswered` ignores the note) and the
  board's `StageSheet`, `ReviewGateSheet` and `RespondSheet` disable submit
  on the same condition.

The only escape hatch today is the standing **Iterate here** option on run
gates' `next` question, whose note is the change request. Review, re-review
and respond gates have no such option.

A second, smaller friction: the stage-end `next` question (Proceed / Iterate
here / Hold) is answered Proceed almost every time, yet the form opens with
nothing selected, so it takes a click on Proceed and a click on Next.

## Goals

- Every gate question can be answered by writing your own answer instead of
  picking an option, on every surface: console, board, and the in-pane form.
- The asking agent receives the exact text, can never mistake it for an
  option value, and treats it as the human's instruction.
- The `next` question opens with Proceed already selected in the console and
  board forms.

## Non-goals

- Preselecting any other option, including ones marked `(Recommended)`.
  Preselecting real decisions invites rubber-stamping.
- Changing the in-pane form (Claude Code's own picker). Its "Other" already
  collects text, and Proceed is already its first option.
- A separate write-in input. The existing note box is reused.

## Design

### 1. Wire contract and daemon

A question's answer gains a third wire shape, alongside the bare value and
`{ value, note?, text? }`:

```json
{ "writeIn": "post only the critical findings and ask about the cache key" }
```

Rules, enforced in `validateGateAnswers`:

- `writeIn` is a string, non-empty after trimming.
- It stands alone: an object carrying `writeIn` together with `value`, `note`
  or `text` is refused.
- It is valid on any question with options, single-select or multi. A
  zero-option question stays free-form and excluded from forms as today.
- A `writeIn` answer skips the single/multi type check and the option
  membership check. The question id must still be present, as today.
- New error strings, pinned verbatim in
  `packages/rt-client/test/gate-answers.test.ts` like the existing ones:
  - `question <id> writeIn must be a non-empty string`
  - `question <id> writeIn replaces value, note and text; send it alone`

Helpers:

- rt-client gains `isWriteIn(raw): raw is { writeIn: string }`.
- `unwrapGateAnswerValue` returns `undefined` for a write-in, so a consumer
  that only reads values falls through instead of acting on the text as if
  it were an option.
- gate-kit's `UnwrappedGateAnswer` gains `writeIn?: string` and its `value`
  becomes optional; `unwrapGateAnswer` fills `writeIn` for the new shape.

Entry points:

- The `gate_answer` MCP tool's `ANSWER_VALUE_SCHEMA` (`lib/mcp/tools.ts`)
  accepts `{ writeIn }`. Its description changes from "Answers must be
  option VALUES verbatim" to say answers are option values verbatim, or
  `{writeIn}` when the human wrote their own answer.
- `rt gate answer --answers` and the console and board server routes pass
  answers through to the daemon untouched and need no change.

Rollout: console, board and daemon ship together in the bundle. In dev mode
a UI newer than the running daemon gets a validation error until the daemon
restarts; the PR says so.

### 2. UI

One rule, in gate-kit's form builders (`answersFromForm`, and the
`gateAnswerPayload` path the board's `sheet-payload.ts` and `RespondSheet`
use), applied per question:

| Pick | Note box | Answer |
|---|---|---|
| yes | empty | the value (today) |
| yes | text | `{ value, note }` (today) |
| no | text | `{ writeIn: text }` |
| no | empty | unanswered for a single-select; `[]` skip for a multi (today) |

Note text is trimmed before this test, as notes are today.

Console (`apps/console/src/app/runs/run-page/GatePanel.tsx`):

- `isAnswered` also counts non-empty note text, so Next enables, the step
  dot shows its check, and the button drops its ` · none` suffix.
- The note box placeholder follows the state: with no pick it invites a
  written answer, with a pick it stays an optional note for the agent. Final
  wording goes through `rt:ui-copy`.
- Clicking the selected option clears it, so any single-select can go back
  to unpicked and take a write-in.
- When the gate has a question with id `next` and an option with value
  `proceed`, the form opens with Proceed selected. A restored draft that
  already holds a value for `next` wins over the preselection.

Board (`apps/board/src/client/board/`):

- `StageSheet`: the shared `Note` box feeds the shared builder, so submit
  enables on a write-in. Proceed preselection as in the console.
- `ReviewGateSheet`: the outcome's note box becomes a write-in when no
  outcome is picked, and submit enables. The findings lists stay multi and
  skippable; "do something else" goes in the outcome write-in.
- `RespondSheet`: each thread's note box becomes a write-in when no
  fix/reply/skip is picked, and the tally gains "N written in". The
  `code-changes` question is unchanged: its note is the revise reason and it
  is structurally collapsed.
- Click-to-clear on the board's single-select pickers, as in the console.

Where write-in is offered: the wire accepts it on every question; the UIs
offer it through each question's note box. List questions with no note box
(review findings, the respond replies multi) are covered by the write-in on
their outcome or thread.

Answered views:

- `answeredGateSummary` (`packages/gate-kit/src/summary.ts`) renders a
  write-in as a `wrote in: "<text>"` fragment. The console's `GateRecord` and
  the board's `AnsweredSheet` and gate summary pick it up from there.
- `run-outcome-refresher` (`lib/daemon/run-outcome-refresher.ts`) labels a
  run whose review-post or respond-post question was written in as
  `wrote in`, instead of returning null.

### 3. Agents

All gated verbs consume answers through the shared `gate-protocol`
attachment (`plugins/mattstack/attachments/gate-protocol/SKILL.md`).

- "Map the gate answer to exact option values": the pane form's "Other"
  text on any question becomes `{ writeIn: text }`, never coerced into the
  nearest option. On `next` this reads the same as Iterate here with a note,
  which is what the pipeline-gates spec already gives "Other".
- A new branch before "Act on the gate answer at the site": when any
  question came back as a write-in, the verb does not take the site's
  mechanical branch for that gate. It reads the whole answer set with the
  write-in as the governing instruction (the other picks may be part of what
  was meant) and acts on it in-pane, as Iterate is handled today. If the next
  step is still unclear it asks in-pane; a real decision opens a new gate,
  never reuses the old one, matching the existing Hold/Iterate rule.
- Under a run, `run_decision` records the write-in verbatim in that
  question's slot of the selection.
- shepherdr: one line saying a relayed human answer that fits no option is
  sent as `{ writeIn }`.

Build obligations for these edits:

- Skill text is written through `superpowers:writing-skills` with a
  RED/GREEN pass on the new branch.
- Bump `plugins/mattstack/.claude-plugin/plugin.json`.
- Regenerate `plugins/mattstack/attachments/mcp-tools/reference.md` after
  the MCP description change.
- Run `bun run skills:expand:board` and commit `apps/board/skills`.
- Recompile the team packs that vendor gate-protocol per
  `mattstack:editing-skills`.

## Testing

- rt-client `gate-answers.test.ts`: write-in accepted on single and multi;
  refused when empty, whitespace, non-string, or combined with
  value/note/text; new error strings pinned.
- gate-kit: the builder table above, `unwrapGateAnswer`,
  `answeredGateSummary`.
- MCP: the `gate_answer` schema accepts `{ writeIn }` and refuses it with
  extra keys.
- Console `GatePanel.test.tsx`: note alone enables Next and submits
  `writeIn`; click-to-clear; Proceed preselected on `next`; a draft beats
  the preselection; a pick plus note still submits `{ value, note }`.
- Board: `stage-sheet-dom.test.tsx` and the review and respond sheet tests
  get matching cases; stories gain write-in states.
- `run-outcome-refresher` test: a written-in post gate labels `wrote in`.
- Fast Browser renders of the console gate panel and the board's stage,
  review and respond sheets in light and dark, with anything that reads
  wrong reported.

## Sequencing note

A peer session holds uncommitted edits to `GatePanel.tsx`, `OptionChips.tsx`
and nearby console files in the main checkout (post-submit cache update,
key badges dropped from read-only chips). They do not change this design;
implementation branches from main after they land.
