---
name: receive-review
disable-model-invocation: true
description: >-
  Use when processing review feedback received on your OWN MR/PR --
  "address the review comments", "go through the reviewer's comments and
  reply", "respond to the review", "handle the feedback on my change".
  For someone else's change use the domain's review skill; for your own
  branch before it has feedback use the self-review flow.
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reply-rules: { contract: reply-rules@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# Receive review (feedback on your own change)

The review comments left on **your own** change: pull the open threads, judge
each against the codebase, decide what to change, reply. Implementation and
posting each wait for their gate's answer.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when `RT_RUN_DB` is set
and `rt runs snapshot` shows `run.status` = `running`: you were invoked
from inside that run, you inherit it, `run.current_stage` is your stage,
and you close nothing at the end.

Otherwise, when a surface launched this pane (the `--spawned-by` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: list `~/.mattstack/runs/<repo>/`
(the `--repo` value in the flags block below) for runs whose `snapshot`
shows `run.status` = `running` and `run.work_type` = `receive-review` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
receive-review` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage receive-review`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:receive-review}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage receive-review
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage receive-review`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage receive-review`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.

Baseline agents already fetch threads, verify before implementing, clarify
vague comments, and gate posting; this skill cross-references those rather
than re-teaching them. It exists for the two things agents get wrong on their
**own** change: adjudicating the comments in the context that wrote the code
(author bias), and performative agreement leaking into the replies.

## 1. Resolve the change and filter the threads

- The change and its requirements come from the caller or domain adapter: the
  diff range, plus the requirements it is judged against. Report a fetch
  failure or a mismatched pair exactly as found; never fabricate the missing
  half.
- Keep only **unresolved human** threads: drop system notes and bot authors.
  Capture each thread's id, its `file:line`, and its full note chain.
- Zero unresolved human threads: say so and stop. Close, only when `## Run`
  started this run: `rt runs stage-done --stage receive-review`, `rt runs
  run-status --status done`, `unset RT_RUN_DB`.

Fetch mechanics belong to the forge CLI (`gh` / `glab`) and the adapter.

## 2. Adjudicate in a fresh context

<HARD-GATE>
Do not judge the reviewer's comments in this session. You (helped) write this
code; reading the diff here re-derives the same assumptions and nods at them,
and reading harder buys confidence, not independence. A ruling formed here IS
the verdict whatever it is labeled, including "the reviewer clearly has a
point, I'll just add the guard."

**REQUIRED SUB-FLOW:** the review dispatch flow below, adjudicator shape,
ONE dispatch covering ALL the threads. Running a
self-review as an afterthought at the end does not satisfy this: the fresh context is how the
comments are adjudicated, not a final gut-check.
</HARD-GATE>

Hand the dispatch flow the numbered threads (`file:line` plus note chains), the
requirements, and the diff range; it owns the template, the subagent, and the
standard blocks.

## Criteria

{{slot:criteria}}

The Criteria section above is the domain's review standards, when the pack
binds them: evaluate the triage lines it declares against this change, and
pass its addendum with `{TRIAGE_FLAGS}` (those resolved values) and
`{SETUP_OBSERVATIONS}` (what was already gathered, else `none`) filled, the
rest verbatim. No depth block here; the addendum informs the per-thread
verdicts.

**One dispatch, all threads together.** Related comments must be judged with
shared context; a partial reading produces wrong conclusions and a wrong
implementation follows it. This batching rule is this skill's own, held
whatever the slots bind.

Per thread it returns `valid` / `pushback` / `needs-clarification`, plus that
entry's relations.

{{include:review-dispatch-body}}

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

## 3. Verdicts and drafted replies (Gate A, scope `verdicts`)

Present the verdict table plus a drafted reply per thread, then the gate.
Nothing is written to code, nothing posted:

- `rt runs field set gate verdicts --stage <stage>` (`receive-review` for an
  own run, `run.current_stage` when inherited).
- The form: **Verdicts and replies approved** (recommended) / **Iterate
  here** (their text names the threads and the change) / **Redo the
  adjudication**; **Hold**.
- `rt runs decision record --contract gate@1 --scope verdicts --selection '{"next":"approve|iterate|redo|hold","note":"<their words or null>"}' --decided-by receive-review`.

**Reply content is a seam.** **No Reply rules section below** (the slot is
unbound): **REQUIRED SUB-SKILL** `superpowers:receiving-code-review`. **A
Reply rules section below**: follow it. On top of either branch, these hold:

- **Per verdict.** `valid` -> a technical acknowledgment of the fix.
  `pushback` -> the technical reason, referencing the code or test that shows
  it. `needs-clarification` -> one crisp question.
- **An ask is an ask.** If the reply asks the reviewer anything, its verdict
  is `needs-clarification`, not a `pushback` ending in a question: when the
  answer would change the ruling, the question is the ruling.
- **No performative openers.** A reply states the technical content. An
  opener acknowledging the comment's quality or offering thanks is
  performative and carries none: "Good call", "You're right", "Great catch",
  "Nice find", "Thanks" -- and every variant, "Confirmed, thanks." included.
  Open on what the code does or what changes.
- **Voice.** Drafting starts by loading the operator's writing-style skill
  when one is available: that load is step one, and each reply is composed in
  that voice from the first word, never a second-pass edit. Absent one, a
  neutral, concise voice.

## Reply rules

{{slot:reply-rules}}

## 4. Implement valid fixes (Gate B, scope `fixes`)

Nothing is implemented until the developer approves it -- not under cover of
"in a follow-up commit," not while drafting. The approval is a form:

- `rt runs field set gate fixes --stage <stage>`.
- The form: a multi-select of the `valid` threads, all pre-selected, each
  option naming `file:line` and the fix; **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope fixes --selection '{"threads":[...]}' --decided-by receive-review`.

On the answer, implement the selected
`valid` fixes one at a time, verifying each with the project's tests and
checks before the next. Finalize each valid reply to "Fixed -- `file:line` /
what changed". Domain ship-time gates still apply to these fixes; this skill
never checks their box.

## 5. Post replies, gated on verdict category (on the `post` gate's answer)

The drafted replies are already bucketed by verdict from step 2.

<HARD-GATE>
Gate `post`: one structured question (the tool is `AskUserQuestion` in
Claude Code), **multi-select**, asking which verdict categories to post as
thread replies. Offer only the categories that have at least one thread
(nothing came back `needs-clarification` -> do not offer it), pre-select
every category that has threads so nothing drops silently, and let the
developer deselect -- e.g. post the `valid` "Fixed" replies and the
`pushback` reasons now, hold `needs-clarification` to ask the reviewer
synchronously first. Also offer **Hold**. `rt runs field set gate post
--stage <stage>` before and `rt runs decision record --contract gate@1
--scope post --selection '{"categories":[...]}' --decided-by
receive-review` after. A paragraph that lists the categories and waits is
not this gate.
</HARD-GATE>

Post thread replies **only** for threads in the selected categories; the rest
stay unanswered, through any channel. Never a top-level note. Never resolve a
thread, never approve: both belong to the developer, however settled a thread
looks once its reply is written. Posting mechanics belong to the forge CLI
and the adapter.

Close, only when `## Run` started this run: after the selected categories
are posted, `rt runs stage-done --stage receive-review`, `rt runs
run-status --status done`, `unset RT_RUN_DB`. Zero unresolved human
threads (step 1) closes the same way, right after the sentence that says
so.

## Red flags

| Thought | Reality |
|---|---|
| "I wrote this, I can tell if the reviewer is right" | That is the author bias. Dispatch the fresh-context adjudication (step 2). |
| "It's a small comment, I'll just judge it here" | Small own-code judgments are the peak of the bias. Dispatch it. |
| "I'll run self-review at the end as the check" | Too late. The fresh context adjudicates the comments; it is not a gut-check after. |
| "I'll open with 'Good call' / 'You're right'" | Performative. State the technical content; no agreement, no thanks. |
| "I'll process the resolved / bot threads too" | Unresolved human threads only. |
| "I'll post the replies since they look right" | Post only what the `post` gate selected; never resolve or approve for the developer. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation is Gate B, after approval, not a line in the draft. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "I'll present the table and ask about fixes and posting in the same breath" | Gate A, Gate B, and post are three forms, in order. Prose that asks all three is none of them. |

## Quick reference

| Signal | Action |
|---|---|
| "Address my review comments" | Change + requirements as given; unresolved human threads only (step 1). |
| Threads in hand | ONE dispatch via the review dispatch flow (step 2), adjudicator shape. Never inline. |
| Criteria bound | Its addendum travels with that dispatch, placeholders filled. |
| Verdicts in hand | Verdict table + drafted replies (Gate A); reply-rules voice, no performative openers. |
| Developer approves fixes | `valid` one at a time, verify each, finalize to "Fixed -- file:line" (Gate B). |
| Developer approves posting | Multi-select the categories present, post those as thread replies; never resolve, never approve. |

## Wrap-up form contract

{{include:wrap-up-form}}
