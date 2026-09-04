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
re-ask a question it already answered. Each tool call is a fresh shell:
prefix every `rt runs` command with `RT_RUN_DB=<its state.db>`.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:receive-review}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>   # each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>
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

{{include:run-identity}}

## 1. Resolve the change and filter the threads

- The change and its requirements come from the caller or domain adapter: the
  diff range, plus the requirements it is judged against. Report a fetch
  failure or a mismatched pair exactly as found; never fabricate the missing
  half.

When the run is yours, record the resolved change per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id it
names, when one exists).

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

## 3. Report the adjudication

Present the verdict table plus a drafted reply per thread, then the
recommendation, in one structured block -- nothing is written to code,
nothing posted yet. Bucket each thread by its verdict (`valid` /
`pushback` / `needs-clarification`) and its recommended action
(`fix` / `reply` / `skip`); the gate below reads from this bucketing, not
from a fresh pass over the threads.

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

## 4. Decide: respond-plan (Gate `respond-plan`)

The verb adjudicates; it never decides what gets fixed or posted. Decision
intake: when the caller hands this step a decided `{plan, post}` object (a
board wrapper, or any caller that already collected the two answers), use
`plan` and ask nothing here -- its per-question answers, keyed by question
id with verbatim option strings, are the decision. Use the decider the
caller names alongside it. Otherwise (a direct terminal run) the verb runs
the gate itself:

- `rt runs field set gate respond-plan --stage <stage>`.
- Run gate-protocol's Runs integration with kind `respond-plan` and these
  questions -- one multi-select per thread GROUP (groups bound the form
  cap; threads stay individually decidable because the option values carry
  thread ids) plus one code-changes question:

  ```json
  [
    {"id": "threads-1", "label": "Threads 1-8: reply, fix, or skip each", "multi": true,
     "options": ["reply:<threadId>", "fix:<threadId>", "skip:<threadId>", "... one triple per thread in the group, ids verbatim"]},
    {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
     "options": ["approve", "revise"]}
  ]
  ```

  More threads than one group's cap allows: repeat the `threads-N` question
  per group. Chunk the in-pane form across those groups per gate-protocol's
  Attended step 1, but submit exactly ONE `rt gate answer` after the LAST
  chunk -- never one per chunk. Plus **Iterate here**; **Hold**.
- Selecting `fix:<threadId>` implies that thread's reply; `skip:<threadId>`
  means neither. Exactly one of the `reply` / `fix` / `skip` triple is
  expected per thread -- a selection with none or more than one of the
  triple for a thread is contradictory: re-ask it via a NEW gate (same
  shape, noting the conflict), never re-answer the closed one and never
  guess which was meant.
- `rt runs decision record --contract gate@1 --scope respond-plan --selection '{"threads":{...as answered},"code_changes":"approve|revise"}' --decided-by <the answer's by>`.

`code-changes: revise` re-adjudicates: back to step 2, a fresh dispatch with
their note -- never revised in this session, the bias HARD-GATE still
applies.

## 5. Implement approved fixes

Nothing is implemented until `respond-plan` approves it -- not under cover
of "in a follow-up commit," not while drafting. On `code-changes: approve`,
implement the `fix:<threadId>` threads one at a time, verifying each with
the project's tests and checks before the next. Finalize each fixed reply
to "Fixed -- `file:line` / what changed". Domain ship-time gates still
apply to these fixes; this skill never checks their box.

## 6. Decide and post: respond-post (Gate `respond-post`)

The drafted replies are bucketed from step 3; `skip:<threadId>` threads
never reach this offer.

<HARD-GATE>
Decision intake: when the caller's `{plan, post}` object already carries
`post`, use it and ask nothing here. Otherwise the verb runs the gate
itself:

- `rt runs field set gate respond-post --stage <stage>`.
- Run gate-protocol's Runs integration with kind `respond-post` and these
  questions:

  ```json
  [
    {"id": "replies", "label": "Post which replies?", "multi": true, "options": ["<threadId> per drafted reply"]},
    {"id": "disposition", "label": "Disposition", "multi": false, "options": ["resolve-addressed", "leave-open"]}
  ]
  ```

  Offer only threads with a drafted reply (`reply:<threadId>` or a
  finalized `fix:<threadId>` from step 5); pre-select every one so nothing
  drops silently, and let the developer deselect -- e.g. post the `valid`
  "Fixed" replies and the `pushback` reasons now, hold a
  `needs-clarification` thread to ask the reviewer synchronously first.
  Plus **Iterate here**; **Hold**. A paragraph that lists the categories and
  waits is not this gate.
</HARD-GATE>

Post thread replies **only** for the selected `replies`; the rest stay
unanswered, through any channel. Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks once its
reply is written. `disposition` governs the developer's call on the posted
threads: `resolve-addressed` resolves each one just replied to, where the
forge distinguishes resolve from reply; `leave-open` posts without
resolving. Posting mechanics belong to the forge CLI and the adapter.

At execution time, after posting: `rt runs decision record --contract
gate@1 --scope respond-post --selection
'{"replies":[...],"disposition":"resolve-addressed|leave-open"}'
--decided-by <the answer's by>`.

Close, only when `## Run` started this run: after the selected replies are
posted, `rt runs stage-done --stage receive-review`, `rt runs
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
| "I'll ask both gate questions, the caller already handed `{plan, post}`" | Decision intake first: a caller-handed object answers `respond-plan` and `respond-post` -- ask nothing. |
| "I'll post the replies since they look right" | Post only what `respond-post` selected; resolve only when `disposition` says so, never approve for the developer. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `respond-plan`'s `code-changes: approve`, not a line in the draft. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. Prose that asks both at once is neither. |

## Quick reference

| Signal | Action |
|---|---|
| "Address my review comments" | Change + requirements as given; unresolved human threads only (step 1). |
| Threads in hand | ONE dispatch via the review dispatch flow (step 2), adjudicator shape. Never inline. |
| Criteria bound | Its addendum travels with that dispatch, placeholders filled. |
| Verdicts in hand | Verdict table + drafted replies, one block (step 3); reply-rules voice, no performative openers. |
| Caller hands `{plan, post}` | Use it, ask nothing; decided-by is the caller's named decider. |
| No caller-handed answers | Gate `respond-plan` (threads + code-changes), then `respond-post` (replies + disposition), in order. |
| `respond-plan` approves | `fix:<threadId>` threads one at a time, verify each, finalize to "Fixed -- file:line" (step 5). |
| `respond-post` answered | Post the selected `replies`; `resolve-addressed` resolves them, `leave-open` doesn't; never approve. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
