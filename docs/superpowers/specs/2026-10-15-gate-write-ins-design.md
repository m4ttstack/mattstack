# Gate write-ins and a preselected Proceed

Date: 2026-10-15
Status: approved design, awaiting spec review

## Problem

A gate question with options can only be answered by picking one. The note
box under each question only rides along with a pick, so typing your own
answer and leaving the options alone leaves Next disabled. This held on a
work run's stage gate in the console.

The rule is enforced at three layers:

- the daemon: `validateGateAnswers` (`packages/rt-client/src/gate-answers.ts`)
  refuses any value that is not one of the question's options;
- gate-kit: `gateItems` (`packages/gate-kit/src/react/index.ts`, docblock
  at line 68) makes every single-select `required` with "strict option
  membership ... never a freeform QuestionnaireInput", and
  `gateAnswerPayload` (`packages/gate-kit/src/payload.ts`) returns null
  while a single-select has no pick;
- the UIs: the console's `GatePanel` (`isAnswered` ignores the note) and the
  board's `StageSheet` disable submit on the same condition.

The only escape hatch today is the standing **Iterate here** option on run
gates' `next` question, whose note is the change request.

A second, smaller friction: the stage-end `next` question (Proceed / Iterate
here / Hold) is answered Proceed almost every time, yet the form opens with
nothing selected, so it takes a click on Proceed and a click on Next.

## Goals

- A gate question the asker marks as accepting a write-in can be answered
  with your own text instead of a pick, on every surface: console, board
  and the in-pane form.
- The asking agent receives the exact text, can never mistake it for an
  option value, and treats it as the human's instruction.
- The `next` question opens with Proceed already selected in the console and
  board forms.

## Non-goals

