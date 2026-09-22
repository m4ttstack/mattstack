---
name: gate-protocol
description: "Use when a gated pane or wrapper needs to publish a human decision point and carry it to an answer -- opening it through rt gate ask or the gate_ask tool, presenting the in-pane form, blocking in gate wait, handling a CAS rejection, or reconciling a doorbell push. Not for direct invocation; a gated verb includes this part."
disable-model-invocation: true
---

# Gate protocol

One shared protocol for any gated pane or wrapper: publish first, then act
on the presentation the daemon returns. The daemon's gate registry is the
single arbiter; no per-verb conflict logic belongs anywhere downstream of
it.

## Publish

Open before anything that depends on the answer. One call owns the whole
opening ceremony (subject resolution, presentation, nudge, origin, the
context size cap):

```bash
rt gate ask --questions '<questions json>' --kind <scope> [--context <text>] [--subject <s>]
```

or, tool-native, the `gate_ask` MCP tool with the same `questions` /
`kind` / `context` / `subject` inputs. Success prints one JSON object:
`{"ok":true,"id":"gt-...","presentation":"form"|"wait","subject":"...","supersededId":null|"gt-..."}`;
a refusal prints `{"ok":false,"error":"..."}` and exits 1. Each tool call
is a fresh shell: capture `id` and `presentation` in the same call that
uses them.

The daemon resolves the subject; never build one by hand. Your session's
running run wins (`run:<id>`), else your agent record (its launch
subject when it carries one, else `agent:<id>`); with neither, a loud
refusal, and a session with multiple running runs is refused naming the
candidates. Pass `--subject` only to open on a subject that is
not your own. Opening on a subject that already carries an open gate of
the same kind supersedes the old one, so a relaunch after a crash is safe
without a separate cleanup step.

A prose `--context` is a VERBATIM QUOTE of the material the decision is
about (the task summary from the brief, the plan section under decision,
the failing check output), never a freshly composed summary; a structured
one carries its shape's fields instead (Structured context below). A
human-owned, non-exempt gate REFUSES (exit 1) on empty or
whitespace-only context -- give it real material or omit the flag, never
blank it. The gate context and every question's `context` share one
8192-byte UTF-8 budget; over it, the daemon drops the question contexts,
and the gate context too when it alone is over, loudly, not silently:
the response carries `contextOmitted: true` and one line lands on stderr.
Do not measure or trim a prose context yourself; a structured open
pre-flights instead. Emit labeled options (`{"value": "...", "label": "..."}`)
whenever a site's option values are not already human-readable; the
registry stores every option in that object form. Labels cap at 200
UTF-8 bytes and an oversized label REJECTS the open: middle-truncate a
long path, never alter the value. A question holds at most 4 options:
that is the native form's hard per-question limit, and the daemon
presents the in-pane form only when EVERY question fits it, so one
5-option question sends the whole gate to the background wait queue.
Structure for it: the navigation verbs a site lists (Iterate here, Go
back to a stage, Hold, Abandon) are their own `next` question, never
extra options folded into a decision question; and a selection list
larger than 4 splits into `<id>-1`, `<id>-2`, ... questions of up to 4
options each, in order, whose answers read as one union. Presentation
is the daemon's, by one rule no caller computes; the nudge and origin
ride the same call, so there is nothing to stamp by hand. `rt gate open` remains
the raw primitive underneath; a gated verb never needs it directly.

## Context placement

Three fields carry explanatory text, each a different scope -- pick by
what the text is background for, never by habit:

- Gate-level `--context` (above): background shared by every question in
  this open -- the task summary, the plan section under decision, the
  failing check output.
- A question's own `context` field: setup specific to that one question,
  when the gate opens more than one and they need different framing.
- An option's `description` field: the one-liner rationale for that
  choice -- why, not what (the `label` already says what).

```json
{"value": "redirect:implement", "label": "Redirect to implement", "description": "the failing check points at code, not the plan"}
```

