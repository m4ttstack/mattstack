---
name: board:respond
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to process review feedback
  on your OWN MR in a fresh herdr pane. Emits lifecycle status through the
  board's status CLI, then delegates the actual work to the skill named by --skill.
  Invoked as "/board:respond <mrUrl> --state <path> --status-bin
  <path> [--report <path>] [--skill <name>]". When no --skill is given, the domain skill is
  resolved from the respond slot binding in .mattstack/skills.jsonc. Not for
  manual use.
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)
metadata:
  slots: "respond"
  slot-respond: "required mr-respond@2 -- owns processing review feedback on one MR: fetching threads, adjudicating, drafting, implementing decided fixes, and executing posting once handed the decisions. Never presents decision gates or decides what posts. When gate 2 offers nothing, posts the reply-only threads on {plan}."
  compiled: "mattstack:gate-protocol@0.28.0"
---

<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->

<!-- part: step source=respond/SKILL.md path=respond/SKILL.md lines=18-521 -->
# mr-board respond runner

The mr-board spawned this pane to process the review feedback on ONE of your own
MRs and report status back to the board through its status CLI. A human
decides only at a gate. This wrapper carries **no** domain knowledge; the
board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | your merge request whose feedback to process |
| `--state <handle>` | opaque board handle for this MR's response. Pass it verbatim to `--status-bin` and the `gate` verbs; never read, stat, or write it. It looks like a `.json` path but no such file exists: board state lives in the board's database, and the path is only a key. Its absence on disk says nothing about whether the board is tracking this pass. |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--report <path>` | where the fill saves the adjudication table and drafted/finalized replies; a resumed pane posts from it |
| `--skill <name>` | the domain skill that owns the actual work (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh run (optional; see "Resumed entry" in `launch.md`) |
| `--resumed-gate-kind <kind>` | the `kind` of the gate `--resumed-gate` names (e.g. `respond-post`). Present exactly when `--resumed-gate` is, and the only way to learn it: `--state` is an opaque handle and `gate wait` returns only the answer. |
| `--round <n>` | the round to delegate at, carried over from an earlier pane on this MR (recorded by the `--round` flag on `<status-bin> respond-status <state> drafting --round <n>`; see "Recover the round from --round (absent: 1)" in `launch.md`). Present on a parked-gate resume when a prior pane got as far as recording one, or on a fresh run when the board found a prior recorded round for this MR (a new run responding to a further round of review); absent means round 1, either because this is the MR's first round or because no earlier pane recorded a round. |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> respond-status <state> <status> [message]
<status-bin> respond-status <state> done <message> --posted <n> --threads <n> [--held <n>]
```

The board tracks five in-flight statuses; emit each as you cross the milestone:

| Status | When to emit |
|--------|--------------|
| `triaging` | Immediately, before fetching threads. |
| `implementing` | Only after Gate 1's `code-changes` question comes back `approve`, before touching code. Skip when no threads need code changes. |
| `drafting` | When presenting the verdict table + drafted replies (before Gate 1), and again right before Gate 2 opens, on every path: after implementing, and after drafting a reply override with nothing implemented. |
| `done` | After the run finishes, zero threads included. REQUIRED: `--posted <n> --threads <n>`, plus `--held <n>` whenever a gate decision kept any reply from posting (see "Counts and the badge"). |
| `error` | Anything unrecoverable (bad MR, delegated skill failed). |

## Flow

The graph is the map: start at the trigger and take only the edges it
draws. Each stage box has its own section below the graph, which names the
stage file that holds the stage's graph and its step sections.

```dot
digraph respond_map {
    rankdir=TB;

    "Trigger: the board launched /board:respond" [shape=ellipse];
    "Launch and resume (launch.md)" [shape=box];
    "Launch and resume exit?" [shape=diamond];
    "Triage and Gate 1 (triage.md)" [shape=box];
    "Triage and Gate 1 exit?" [shape=diamond];
    "Implement the plan (implement.md)" [shape=box];
    "Implement the plan exit?" [shape=diamond];
    "Gate 2 and posting (post.md)" [shape=box];
    "Gate 2 and posting exit?" [shape=diamond];
    "<status-bin> respond-status <state> done <summary> --posted <n> --threads <n> [--held <n>]" [shape=plaintext];
    "<status-bin> respond-status <state> error <what went wrong>" [shape=plaintext];
    "Respond error written: stay in the pane and report" [shape=doublecircle];
    "Respond gate gone: ended cleanly, no status write" [shape=doublecircle];
    "Held at a respond off-script gate: the pane stays" [shape=doublecircle];
    "Respond done: stay in the pane" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: the board launched /board:respond" -> "Launch and resume (launch.md)";
    "Launch and resume (launch.md)" -> "Launch and resume exit?";
    "Launch and resume exit?" -> "Triage and Gate 1 (triage.md)" [label="fresh run with a domain skill"];
    "Launch and resume exit?" -> "Triage and Gate 1 (triage.md)" [label="fresh generic run, style loaded"];
    "Launch and resume exit?" -> "Implement the plan (implement.md)" [label="respond-plan resume joined"];
    "Launch and resume exit?" -> "Gate 2 and posting (post.md)" [label="respond-post resume"];
    "Launch and resume exit?" -> "Respond gate gone: ended cleanly, no status write" [label="gate gone"];
    "Launch and resume exit?" -> "<status-bin> respond-status <state> error <what went wrong>" [label="error"];
    "Launch and resume exit?" -> "Held at a respond off-script gate: the pane stays" [label="hold"];
    "Triage and Gate 1 (triage.md)" -> "Triage and Gate 1 exit?";
    "Triage and Gate 1 exit?" -> "Implement the plan (implement.md)" [label="Gate 1 answered"];
    "Triage and Gate 1 exit?" -> "<status-bin> respond-status <state> done <summary> --posted <n> --threads <n> [--held <n>]" [label="no unresolved threads, 0 and 0"];
    "Triage and Gate 1 exit?" -> "<status-bin> respond-status <state> error <what went wrong>" [label="error"];
    "Triage and Gate 1 exit?" -> "Respond gate gone: ended cleanly, no status write" [label="gate gone"];
    "Triage and Gate 1 exit?" -> "Held at a respond off-script gate: the pane stays" [label="hold"];
    "Implement the plan (implement.md)" -> "Implement the plan exit?";
    "Implement the plan exit?" -> "Gate 2 and posting (post.md)" [label="plan worked"];
    "Implement the plan exit?" -> "Triage and Gate 1 (triage.md)" [label="revise: a new round"];
    "Implement the plan exit?" -> "<status-bin> respond-status <state> error <what went wrong>" [label="error"];
    "Gate 2 and posting (post.md)" -> "Gate 2 and posting exit?";
    "Gate 2 and posting exit?" -> "<status-bin> respond-status <state> done <summary> --posted <n> --threads <n> [--held <n>]" [label="posting finished"];
    "Gate 2 and posting exit?" -> "<status-bin> respond-status <state> error <what went wrong>" [label="error"];
    "Gate 2 and posting exit?" -> "Respond gate gone: ended cleanly, no status write" [label="gate gone"];
    "Gate 2 and posting exit?" -> "Held at a respond off-script gate: the pane stays" [label="hold"];
    "<status-bin> respond-status <state> done <summary> --posted <n> --threads <n> [--held <n>]" -> "Respond done: stay in the pane";
    "<status-bin> respond-status <state> error <what went wrong>" -> "Respond error written: stay in the pane and report";
}
```