- Write-ins on every question. Write-in is opt-in per question; questions
  whose answers drive a mechanical step (review findings and outcome,
  respond threads, doctor's action, pane-attention) do not set it, and
  their flows are unchanged, including the review sheet's existing seeding
  of the recommended outcome.
- Preselecting any option other than Proceed on `next`, including ones
  marked `(Recommended)`.
- Changing Claude Code's own picker. Its "Other" already collects text, and
  Proceed is already its first option.
- A separate write-in input. The existing note box is reused.

## Design

### 1. The question attribute and the wire contract

`GateQuestion` (rt-client `packages/rt-client/src/commands.ts`, and
gate-kit's `packages/gate-kit/src/types.ts`) gains an optional
`writeIn?: true`. Default absent: the question behaves exactly as today.

At gate open the daemon refuses `writeIn` on a question with no options
(a zero-option question is already free-form):
`question <id> writeIn needs options`.

A question's answer gains a third wire shape, alongside the bare value and
`{ value, note?, text? }`; the `GateAnswer` union in `commands.ts` gets the
arm:

```json
{ "writeIn": "split the migration into its own MR before shipping" }
```

Rules, enforced in `validateGateAnswers`:

- Accepted only on a question that declares `writeIn: true`; anywhere else
  it is refused.
- `writeIn` is a string, non-empty after trimming.
- It stands alone: an object carrying `writeIn` together with `value`, `note`
  or `text` is refused.
- Valid on single-select and multi questions alike. A `writeIn` answer skips
  the single/multi type check and the option membership check. The question
  id must still be present, as today.
- New error strings, pinned verbatim in
  `packages/rt-client/test/gate-answers.test.ts` like the existing ones:
  - `question <id> does not accept a write-in`
  - `question <id> writeIn must be a non-empty string`
  - `question <id> writeIn replaces value, note and text; send it alone`

Pane-attention gates, whose answer the daemon itself reads
(`runAttentionRouting`, `lib/daemon/handlers/gate.ts`), never set the
attribute, so the first rule refuses a write-in there.

Helpers:

- rt-client gains `isWriteIn(raw): raw is { writeIn: string }`.
- `unwrapGateAnswerValue` returns `undefined` for a write-in, so a consumer
  that only reads values falls through instead of acting on the text as if
  it were an option.
- gate-kit's `UnwrappedGateAnswer` gains `writeIn?: string` and its `value`
  becomes optional; `unwrapGateAnswer` fills `writeIn` for the new shape.
- Rebuild rt-client's `dist/` after the type changes; the dist-freshness
  test fails on a stale build.

Entry points:

- `gate_ask` (`lib/mcp/tools.ts`): the question schema accepts
  `writeIn: true`, and its description's "Answers must be option VALUES
  verbatim" sentence adds that a question marked `writeIn` may instead be
  answered `{writeIn}`.
- `gate_answer`: `ANSWER_VALUE_SCHEMA` accepts `{ writeIn }`, and its
  description's "Answer values must be option VALUES verbatim" sentence gets
  the same addition.
- `rt gate answer --answers` and the console and board server routes pass
  answers through to the daemon untouched and need no change.

Rollout: console, board and daemon ship together in the bundle. In dev mode
a UI newer than the running daemon gets a validation error until the daemon
restarts; the PR says so.

### 2. UI

One rule, in gate-kit's form builders (`answersFromForm`, and the
`gateAnswerPayload` path the board's `sheet-payload.ts` uses), applied per
question. Note text is trimmed first, as today.

| Question | Pick | Note box | Answer |
|---|---|---|---|
| any | yes | empty | the value (today) |
| any | yes | text | `{ value, note }` (today) |
| `writeIn` | no | text | `{ writeIn: text }` |
| `writeIn` | no | empty | unanswered for a single-select; `[]` skip for a multi (today) |
| not `writeIn` | no | any | unanswered for a single-select; `[]` skip for a multi, note kept as today |

`gateItems` keeps a `writeIn` single-select `required`, satisfied by a pick
or by note text; its docblock is rewritten to say so.

Console (`apps/console/src/app/runs/run-page/GatePanel.tsx`):

- On a `writeIn` question, `isAnswered` also counts note text, so Next
  enables, the step dot shows its check, and the button drops its ` · none`
  suffix.
- On a `writeIn` question the note placeholder follows the state: with no
  pick it invites a written answer, with a pick it stays an optional note.
  Other questions keep today's placeholder. Final wording goes through
  `rt:ui-copy`.
- On a `writeIn` single-select, clicking the selected option clears it.
- When the gate has a question with id `next` and an option with value
  `proceed`, the form opens with Proceed selected, but only when no draft
  was restored for the gate. The preselection is not user input: it does not
  save a draft or show "Draft saved".

Board (`apps/board/src/client/board/`):

- `StageSheet` is the only board body that changes. On `writeIn` questions
  the shared `Note` box (`SheetParts.tsx`) feeds the write-in rule, takes
  the state-following placeholder, and single-selects get click-to-clear.
  The "N of M answered" tally and the dock's `pickChip` count and show
  write-ins. Proceed preselection follows the console's rule.
- `ReviewGateSheet`, `RespondSheet` and `PaneSheetBody` are unchanged: their
  questions never set `writeIn`.

Answered views. Each of these reads `.value` today and gets a write-in
branch that shows `wrote in: "<text>"`:

- gate-kit `answeredGateSummary` (`packages/gate-kit/src/summary.ts`);
- the console's `questionAnswer` (`apps/console/src/app/runs/derive/gates.ts`),
  which feeds `derive/gateRecord.ts`, `day.ts` and `story.ts`;
- the board's `AnsweredSheet.tsx` (the read-only form rebuilt from
  `unwrapGateAnswer(raw).value`), which shows the text in place of the
  chips instead of "none" or "No answer recorded.";
- `row-status.ts` and `respond-join.ts`, which only need to compile against
  the optional `value` and treat a write-in as no pick;
- `run-outcome-refresher` (`lib/daemon/run-outcome-refresher.ts`) keeps
  returning null for its post gates, which never set `writeIn`.

### 3. Agents

Which questions set `writeIn`: the pipeline stage sites
(`plugins/mattstack/attachments/pipeline/*`) set `writeIn: true` on their
decision questions, the questions where an answer outside the options is
something the agent can act on. `next` never sets it (Iterate here already
carries a change request), and neither do review, respond, doctor or
pane-attention questions. The plan lists each site's questions.

`plugins/mattstack/attachments/gate-protocol/SKILL.md`:

- "Asking": document the attribute and the rule above for when to set it.
- "Answers are option values" (the section stating the daemon rejects
  anything that is not an option value, and that pane free text replacing
  offered text rides as a note) is rewritten: on a `writeIn` question the
  answer may be `{writeIn}`; everywhere else today's rules hold unchanged.
- "Map the gate answer to exact option values": on a `writeIn` question,
  the pane form's "Other" text becomes `{ writeIn: text }`, never coerced
  into the nearest option. On any other question "Other" keeps today's
  handling.
- The words path ("the human answers in words at a held gate") follows the
  same rule: words that fit no option become a write-in on a `writeIn`
  question, and keep today's handling elsewhere.
- A new branch before "Act on the gate answer at the site": when any
  question came back as a write-in, the verb does not take the site's
  mechanical branch for that gate. It reads the whole answer set with the
  write-in as the governing instruction (the other picks may be part of what
  was meant) and acts on it, as Iterate is handled today. If the next step
  is still unclear: under a run it opens a new gate (the gate stop hook
  blocks ending a turn in prose under a running run), and only with no run
  does it ask in prose. A real decision always opens a new gate, never
  reuses the old one, matching the existing Hold/Iterate rule.
- Under a run, `run_decision` records the write-in in that question's slot
  as an object, for example `"approach": {"writeIn": "..."}`, never as bare
  text that would read as an option value.

The board wrappers' own answer rules (`apps/board/skills-src/respond/SKILL.md`
"Reading answers", `respond/gate-step.md`, `doctor/entry.md`) are unchanged:
their questions never set `writeIn`, so strict membership and "Other text
rides as a note" stay true for them.

