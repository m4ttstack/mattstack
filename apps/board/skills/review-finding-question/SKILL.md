---
name: board:review-finding-question
description: >-
  Use when the human asks about one finding of the review this session wrote,
  invoked in a board review pane as "/board:review-finding-question <gate-id>
  <finding-id> "<question>"" while the session holds at its review-post gate.
  Not for any other session.
disable-model-invocation: true
---

<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->

<!-- part: step source=review-finding-question/SKILL.md path=review-finding-question/SKILL.md lines=11-124 -->
# Review finding question

The human is deciding on your review gate and has a question about one
finding: is it real, is it overstated, what does the data say. You answer
with evidence, then they choose to revise the finding or leave it. They
finish the review on the board, never in this pane.

## Arguments

`<gate-id> <finding-id> "<question>"`, commas between them optional. The
gate is the review-post gate this session opened; the finding is an `id` in
your report json (the `.json` sibling of your `--report`). Your `--state`
and `--status-bin` are the ones this session was launched with.

This skill runs only inside the board review session that wrote that
report. If this session has no `/board:review` launch, or the finding id is
not in the report json, say so in one line and stop.

## The rule for the whole conversation

Until the human says to revise, you change nothing: no edit to the report,
no gate opened or answered, no post to the MR, no commit, no database
write. Databases only through rt's sdm verbs (the `rt:sdm-connect` skill),
only `*-read-only` resources, QA unless the human names prod in this
conversation. Posting and the verdict are the human's, on the board.

## 1. Restate, then explore through a helper

Restate in two lines: the finding (tier, title, `file:line`) and the
question. Then dispatch one read-only explorer with the Agent tool
(`model: sonnet`, `effort: medium`) and wait for it. Its brief is:

- the finding, verbatim from the report json, and the MR url;
- the human's question, verbatim;
- what it may use: the code (`mr_view`, `gitlab_get`, or a worktree
  through the `rt:worktree` skill, disposed of before it returns), logs,
  New Relic, and QA databases through rt's sdm verbs on `*-read-only`
  resources; prod only when the human named it;
- that it changes nothing anywhere and returns: what it checked (each query
  or search, verbatim), what it found, what it could not check, and its
  verdict.

Each follow-up question that needs new digging gets its own explorer with
the same brief and the new question. A question you can answer from what
you already hold, answer directly.

## 2. Report in this shape, then ask for the outcome as a form

```
Verdict: holds | narrower than written | broader than written | does not hold
Evidence:
- <what was checked> → <what it showed>   (one line each, queries verbatim)
Not checked: <what the explorer could not reach, or "nothing">
Proposed change: <new tier / anchor / comment, or "drop f2", or "none">
```

**REQUIRED SUB-SKILL:** Use mattstack:wrap-up to ask for the outcome. The
form has one Decisions question, "What should happen to <finding-id>?",
with exactly these options, the one matching your verdict first and
labelled `(Recommended)`:

- **Revise and re-raise the gate**: apply the proposed change.
- **Leave it as is**: the finding stands.
- **Keep asking**: the human has more to ask.

Recommend "Revise" when the proposed change is not "none", otherwise
"Leave it as is". Act on the answer: §3, §4, or wait for the next
question. A typed reply instead of a pick is a follow-up question: answer
it, report again in the same shape, and ask again.

## 3. Revise (only on the human's go-ahead)

1. Show the revised finding next to the original: tier, anchor, body,
   comment. Keep its `id` and every field you were not asked to change.
   For "drop", say so. Then ask with mattstack:wrap-up: one Decisions
   question, "Apply this revision to <finding-id>?", options **Apply it
   (Recommended)**, **Change the wording**, **Cancel**. Apply only on
   "Apply it"; "Change the wording" takes their edit and asks again;
   "Cancel" goes to §4.
2. Edit the finding in the report json and the report markdown, keeping
   them in step (tier counts and summary lines that name it included).
3. If a background wait loop is running on this gate, stop it with
   TaskStop (load it with ToolSearch when it is deferred) before anything
   else touches the gate.
4. Rebuild the gate's open file exactly as this session built the first
   one (the same scripts, extras and arguments), then run the same
   `open-gate.sh <status-bin> <state> review-post <open-file>`. The new gate
   supersedes the old one.
5. Start one background `<status-bin> gate wait <state> --max-ms 90000`
   loop on the new gate and end the turn holding at it. Do not show a pane
   form: the human finishes on the board.
6. Tell the human: the finding is revised, the gate is re-raised, finish
   the review on the board.

A `closed (superseded)` result for the old gate id later is your own
rebuild: ignore it and keep holding at the new gate. If the rebuild or the
open fails, say what failed, restore nothing by hand, and leave the old
gate's state as the wrapper's gate step would.

## 4. Leave it as is

Change nothing. Tell the human the finding stands and to finish on the
board. If this gate's wait loop is no longer running, start one, then end
the turn holding at the gate.

## Red flags

| Thought | Do instead |
|---|---|
| "I'll just grep and query myself" | Dispatch the explorer; your context holds the review. |
| "Prod read-only would settle it" | Offer it; run it only when the human names prod. |
| "They want it gone, I'll answer the gate as comment" | Revise, re-raise, send them to the board. |
| "The old gate closed, the run is over" | That close is your rebuild. Hold at the new gate. |
| "I'll list the options in text, it's quicker" | The outcome is a mattstack:wrap-up form; the pick is the record. |
