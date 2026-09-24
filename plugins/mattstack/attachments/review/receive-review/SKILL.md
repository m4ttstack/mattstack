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

{{include:writing-style-lookup}}

## Reply rules

{{slot:reply-rules}}

## 4. Decide: respond-plan (Gate `respond-plan`)

The verb adjudicates; it never decides what gets fixed or posted. Decision
intake: when the caller hands this step decided answers -- the `{plan}`
half alone (a board wrapper hands it after its own first gate, `{post}`
following later when step 6 offers a thread) or a combined `{plan, post}` object from a
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
  `{value, note, text}` object to its `value`, and splitting at the first `:`;
  `thread-<n>` is a container, nothing keys on it.
- Over budget (the fit printed `"fits": false`, or the ask reported
  `contextOmitted`): right after the ask and before waiting on any
  answer, write one line, `gate-1-context: dropped`, into step 3's saved
  report (when there is one). A resumed pane has no other way to know
  those cards never showed their drafts (A dropped context, below).
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
  The pane's answer never carries `text`: a replacement reply the human
  types in the form's free-text field rides as `note`, which makes a
  `reply:` thread an override (Report rows below).
- `fix:<threadId>` implies that thread's reply; `skip:<threadId>` means
  neither.
- `rt runs decision record --contract gate@1 --scope respond-plan --selection '{"threads":{"<threadId>":"reply|fix|skip","...":"one entry per thread, keyed by the id read out of its answer value"},"texts":{"<threadId>":"<the answer's text>"},"overrides":["<threadId>"],"notes":{"<threadId>":"<the answer's note>"},"code-changes":"approve|revise|skip"}' --decided-by <the answer's by>`.
  `threads` values stay the bare verbs. `texts` holds one entry per
  `reply:` answer that carries `text`; `overrides` lists every
  `gate-1: override` thread (Report rows below); `notes` holds one entry
  per `gate-1: override` thread whose answer carried a note, that note;
  omit any of the three keys when it would be empty.

**Edited replies.** A `reply:<threadId>` answer may be an object whose
`text` is the reply to post for that thread, in place of the drafted
`reply.text`: `{"value": "reply:<threadId>", "text": "<edited reply>"}`.
A `reply:` answer that carries `text` posts that text, whether or not it
also carries a note, because the human wrote the exact words. `text` on a
`fix:` or `skip:` answer changes nothing.

**Report rows.** Once gate 1 is answered, rewrite each thread's row of
step 3's report (the saved report file too, when there is one) in this
shape, in verdict-table order:

```text
- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"
```

| Field | Filled from |
|---|---|
| `gate-1` | the verb the developer answered, never step 3's recommendation: `reply`, `fix` or `skip`, except that a `reply:` is `override` when its answer carries no `text` and any one of these holds, whoever answered: its gate 1 reply was not verbatim (the card showed a `direction` or no reply); the answer carries a `note`; or its question context never reached the gate, so its draft may never have been shown: you dropped it for the size budget, or the open was whole-open over budget (a `"fits": false` open, one that reported `contextOmitted`, or a report carrying the line `gate-1-context: dropped`), which counts every thread's context as dropped |
| `reply` | the answer's `text` when it has one, else step 3's draft, else `none`; step 5 rewrites a fixed row's reply and step 6 an override's |

**A dropped context.** When the respond-plan open reports `contextOmitted`,
its stderr ends "shorten and re-ask": do neither. Never shorten a reply
and never re-ask to fit. Keep the gate as opened, take its answers as
given, and count every thread's context as dropped, so every `reply:`
answer with no `text` is an override. On any resume, a caller-handed
`{plan}` in a fresh pane included, a report carrying the line
`gate-1-context: dropped` means the same, whoever opened the gate: a
caller that owns the gates writes that line into its own report.

Every later posting, a resumed pane's included, reads these rows, never
step 3's recommendation: a `gate-1: reply` row posts its row's reply from
gate 1; an `override` row, and a `fix` row step 5 finalized, are offered
at gate 2; a `skip` row, and a `fix` row under `code-changes: skip`, post
nothing. A `## Run` Resume with only the snapshot at hand reads the
respond-plan record instead: `threads` gives each verb, `texts` the
edited replies, `overrides` the reply overrides, offered at gate 2
beside any finalized fix, and `notes` the note to fold into an
override's redraft, so it never posts a draft an override was meant to
replace and never redrafts one without its note. A `reply` thread with
no `texts` entry has no recoverable gate 1 draft there, so count it as
an override (`gate-1: override`): redraft it and offer it at gate 2
beside the other overrides, never posting it from gate 1, however
closely the redraft follows the lost one.