shepherdr: one line saying a relayed human answer that fits no option is
sent as `{ writeIn }` when the question allows it.

Build obligations for these edits:

- Skill text is written through `superpowers:writing-skills` with a
  RED/GREEN pass on the new branch.
- Bump `plugins/mattstack/.claude-plugin/plugin.json`.
- Regenerate `plugins/mattstack/attachments/mcp-tools/reference.md` after
  the MCP description changes.
- Run `bun run skills:expand:board` and commit `apps/board/skills`.
- Recompile the team packs that vendor gate-protocol per
  `mattstack:editing-skills`.

## Testing

- rt-client `gate-answers.test.ts`: write-in accepted on single and multi
  `writeIn` questions; refused on a question without the attribute, when
  empty or whitespace, non-string, or combined with value/note/text; the new
  error strings pinned. Gate open refuses `writeIn` on a zero-option
  question.
- gate-kit: the builder table above, `gateItems` required-ness,
  `unwrapGateAnswer`, `answeredGateSummary`.
- MCP: `gate_ask` accepts `writeIn: true` on a question; `gate_answer`
  accepts `{ writeIn }` and refuses it with extra keys.
- Console `GatePanel.test.tsx`: on a `writeIn` question a note alone enables
  Next and submits `writeIn`, click-to-clear works, and a pick plus note
  still submits `{ value, note }`; on a plain question a note alone still
  leaves Next disabled; Proceed preselected on `next`; a restored draft
  suppresses the preselection; no "Draft saved" on open.
- Console `derive/gates` tests: `questionAnswer` renders a write-in.
- Board: `stage-sheet-dom.test.tsx` gets the console's cases plus the tally
  and `pickChip`; `AnsweredSheet` renders a write-in; stories gain write-in
  states.
- Fast Browser renders of the console gate panel and the board's stage and
  answered sheets in light and dark, with anything that reads wrong
  reported.