What the graph cannot show:

- **Thread ids.** On the generic path a thread's id is the discussion's
  `id` in the `mr_threads` result: the same string the gate option values
  carry (`reply:<threadId>`), the report rows key on, and
  `mr_reply_thread` and `mr_resolve_thread` take as `discussionId`.
- **Budgets.** Each `Fixed the <tool> call once already?` counter counts
  for the whole run, per thread for `mr_reply_thread` and
  `mr_resolve_thread`, and does not reset after an off-script iterate: a
  refusal after an iterate goes straight back to that origin's off-script
  gate, and its `Off-script rounds = 2 (...)?` counter (per thread for the
  two posting origins) bounds the loop. `Revise rounds = 3?` counts the
  `revise` answers this pane acted on; a resumed pane counts from zero.
  `Fix attempts = 3 (this thread)?` counts attempts per fix thread.
  `Resumed wait failures = 3 (respond)?` counts failing resumed waits;
  closed, not found and `no gate open` are terminal, never counted.
- **Exit messages.** `done` carries a short summary and the counts ("Counts
  and the badge"). `error` names what went wrong specifically: the bad MR,
  the refused tool with its error, the failed domain skill,
  `revise budget spent after 3 rounds; drafts kept in --report`, or the
  resumed wait's third failure. Gate gone writes no status: say so in the
  pane and stop, since whatever superseded the gate already owns this MR's
  board state.

### Launch and resume (launch.md)

The first acts of every launch: the status the entry implies, the domain
skill resolution, the writing style on the generic path, and on a parked-gate
resume the recorded answer read with `gate wait` before anything else, the
Posted already read and the join to `--report`.
Read `launch.md` now and follow its graph; its sections are there.

### Triage and Gate 1 (triage.md)

Adjudicate every unresolved human thread, through the domain skill or on the
generic path, write the verdict table and drafts to `--report`, and open Gate 1
with `<status-bin> gate open <state> --kind respond-plan` (or its fitted open
file), then wait for its answer.
Read `triage.md` now and follow its graph; its sections are there.

### Implement the plan (implement.md)

Record the Gate 1 answer, draft the reply overrides, and act on
`code-changes`: implement the fixes on `approve`, hand the plan over on
`skip`, or re-adjudicate at the next round on `revise`.
Read `implement.md` now and follow its graph; its sections are there.

### Gate 2 and posting (post.md)

When there are threads to offer, open Gate 2 with `<status-bin> gate open
<state> --kind respond-post` (or its fitted open file), push the fixes with
`git_push` after the two checks, then post and resolve as the answer picks,
the reply-only threads included.
Read `post.md` now and follow its graph; its sections are there.

## Gate step (gate-step.md)

Gate 1 and Gate 2 each take the shared gate step after their open. Its graph
and sections are in `gate-step.md`; each gate box says when to read it.

The gate step's pane forms follow the gate protocol included at the end of
this skill: its "Present the in-pane gate form" step and its "Answers are
option values" and "Doorbell" sections, for the rendering and conflict
mechanics. Where it records the pane's answer with the `gate_answer` tool,
a board gate records it with `<status-bin> gate answer <state> --answers
<json> --by pane` instead.

## Off-script step

Every `respond off-script gate: ...` box takes this step. It is a daemon
gate opened with `gate_ask` on the MR's subject, not a board gate: no
`<status-bin> gate` verb touches it, and no parked resume exists for it.
The step writes no status. The box that entered reads the outcome:

- **Answered:** its outcome diamond reads `answers.action`'s value, which
  starts with `take:`, `iterate:`, `hold:` or `hand back:`. Hold ends the
  turn with the pane open and no terminal status.
- **Gone** (closed or not found): end cleanly, say so in the pane, and
  write no status.
- **Unavailable** (`gate_ask` errors, or the wait fails three times): the
  box's `gate unavailable` edge, which does what hand back does.

```dot
digraph respond_off_script_step {
    rankdir=TB;

    "Trigger: a respond off-script gate box is entered" [shape=ellipse];
    "Build the off-script questions (respond)" [shape=box];
    "gate_ask {subject: mr:<mrUrl>, kind: off-script, questions, context} (respond)" [shape=plaintext];
    "gate_ask result (respond off-script)?" [shape=diamond];
    "STOP: ask only through gate_ask (respond)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "AskUserQuestion with the off-script questions verbatim (respond)" [shape=plaintext];
    "gate_answer {id, answers} (respond off-script)" [shape=plaintext];
    "gate_answer result (respond off-script)?" [shape=diamond];
    "rt gate wait <id> as a background Bash task (respond off-script)" [shape=plaintext];
    "End the turn: holding at off-script gate <id> (respond)" [shape=box];
    "Trigger: the respond off-script wait finished" [shape=ellipse];
    "Off-script wait result (respond)?" [shape=diamond];
    "Off-script wait failures = 3 (respond)?" [shape=diamond];
    "Off-script gate gone (respond)" [shape=doublecircle];
    "Off-script gate unavailable (respond)" [shape=doublecircle];
    "Off-script answered: back to its box (respond)" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a respond off-script gate box is entered" -> "Build the off-script questions (respond)";
    "Build the off-script questions (respond)" -> "gate_ask {subject: mr:<mrUrl>, kind: off-script, questions, context} (respond)";
    "gate_ask {subject: mr:<mrUrl>, kind: off-script, questions, context} (respond)" -> "gate_ask result (respond off-script)?";
    "gate_ask result (respond off-script)?" -> "AskUserQuestion with the off-script questions verbatim (respond)" [label="presentation form"];
    "gate_ask result (respond off-script)?" -> "rt gate wait <id> as a background Bash task (respond off-script)" [label="presentation wait"];
    "gate_ask result (respond off-script)?" -> "Off-script gate unavailable (respond)" [label="tool error"];
    "gate_ask result (respond off-script)?" -> "STOP: ask only through gate_ask (respond)" [label="tempted to ask in pane prose or decide yourself"];
    "STOP: ask only through gate_ask (respond)" -> "gate_ask {subject: mr:<mrUrl>, kind: off-script, questions, context} (respond)";
    "AskUserQuestion with the off-script questions verbatim (respond)" -> "gate_answer {id, answers} (respond off-script)";
    "gate_answer {id, answers} (respond off-script)" -> "gate_answer result (respond off-script)?";
    "gate_answer result (respond off-script)?" -> "Off-script answered: back to its box (respond)" [label="recorded"];
    "gate_answer result (respond off-script)?" -> "Off-script answered: back to its box (respond)" [label="another surface answered first: proceed on the recorded answer"];
    "rt gate wait <id> as a background Bash task (respond off-script)" -> "End the turn: holding at off-script gate <id> (respond)";
    "End the turn: holding at off-script gate <id> (respond)" -> "Trigger: the respond off-script wait finished" [style=dashed];
    "Trigger: the respond off-script wait finished" -> "Off-script wait result (respond)?";
    "Off-script wait result (respond)?" -> "Off-script answered: back to its box (respond)" [label="answered"];
    "Off-script wait result (respond)?" -> "Off-script gate gone (respond)" [label="closed or not found"];
    "Off-script wait result (respond)?" -> "Off-script wait failures = 3 (respond)?" [label="any other failure"];
    "Off-script wait failures = 3 (respond)?" -> "rt gate wait <id> as a background Bash task (respond off-script)" [label="no: wait again"];
    "Off-script wait failures = 3 (respond)?" -> "Off-script gate unavailable (respond)" [label="yes"];
}
```

### Build the off-script questions (respond)

Exactly one question: id `action`, `multi: false`, its `label` the box's
situation line, and the four options the box's table gives, in order take,
iterate, hold, hand back. Each option is an object:

```json
{"value": "iterate: you fixed the cause, read the threads again (mr_threads refused)", "label": "Fixed it, read again", "description": "You fixed what refused the read and I read the threads again."}
```

`value` is spelled in full, starts with its verb, and names the proposed
move and the refused tool; `label` is 2 to 6 words; `description` is one
sentence saying what happens on that answer. Four options stay inside the
native form's per-question cap.

Call `gate_ask` with `subject: mr:<mrUrl>`, `kind: off-script`, that
question, and `context` quoting both errors verbatim (the first refusal
and the one after the fix) with the call that was refused. Never send an
empty context: a human-owned gate refuses it. Keep the result's `id` and
`presentation`. A `gate_ask` error is not itself an off-script origin: it
is `Off-script gate unavailable (respond)`.

On `form`, ask the question with AskUserQuestion verbatim (label, option
labels and descriptions), then record the pick with `gate_answer {id,
answers: {"action": "<the chosen value verbatim>"}}`, nuance in the
`{value, note}` form. A `conflict: true` result means another surface
answered first: proceed on its recorded answer and say in the pane which
answer won.

### End the turn: holding at off-script gate <id> (respond)

Launch one `rt gate wait <id>` as a background Bash task (the shell tool's
run-in-background mode; the wait is never a tool call), never a second
while one runs, and end the turn in one line: `holding at off-script gate
<id>`. The wait's completion re-invokes the pane; its last stdout is
`{"ok":true,"status":"answered","row":{...}}`, so read the answer at
`row.answer.answers.action` (a bare value or a `{value, note}` object) and
the decider at `row.answer.by`. Closed or not found is gone. Any other
failure re-runs the wait; the third failure is unavailable.

No parked resume exists for this kind: the board never replays an
off-script answer into a fresh pane, so this pane must stay to act on it.
A hold answer keeps the pane open with nothing moved and no terminal
status.

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time: not a flag and not part of the MR. Honor it while
processing the feedback (e.g. "push back on the naming comment", "only handle
thread 2") and pass it along to the domain skill as context. It never overrides
the status contract or either gate. A note that asks for a move the graph
marks STOP takes the off-script edge instead.

## Resolving the domain skill

The domain skill that owns the actual work comes from the first source that
answers; the order is fixed and the flow's first diamonds draw it:

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. When the board also passed `--skill-path <path>`,
   read the SKILL.md at that absolute path directly and treat it exactly as
   the domain skill named by `--skill`.
2. **Otherwise resolve the `respond` slot** with the vendored resolver,
   `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`. On exit 0, read the
   SKILL.md at `resolved.respond.path` and treat that skill exactly as if it
   had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. The generic path follows.

## Gate 1 and Gate 2 shapes

**Fitted open files.** A domain skill may hand back a fitted open file for
either gate: `gate-ctx.sh fit` output whose `.questions` already have the
shape below, each thread's structured context on its question (and, for
Gate 1, the planned fix on its `fix` option). That file IS the gate: open
it with `open-gate.sh` and the gate's kind, never rebuilt, re-ordered,
trimmed or hand-edited. The script prints the same JSON line as `gate
open`, with `"contextOmitted": true` added when the daemon dropped the
question contexts, and exits with its status. A `fits: false` file is
still over the shared context budget; the script drops whole question
contexts, largest first, until it fits, so the file goes in untouched. A
Gate 2 file ends with a pane-only `next` navigation question this wrapper
does not ask; the script drops it.

**Gate 1 (`respond-plan`).** ONE single-select question per unresolved
thread, in verdict-table order, plus one `code-changes` question. A thread
question's id is `thread-<n>` by 1-based position, its label that thread's
`<file>:<line>`, and its three options carry the verb plus the thread id
VERBATIM in the value (the ids shown are placeholders; substitute the real
ones):

```json
[
  {"id": "thread-1", "label": "<file>:<line>", "multi": false,
   "context": "<this thread's reviewer comment quoted verbatim, then the drafted reply or fix summary for it>",
   "options": [{"value": "reply:<threadId>", "label": "Reply only", "description": "Post the drafted reply and change no code."},
               {"value": "fix:<threadId>", "label": "Fix the code", "description": "Implement the proposed fix, then offer its reply at Gate 2."},
               {"value": "skip:<threadId>", "label": "Skip this thread", "description": "Post nothing and change nothing for this thread."}]},
  {"id": "thread-2", "label": "<file>:<line>", "multi": false,
   "context": "<thread 2's own quote + draft>",
   "options": ["... the next thread's reply/fix/skip triple, its own id and context verbatim; one such question per thread"]},
  {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
   "options": [{"value": "approve", "label": "Approve the changes", "description": "Implement every thread answered fix this round."},
               {"value": "revise", "label": "Revise the proposal", "description": "Implement nothing and re-adjudicate at the next round."},
               {"value": "skip", "label": "Skip code changes", "description": "Implement nothing this round while the replies still go ahead."}]}
]
```

One question per thread keeps every question at three options, under the
native form's per-question cap, so `gate open` stamps `form` for any thread
count; never fold several threads into one multi-select. It also makes
reply, fix and skip mutually exclusive per thread by construction, so no
contradictory selection can arrive.

The thread id lives in the option VALUE, never in the question id: every
consumer of the answer (this wrapper, a `--resumed-gate` pane, the board
card, the console card) reads every `answers` key other than
`code-changes`, unwraps a `{value, note, text}` object to its `value`,
splits at the first `:`, and joins the thread id to the report row. The
`thread-<n>` id is a container; nothing keys on it.

`skip` is the no-code-changes sentinel: surfaces hide the code-changes
question until a `fix:` value is selected and submit `skip` for it while
hidden, so it must always be present in the options.

**Gate 2 (`respond-post`).** ONE multi-select question per offered thread,
in verdict-table order (a reply-only or `skip:` thread gets none). Its id
is `thread-<n>` by 1-based position among these threads, its label the
thread's `<file>:<line>`, and its two options `post:<threadId>` and
`resolve:<threadId>`, thread id VERBATIM:

```json
[
  {"id": "thread-1", "label": "<file>:<line>", "multi": true,
   "context": "<this thread's file:line, then the reply text that will post>",
   "options": [{"value": "post:<threadId>", "label": "Post this reply", "recommended": true, "description": "Post this reply to the thread."},
               {"value": "resolve:<threadId>", "label": "Resolve the thread", "recommended": true, "description": "Resolve the thread after its reply."}]},
  {"id": "thread-2", "label": "<file>:<line>", "multi": true,
   "context": "<thread 2's file:line and reply>",
   "options": [{"value": "post:<threadId>", "label": "Post this reply", "recommended": true, "description": "Post this reply to the thread."},
               {"value": "resolve:<threadId>", "label": "Resolve the thread", "description": "Resolve the thread after its reply."}]}
]
```

`post` is recommended on every offered thread; `resolve` only on a thread
whose reply finalizes a fix, so a reply override stays open for the
reviewer unless the human ticks it. Post and resolve are independent:
both, either one, or neither.

**Labels.** Option labels cap at 200 UTF-8 bytes (these sit far under it).
Keep a question label to the thread's path and line; when a path is long,
middle-truncate the path portion (keep the filename and line). Never alter
a value string.

**Byte budget.** Each thread's material rides its own question's `context`,
so every surface shows the quote and draft WITH the question it belongs
to. `--context` carries only what is shared across threads (the MR and
round, one or two lines). `--context` plus every question `context` share
one 8192 UTF-8 byte budget. Send them whole: an oversized context is
dropped loudly by the daemon, not by you, and the open's output then
carries `"contextOmitted": true`. Never pre-trim or drop a context
yourself.

**Legacy Gate 2 shape.** A Gate 2 opened before this shape (a `replies`
multi, or its `replies-1`, `replies-2`, ... chunks, of bare thread ids plus
`disposition`) still reads as it did: post the union of the selected
replies, and resolve them only on `resolve-addressed`.

## Reading answers

`gate wait`'s answered form is `{"answers": {...}, "by": "...",
"answeredAt": ...}`, keyed by that gate's own question ids: for Gate 1,
one `thread-<n>` id per unresolved thread plus `code-changes`; for Gate 2,
one `thread-<n>` id per offered thread, each an array of `post:<threadId>`
and/or `resolve:<threadId>`.

- **Thread answers.** Iterate every key other than `code-changes`, unwrap a
  `{value, note, text}` object to its `value`, and split each value at the
  first `:` into the verb and the thread id. The thread id is in the
  value; the `thread-<n>` key is never a join key.
- **`text` versus `note`.** A Gate 1 `reply:` answer's or a Gate 2
  answer's `text`, when present, is the reply to post for that thread; the
  note never is. The pane form never sends `text`.
- **Note form.** Nuance rides a `{value, note}` object, e.g.
  `{"code-changes": {"value": "approve", "note": "approve but hold off on
  thread 3"}}`. A Gate 2 thread's explicit empty array (`{"thread-2": []}`)
  is valid too, recording the decision to neither post its reply nor
  resolve it.
- **Strict membership.** Every answer value must match one of its
  question's option values exactly (the included gate protocol's "Answers
  are option values"): never an index or a paraphrase.
- **`by`.** The deciding surface. Pass it on with `{plan}` and `{post}`, so
  the domain skill's decision record names who decided.

## Reply overrides

A `reply:` answer that carries `text` posts that text, note or not: the
human wrote the exact words. A `reply:` answer with no `text` is a **reply
override** when its Gate 1 card did not show its reply word for word, or
when the answer carries a `note` (in the pane form a note is the only place
a typed replacement can go).

A card did not show its reply when:

- the verdict table recommended `fix` or `skip` (the card showed a fix
  direction or nothing);
- its question context never reached the gate: the open was a `fits:
  false` file or its output flagged `contextOmitted` (then count every
  question's context as dropped);
- on a resume, `--report` carries the line `gate-1-context: dropped`
  (count every question's context as dropped).

This holds whoever answered, the pane included. An override's reply is
drafted after Gate 1, with its note when it has one, written into its row,
and the row set to `gate-1: override` (the domain skill does this on its
path). Gate 2 offers it.

## Counts and the badge

`<status-bin> respond-status <state> done "<one-line summary>" --posted <n>
--threads <n> [--held <n>]` reports what actually happened to the replies:

- `--threads` is the number of unresolved human threads the run set out to
  answer, i.e. the rows in the verdict table.
- `--posted` is how many of those actually received a posted reply: every
  thread that got a reply, i.e. each reply-only thread whose reply went up
  plus each Gate 2 thread (fixed or override) whose answer carries `post:`,
  a thread the Posted already read found up included. Resolving counts
  toward neither number.
- `--held` is how many of those deliberately got NO posted reply because a
  gate decided so: a `skip:` thread, a `fix:` thread held out under
  `code-changes: skip`, a Gate 2 thread (fixed or override) answered without
  `post:`, or a `gate-1: reply` thread an older Gate 2's answer kept down (a
  retired `replies` list that leaves it out, or an answer that names it
  without `post:`). Count a thread here only when a gate answer settled it
  without a reply going up; a thread the run simply never got to is neither
  posted nor held.
- A thread held by a failed push (`respond-post-held:`), a fix thread
  recorded unfixed, and a thread handed back at a reply refusal are
  neither posted nor held.
- A resolve refusal changes no count: a thread whose reply posted still
  counts as posted, since `--posted` counts replies. Name the unresolved
  thread in the `done` message.

The board derives the badge from these counts, so a wrong count is a wrong
badge:

| Counts | Badge |
|---|---|
| `3/3` | "replies posted" |
| `2/3` | "2 of 3 posted", and nags with a resume offer |
| `2/3 + 1 held` | "replies posted, 1 held", and finishes clean |
| `0/3` | "replies drafted, not posted" |

Omitting `--held` for a gate-held reply leaves the board offering a
pointless resume forever on a thread the human already settled. Keep the
message short, e.g. `"3 threads: 2 fixed, 1 pushback"` or `"2 threads: 1
fixed, 1 reply held per gate"`.

## Rules

- The board owns `queued`; this pane owns every status between it and the
  terminal write.
- `--state` is a handle, not a file: pass it verbatim, never read or write
  it yourself. Status goes only through `--status-bin`, and drafted and
  finalized replies only to `--report`.
- Both gates are non-negotiable. Never implement a fix or post a reply
  without the human's answer at the relevant gate (Gate 1's `reply:` for a
  reply-only thread, Gate 2 for a fixed thread or a reply override), even
  to hurry the badge to `done`. `done` follows the human's gate answers,
  not your own call: `--posted` counts what actually went up, never what
  you drafted, and `--held` counts only what a gate answer kept down.

## Gate protocol

The daemon-generic gate mechanics every passage above refers to. The board's
own projections (`<status-bin> gate ...`) sit in `board:gate-cli-recipes`;
everything else is here.

Below, `gate_ask` is what this wrapper's `<status-bin> gate open` already
did; `gate_answer` is `<status-bin> gate answer <state> --answers <json>
--by pane`; `rt gate wait` is the wait recipe in `board:gate-cli-recipes`.

<!-- part: include:gate-protocol source=mattstack:gate-protocol version=0.28.0 path=attachments/gate-protocol/SKILL.md lines=7-444 -->
# Gate protocol

One shared protocol for any gated pane or wrapper: publish first, then act
on the presentation the daemon returns. The daemon's gate registry is the
single arbiter; no per-verb conflict logic belongs anywhere downstream of
it. Every gate walks this graph: the site names the scope, the questions
and the selection; this part publishes, answers and records.

If a site's questions or a rule in the including verb ask for a move this
graph marks STOP, open the Off-script gate (below) instead.

```dot
digraph gate_protocol {
    rankdir=TB;

    "Trigger: a site reaches its gate" [shape=ellipse];
    "Build the gate's questions and context" [shape=box];
    "Under a run: bracket the gate?" [shape=diamond];
    "run_field_set {key: gate, value: <scope>, stage}" [shape=plaintext];
    "gate_ask {questions, kind: <scope>, context?, subject?}" [shape=plaintext];
    "gate_ask result?" [shape=diamond];
    "Fixed this gate_ask call once already?" [shape=diamond];
    "Fix what the gate_ask refusal names" [shape=box];
    "Daemon down: is the gated pane unattended?" [shape=diamond];
    "Under a run: fail the stage at the gate?" [shape=diamond];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [shape=plaintext];
    "Present the gate form with no registry" [shape=box];
    "gate_ask presentation?" [shape=diamond];
    "Wait: is the gated pane an attended non-herdr session?" [shape=diamond];
    "Present the in-pane gate form" [shape=box];
    "Gate form result?" [shape=diamond];
    "Gate questions left for another form call?" [shape=diamond];
    "Map the gate answer to exact option values" [shape=box];
    "gate_answer {id, answers}" [shape=plaintext];
    "gate_answer result?" [shape=diamond];
    "Resubmitted this gate_answer once already?" [shape=diamond];
    "Discard the form's gate answer; say which surface won" [shape=box];
    "Holding an open gate: under a run?" [shape=diamond];
    "Under a run: set waiting-gate?" [shape=diamond];
    "run_field_set {key: waiting-gate, value: <id>, stage}" [shape=plaintext];
    "rt gate wait <id> as a background Bash task" [shape=plaintext];
    "End the turn: holding at gate <id>" [shape=box];
    "Trigger: the gate wait finished and re-invoked this pane" [shape=ellipse];
    "Gate wait result for an already reconciled gate?" [shape=diamond];
    "Trigger: the human answers in words at a held gate" [shape=ellipse];
    "Words answer for an already reconciled gate?" [shape=diamond];
    "Trigger: a gate doorbell push arrives" [shape=ellipse];
    "Doorbell for an already reconciled gate?" [shape=diamond];
    "rt gate wait <id> --timeout 2s" [shape=plaintext];
    "waiting-gate set on this run?" [shape=diamond];
    "run_field_set {key: waiting-gate, value: -, stage}" [shape=plaintext];
    "Gate answer already in hand?" [shape=diamond];
    "Gate wait status?" [shape=diamond];
    "Take the winning gate answer and its by" [shape=box];
    "Under a run: record the gate decision?" [shape=diamond];
    "run_decision {contract: gate@1, scope, selection, decidedBy}" [shape=plaintext];
    "STOP: never invent an answer or re-ask a closed gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Gate stage failed" [shape=doublecircle];
    "Verb ends at the gate, quoting the refusal" [shape=doublecircle];
    "No run: held at the open gate, turn ends" [shape=doublecircle];
    "Late gate signal discarded" [shape=doublecircle];
    "Gate path ended per the verb's policy" [shape=doublecircle];
    "Act on the gate answer at the site" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a site reaches its gate" -> "Build the gate's questions and context";
    "Build the gate's questions and context" -> "Under a run: bracket the gate?";
    "Under a run: bracket the gate?" -> "run_field_set {key: gate, value: <scope>, stage}" [label="yes"];
    "Under a run: bracket the gate?" -> "gate_ask {questions, kind: <scope>, context?, subject?}" [label="no"];
    "run_field_set {key: gate, value: <scope>, stage}" -> "gate_ask {questions, kind: <scope>, context?, subject?}";
    "gate_ask {questions, kind: <scope>, context?, subject?}" -> "gate_ask result?";
    "gate_ask result?" -> "gate_ask presentation?" [label="ok: keep id and presentation"];
    "gate_ask result?" -> "Daemon down: is the gated pane unattended?" [label="refused: daemon unreachable"];
    "gate_ask result?" -> "Fixed this gate_ask call once already?" [label="refused: any other reason"];
    "Fixed this gate_ask call once already?" -> "Fix what the gate_ask refusal names" [label="no"];
    "Fixed this gate_ask call once already?" -> "Under a run: fail the stage at the gate?" [label="yes: budget spent"];
    "Fix what the gate_ask refusal names" -> "gate_ask {questions, kind: <scope>, context?, subject?}";
    "Daemon down: is the gated pane unattended?" -> "Present the gate form with no registry" [label="no: attended"];
    "Daemon down: is the gated pane unattended?" -> "Under a run: fail the stage at the gate?" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "Verb ends at the gate, quoting the refusal" [label="no"];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" -> "Gate stage failed";
    "Present the gate form with no registry" -> "Under a run: record the gate decision?" [label="answered: decidedBy is pane"];
    "gate_ask presentation?" -> "Present the in-pane gate form" [label="form"];
    "gate_ask presentation?" -> "Wait: is the gated pane an attended non-herdr session?" [label="wait"];
    "Wait: is the gated pane an attended non-herdr session?" -> "Present the in-pane gate form" [label="yes: take the form anyway"];
    "Wait: is the gated pane an attended non-herdr session?" -> "Under a run: set waiting-gate?" [label="no: spawned, or any herdr pane"];
    "Present the in-pane gate form" -> "Gate form result?";
    "Gate form result?" -> "Gate questions left for another form call?" [label="answered"];
    "Gate form result?" -> "Trigger: a gate doorbell push arrives" [label="dismissed by the daemon: the doorbell is the next input" style=dashed];
    "Gate form result?" -> "Holding an open gate: under a run?" [label="cancelled by the human"];
    "Gate questions left for another form call?" -> "Present the in-pane gate form" [label="yes: the next chunk"];
    "Gate questions left for another form call?" -> "Map the gate answer to exact option values" [label="no: last chunk answered"];
    "Map the gate answer to exact option values" -> "gate_answer {id, answers}";
    "gate_answer {id, answers}" -> "gate_answer result?";
    "gate_answer result?" -> "Take the winning gate answer and its by" [label="recorded: this answer won"];
    "gate_answer result?" -> "Discard the form's gate answer; say which surface won" [label="conflict: true"];
    "gate_answer result?" -> "Resubmitted this gate_answer once already?" [label="refused: not an option value"];
    "gate_answer result?" -> "STOP: never invent an answer or re-ask a closed gate" [label="refused: gate closed or not found"];
    "Resubmitted this gate_answer once already?" -> "Map the gate answer to exact option values" [label="no"];
    "Resubmitted this gate_answer once already?" -> "Holding an open gate: under a run?" [label="yes: leave it open for another surface"];
    "Discard the form's gate answer; say which surface won" -> "Take the winning gate answer and its by";
    "Holding an open gate: under a run?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "Holding an open gate: under a run?" -> "No run: held at the open gate, turn ends" [label="no"];
    "Under a run: set waiting-gate?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "Under a run: set waiting-gate?" -> "rt gate wait <id> as a background Bash task" [label="no"];
    "run_field_set {key: waiting-gate, value: <id>, stage}" -> "rt gate wait <id> as a background Bash task";
    "rt gate wait <id> as a background Bash task" -> "End the turn: holding at gate <id>";
    "End the turn: holding at gate <id>" -> "Trigger: the gate wait finished and re-invoked this pane" [style=dashed];
    "Trigger: the gate wait finished and re-invoked this pane" -> "Gate wait result for an already reconciled gate?";
    "Gate wait result for an already reconciled gate?" -> "Late gate signal discarded" [label="yes"];
    "Gate wait result for an already reconciled gate?" -> "waiting-gate set on this run?" [label="no"];
    "Trigger: the human answers in words at a held gate" -> "Words answer for an already reconciled gate?";
    "Words answer for an already reconciled gate?" -> "Late gate signal discarded" [label="yes: say in one line which surface already decided it"];
    "Words answer for an already reconciled gate?" -> "waiting-gate set on this run?" [label="no"];
    "Trigger: a gate doorbell push arrives" -> "Doorbell for an already reconciled gate?";
    "Doorbell for an already reconciled gate?" -> "Late gate signal discarded" [label="yes"];
    "Doorbell for an already reconciled gate?" -> "rt gate wait <id> --timeout 2s" [label="no"];
    "rt gate wait <id> --timeout 2s" -> "waiting-gate set on this run?";
    "waiting-gate set on this run?" -> "run_field_set {key: waiting-gate, value: -, stage}" [label="yes: this pane armed it at a hold"];
    "waiting-gate set on this run?" -> "Gate answer already in hand?" [label="no: never armed for this gate (a form pane, or no run)"];
    "run_field_set {key: waiting-gate, value: -, stage}" -> "Gate answer already in hand?";
    "Gate answer already in hand?" -> "Map the gate answer to exact option values" [label="yes: the human answered in words"];
    "Gate answer already in hand?" -> "Gate wait status?" [label="no: a wait printed the row"];
    "Gate wait status?" -> "Take the winning gate answer and its by" [label="answered: row.answer"];
    "Gate wait status?" -> "STOP: never invent an answer or re-ask a closed gate" [label="closed or gate not found"];
    "Gate wait status?" -> "Holding an open gate: under a run?" [label="timed out: still open (the 2s re-read)"];
    "STOP: never invent an answer or re-ask a closed gate" -> "Gate path ended per the verb's policy";
    "Take the winning gate answer and its by" -> "Under a run: record the gate decision?";
    "Under a run: record the gate decision?" -> "run_decision {contract: gate@1, scope, selection, decidedBy}" [label="yes"];
    "Under a run: record the gate decision?" -> "Act on the gate answer at the site" [label="no"];
    "run_decision {contract: gate@1, scope, selection, decidedBy}" -> "Act on the gate answer at the site";
}
```

### Build the gate's questions and context

Open before anything that depends on the answer. `gate_ask` owns the whole
opening ceremony (subject resolution, presentation, nudge, origin, the
context size cap): `questions` (each `{"id", "label", "multi",
"options"}`), `kind` = the gate's scope, and optional `context` and
`subject`. Success returns `id` (`gt-...`), `presentation` (`form` or
`wait`), `subject`, and `supersededId` (null or the superseded gate's id).
Keep `id` and `presentation`: every node after it acts on them.

- **Subject.** The daemon resolves it; never build one by hand. Your
  session's running run wins (`run:<id>`), else your agent record (its
  launch subject when it carries one, else `agent:<id>`); with neither, a
  loud refusal, and a session with multiple running runs is refused naming
  the candidates. Pass `subject` only to open on a subject that is not your
  own. Opening where the subject already carries an open gate of the same
  kind supersedes the old one, so a relaunch after a crash is safe without
  a cleanup step.
- **Context.** A prose `context` is a VERBATIM QUOTE of the material the
  decision is about (the task summary from the brief, the plan section
  under decision, the failing check output), never a freshly composed
  summary; a structured one carries its shape's fields instead (Structured
  context below). A human-owned, non-exempt gate REFUSES on empty or
  whitespace-only context: give it real material or omit the field, never
  blank it. The gate context and every question's `context` share one
  8192-byte UTF-8 budget; over it, the daemon drops the question contexts,
  and the gate context too when it alone is over, loudly: the result
  carries `contextOmitted: true`. Do not measure or trim a prose context
  yourself; a structured open pre-flights instead.
- **Where text goes.** Gate-level `context` is background every question
  shares. A question's own `context` is setup for that one question, when
  the gate asks several that need different framing. An option's
  `description` is the one-line why for that choice; the `label` already
  says what.
- **Options.** Emit labeled options whenever a site's option values are not
  already human-readable; the registry stores every option in that object
  form. Labels cap at 200 UTF-8 bytes and an oversized label REJECTS the
  open: middle-truncate a long path, never alter the value.
- **At most 4 options per question.** That is the native form's hard
  per-question limit, and the daemon presents the in-pane form only when
  EVERY question fits it, so one 5-option question sends the whole gate to
  the background wait queue. The navigation verbs a site lists (Iterate
  here, Go back to a stage, Hold, Abandon) are their own `next` question,
  never extra options folded into a decision question; a selection list
  larger than 4 splits into `<id>-1`, `<id>-2`, ... questions of up to 4
  options each, in order, whose answers read as one union.

```json
{"value": "redirect:implement", "label": "Redirect to implement", "description": "the failing check points at code, not the plan"}
```

Presentation is the daemon's, by one rule no caller computes; the nudge and
origin ride the same call, so there is nothing to stamp by hand. `rt gate
open` remains the raw primitive underneath; a gated verb never needs it.

### Fix what the gate_ask refusal names

A refusal that names a subject or question problem (a blank context, an
oversized label, several running runs) is not daemon-down: fix exactly what
it names and call `gate_ask` again, once. An oversized label is fixed by
middle-truncating that label (keep its start and its end, `...` between)
and nothing else: the option's `value` is sent exactly as it was in the
refused call, never rewritten to carry the label's text, and no whole end
of the label is dropped. A second refusal fails the stage under a run
with a `reason` that quotes the refusal text verbatim, or ends the verb
quoting it with no run. It does not go off-script: `gate_ask` is the
refused tool, and the off-script gate opens through `gate_ask` too.

### Present the gate form with no registry

`gate_ask` failed with a daemon-unreachable error, so the gate runs
form-only in the pane, exactly the pre-facility behavior: present the form
and act on its answer, with no `gate_ask`, `rt gate wait` or `gate_answer`
calls at all. With no registry there is no CAS: the form's answer is the
decision, and its record, when a run exists, carries `decidedBy` `pane`.
An unattended pane never presents this form; it fails the stage under a
run, or ends the verb.

### Present the in-pane gate form

This is the `presentation: "form"` branch; an attended non-herdr pane on
`wait` lands here too (Attendance, below). The native in-pane structured form is this
gate's registry face: where the launch-injected AskUserQuestion hook is
active, an open gate matching the pane's LAUNCH subject is what lets the
form through, and so is the pane's own worktree carrying its own open run:
gate. Render each option's `label` when it has one and its `description`
when it has one (the AskUserQuestion option's own description field). The
form never shows a structured context's JSON: flatten each context to prose
for the form's question text.

When the gate carries more questions than one form call fits, ask them in
gate order, one chunk per call, and answer once after the last chunk; a
lost CAS at that point discards every chunk's answer together.

Dismissed by the daemon: another surface answered while the form was open,
the daemon injected a single Escape, and the doorbell is your next input.
Cancelled by the human: the gate stays open; never re-present it on your
own.

### Map the gate answer to exact option values

`gate_answer` takes `id` = the gate's id and `answers` = one object keyed by
question id, `{"<question id>": "<value>" | ["<value>", ...] | {"value":
..., "note": "..."}}`. Each value is the chosen option's `value` verbatim
(Answers are option values, below); a question with no options takes what
the human typed. An answer the human gave in words maps the same way, its
nuance in `note`. A value the daemon refuses is remapped once; a second
refusal leaves the gate open for another surface to answer.

### Discard the form's gate answer; say which surface won

A losing `gate_answer` is not an error: it returns a successful result
carrying `conflict: true` and the winner's `row`. Discard the form's
answer, say in the pane in one line which answer won and from where
(`row.answer.by`), and proceed on `row`'s recorded answer; no second read
is needed. On the words path the discarded answer is the human's words,
not a form's.

### End the turn: holding at gate <id>

The node before launched the one background `rt gate wait <id>` (the
shell tool's run-in-background mode; the wait is never a tool call, since
no tool blocks on a gate); never launch a second while one for this gate
runs. End the turn in one line: `holding at gate <id>`. The wait
loops internally around the daemon clamp, survives daemon restarts, and
exits only on answered or closed, printing
`{"ok":true,"status":"answered","row":{...}}` as its last stdout. The pane
is idle but armed: the wait's completion re-invokes this pane with the
answer as the tool result. Under a run a turn ends only with
`waiting-gate` or `hold` set; the pipeline gate stop hook blocks any other
ending, which is why every hold under a run arms the marker and the wait.

### Take the winning gate answer and its by

Read the answers at `row.answer.answers` (or the answer this pane just
recorded) and the deciding surface at `row.answer.by`. `decidedBy` names
the CAS WINNER, never `pane` when a different surface won, and a `gate@1`
record's `decidedBy` is a surface (`pane`, `board`, `console`,
`shepherd`), never a verb name.

## Attendance

Attendance comes from the invocation context, never from asking. Under a
run it is the run's `spawnedBy` (recorded as `spawned_by`): set means a
surface spawned the pane and it is unattended. A verb with no run has no
`spawnedBy`: one a surface launched in a pane (a board wrapper, a herd
brief) is unattended, and its launch instruction says so; one a human typed
is attended.

On `wait`, the branch turns on herdr as well as attendance: an attended
non-herdr session takes the plain in-pane form anyway, because the stamp
names what OTHER surfaces reconcile against, not a command to this pane,
and a non-herdr pane has no herdr PTY to receive the remote-answer Escape
that makes the idle wait safe. A spawned pane, or any herdr pane whether
attended or not, goes to the wait. The herdr bit is `HERDR_ENV=1` in the
pane's environment, read only to pick this `wait` branch, never to compute
presentation. A human who opens an unattended pane can interrupt the wait
and answer in words: the graph's words trigger, which first checks that
no surface already reconciled the gate.

Under a run, a cancelled form holds on the wait even outside herdr: no form
is open, so nothing needs the remote-answer Escape. With no run, a cancelled
form launches no wait: the human who cancelled is at the pane, the turn ends
held at the open gate, and the answer arrives later in words.

## Runs integration

A site that says "run gate-protocol's Runs integration with kind `<k>` and
these questions" enters the graph at its trigger and walks every branch;
it is not a list of steps to run in order. The site supplies `kind` (its
scope), the questions and its selection. Every `run_*` call passes the
run's `runDb`, which the verb holds. No `subject`: the daemon resolves this
session's running run. Include `context` only when the site has material to
quote; omit the field otherwise, never an empty string.

A site's own lines for the graph's run nodes are those nodes, not extra
steps: its `run_field_set` with `key` `gate` is the bracket node, and its
`run_decision` line is the `run_decision` node, filled with the site's
selection, never a second record.

## Off-script gate

Leaving a host's graph is legal when it is explicit. A host STOP that
routes here opens this gate through the graph above, scope
`off-script:<site>:<n>` (`n` counts from 1 within the site's attempt), with
`context` quoting the refusal or the line that asks for the move:

| Question | Options |
|---|---|
| `action` | **Take the proposed move** (the value spells the move in full) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Selection: `{"move":"<the move>","why":"<the refusal or line>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`,
recorded only under a run, like every `run_decision`. Take: make exactly
that move, once, then continue from the node the forbidden move would have
led to. Hand back: under a run, `run_stage {action: fail}` with the why as
the reason; with no run, end the verb quoting the why. A host graph draws
one off-script node per STOP origin, never one shared node: continuing
needs to know where the move came from, and a shared node cannot return to
the right place.

## Structured context (gate-ctx@1)

A context string may carry a JSON object instead of prose, for surfaces
that render it as cards. It is structured when it parses as an object
whose `"gate-ctx"` key names a known shape; anything else takes the prose
path. The key is both the discriminant and the version:

| Shape | Carried by | Required | Optional |
|---|---|---|---|
| `plan@1` | gate `context` | `reviewer`, `threads.total` | `round`, `threads.blocking` (absent reads 0), `adjudication` (display string) |
| `post@1` | gate `context` | `reviewer`, `replies` (count) | `round`, `fixes` (`[{"sha": ...}]`) |
| `thread@1` | a thread question's `context` | `author`, `severity`, `claim.summary`, `verdict.call`, `reply.kind`, `reply.text` unless `reply.kind` is `none` | `claim.points` (strings), `verdict.note` |
| `reply@1` | a respond-post thread question's `context` | `thread`, `file`, `verb`, `text` | `sha` |
| `replies@1` | a replies question's `context` (the retired respond-post shape; renderers still read gates opened with it) | `replies[]`, each `thread`, `file`, `verb`, `text` | `sha` per entry |
| `review@1` | a review-post gate's `context` | `readiness`, `summary`, `findings` (counts by severity) | `reviewer`, `round`, `re_review` (absent reads false), `prior` (`{addressed, still_open}`, both required) |
| `findings@1` | each `findings-*` question's `context` | `findings[]`, each `id`, `severity`, `title`, `body` | `file`, `fix`, `evidence`, `disposition` per entry |

- Enums: `severity` is `blocking | non-blocking | question | none`;
  `verdict.call` is `valid | valid-low-value | pushback |
  needs-clarification | no-ask`; `reply.kind` is `verbatim` (the exact
  text that will post), `direction` (intent only), or `none` (nothing
  posts); `verb` is `reply | fix`, and `sha` rides only a `fix`.
  `readiness` is `yes | no | with-fixes`, hyphenated; a `findings@1`
  entry's `severity` is `critical | important | minor` and its
  `disposition` (re-review only) is `new | still-open | addressed-check`;
  a severity with no findings may omit its count, and absent reads 0.
- A `thread@1` question's `label` is the thread's `file:line`, and its
  ordinal is its position among the gate's `thread-*` questions. The
  planned fix is not in the context: it is the `fix` option's
  `description`. A `reply@1` question is `multi`, with exactly two
  options, `post:<thread>` and `resolve:<thread>`, picked independently;
  its `label` is the thread's `file:line`. A `replies@1` entry joins its
  checkbox option by `thread` == option value.
- A `findings@1` entry joins its option ONE TO ONE: `id` == the option's
  `value`, every option with exactly one entry and every entry with one
  option; a mismatch either way sends the whole gate to the generic
  view. The options keep the degraded recipe older renderers parse:
  label `[Tier] title`, description `anchor · fix · kind:<word>`. `file`
  is a real `path:line` anchor, never the label of an unanchored
  finding. A `review@1` gate is structured only when EVERY `findings-*`
  question carries a `findings@1` context; otherwise it opens as prose.
- Unknown keys are ignored, and a new field never bumps the version; a
  changed meaning or type does. A missing or wrong-typed required field
  fails the WHOLE context, which then shows as raw JSON through the prose
  path: validate before opening, and omit an optional key rather than
  writing `null`.
- Size: pre-flight the whole open against the shared budget above,
  measuring the serialized strings. Over it, drop `claim.points` from the
  longest thread first, then `verdict.note` the same way; never trim
  `reply.text`, the reply is the thing being approved.
  In a `findings@1` open, drop `evidence` from the entry where it is
  largest first, then `fix` the same way, whole fields only; never
  `title`, `file`, or `body`. Still over: prose
  contexts for the whole gate, never a half-structured one.
- The in-pane form never shows the JSON: flatten each context to prose
  for the form's question text.

## Answers are option values

For a question with options, every answer value must exactly match one of
its option VALUES (multi = array, every element checked); the daemon
compares values only, never labels, and rejects anything else at record
time. Never an index or a paraphrase. Nuance rides the per-answer note
form:
`{"value": <verbatim value or array>, "note": "<free text>"}`.
A surface that lets the human replace text the gate offered (an edited
reply) sends it as `text` on the same object, beside any note:
`{"value": <verbatim value or array>, "text": "<replacement>"}`. The
in-pane form never sends `text`; a replacement for offered text that the
human types in the form's free-text field rides as a note. What a note or
`text` changes is each verb's own act step's call; the protocol swaps
neither in for offered text by itself.

## Closed gates, Hold / Iterate

`closed` means the decision site is abandoned: end that path cleanly per
the verb's own policy. Never invent an answer for a closed gate. Picking
Hold or Iterate is handled IN-PANE by the verb itself, not posted through
the registry as a terminal decision; a verb that re-asks after Hold or
Iterate opens a NEW gate rather than reusing the old one. Marking such
options pane-only (so remote cards render them disabled) rides `meta`,
which only the typed client and raw `rt gate open` carry; `gate_ask`
does not.

## Doorbell

The doorbell phrase is a VERIFY-ONLY signal: it never carries or implies
the answer, only "re-read the registry" (the 2s re-read node). With a form
open, the daemon dismisses it itself with a single Escape into the gate's
pane, so the doorbell arrives as your next input; for a pane the daemon
cannot reach, it queues behind the form until the human answers or cancels
it. The surface that recorded the answer never receives this push, and a
push for a gate already reconciled is discarded.

## Red flags

| Thought | Reality |
|---|---|
| "I'll compute presentation / build --origin myself" | The daemon owns the ceremony. `gate_ask` returns the presentation; act on it. |
| "The doorbell push tells me what they picked" | It's verify-only. It never carries or implies the answer: re-read the registry. |
| "`decidedBy` is whoever just submitted the form" | It names the CAS WINNER, which may be a different surface than the one that just submitted. |
| "I'll ask the human whether this pane is attended" | Attendance comes from the invocation context, never asked. |
| "The site's run_decision line is one more record after the graph's" | It is the graph's `run_decision` node, filled with the site's selection. |
