---
name: board:doctor
description: >-
  Use when the mr-board launches a pane to auto-repair mechanical breakage
  (merge conflicts and/or red CI) on ONE MR, yours or a teammate's, invoked as
  "/board:doctor <mrUrl> --state <path> --status-bin <path> [--skill <name>]"
  with optional --tier, --fix-classes and --draft-bin flags. Not for manual use.
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "doctor,doctor-api"
  slot-doctor: "required mr-doctor@2 -- owns the checkout-tier repair playbook: locating or provisioning the worktree, rebasing, triaging and fixing CI, watching for green. When a fix would otherwise dead-end in error but the decision is enumerable, it reports the decision back to this wrapper instead of guessing or terminating -- it never opens or waits on the escalation gate itself."
  slot-doctor-api: "required mr-doctor-api@2 -- owns the api-tier repair playbook: no checkout, pipeline retries, server-side rebase, held drafts only. Same escalation-reporting contract as the checkout-tier slot -- it never opens or waits on the escalation gate itself."
  compiled: "mattstack:gate-protocol@0.31.14"
---

<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->

<!-- part: step source=doctor/SKILL.md path=doctor/SKILL.md lines=16-567 -->
# mr-board doctor runner

The board launched this pane because an MR has mechanical breakage (CI red
and/or merge conflicts); it may be yours or a teammate's. The human is not
watching: finish unattended, and reach a human only through a
`doctor-escalation` gate or a terminal `error`. This wrapper carries **no**
repo- or CI-specific knowledge; the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to repair |
| `--state <handle>` | opaque board handle for this MR's repair. Pass it verbatim to `--status-bin`, `--draft-bin`, and the `gate` verbs; never read, stat, or write it. It looks like a `.json` path but no such file exists: board state lives in the board's database, and the path is only a key. Its absence on disk says nothing about whether the board is tracking this pass. |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--skill <name>` | the domain skill that owns the actual repair (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--tier api` | API-only repair tier: no checkout, no worktree, no local commits. Absent = the historical checkout-tier behavior. |
| `--fix-classes <a,b>` | Comma-separated allowlist of fix classes the dispatching policy enabled (e.g. `retry-flake,inherited-note-draft`). `none` is the empty allowlist: no class is licensed. Absent licenses every class. Actions outside the list are escalations, not fixes. See "Fix classes" below for what each one licenses. |
| `--draft-bin <path>` | Absolute path to the board's draft-writer CLI. Any outbound MR note MUST be written through it as a held draft, passing this pane's own `--state` value through so the draft lands in the right board's db: `<draft-bin> doctor-draft <mrUrl> <iid> <kind> <body...> --state <state>`. Never post a note directly. |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh run (optional; see "Resumed entry" in `entry.md`) |
| `--resumed-gate-kind <kind>` | the `kind` of the gate `--resumed-gate` names (e.g. `doctor-escalation`). Present exactly when `--resumed-gate` is, and the only way to learn it: `--state` is an opaque handle and `gate wait` returns only the answer. |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> doctor-status <state> <status> [message]
```

## State progression

The board owns `queued`. You emit the rest as you cross each milestone:

| Status | When to emit |
|--------|--------------|
| `diagnosing` | Immediately, before you know if it's conflicts, CI, or both. |
| `rebasing` | While a rebase/conflict resolution is running. |
| `fixing` | While implementing fixes for CI failures (or resolving conflicts), including while an escalation gate opened during a fix is being waited on; see "Escalation step" below. |
| `watching` | Post-push, while polling CI for green. |
| `done` | Terminal: clean + green, or fixes pushed and green. |
| `error` | Terminal: a non-enumerable failure needs a human to look directly, or an escalation answer is "leave it to me in the pane". |

## Flow

The graph is the map: start at the trigger and take only the edges it
draws. Each stage box is a file beside this one with its own graph and
sections; the exit at the end of the run (the lease release and the
terminal status) is drawn here.

```dot
digraph doctor_flow {
    rankdir=TB;

    "Trigger: the board launched /board:doctor" [shape=ellipse];
    "Launch and resume entry (entry.md)" [shape=box];
    "Entry outcome (doctor)?" [shape=diamond];
    "Domain repair (domain.md)" [shape=box];
    "Domain repair outcome (doctor)?" [shape=diamond];
    "Diagnose and rebase (diagnose.md)" [shape=box];
    "Diagnosis outcome (doctor)?" [shape=diamond];
    "Classify and retry (classify.md)" [shape=box];
    "Classify and retry outcome (doctor)?" [shape=diamond];
    "Watch the pipeline (watch.md)" [shape=box];
    "Watch outcome (doctor)?" [shape=diamond];
    "Own lease held (doctor exit)?" [shape=diamond];
    "ci_lease_release {mrUrl}" [shape=plaintext];
    "Which exit (doctor)?" [shape=diamond];
    "<status-bin> doctor-status <state> done <message>" [shape=plaintext];
    "<status-bin> doctor-status <state> error <specific, actionable message>" [shape=plaintext];
    "Doctor error written: stay in the pane" [shape=doublecircle];
    "Held at an escalation: the pane stays, no terminal status" [shape=doublecircle];
    "Escalation gate gone: ended cleanly, no status write" [shape=doublecircle];
    "Doctor done: the board closes this tab" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: the board launched /board:doctor" -> "Launch and resume entry (entry.md)";
    "Launch and resume entry (entry.md)" -> "Entry outcome (doctor)?";
    "Entry outcome (doctor)?" -> "Domain repair (domain.md)" [label="repair from the top"];
    "Entry outcome (doctor)?" -> "Domain repair (domain.md)" [label="domain action answered"];
    "Entry outcome (doctor)?" -> "Classify and retry (classify.md)" [label="retry budget answered"];
    "Entry outcome (doctor)?" -> "Watch the pipeline (watch.md)" [label="watch budget answered"];
    "Entry outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="entry ends the run"];
    "Entry outcome (doctor)?" -> "Which exit (doctor)?" [label="resumed answer ends the run"];
    "Domain repair (domain.md)" -> "Domain repair outcome (doctor)?";
    "Domain repair outcome (doctor)?" -> "Diagnose and rebase (diagnose.md)" [label="no domain skill"];
    "Domain repair outcome (doctor)?" -> "Watch the pipeline (watch.md)" [label="pushed"];
    "Domain repair outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="domain repair clean and green"];
    "Domain repair outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="domain repair ends the run"];
    "Diagnose and rebase (diagnose.md)" -> "Diagnosis outcome (doctor)?";
    "Diagnosis outcome (doctor)?" -> "Classify and retry (classify.md)" [label="red CI"];
    "Diagnosis outcome (doctor)?" -> "Watch the pipeline (watch.md)" [label="rebased or running"];
    "Diagnosis outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="nothing broken"];
    "Diagnosis outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="diagnosis ends the run"];
    "Classify and retry (classify.md)" -> "Classify and retry outcome (doctor)?";
    "Classify and retry outcome (doctor)?" -> "Watch the pipeline (watch.md)" [label="retried"];
    "Classify and retry outcome (doctor)?" -> "Watch the pipeline (watch.md)" [label="no job list: watch the head sha"];
    "Classify and retry outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="classification ends the run"];
    "Watch the pipeline (watch.md)" -> "Watch outcome (doctor)?";
    "Watch outcome (doctor)?" -> "Classify and retry (classify.md)" [label="red again"];
    "Watch outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="watched green"];
    "Watch outcome (doctor)?" -> "Own lease held (doctor exit)?" [label="watch ends the run"];
    "Own lease held (doctor exit)?" -> "ci_lease_release {mrUrl}" [label="yes: own mode"];
    "Own lease held (doctor exit)?" -> "Which exit (doctor)?" [label="no: board mode, stood down, or never claimed"];
    "ci_lease_release {mrUrl}" -> "Which exit (doctor)?";
    "Which exit (doctor)?" -> "<status-bin> doctor-status <state> done <message>" [label="done: clean and green"];
    "Which exit (doctor)?" -> "<status-bin> doctor-status <state> error <specific, actionable message>" [label="error, a stand-down, or leave it to me"];
    "Which exit (doctor)?" -> "Held at an escalation: the pane stays, no terminal status" [label="hold"];
    "Which exit (doctor)?" -> "Escalation gate gone: ended cleanly, no status write" [label="gate gone"];
    "<status-bin> doctor-status <state> done <message>" -> "Doctor done: the board closes this tab";
    "<status-bin> doctor-status <state> error <specific, actionable message>" -> "Doctor error written: stay in the pane";
}
```

A stage ends at a doublecircle that names where the map goes next, and
the stage's outcome diamond here takes the edge with that exit's name. A
stage entered at a named node (an answered domain action, a retry budget
answer, failed jobs from a watch) starts at its trigger for that entry.

What the graph cannot show:

- **The done write is the last call.** The board closes this pane's tab
  the moment `doctor-status <state> done` lands, which ends this session
  mid-batch. So the done write is a call of its own, sent only after every
  other write of the run has returned: `ci_lease_release`, and any push,
  rebase or retry the run made. A write sent in the same batch as the done
  write is lost.
- **Lease mode.** `Who holds the fresh lease (doctor)?` fixes the mode for
  the run: board mode (the board's `board:doctor:` owner holds it) or own
  mode (this session holds it). Every `Lease mode (...)?` diamond reads
  that mode. In board mode, a check that finds no fresh lease (null, or
  only a stale one) or another owner's lease is `another owner: stand
  down` at the `Lease check result (...)?` diamond: the board's lease is
  gone, and this pane never claims in its place. See "The CI lease".
- **Budgets.** Each `Fixed the <tool> call once already?` counter counts
  for the whole run. A guard STOP's re-entry passes the same counter as a
  tool error. None resets on an off-script iterate: a refusal after an
  iterate goes straight back to that tool's off-script escalation, and
  its `Off-script rounds = 2 (...)?` counter bounds the loop.
  `Old-lease waits = 2 (doctor)?` counts the waits a resumed pane has
  taken on its old lease: two at most, then it stands down naming the
  holder.
- **Exit messages.** `done` names what the run repaired (or "clean and green,
  nothing to repair"). `error` is specific and actionable (see "Escalation
  shapes and phrasing"); a stand-down's message is `another CI attendant
  holds !<iid>: <holder>`. Hold and gate gone write no status. Under
  `--tier api` every status write names the action and its fix class.

### Launch and resume entry (entry.md)

Writes the first status, resolves the domain skill, checks the tier, and
reads or claims the CI lease; a parked-gate resume reads its parked
answer first and routes on it.
Read `entry.md` now and follow its graph; its sections are there.

### Domain repair (domain.md)

Hands the repair to the resolved domain skill, escalates the enumerable
decisions it reports back, and takes a refused `git_push` through its
off-script escalation.
Read `domain.md` now and follow its graph; its sections are there.

### Diagnose and rebase (diagnose.md)

The generic path's first read: what is broken on the MR, and a
server-side rebase when it has conflicts.
Read `diagnose.md` now and follow its graph; its sections are there.

### Classify and retry (classify.md)

Reads the failed jobs, classifies each, and retries a flaky job or
drafts an inherited-failure note under the CI lease.
Read `classify.md` now and follow its graph; its sections are there.

### Watch the pipeline (watch.md)

Watches one sha with `ci_watch` to a verdict, re-claims a lost own-mode
lease, and escalates a watch that runs past its budget.
Read `watch.md` now and follow its graph; its sections are there.

## Escalation step

Every `doctor escalation: ...` and `doctor off-script escalation: ...` box,
in whichever stage file holds it, takes this step. The step writes no
status: keep the status the escalating node left (`fixing` during a fix, `diagnosing` or `watching`
when a lease, read or watch refusal escalates), including while waiting.
The box that entered reads the outcome:

- **Answered:** its outcome diamond reads `answers.action`.
- **Gone** (closed, not found, or no gate open): end cleanly, say so in the
  pane, and write no status: whatever superseded the gate already owns this
  MR's board state.
- **Degraded** (`gate open` exits nonzero, the escalation budget is spent,
  or the wait keeps failing): the box writes `error` with the actionable
  escalation message this gate would have asked, and never presents a
  form. Doctor panes are routinely auto-dispatched with no human watching,
  and a form there waits forever without a terminal status; the board
  (and, for auto dispatches, the escalation notifier) surfaces the error
  to a human.

```dot
digraph doctor_escalation_step {
    rankdir=TB;

    "Trigger: a doctor escalation box is entered" [shape=ellipse];
    "Escalations opened this run = 3?" [shape=diamond];
    "Build the doctor-escalation question" [shape=box];
    "<status-bin> gate open <state> --kind doctor-escalation --questions <json> [--context <text>]" [shape=plaintext];
    "doctor-escalation open exit?" [shape=diamond];
    "Presentation (doctor-escalation)?" [shape=diamond];
    "STOP: the answer is the human's; wait for the gate (doctor)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Ask the doctor-escalation question as a pane form" [shape=box];
    "<status-bin> gate answer <state> --answers <json> --by pane (doctor form)" [shape=plaintext];
    "gate answer printed a JSON line (doctor form)?" [shape=diamond];
    "Trigger: a doorbell arrives while the doctor form is open" [shape=ellipse];
    "<status-bin> gate wait <state> --max-ms 1000 (doctor doorbell)" [shape=plaintext];
    "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (doctor)" [shape=plaintext];
    "End the turn: holding at gate <gateId> (doctor)" [shape=box];
    "Trigger: the doctor wait loop finished" [shape=ellipse];
    "Doctor wait result?" [shape=diamond];
    "Doctor wait failures = 3?" [shape=diamond];
    "Trigger: a human answers the doctor escalation in the pane" [shape=ellipse];
    "<status-bin> gate answer <state> --answers <json> --by pane (doctor escape hatch)" [shape=plaintext];
    "gate answer printed a JSON line (doctor escape hatch)?" [shape=diamond];
    "Escalation degraded: the box writes error" [shape=doublecircle];
    "Escalation gate gone: the box ends cleanly" [shape=doublecircle];
    "Escalation answered: back to its box" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a doctor escalation box is entered" -> "Escalations opened this run = 3?";
    "Escalations opened this run = 3?" -> "Escalation degraded: the box writes error" [label="yes: error, escalation budget spent"];
    "Escalations opened this run = 3?" -> "Build the doctor-escalation question" [label="no"];
    "Build the doctor-escalation question" -> "<status-bin> gate open <state> --kind doctor-escalation --questions <json> [--context <text>]";
    "<status-bin> gate open <state> --kind doctor-escalation --questions <json> [--context <text>]" -> "doctor-escalation open exit?";
    "doctor-escalation open exit?" -> "Presentation (doctor-escalation)?" [label="0"];
    "doctor-escalation open exit?" -> "Escalation degraded: the box writes error" [label="nonzero: the daemon is down"];
    "Presentation (doctor-escalation)?" -> "Ask the doctor-escalation question as a pane form" [label="form"];
    "Presentation (doctor-escalation)?" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (doctor)" [label="wait"];
    "Presentation (doctor-escalation)?" -> "STOP: the answer is the human's; wait for the gate (doctor)" [label="tempted to pick the option yourself"];
    "STOP: the answer is the human's; wait for the gate (doctor)" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (doctor)";
    "Ask the doctor-escalation question as a pane form" -> "<status-bin> gate answer <state> --answers <json> --by pane (doctor form)";
    "<status-bin> gate answer <state> --answers <json> --by pane (doctor form)" -> "gate answer printed a JSON line (doctor form)?";
    "gate answer printed a JSON line (doctor form)?" -> "Escalation answered: back to its box" [label="no: this answer stands"];
    "gate answer printed a JSON line (doctor form)?" -> "Escalation answered: back to its box" [label="yes: another surface won, proceed on its answer"];
    "Trigger: a doorbell arrives while the doctor form is open" -> "<status-bin> gate wait <state> --max-ms 1000 (doctor doorbell)";
    "<status-bin> gate wait <state> --max-ms 1000 (doctor doorbell)" -> "Escalation answered: back to its box";
    "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (doctor)" -> "End the turn: holding at gate <gateId> (doctor)";
    "End the turn: holding at gate <gateId> (doctor)" -> "Trigger: the doctor wait loop finished" [style=dashed];
    "Trigger: the doctor wait loop finished" -> "Doctor wait result?";
    "Doctor wait result?" -> "Escalation answered: back to its box" [label="answered"];
    "Doctor wait result?" -> "Escalation gate gone: the box ends cleanly" [label="closed, not found, or no gate open"];
    "Doctor wait result?" -> "Doctor wait failures = 3?" [label="any other failure"];
    "Doctor wait failures = 3?" -> "One background Bash task looping <status-bin> gate wait <state> --max-ms 90000 (doctor)" [label="no: wait again"];
    "Doctor wait failures = 3?" -> "Escalation degraded: the box writes error" [label="yes"];
    "Trigger: a human answers the doctor escalation in the pane" -> "<status-bin> gate answer <state> --answers <json> --by pane (doctor escape hatch)";
    "<status-bin> gate answer <state> --answers <json> --by pane (doctor escape hatch)" -> "gate answer printed a JSON line (doctor escape hatch)?";
    "gate answer printed a JSON line (doctor escape hatch)?" -> "Escalation answered: back to its box" [label="no: this answer stands"];
    "gate answer printed a JSON line (doctor escape hatch)?" -> "Escalation answered: back to its box" [label="yes: another surface won, tell the human which answer won"];
}
```

### Build the doctor-escalation question

Exactly one question, id `action`. Its `label` states the situation in one
line, in the voice of "Escalation shapes and phrasing". Each option is an
object in the box's own wording:

```json
{"value": "retry job 812 once more on 4f2a9c1", "label": "Retry it once more", "description": "I retry job 812 one more time and watch the pipeline for 4f2a9c1 again."}
```

`value` is spelled in full, human-readable, never a bare index or a
one-word verb the resumed entry could not route; `label` is 2 to 6 words;
`description` is one sentence saying what happens on that answer. The
last option is always `leave it to me in the pane`, with the value exactly
that literal string.

The open prints one JSON line, `{"gateId": "...", "presentation":
"form"}` or `"wait"`. Keep both: `Presentation (doctor-escalation)?` reads
`presentation`, and `End the turn: holding at gate <gateId> (doctor)`
names `gateId`.

`--context` carries the situation line the escalation composes, with any
quoted errors. When it would exceed 8192 UTF-8 bytes, omit `--context`
entirely rather than trimming it.

`Escalations opened this run = 3?` counts enumerable and off-script
escalations together; a resumed pane counts from zero. Each dead end
opens a new gate; an answered gate is never re-opened.

### Ask the doctor-escalation question as a pane form

Follow the gate protocol included at the end of this skill: its "Present
the in-pane gate form" step and its "Answers are option values" and
"Doorbell" sections, for the mechanics. Where it records the pane's
answer with the `gate_answer` tool, a board gate records it with
`<status-bin> gate answer <state> --answers <json> --by pane` instead.

- Render this gate's one question with its label verbatim, and submit the
  chosen option's `value` verbatim: never an index or a paraphrase.
- Nuance rides the note form: `{"action": {"value": "proceed as code-fix
  after override", "note": "but hold off on the migration file"}}`.
- A printed JSON line from `gate answer`, or a doorbell while the form
  still sits open, means another surface won: proceed on the winning
  answer, never the one you meant to submit. The doorbell is
  verify-only: read the recorded answer with `<status-bin> gate wait
  <state> --max-ms 1000`.
- A PreToolUse hook may deny native AskUserQuestion when no gate is open.
  That denial is the gate protocol speaking: take this step's `gate open`
  first. When the daemon is down the hook allows the native form, but this
  skill's degraded path is still `error`, never a form.

### End the turn: holding at gate <gateId> (doctor)

Read `${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md` with the Read
tool and follow its "Wait recipe": one background shell task loops
`<status-bin> gate wait <state> --max-ms 90000` while it prints
`{"status":"pending"}`; never launch a second while one runs. End the turn
in one line: `holding at gate <gateId>`, naming this gate. The loop's
completion re-invokes the pane with the answer.

A human who interrupts the wait and answers in the pane is the escape
hatch: record it with `<status-bin> gate answer <state> --answers <json>
--by pane` so a parked resume stays in sync. Per that file's "CAS loss and
reading answers back": silence and exit 0 means this answer stands; one
printed JSON line (`{answers, by, answeredAt}`) means another surface
answered first, so proceed on the printed answer and tell the human which
answer won.

Per "A failing wait is not degradation" and "Closed or missing gate": a
closed, not-found or `no gate open for <url>` result is terminal and ends
cleanly; any other failing wait re-runs, and only a third failure is
degraded.

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time: not a flag and not part of the MR. Honor it while
diagnosing and fixing (e.g. "the lint job is the real blocker", "don't touch
the flaky e2e suite") and pass it along to the domain skill as context. It
never overrides the tier, the enabled fix classes, or the status contract.
A note that asks for a move the graph marks STOP takes the off-script edge
instead.

## Resolving the domain skill

The domain skill that owns the actual repair comes from the first source
that answers; the order is fixed and the flow's first diamonds draw it.
The tier picks the slot: `--tier api` uses the `doctor-api` slot
(mirroring the board's `triage.doctorSkill`), any other launch uses the
`doctor` slot (mirroring `config.doctorSkill`).

1. **Explicit `--skill <name>` wins.** The resolver does not run. With
   `--skill-path <path>`, read the SKILL.md at that absolute path; without
   it, load the skill by name.
2. **Otherwise resolve the tier's slot** with the vendored resolver,
   `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`. On exit 0, read the
   SKILL.md at `resolved.doctor.path` (or `resolved.doctor-api.path` under
   `--tier api`) and treat it exactly as if it came through `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's
   JSON `errors` verbatim. Never guess or substitute a binding; the
   generic path follows.

## The CI lease

Exactly one CI attendant works an MR at a time: this doctor, a watch-ci
session, or the board's own doctor dispatch. The `ci_lease_*` tools own the
lease, and the owner is always this session. The first call is
`ci_lease_read {mrUrl}`, never a claim:

- **Board mode:** a fresh lease owned by the board's `board:doctor:<mr>`
  owner. The board's triage claimed it before an auto dispatch,
  heartbeats it each cron pass and releases it at a terminal status. No
  claim, no heartbeat, no release: `ci_watch` passes `underBoardLease:
  true` and only reads it. Before each rebase, retry and push, read it
  again; a lease that is not the board's is a stand-down.
- **Own mode:** no fresh lease (null, or only a stale one), or `mine:
  true`. Claim with `ci_lease_claim {mrUrl, holder: doctor, branch?}`
  (`branch` the MR's source branch when the launch, an `mr_view` read or
  the domain skill names it; omit `branch` otherwise, since the tool takes
  a claim without it) before any repair, re-claim before
  each rebase, retry and push, heartbeat during a long domain fix, and
  release with `ci_lease_release {mrUrl}` at every exit except a
  stand-down.
- **Stand down:** any other owner. Write `doctor-status error "another CI
  attendant holds !<iid>: <holder>"`, never release (the lease is not
  yours), and stay in the pane.

A `lease_lost` watch result in own mode with no `holder` means no lease is
held at all: claim again, twice at most, and past that the lost-lease
escalation asks the human. With a holder named, or in board mode, it is a
stand-down.

A resumed pane (launched with `--resumed-gate`) is the one exception to
standing down on another owner's fresh `doctor` lease. `claude --resume`
may start this pane under a new session id, so the lease its earlier self
claimed reads as another session's, and `ci_lease_claim` refuses a fresh
lease another session owns. So the resumed pane waits the old lease out
and reads it again: a dead pane never heartbeats, so its lease goes stale
and the claim succeeds, while a live attendant heartbeats, so a moved
`heartbeatAt` is a stand-down. A fresh run never waits.

| Thought | Reality |
|---|---|
| "The board launched me, so I claim" | Board mode never claims. Read first; the board's lease covers this pane. |
| "Another session holds it but I can retry faster" | Stand down. Two attendants on one MR race each other's commits, pushes and retries. |
| "I claimed at the start, so the retry is mine" | The lease may have lapsed or moved. Check before every repair. |
| "The claim errored, so I skip the lease" | Fix the call once, then the off-script escalation. A repair never runs unleased. |

## Escalation shapes and phrasing

Escalate, don't speculate. A fix that needs product judgment or a
non-obvious semantic resolution takes one of two shapes:

- **Non-enumerable.** No small set of concrete choices exists: the
  diagnosis itself is unclear, or the fix is open-ended. Emit `error` with
  a specific, actionable message.
- **Enumerable.** The decision reduces to a short list of concrete,
  executable choices. Open a `doctor-escalation` gate instead of erroring.

The enumerable cases come in three shapes:

- **Conflict strategy:** both sides of a rebase conflict changed the same
  logic and there is a small set of concrete resolutions (keep one side,
  take the other, or a specific merge of both). Options are those
  resolutions.
- **Author-gate override:** safeguard 2 (`domain.md`) came back
  inconclusive or mismatched for a branch-writing fix class. Options are e.g. `"proceed as
  <fix class> after override"`. **The invariant survives this gate:** an
  answered override does **not** license skipping the independent check.
  Re-verify the author gate fresh, right before applying, exactly as the
  safeguard requires. If the fresh check still does not confirm the
  board's own identity, do not apply the fix; emit `error` with the
  concrete mismatch. A human overriding "proceed" without a match is
  exactly the ambiguity the safeguard exists to catch, so no pane answer
  resolves it.
- **Budget extension:** the fix or watch loop hit its budget without
  converging. Options are e.g. `"extend the fix budget by <n> more
  cycles"`. A
  granted extension that still does not converge is a fresh escalation,
  or `error` when nothing enumerable is left to offer.

### Non-enumerable (`error`)

No small set of concrete choices exists: emit `error` with a specific,
actionable message:

- `"no worktree available: the pool is full"`

Bad ones are vague: `"couldn't fix"`, `"needs human"`, `"CI still red"`.

### Enumerable (`doctor-escalation` gate)

A short list of concrete, executable choices exists: open the gate with
that list as `options`, e.g.:

- `"rebase conflict in app/routes/foo.ts: both sides modified handleSubmit"`
  with options:

  | Value | Label | Description |
  |---|---|---|
  | `keep the MR branch's handleSubmit` | Keep the MR's version | I resolve the conflict with the MR branch's handleSubmit and push. |
  | `keep main's handleSubmit` | Keep main's version | I resolve the conflict with main's handleSubmit and push. |
  | `leave it to me in the pane` | Leave it to me | I stop and write an error naming the conflict. |

- `"CI red after 3 cycles: 2 tests still failing (snapshot + business logic
  in Bar)"` with options:

  | Value | Label | Description |
  |---|---|---|
  | `extend the fix budget by 3 more cycles` | Try three more cycles | I keep fixing for up to three more fix and watch cycles. |
  | `leave it to me in the pane` | Leave it to me | I stop and write an error naming the failing tests. |

## API tier

When `--tier api` is present, the repair is checkout-free by contract:

- Never claim a worktree, never commit, never push. The only mutations
  allowed are job or pipeline retries (`mr_retry`), a server-side rebase
  (`mr_rebase`) when licensed, and held drafts via `--draft-bin`. The CI
  lease calls are bookkeeping, not repairs, and apply at this tier too.
- The `rebasing` and `fixing` milestones apply to their API-shaped
  equivalents (server-side rebase, retry); otherwise go straight from
  `diagnosing` to `watching`. Escalations apply unchanged at this tier: a
  retry loop that does not converge is a budget-extension escalation, as
  at the checkout tier.
- **Every autonomous action is reported as a status-bin write whose
  message names the action and fix class** (e.g. `fixing "retried job 812
  (retry-flake)"`, `rebasing "server-side rebase (clean-api-rebase)"`).
  For auto-dispatched doctors the status writer mirrors each of these into
  the audit log, one line per autonomous action, so an unreported action
  is an audit-trail violation, not a formality.
- Anything that would need a checkout is an `error` escalation whose
  message carries the diagnosis (failed job, one-line cause, why it is not
  yours to retry). The human is not watching; the escalation IS the
  handoff.

## Fix classes

`--fix-classes` is an allowlist, not a suggestion: a fix class not in the
list is out of scope, full stop, and the corresponding breakage is an
escalation instead.

- `retry-flake`: one retry of a flaky job (`mr_retry`).
- `inherited-note-draft`: a held draft through `--draft-bin` naming a
  failure inherited from the target branch.
- `clean-api-rebase`: a server-side rebase (`mr_rebase`).
  `Server-side rebase licensed?` answers yes only when `--fix-classes`
  is absent or lists `clean-api-rebase`; under `--fix-classes none` it
  answers no.
- **`mechanical-lint`** (checkout tier only): **behavior-neutral
  mechanical code fixes ONLY**... appending a required lint-disable reason
  suffix, formatting-only changes (whitespace, quote style, trailing
  commas), import ordering. Nothing that could alter runtime behavior
  qualifies; if a fix touches logic, changes a condition, adds or removes a
  code path, or you are not certain it's a no-op, it is **not**
  mechanical-lint... escalate it instead of guessing.
- **`code-fix`** (checkout tier only): **full repair authority on the
  board identity's OWN MRs**... real code fixes for red CI, semantic
  conflict resolution, committed and pushed to the MR branch. The
  dispatcher only ever includes this class when the MR author IS the
  board's own identity. Judgment line: `code-fix` licenses fixes a
  competent author would consider the obviously-intended change (a missing
  import, a type error with one evident correction, a broken test whose
  fixture drifted from sanctioned behavior). It does NOT license design
  decisions: when the fix would CHANGE sanctioned behavior, pick between
  plausible intents, or the loop is not converging, escalate with the
  options laid out.
- When both `mechanical-lint` and `code-fix` are present, the fix takes the
  narrowest class that covers it, and the commit message names that class.

## Rules

- No `--no-verify`, no bypassing pre-commit hooks.
- Force only through `git_push`'s `forceWithLease: true`, never a plain
  force.
- Open a gate only when the decision genuinely reduces to a short,
  concrete, executable list of options. When in doubt whether a failure is
  enumerable, it isn't: emit `error` instead of inventing options a human
  wouldn't recognize as their real choices.
- `--state` is a handle, not a file: pass it verbatim, never read or write
  it yourself.

## Gate protocol

The daemon-generic gate mechanics every passage above refers to. The board's
own projections (`<status-bin> gate ...`) sit in `board:gate-cli-recipes`;
everything else is here.

Below, `gate_ask` is what this wrapper's `<status-bin> gate open` already
did; `gate_answer` is `<status-bin> gate answer <state> --answers <json>
--by pane`; `rt gate wait` is the wait recipe in `board:gate-cli-recipes`.
This wrapper's own "Escalation step" replaces the protocol's "Off-script
gate" section.

<!-- part: include:gate-protocol source=mattstack:gate-protocol version=0.31.14 path=attachments/gate-protocol/SKILL.md lines=7-305 -->
# Gate protocol

The daemon's gate registry is the single arbiter; under a run the gate
tools record the decision.

If a site's questions or a rule in the including verb ask for a move this
graph marks STOP, open the Off-script gate (below) instead.

```dot
digraph gate_protocol {
    "Trigger: a site reaches its gate" [shape=ellipse];
    "Trigger: a site opened its gate with gate_open" [shape=ellipse];
    "Build the gate's questions and context" [shape=box];
    "gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}" [shape=plaintext];
    "gate_ask result?" [shape=diamond];
    "Under a run (gate_ask fix)?" [shape=diamond];
    "run_budget {key: gate-fix:<scope>, limit: 2, stage}" [shape=plaintext];
    "Fixed this gate_ask call once already?" [shape=diamond];
    "Fix what the gate_ask refusal names" [shape=box];
    "Daemon down: is the gated pane unattended?" [shape=diamond];
    "Under a run: fail the stage at the gate?" [shape=diamond];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [shape=plaintext];
    "Present the gate form with no registry" [shape=box];
    "Under a run (no-registry answer)?" [shape=diamond];
    "gate_record {runDb, stage, scope, shape: answers, answers, decidedBy: pane}" [shape=plaintext];
    "paneAction?" [shape=diamond];
    "Present the in-pane gate form" [shape=box];
    "Gate form result?" [shape=diamond];
    "Map the gate answer to exact option values" [shape=box];
    "gate_answer {id, answers, runDb?, stage?}" [shape=plaintext];
    "gate_answer result?" [shape=diamond];
    "Under a run (answer remap)?" [shape=diamond];
    "run_budget {key: gate-remap:<scope>, limit: 2, stage}" [shape=plaintext];
    "Resubmitted this gate_answer once already?" [shape=diamond];
    "Say which surface won" [shape=box];
    "Holding an open gate: under a run?" [shape=diamond];
    "run_field_set {key: waiting-gate, value: <id>, stage}" [shape=plaintext];
    "rt gate wait <id> as a background Bash task" [shape=plaintext];
    "End the turn: holding at gate <id>" [shape=box];
    "Trigger: the gate wait finished" [shape=ellipse];
    "Trigger: the human answers in words" [shape=ellipse];
    "Trigger: a doorbell push arrives" [shape=ellipse];
    "gate_reconcile {id, runDb?, stage?}" [shape=plaintext];
    "gate_reconcile status?" [shape=diamond];
    "A write-in to act on (actOnWriteIn)?" [shape=diamond];
    "Act on a write-in" [shape=box];
    "STOP: never invent an answer or re-ask a closed gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Gate stage failed" [shape=doublecircle];
    "Verb ends quoting the refusal" [shape=doublecircle];
    "No run: held at the open gate" [shape=doublecircle];
    "Late gate signal discarded" [shape=doublecircle];
    "Path ended per the verb's policy" [shape=doublecircle];
    "Write-in acted on: a new gate opens" [shape=doublecircle];
    "Act on the gate answer at the site" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: a site reaches its gate" -> "Build the gate's questions and context" -> "gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}" -> "gate_ask result?";
    "gate_ask result?" -> "paneAction?" [label="ok"];
    "gate_ask result?" -> "Daemon down: is the gated pane unattended?" [label="refused: daemon unreachable"];
    "gate_ask result?" -> "Under a run (gate_ask fix)?" [label="refused: other"];
    "Under a run (gate_ask fix)?" -> "run_budget {key: gate-fix:<scope>, limit: 2, stage}" [label="yes"];
    "Under a run (gate_ask fix)?" -> "Fixed this gate_ask call once already?" [label="no"];
    "run_budget {key: gate-fix:<scope>, limit: 2, stage}" -> "Fixed this gate_ask call once already?";
    "Fixed this gate_ask call once already?" -> "Fix what the gate_ask refusal names" [label="no"];
    "Fixed this gate_ask call once already?" -> "Under a run: fail the stage at the gate?" [label="yes"];
    "Fix what the gate_ask refusal names" -> "gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}";
    "Daemon down: is the gated pane unattended?" -> "Present the gate form with no registry" [label="no"];
    "Daemon down: is the gated pane unattended?" -> "Under a run: fail the stage at the gate?" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" [label="yes"];
    "Under a run: fail the stage at the gate?" -> "Verb ends quoting the refusal" [label="no"];
    "run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}" -> "Gate stage failed";
    "Present the gate form with no registry" -> "Under a run (no-registry answer)?";
    "Under a run (no-registry answer)?" -> "gate_record {runDb, stage, scope, shape: answers, answers, decidedBy: pane}" [label="yes"];
    "Under a run (no-registry answer)?" -> "A write-in to act on (actOnWriteIn)?" [label="no"];
    "gate_record {runDb, stage, scope, shape: answers, answers, decidedBy: pane}" -> "A write-in to act on (actOnWriteIn)?";
    "Trigger: a site opened its gate with gate_open" -> "paneAction?";
    "paneAction?" -> "Present the in-pane gate form" [label="form"];
    "paneAction?" -> "rt gate wait <id> as a background Bash task" [label="wait"];
    "Present the in-pane gate form" -> "Gate form result?";
    "Gate form result?" -> "Map the gate answer to exact option values" [label="answered"];
    "Gate form result?" -> "Trigger: a doorbell push arrives" [label="dismissed" style=dashed];
    "Gate form result?" -> "Holding an open gate: under a run?" [label="cancelled"];
    "Map the gate answer to exact option values" -> "gate_answer {id, answers, runDb?, stage?}" -> "gate_answer result?";
    "gate_answer result?" -> "A write-in to act on (actOnWriteIn)?" [label="this answer won"];
    "gate_answer result?" -> "Say which surface won" [label="conflict: true"];
    "gate_answer result?" -> "Under a run (answer remap)?" [label="refused: not an option"];
    "gate_answer result?" -> "STOP: never invent an answer or re-ask a closed gate" [label="refused: closed or not found"];
    "Under a run (answer remap)?" -> "run_budget {key: gate-remap:<scope>, limit: 2, stage}" [label="yes"];
    "Under a run (answer remap)?" -> "Resubmitted this gate_answer once already?" [label="no"];
    "run_budget {key: gate-remap:<scope>, limit: 2, stage}" -> "Resubmitted this gate_answer once already?";
    "Resubmitted this gate_answer once already?" -> "Map the gate answer to exact option values" [label="no"];
    "Resubmitted this gate_answer once already?" -> "Holding an open gate: under a run?" [label="yes"];
    "Say which surface won" -> "A write-in to act on (actOnWriteIn)?";
    "Holding an open gate: under a run?" -> "run_field_set {key: waiting-gate, value: <id>, stage}" [label="yes"];
    "Holding an open gate: under a run?" -> "No run: held at the open gate" [label="no"];
    "run_field_set {key: waiting-gate, value: <id>, stage}" -> "rt gate wait <id> as a background Bash task" -> "End the turn: holding at gate <id>";
    "End the turn: holding at gate <id>" -> "Trigger: the gate wait finished" [style=dashed];
    "Trigger: the gate wait finished" -> "gate_reconcile {id, runDb?, stage?}" -> "gate_reconcile status?";
    "Trigger: the human answers in words" -> "gate_reconcile {id, runDb?, stage?}";
    "Trigger: a doorbell push arrives" -> "gate_reconcile {id, runDb?, stage?}";
    "gate_reconcile status?" -> "Late gate signal discarded" [label="late: reconciled, stale, or acted on"];
    "gate_reconcile status?" -> "Say which surface won" [label="answered"];
    "gate_reconcile status?" -> "STOP: never invent an answer or re-ask a closed gate" [label="closed or not found"];
    "gate_reconcile status?" -> "Map the gate answer to exact option values" [label="open, words"];
    "gate_reconcile status?" -> "End the turn: holding at gate <id>" [label="open, no words"];
    "gate_reconcile status?" -> "Daemon down: is the gated pane unattended?" [label="refused: daemon unreachable"];
    "STOP: never invent an answer or re-ask a closed gate" -> "Path ended per the verb's policy";
    "A write-in to act on (actOnWriteIn)?" -> "Act on a write-in" [label="yes"];
    "A write-in to act on (actOnWriteIn)?" -> "Act on the gate answer at the site" [label="no"];
    "Act on a write-in" -> "Write-in acted on: a new gate opens";
}
```

### Build the gate's questions and context

Open before anything that depends on the answer. A question is `{"id",
"label", "multi", "options"}`, plus `"writeIn": true` where the site marks
`(write-in)`; `kind` is the gate's scope. Pass `subject` only for a subject
not your own.

- **Context** is a VERBATIM QUOTE of the material under decision (the
  brief's task, the plan section, the failing output), never a fresh
  summary, and never sent empty. Lay it out as Markdown that reads the same
  unrendered: a framing line, then label lines (`Important:`) with one `-`
  bullet per item. Never trim it; the daemon drops what overflows. A
  question's own `context` sets up that question alone; an option's
  `description` is its one-line why.
- **Options** are `{value, label}` objects when values are not
  human-readable; a recommended pick's `label` ends ` (Recommended)`, its
  `value` bare. In a site table headed `Options (recommended first)`, mark
  the option the table writes; a row with none, such as the stage-end
  `next`, marks none.
- **Write-ins** go only on a decision question whose free text you can act
  on, never on `next` or a review-post, respond, doctor or pane-attention
  question.
- **At most 4 options per question**, or the whole gate goes to the wait.
  Navigation (Iterate here, Go back, Hold, Abandon) is its own `next`
  question; a longer list splits into `<id>-1`, `<id>-2`, ... read as one
  union.

### Trigger: a site opened its gate with gate_open

A site opening a structured gate calls `gate_open` itself and enters here.
Its result carries what `gate_ask`'s does (see gate_ask result?), and under
a run it has already written `gate` and, on `wait`, armed `waiting-gate`.

### gate_ask result?

**ok:** keep `id`, `paneAction`, `formContext` and `formChunks`;
`labelsTruncated` lists labels the tool shortened, so never shorten one
yourself. **`runErrors`:** the gate is open but a run write failed: quote it
in one line and carry on at `paneAction?`, never re-asking the gate or
writing that field yourself.

### Fix what the gate_ask refusal names

Fix exactly what it names (a blank context, several running runs, a bad
`runDb`) and ask again, once. Under a run each counter diamond reads
`run_budget`'s `exhausted` and a `run_budget` error counts as exhausted;
with no run, count in context. A second refusal fails the stage or ends the
verb, quoting it verbatim; never off-script, since that gate opens through
`gate_ask` too.

### Present the gate form with no registry

Form-only, with no other gate call: the answer is the decision (no CAS),
`decidedBy` `pane`, and under a run `gate_record` records it.

### Present the in-pane gate form

The `paneAction: form` branch (older sites say the
`presentation: "form"` branch). Show `formContext`, when present, in the
pane before the first chunk, then ask `formChunks` in order, one
AskUserQuestion call per chunk, rendering each chunk as given; answer once,
after the last. Dismissed: another surface answered, and the doorbell is
your next input. Cancelled: the gate stays open; never re-present it
yourself.

### Map the gate answer to exact option values

`answers` is one object keyed by question id, values per Answers are option
values (below); a question with no options takes the human's text, and
words at a held gate map the same way. On a `writeIn` question, "Other"
text with nothing ticked is `{"writeIn": "<text>"}`, never the nearest
option; beside ticks on a multi it is `{"value": [<ticks>], "note":
"<text>"}`. A refused value is remapped once, counted as in Fix what the
gate_ask refusal names, then left open for another surface.

### Say which surface won

Say in one line which answer won and from where (`decidedBy`), drop the
pane's own answer or words, and go on with the result's `answers`.

### End the turn: holding at gate <id>

Never launch a second wait for this gate. End the turn in one line,
`holding at gate <id>`. Under a run a turn ends only with `waiting-gate`
set: `gate_ask` arms it on `wait`, the `run_field_set` node after a
cancelled form or a spent remap.

### gate_reconcile status?

It re-reads the gate (up to 2 seconds), records the answer under a run and
clears `waiting-gate`; never a timed `rt gate wait` or a hand record. Late
means `alreadyReconciled`, a `skipped` naming a stale gate, or, with no run,
a gate this pane already acted on. Otherwise `answered` is the decision, and
words in hand lose to it. `open` with words: map them and let
`gate_answer`'s CAS decide; with none, end the turn again (the wait and
marker stand). A daemon-unreachable refusal takes the daemon-down branch,
quoting it.

### A write-in to act on (actOnWriteIn)?

Read `actOnWriteIn` off the tool result: it is the deliberate-pick rule. A
write-in is acted on only when `next` is absent, Proceed or Iterate here;
any other `next` (Hold, Go back, Abandon) was picked on purpose, and the
site takes it with the write-in as its note. With no tool result, apply the
rule yourself.

### Act on a write-in

Handle the gate like Iterate here: skip the site's own branch (a Proceed
beside it is the form's preselection), do what the write-in asks, reading
the whole answer set, then open a NEW gate at the same site so the human
sees the result first. One too unclear to act on goes straight to that new
gate, which asks about it.

## Attendance

Attendance comes from the invocation context, never from asking: under a
run, `spawnedBy` set means unattended; with no run, the launch instruction
says (a pane a surface launched is unattended).

## Runs integration

A site that says "run gate-protocol's Runs integration with kind `<k>` and
these questions" enters at the trigger and walks every branch. Under a run
every gate tool call passes `runDb` and the site's `stage`: the tools
bracket the gate, arm `waiting-gate` on a wait, record the answers map
(`decidedBy` the CAS winner) and clear the marker. Without them the stop
hook bounces the turn. With no run, omit both; nothing here calls a `run_*`
tool.

- **Sites not yet on the tools** (ship, watch-ci, evidence, review, forge,
  board) still draw a `run_field_set {key: gate}` bracket, run before
  `gate_ask`, and a `run_decision` gate@1 line, run at `Act on the gate
  answer at the site` (it upserts in the site's shape; a write-in records
  as `{"writeIn": "<their words>"}` in the slot holding that question's
  answer, never bare text).
- **Review shapes.** `gate_answer` and `gate_reconcile` record nothing on a
  review gate (`respond-plan`, `respond-post`, `review-post`, scope `post`)
  unless passed `record: true`; the site records with `gate_record`, or
  with its `run_decision` line while not yet on the tools.

## Off-script gate

A host STOP opens it through the graph: scope `off-script:<site>:<n>` (`n`
from 1 within the site's attempt), `context` quoting the refusal or the
line asking for the move.

| Question | Options |
|---|---|
| `action` | **Take the proposed move** (its value spells the whole move) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Take: make exactly that move once, then continue from the node it led to.
Hand back: under a run, `run_stage {action: fail}` with the why as reason;
with no run, end the verb quoting it.

## Structured context (gate-ctx@1)

A site that opens a structured gate builds its source per
`${CLAUDE_SKILL_DIR}/parts/include-gate-protocol/structured-context.md` and opens it with `gate_open`.
Nothing else in this protocol needs it.

## Answers are option values

An answer to a question with options is one of its option VALUES verbatim
(an array on a multi), never an index, label or paraphrase. Nuance rides
`{"value": ..., "note": "..."}`; an edited replacement for offered text
rides `text`, which the in-pane form never sends. The verb's act step
decides what either changes. A `writeIn: true` question may instead take
`{"writeIn": "<their words>"}` alone.

## Closed gates, Hold / Iterate

`closed` abandons the site: end that path per the verb's policy, never
inventing an answer. The verb handles Hold and Iterate in the pane once the
answer is recorded; a re-ask opens a NEW gate.

## Doorbell

Verify-only: it never carries the answer, only "re-read the registry",
which is `gate_reconcile`. The daemon dismisses an open form first.

## Red flags

| Thought | Reality |
|---|---|
| "The doorbell says what they picked" | Call `gate_reconcile`. |