`code-changes: revise` re-adjudicates: back to step 2, a fresh dispatch with
their note -- never revised in this session, the bias HARD-GATE still
applies. `code-changes: skip` (the no-fix sentinel) implements nothing:
straight to step 6. A thread answered
`fix:` under `skip` stays unimplemented and has no finalized reply, so
step 6 neither offers nor posts it.

## 5. Implement approved fixes

Nothing is implemented until `respond-plan` approves it -- not under cover
of "in a follow-up commit," not while drafting. On `code-changes: approve`,
implement the `fix:<threadId>` threads one at a time, verifying each with
the project's tests and checks before the next. Finalize each fixed reply
to "Fixed -- `file:line` / what changed" and write it over the draft in
the thread's report row, with ` · sha: <short sha>` before its `reply`
field. Domain ship-time gates still
apply to these fixes; this skill never checks their box.

## 6. Decide and post: respond-post (Gate `respond-post`)

This gate offers exactly the replies the developer has not yet seen word
for word: every `gate-1: override` row, and every `gate-1: fix` row whose
reply step 5 finalized (step 4's Report rows). An override's reply
was never seen word for word: redraft it now, per step 3's reply rules
as a reply with no code change and folding in its answer's note when it
has one, and write it into its row. A `gate-1: reply` row is never offered: it
posts its row's reply and is never resolved, except as a retired-shape
`post` decides it (the act paragraph below). A `skip` row, and a `fix`
row step 5 never finalized, post nothing.

- **No thread offered** (no finalized fix and no override) **and no
  caller-handed `post`**: post the `gate-1: reply` rows now. There is no
  respond-post gate and no respond-post record: open nothing, record
  nothing for this scope (the respond-plan record covers those replies),
  and close. A caller that owns the gates gets no open file back, only
  that nothing is offered and which replies posted.
- **No thread offered, but the caller handed a `post`** (in a
  `{plan, post}` object, or on its own): that `post` decides first. Post
  no `gate-1: reply` row before reading it; act on it as the act
  paragraph below says, and record its selection there, a retired-shape
  `post` unchanged.
- **Threads offered:** the `gate-1: reply` rows wait, and post once this
  gate proceeds (the act paragraph below).

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
    "context": {"gate-ctx": "reply@1", "thread": "<threadId>", "file": "<file>:<line>", "verb": "fix", "sha": "<short sha>", "text": "<the exact finalized reply>"},
    "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                {"value": "resolve:<threadId>", "label": "resolve", "recommended": true, "description": "resolve the thread"}]},
   {"id": "thread-2", "...": "the next offered thread, its own id verbatim: a fix in this shape, or an override with verb reply, no sha, resolve not recommended"},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed", "recommended": true}, "iterate", "hold"]}
 ]}