## Structured context (gate-ctx@1)

A context string may carry a JSON object instead of prose, for surfaces
that render it as cards. It is structured when it parses as an object
whose `"gate-ctx"` key names a known shape; anything else takes the prose
path. The key is both the discriminant and the version:

| Shape | Carried by | Required | Optional |
|---|---|---|---|
| `plan@1` | gate `--context` | `reviewer`, `threads.total` | `round`, `threads.blocking` (absent reads 0), `adjudication` (display string) |
| `post@1` | gate `--context` | `reviewer`, `replies` (count) | `round`, `fixes` (`[{"sha": ...}]`) |
| `thread@1` | a thread question's `context` | `author`, `severity`, `claim.summary`, `verdict.call`, `reply.kind`, `reply.text` unless `reply.kind` is `none` | `claim.points` (strings), `verdict.note` |
| `replies@1` | a replies question's `context` | `replies[]`, each `thread`, `file`, `verb`, `text` | `sha` per entry |
| `review@1` | a review-post gate's `--context` | `readiness`, `summary`, `findings` (counts by severity) | `reviewer`, `round`, `re_review` (absent reads false), `prior` (`{addressed, still_open}`, both required) |
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
  `description`. A `replies@1` entry joins its checkbox option by
  `thread` == option value, so list exactly that question's options.
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

## Acting on the response

**`presentation: "form"`.** Present the native in-pane structured form;
it is this gate's registry face (where the launch-injected
AskUserQuestion hook is active, an open gate matching the pane's LAUNCH
subject is what lets the form through, and so is the pane's own
worktree carrying its own open run: gate). Render each
option's `label` when it has one and its `description` when it has one
(the AskUserQuestion option's own description field); submit the chosen
option's `value` verbatim: `rt gate answer <id> --answers '<json>' --by pane` (or the
`gate_answer` tool). When the gate carries more questions than one form
call fits, chunk the forms but submit exactly ONE answer after the last
chunk; a CAS rejection at that point discards every chunk's answer
together.

**`presentation: "wait"`, attended pane** (a human's interactive
non-herdr session; the default for a human-invoked verb): take the plain
in-pane form anyway, despite the stamp. The stamp names what OTHER
surfaces reconcile against, not a command to this pane, and a non-herdr
pane has no herdr PTY to receive the remote-answer Escape that makes the
idle wait safe. Answer exactly as the form branch above.

**`presentation: "wait"`, unattended pane** (spawned, or a herdr pane
whose gate exceeded the form option cap): record the marker when a run
exists (`rt runs field set waiting-gate <id> --stage <stage>`), launch
ONE background `rt gate wait <id>` (the shell tool's run-in-background
mode; the wait is never a tool call), and END THE TURN in one line:
`holding at gate <id>`. The wait loops internally around the daemon
clamp, survives daemon restarts, and exits only on answered or closed,
printing `{"ok":true,"status":"answered","row":{...}}` as its last
stdout. The pane is idle but armed: the wait's completion re-invokes this
pane with the answer as the tool result. On re-invoke, clear the marker
FIRST (`rt runs field set waiting-gate - --stage <stage>`), then read the
answers at `row.answer.answers` and the deciding surface at
`row.answer.by`. `status:"closed"` or a `gate not found` failure is
terminal: clear the marker, end this path cleanly, never invent an
answer, never present a form.

