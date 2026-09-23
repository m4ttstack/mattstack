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
Launched by hand, first the Resume offer: run `rt runs --repo <repo>
--json` (the `--repo` value in the flags block below) and keep the runs
whose `status` is `running` and `work_type` is `receive-review`; never
read the run dbs by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=~/.mattstack/runs/<repo>/<its id>/state.db`
(the candidate row's `id`), then `rt runs stage-start --stage
receive-review` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage receive-review`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered. rt runs verbs resolve your run
automatically (env RT_RUN_DB first, else the run this session started,
else the newest running run in this worktree; ambiguity errors loudly).
Export RT_RUN_DB only to drive a different run than yours.

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
intake: when the caller hands this step decided answers -- the `{plan}`
half alone (a board wrapper hands it after its own first gate, `{post}`
following later before posting) or a combined `{plan, post}` object from a
caller that collected both up front -- use `plan` and ask nothing here: its
per-question answers, keyed by question id with verbatim option strings,
are the decision. Use the decider the caller names alongside it. Every
other path builds the open first.

### Build the open

The gate carries structured context (gate-protocol's Structured context),
built from step 3's buckets. Make one scratch directory (`mktemp -d`) and
write its path out literally from then on: each tool call is a fresh
shell. Write `<dir>/respond-plan.source.json`:

```json
{"context": {"gate-ctx": "plan@1", "reviewer": "<primary reviewer>",
             "threads": {"total": 2, "blocking": 1},
             "adjudication": "<tally> · fresh-context adjudicated"},
 "questions": [
   {"id": "thread-1", "label": "<file>:<line>", "multi": false,
    "context": {"gate-ctx": "thread@1", "author": "<reviewer>", "severity": "<severity>",
                "claim": {"summary": "<the ask>", "points": ["<one specific>"]},
                "verdict": {"call": "<verdict word>", "note": "<its reason>"},
                "reply": {"kind": "<kind>", "text": "<drafted reply>"}},
    "options": [{"value": "reply:<threadId>", "label": "reply", "description": "reply only; no code change"},
                {"value": "fix:<threadId>", "label": "fix", "recommended": true, "description": "<the planned change and where>"},
                {"value": "skip:<threadId>", "label": "skip", "description": "no reply, no code change"}]},
   {"id": "thread-2", "...": "the next thread in the same shape, its own id verbatim"},
   {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
    "options": ["approve", "revise", "skip"]}
 ]}
```

ONE single-select question per unresolved thread, in verdict-table order,
plus `code-changes`. A thread question's id is `thread-<n>` by 1-based
position, its label the thread's `file:line`, its options that thread's
verb triple with the thread id VERBATIM in the value and the bare verb in
the label. The triple's member matching step 3's recommended action
carries `"recommended": true` -- this is how the recommendation reaches
the gate; rt-client normalization renders it as the label's
"(Recommended)" suffix and capitalizes the bare verb, so labels stay
lowercase here.

| Field | Filled from |
|---|---|
| `reviewer` | one name: the author with the most unresolved threads, ties to the first to appear; any other reviewer shows on their own threads' `author` |
| `threads` | `total`: the thread-question count; `blocking`: how many threads carry severity `blocking` |
| `adjudication` | `all valid` when every verdict is `valid`, else `<count> <verdict>` per verdict word in first-appearance order, comma-joined; then ` · fresh-context adjudicated` |
| `round` | only when the caller supplies it; otherwise omit the key |
| `author` | the author of the thread's opening note |
| `severity` | the reviewer's own words, never the verdict: an explicit softener (nit, optional, non-blocking, minor, suggestion) is `non-blocking`; a question that asks for no change is `question`; a thread with no ask (a summary, an FYI) is `none`; any other change request is `blocking` |
| `claim` | `summary`: the reviewer's ask in one or two sentences, their wording where it fits; `points`: their supporting specifics, one per string, the key omitted when there are none |
| `verdict` | `call`: the adjudicator's verdict word verbatim; `note`: its one-line reason (the warranted change, the pushback reason, or the question to ask) |
| `reply` | by step 3's recommended action: `reply` is `verbatim` with the drafted reply as `text`; `fix` is `direction` with the drafted reply (it finalizes in step 5); `skip` is `{"kind": "none"}` |
| `fix` option `description` | the planned change and where, from the adjudicator's `valid` entry; a thread with no such entry gets `implement the reviewer's ask as written` |

Fit it:

```bash
sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json
```

Exit 1 prints one line per contract problem, naming the question and the
field: fix the source and rerun. The output file IS the open: its
`.context` and `.questions` go to the gate verbatim, fitted to the shared
budget (points and notes trimmed, or every context prose when nothing
else fits; `"fits": false` means even the prose is over, and the daemon
will drop contexts loudly). Never hand-edit it, and never shorten a reply
to make an open fit.

### Hand back or run the gate

**A caller that owns the gates** (it delegated the adjudication to this
verb and presents the gates itself; a board wrapper does, and says so when
it delegates): open nothing. Hand back the verdict table plus the absolute
path of `<dir>/respond-plan.open.json`; the caller opens its gate from
that file's `.questions` and `.context`, then hands `{plan}` back.

**Otherwise** (a direct terminal run) the verb runs the gate itself:

- `rt runs field set gate respond-plan --stage <stage>`.
- Run gate-protocol's Runs integration with kind `respond-plan`, the open
  read from the file:

  ```bash
  rt gate ask --questions "$(jq -c .questions <dir>/respond-plan.open.json)" --kind respond-plan --context "$(jq -r .context <dir>/respond-plan.open.json)"
  ```

  One question per thread keeps every question at three options, under
  the form cap, so a herdr pane gets `form` for any thread count; never
  fold several threads into one multi-select. It also makes reply / fix /
  skip mutually exclusive per thread by construction. The thread id lives
  in the option VALUE, never in the question id: every consumer joins by
  reading each `answers` key other than `code-changes`, unwrapping a
  `{value, note}` object to its `value`, and splitting at the first `:`;
  `thread-<n>` is a container, nothing keys on it.
- In-pane form (gate-protocol's presentation: "form" branch): the form
  never shows the JSON. Running
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/respond-plan.source.json`
  prints the same open with every
  context as prose: show its `.context` as one line in the pane before
  the first form call, and make each thread question's form text its
  `label`, a newline, its prose `context`, then `Reply, fix, or skip?`,
  under the header `Thread <n>`. The form tool takes at most four
  questions per call, so ask the thread questions in order, up to four
  per call, until every thread is asked. Then one last call:
  `code-changes`, only when some thread answered `fix:` (otherwise submit
  its sentinel `skip` unasked, the same hide rule the board and console
  cards apply), plus a pane-only `next` question of **Continue** /
  **Iterate here** / **Hold**. That pane-only question never reaches the
  registry, and Iterate / Hold are never extra options on a thread or
  code-changes question: a fourth and fifth option there would push it
  over the cap.
  Continue: submit exactly ONE `rt gate answer` after that last call,
  carrying every thread answer plus `code-changes`, never one per chunk.
- `fix:<threadId>` implies that thread's reply; `skip:<threadId>` means
  neither.
- `rt runs decision record --contract gate@1 --scope respond-plan --selection '{"threads":{"<threadId>":"reply|fix|skip","...":"one entry per thread, keyed by the id read out of its answer value"},"code-changes":"approve|revise|skip"}' --decided-by <the answer's by>`.

`code-changes: revise` re-adjudicates: back to step 2, a fresh dispatch with
their note -- never revised in this session, the bias HARD-GATE still
applies. `code-changes: skip` (the no-fix sentinel) implements nothing:
straight to step 6 with the `reply:` threads' drafts. A thread answered
`fix:` under `skip` stays unimplemented and has no finalized reply, so it
is held out of step 6 rather than posted as a draft.

## 5. Implement approved fixes

Nothing is implemented until `respond-plan` approves it -- not under cover
of "in a follow-up commit," not while drafting. On `code-changes: approve`,
implement the `fix:<threadId>` threads one at a time, verifying each with
the project's tests and checks before the next. Finalize each fixed reply
to "Fixed -- `file:line` / what changed". Domain ship-time gates still
apply to these fixes; this skill never checks their box.

## 6. Decide and post: respond-post (Gate `respond-post`)

The drafted replies are bucketed from step 3; `skip:<threadId>` threads
never reach this offer. When no thread is offered (every thread `skip:`,
or every `fix:` held out under `code-changes: skip`), there is no
respond-post gate: open nothing, post nothing, record nothing for this
scope, and close; a caller that owns the gates gets no open file back,
only that nothing is offered.

<HARD-GATE>
Decision intake: when the caller's `{plan, post}` object already carries
`post`, use it and ask nothing here. Otherwise build the open, then hand
it back or run the gate.

**Build the open** in step 4's scratch directory, as
`<dir>/respond-post.source.json`:

```json
{"context": {"gate-ctx": "post@1", "reviewer": "<as in step 4>", "replies": 2,
             "fixes": [{"sha": "<short sha>"}]},
 "questions": [
   {"id": "thread-1", "label": "<file>:<line>", "multi": true,
    "context": {"gate-ctx": "reply@1", "thread": "<threadId>", "file": "<file>:<line>", "verb": "fix", "sha": "<short sha>", "text": "<the exact reply that will post>"},
    "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                {"value": "resolve:<threadId>", "label": "resolve", "recommended": true, "description": "resolve the thread"}]},
   {"id": "thread-2", "label": "<file>:<line>", "multi": true,
    "context": {"gate-ctx": "reply@1", "thread": "<threadId>", "file": "<file>:<line>", "verb": "reply", "text": "<the exact reply that will post>"},
    "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                {"value": "resolve:<threadId>", "label": "resolve", "description": "resolve the thread"}]},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed", "recommended": true}, "iterate", "hold"]}
 ]}
```

ONE multi-select question per offered thread, in verdict-table order,
plus `next`. A thread is offered when it has a drafted reply: a
`reply:<threadId>`, or a `fix:<threadId>` finalized in step 5. Its
question's id is `thread-<n>` by 1-based position among the offered
threads, its label the thread's `file:line`, and its options exactly
`post:<threadId>` and `resolve:<threadId>`, thread id VERBATIM, bare
verb as the label.

| Field | Filled from |
|---|---|
| `post` option | `"recommended": true` on every thread, so nothing drops silently |
| `resolve` option | `"recommended": true` only when the thread's `verb` is `fix`; a reply-only thread (a pushback, a clarifying question) stays open for the reviewer unless the developer ticks it |
| `reply@1` context | that one thread: `verb` `fix` with its commit's short `sha` for a reply finalized in step 5, else `reply` with no `sha`; a fix with no commit carries no `sha`; `text` the exact reply that will post, never shortened |
| gate `replies` | the offered-thread count |
| gate `fixes` | one entry per commit step 5 made, the key omitted when there are none |

Post and resolve are independent picks: both, post only, resolve
without replying, or neither (an explicit empty array). Two options per
question keeps every thread under the form cap, whatever the count.

- Fit it:

  ```bash
  sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json
  ```

  Exit 1 names the question and field to fix. Nothing here is trimmable
  (a reply is never shortened), so an open over the budget goes all
  prose.

**A caller that owns the gates**: open nothing. Hand back the finalized
replies plus the absolute path of `<dir>/respond-post.open.json`, then
wait for its `{post}`. Its `.questions` end with `next`; a caller with its
own navigation drops that question.

**Otherwise** the verb runs the gate itself:

- `rt runs field set gate respond-post --stage <stage>`.
- Run gate-protocol's Runs integration with kind `respond-post`, the open
  read from the file:

  ```bash
  rt gate ask --questions "$(jq -c .questions <dir>/respond-post.open.json)" --kind respond-post --context "$(jq -r .context <dir>/respond-post.open.json)"
  ```

  `next` carries the navigation verbs -- **Proceed** (recommended) /
  **Iterate here** / **Hold** -- and never folds into a thread question.
  A paragraph that lists the replies and waits is not this gate.
- In-pane form: run
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/respond-post.source.json`.
  Show its `.context` as one line before the form; each thread
  question's form text is its `label`, a newline, its prose context
  (`<file> FIX · <sha>: <text>` or `<file> REPLY: <text>`), then `Post,
  resolve, both, or neither?`, under the header `Thread <n>`, as a
  multi-select. Ask the thread questions in order, up to four per call,
  then `next` in one last call, and submit exactly ONE `rt gate answer`
  carrying every thread answer plus `next`. The JSON never reaches the
  form.
</HARD-GATE>

Act per thread, reading each `thread-<n>` answer (a `{value, note, text}`
object unwraps to its `value`; the note rides the decision record and never
edits the reply) and splitting each value at the first `:` into the verb
and the thread id: `post:<threadId>` posts that thread's reply, which is
the answer's `text` when it carries one and the `reply@1` context's `text`
otherwise (`text` on a thread with no `post:` posts nothing);
`resolve:<threadId>` resolves the thread, after its reply when both are
picked and on its own when only resolve is, where the forge distinguishes
resolve from reply; an empty array leaves the thread untouched. Nothing
else posts, through any channel. Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks once
its reply is written. Posting mechanics belong to the forge CLI and the
adapter. A caller-handed `post` in the retired shape (a `replies` list, or
its `replies-1`, `replies-2`, ... chunks read as one union, of bare thread
ids plus `disposition`) posts the listed replies, resolves them only on
`resolve-addressed`, and records that selection unchanged.

At execution time, after acting: `rt runs decision record --contract
gate@1 --scope respond-post --selection
'{"threads":{"<threadId>":{"post":true,"resolve":false},"...":"one entry per offered thread"}}'
--decided-by <the answer's by>`. An entry carries `text` only when its
thread's answer was an object with `text` and `post:`, and then it is the
answer's: `{"post":true,"resolve":true,"text":"<the answer's text>"}`. A
reply posted from the `reply@1` context records `{post, resolve}` alone.
Every offered thread gets an entry. An answer's values name its thread;
an empty array names none, so take that thread from the question's
options in the open, or, when the open is not at hand (a caller handed
`post` to a fresh pane), record every offered thread (a report row with a
finalized reply) that no answer value names as both `false`. Never map a
`thread-<n>` key to a thread by its position.

Close, only when `## Run` started this run: after acting on every thread
and recording the decision, `rt runs stage-done --stage receive-review`, `rt runs
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
| "I'll post the replies since they look right" | Post only the threads whose answer carries `post:`, resolve only those carrying `resolve:`; never approve for the developer. |
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
| No caller-handed answers | Gate `respond-plan` (threads + code-changes), then `respond-post` (a post/resolve pair per thread), in order; a caller that owns the gates gets each open handed back instead. |
| Opening either gate | Source file, `gate-ctx.sh fit`, then its open verbatim: handed back to a caller that owns the gates, else `rt gate ask`. |
| `respond-plan` approves | `fix:<threadId>` threads one at a time, verify each, finalize to "Fixed -- file:line" (step 5). |
| `respond-post` answered | Per thread: `post:` posts its reply, `resolve:` resolves it, either or both; never approve. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