```

ONE multi-select question per offered thread, in verdict-table order,
plus `next`; a `gate-1: reply` row never gets one. Its question's
id is `thread-<n>` by 1-based position among the offered threads, its
label the thread's `file:line`, and its options exactly
`post:<threadId>` and `resolve:<threadId>`, thread id VERBATIM, bare
verb as the label.

| Field | Filled from |
|---|---|
| `post` option | `"recommended": true` on every thread, so nothing drops silently |
| `resolve` option | `"recommended": true` only on a fixed thread; an override stays open for the reviewer unless the developer ticks it |
| `reply@1` context | that one thread: `verb` `fix` with its commit's short `sha` for a fixed thread (a fix with no commit carries no `sha`), `verb` `reply` with no `sha` for an override; `text` the exact reply from its row, never shortened |
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

**A caller that owns the gates**: open nothing. Hand back the offered
replies plus the absolute path of `<dir>/respond-post.open.json`, then
wait for its `{post}`. Its `.questions` end with `next`; a caller with its
own navigation drops that question. Once you have acted on its `{post}`,
hand back which replies posted, as the no-offer path does.

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
  carrying every thread answer plus `next`. The pane's answer never
  carries `text`: whatever the human types in the form's free-text
  field, a full replacement reply included, rides as `note`, and the
  drafted reply posts. The JSON never reaches the form.
</HARD-GATE>

**Push before any Fixed reply.** Only when the picks post or resolve at
least one `gate-1: fix` row; otherwise push nothing. Once this gate
proceeds, or a caller hands `post`, and before acting on those rows:

1. Check the target: `git branch --show-current` must print the MR's
   source branch (step 1's `branch`, else the forge's), and `git
   rev-parse --abbrev-ref @{push}` must print that branch on its remote
   (`origin/<source branch>`). Any other output, an error included, is a
   failed push; never switch branches to make it match.
2. Push with a plain `git push`, so every commit step 5 made is on the
   MR. That proceed is the authorization: ask nothing more.

A failed push (a target mismatch or a push error) holds those rows: post
and resolve none of them, report the mismatch or the error verbatim (in
the hand-back when a caller owns the gates), and leave the run open,
since the close waits for every reply. Never force, rebase or merge past
it. Every other reply posts as decided either way. Then record the
respond-post decision at once, with the held thread ids under `"held"`.
A resume that finds `"held"` in that record treats every other offered
thread as already acted on, acts only on the held threads once steps 1
and 2 succeed, then records again without `"held"`.

Act per thread, reading each `thread-<n>` answer (a `{value, note, text}`
object unwraps to its `value`; the note rides the decision record and never
edits the reply) and splitting each value at the first `:` into the verb
and the thread id: `post:<threadId>` posts that thread's reply, which is
the answer's `text` when it carries one and the `reply@1` context's `text`
otherwise (`text` on a thread with no `post:` posts nothing);
`resolve:<threadId>` resolves the thread, after its reply when both are
picked and on its own when only resolve is, where the forge distinguishes
resolve from reply; an empty array leaves the thread untouched. Then, once
this gate proceeds (its `next` answer is `proceed`, or a caller handed
`post`, which carries no `next`), post every `gate-1: reply` row,
its row's reply, unresolved: this gate never offers those threads, so
they post whatever it picked for its own threads. On `hold` or `iterate`
they wait. When the open offers such a thread, or an answer value names
it (an open built before this rule), that thread's answer decides it
instead, an empty array included, and no reply posts twice. Nothing
else posts, through any channel. Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks once
its reply is written. Posting mechanics belong to the forge CLI and the
adapter. A caller-handed `post` in the retired shape (a `replies` list, or
its `replies-1`, `replies-2`, ... chunks read as one union, of bare thread
ids plus `disposition`) posts the listed replies, resolves them only on
`resolve-addressed`, and records that selection unchanged. That shape
offered every thread with a reply, so it decides each `gate-1: reply`
row fully, as that older gate did: one it lists posts once and is
resolved only on `resolve-addressed`, and one it omits (an empty list
included) posts nothing.

At execution time, after acting: `rt runs decision record --contract
gate@1 --scope respond-post --selection
'{"threads":{"<threadId>":{"post":true,"resolve":false},"...":"one entry per offered thread"}}'
--decided-by <the answer's by>`. An entry carries `text` only when its
thread's answer was an object with `text` and `post:`, and then it is the
answer's: `{"post":true,"resolve":true,"text":"<the answer's text>"}`
when that answer also carries `resolve:`, `"resolve":false` when it does
not. A reply posted from the `reply@1` context never adds `text`. An
entry whose thread's answer carries a note adds it as `note`:
`{"post":true,"resolve":false,"note":"<the note>"}`. After a failed push
the selection adds `"held":["<threadId>"]` beside `threads`, each held
thread's entry still its answer's picks. Every offered
thread gets an entry, and only offered threads: a `gate-1: reply`
row's reply rides the respond-plan record. An answer's values name its thread; an empty
array names none, so take that thread from the question's options in the
open, or, when the open is not at hand (a caller handed `post` to a
fresh pane), record every offered thread (a `gate-1: override` row, or
a `gate-1: fix` row step 5 finalized) that no answer value names as both `false`. Never map a
`thread-<n>` key to a thread by its position.