Attendance comes from the invocation context, never from asking: the
spawning surface says so (`--spawned-by`, the run record's `spawned_by`),
and a human-run verb defaults to attended. A human who opens an
unattended pane can interrupt the wait and answer conversationally with
the same `rt gate answer ... --by pane`.

## CAS and the doorbell

If the answer CAS reports an earlier answer, discard your form's answer,
say in the pane in one line which answer won and from where, and proceed
on the recorded one; the rejection payload carries it, no second read
needed. A decision record's `--decided-by` always names the WINNER, never
`pane` when a different surface won.

Answered externally while a form still sits open: the daemon queues the
doorbell and dismisses the form itself (it injects a single Escape into
the gate's pane), so the doorbell arrives as your next input; for a pane
the daemon cannot reach, it queues behind the form until the human
answers or cancels it. The doorbell phrase is a VERIFY-ONLY signal; it
never carries or implies the answer, only "re-read the registry"
(`rt gate wait <id> --timeout 2s`). The surface that recorded the answer
never receives this push. A push for a gate already reconciled is
discarded.

## Closed gates, Hold / Iterate

`closed` means the decision site is abandoned: end that path cleanly per
the verb's own policy. Never invent an answer for a closed gate. Picking
Hold or Iterate is handled IN-PANE by the verb itself, not posted through
the registry as a terminal decision; a verb that re-asks after Hold or
Iterate opens a NEW gate rather than reusing the old one. Marking such
options pane-only (so remote cards render them disabled) rides `meta`,
which only the typed client and raw `rt gate open` carry; `rt gate ask`
and the tool do not.

## Answers are option values

Every answer value must exactly match one of the question's option VALUES
(multi = array, every element checked); the daemon compares values only,
never labels, and rejects anything else at record time. Never an index or
a paraphrase. Nuance rides the per-answer note form:
`{"value": <verbatim value or array>, "note": "<free text>"}`.

## Runs integration

A gated pipeline site publishes its decision on the run's subject and
lets the presentation pick the branch:

1. Bracket the run record: `rt runs field set gate <scope> --stage
   <stage>`.
2. Publish: `rt gate ask --questions '<questions json>' --kind <scope>
   --context '<verbatim quote of the material -- per-site substitution
   point>'`. Include `--context` only when the site has material to
   quote; omit the flag entirely otherwise, never an empty string. No
   `--subject`: the daemon resolves this session's running run. Capture
   `id` and `presentation` from the response in this same call.
3. Act on the response per the branches above (form; wait-but-attended;
   wait-and-unattended).
4. Record at execution time, decider = the surface that answered:

   ```bash
   rt runs decision record --contract gate@1 --scope <scope> \
     --selection '<json>' --decided-by <row.answer.by>
   ```

   (`--decided-by` is `pane`, `board`, `console`, or `shepherd`, never a
   verb name.)

## Daemon down (either mode)

`rt gate ask` failing with a daemon-unreachable error means form-only
in-pane, exactly the pre-facility behavior: attended sites present the
form and act on its answer, recording `--decided-by pane`, with no
`gate ask` / `wait` / `answer` calls at all; unattended sites fail the
stage rather than presenting a form. A refusal that names a subject or
question problem is not daemon-down: fix the call.

## Red flags

| Thought | Reality |
|---|---|
| "I'll compute presentation / build --origin / branch on HERDR_ENV myself" | The daemon owns the ceremony. `rt gate ask` returns the presentation; act on it. |
| "The CAS lost, I'll resubmit the form's answer anyway" | The rejection already carries the winner. Discard the form's answer and proceed on the recorded one. |
| "The doorbell push tells me what they picked" | It's verify-only. It never carries or implies the answer -- go read the registry. |
| "A closed gate means I should ask again" | `closed` means the decision site is abandoned. End that path per the verb's own policy; never invent an answer, never re-ask on your own initiative. |
| "I'll submit each form chunk's answer as it completes" | One `gate answer` after the LAST chunk; a CAS rejection there discards all of them together. |
| "`--decided-by` is whoever just submitted the form" | It names the CAS WINNER, which may be a different surface than the one that just submitted. |
| "I'll ask the human whether this pane is attended" | Attendance comes from the invocation context (`--spawned-by`), never asked. |
| "I'll run the wait as a tool call" | The wait is `rt gate wait` as background bash, ending the turn; a synchronous tool call cannot park the pane. |
