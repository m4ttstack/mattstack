---
name: board:review-finding-question
description: >-
  Use when the human asks about one finding of the review this session wrote,
  invoked in a board review pane as "/board:review-finding-question <gate-id>
  <finding-id> "<question-file>"" while the session holds at its review-post gate.
  Not for any other session.
disable-model-invocation: true
---

# Review finding question

The human is deciding on your review gate and has a question about one
finding: is it real, is it overstated, what does the data say. You answer
with evidence, then they choose to revise the finding or leave it. They
finish the review on the board, never in this pane.

## Arguments

`<gate-id> <finding-id> "<question-file>"`, commas between them optional. The
gate is the review-post gate this session opened; the finding is an `id` in
your report json (the `.json` sibling of your `--report`). Your `--state`
and `--status-bin` are the ones this session was launched with. The
question file is a markdown file the board wrote: read it first, and its
contents are the human's question.

This skill runs only inside the board review session that wrote that
report. If this session has no `/board:review` launch, or the finding id is
not in the report json, say so in one line and stop.

The line can also arrive as the first message of a resume: a gate the board
parked after a long wait closed this pane, and a question about one of its
findings resumes the session with it. The gate is then `parked`, not `open`,
and no wait loop is running; everything below holds the same.

## The rule for the whole conversation

Until the human says to revise, you change nothing: no edit to the report,
no gate opened or answered, no post to the MR, no commit, no database
write. Databases only through rt's sdm verbs (the `rt:sdm-connect` skill),
only `*-read-only` resources, QA unless the human names prod in this
conversation. Posting and the verdict are the human's, on the board.

## 1. Restate, then explore through a helper

Restate in two lines: the finding (tier, title, `file:line`) and the
question. Then dispatch one explorer with the Agent tool
(`subagent_type: Explore`, `model: sonnet`, `effort: medium`) and wait for
it. Explore has no Edit or Write but does have Bash, so the brief's
"changes nothing" line is what keeps it read-only. Its brief is:

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
2. Check the old gate is still waiting on the human:
   `<status-bin> gate wait <state> --max-ms 1000`. Only `{"status":
   "pending"}` goes on. An `answers` line means the human already decided
   on the board: edit nothing, re-raise nothing, tell them the review was
   answered before the revision could apply, then carry on with that
   answer as the wrapper's gate step does (a running wait loop delivers
   the same answer: act on it once). A failure saying the gate closed or
   was not found is the same: edit nothing, re-raise nothing, and say so.
   Any other failure: take the **restore path** below.
3. Copy the report json and the report markdown aside, each to
   `<its path>.pre-revision`.
4. Edit the finding in the report json and the report markdown, keeping
   them in step (tier counts and summary lines that name it included).
5. Rebuild the gate's open file exactly as this session built the first
   one (the same scripts, extras and arguments). If it fails, take the
   **restore path** below.
6. Run the step 2 check again. An `answers` line, or a failure saying the
   gate closed or was not found: move both copies back, re-raise nothing,
   say so, and carry on as step 2 does. Any other failure: take the
   **restore path** below.
7. Run the same `open-gate.sh <status-bin> <state> review-post
   <open-file>`. The new gate supersedes the old one, a parked one too. If
   it exits non-zero, take the **restore path** below.
8. Delete both copies. If a background wait loop is still running on the
   old gate, stop it with TaskStop (load it with ToolSearch when it is
   deferred).
9. Start one background `<status-bin> gate wait <state> --max-ms 90000`
   loop on the new gate and end the turn holding at it. Do not show a pane
   form: the human finishes on the board.
10. Tell the human: the finding is revised, the gate is re-raised, finish
    the review on the board.

**Restore path:** move any copies back over the report json and markdown,
say what failed, and keep holding at the old gate. If this gate's wait loop
is not running (a parked gate has none), start one, then end the turn.

A `closed (superseded)` result for the old gate id later is your own
re-raise: ignore it and keep holding at the new gate.

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
| "The old gate closed, the run is over" | That close is your re-raise. Hold at the new gate. |
| "I'll edit the report, then check the gate" | Check first: the post step builds comments from the report, so a late edit posts text the human never approved. |
| "The revision is ready, re-raise it now" | Check the old gate is still pending first; a late re-raise reopens a posted review. |
| "The open failed, I'll leave the report revised" | Take the restore path; the report must match the gate the human can still answer. |
| "I'll list the options in text, it's quicker" | The outcome is a mattstack:wrap-up form; the pick is the record. |