Close, only when `## Run` started this run: after every reply has posted
and every decision is recorded, `rt runs stage-done --stage receive-review`, `rt runs
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
| "I'll post the replies since they look right" | Post only what an answer picked: a `gate-1: reply` row, or an offered thread whose answer carries `post:`; resolve only those carrying `resolve:`; never approve for the developer. |
| "I'll offer the reply-only threads at `respond-post` too, for a last look" | The developer already saw that exact reply. `respond-post` offers only the replies they have not seen word for word: fixed threads and `reply:` overrides with no `text`. |
| "Gate 2's answer doesn't name the reply-only thread, so it stays unposted" | Gate 1 decided it. It posts once gate 2 proceeds, whatever gate 2 picked for its own threads, unless the open offered it or an answer value names it. |
| "They answered `reply:`, so the drafted reply posts now" | Only a reply they saw word for word posts from gate 1. A `reply:` with no `text` is an override when its card showed a direction or no reply, its answer carries a note, or its question context never reached the gate: redrafted and offered at `respond-post`. |
| "The pane showed the prose, so a dropped context does not matter" | The rule holds whoever answered. A `reply:` with no `text` on a thread whose question context never reached the gate is an override. |
| "The stderr says shorten and re-ask, so I'll trim the replies and open it again" | Never shorten a reply and never re-ask to fit. Take the answers as given; every `reply:` with no `text` is an override. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that knowledge with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "The draft is gone, but I know what it said, so I'll rebuild it and post it from gate 1" | A rebuilt reply is words the developer never saw. From the snapshot alone, a `reply` thread with no `texts` entry is redrafted and offered at `respond-post`. |
| "It's only a note, so the verbatim draft still posts" | A note on a `reply:` may change the reply, and in the pane form it is the only place a typed replacement can go. Redraft with it and offer the thread at `respond-post`. |
| "Step 3 recommended a reply here, so it posts" | Posting reads each report row's `gate-1` field, never the recommendation. A `gate-1: skip` row posts nothing. |
| "The plan record has no slot for the edited reply" | It goes in `texts` beside `threads`, and over the draft in the report's row for that thread. Overrides go in `overrides`, and an override's note in `notes`. |
| "The gate approved posting, not a push, so the Fixed reply goes up (or I ask first)" | "Fixed" with nothing on the remote is false. The proceed authorizes the push: check the branch and `@{push}`, push first, and a mismatch or failed push holds every picked `gate-1: fix` row. |
| "A plain `git push` pushes the MR" | It pushes whatever branch is checked out, to its own destination. Check both against the MR's source branch first. |
| "The fix is held, so I'll record respond-post once it posts" | A resume from the snapshot would re-offer the replies that already posted. Record now, with the fix threads under `"held"`. |
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
| Caller hands `{plan, post}` | Use it, ask nothing; decided-by is the caller's named decider. The handed `post` decides before any `gate-1: reply` row posts, even with nothing offered. |
| No caller-handed answers | Gate `respond-plan` (threads + code-changes), then `respond-post` (a post/resolve pair per offered thread) only when a report row is a finalized fix or an override, in order; a caller that owns the gates gets each open handed back instead. |
| Opening either gate | Source file, `gate-ctx.sh fit`, then its open verbatim: handed back to a caller that owns the gates, else `rt gate ask`. |
| `respond-plan` answered | Rewrite every report row with its `gate-1` field and any edited reply (step 4's Report rows); posting reads only these rows. |
| `respond-plan` answered `reply:` | Override when the answer has no `text` and any one of: a card that was not verbatim, a note, or a question context that never reached the gate. An override is `gate-1: override`, listed under `overrides` (its note, when it has one, under `notes`), redrafted and offered at `respond-post`. Any other `reply:` is `gate-1: reply` (the answer's `text` under `texts`, else the verbatim draft): it posts from gate 1, never resolved except as a retired-shape `post` decides it, at once with no offered thread and no caller-handed `post`, once `respond-post` proceeds otherwise, never on `revise`. |
| `respond-plan` approves | `fix:<threadId>` threads one at a time, verify each, finalize to "Fixed -- file:line" (step 5). |
| `respond-post` answered | When a `gate-1: fix` row posts or resolves: check the branch and `@{push}`, then push first; a mismatch or failed push holds those rows under `"held"` in the record. Per offered thread: `post:` posts its reply (the answer's `text` when edited), `resolve:` resolves it, either or both; on proceed, the `gate-1: reply` rows post; never approve. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
