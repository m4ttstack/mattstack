---
name: gate-protocol
description: "Use when a gated pane or wrapper needs to publish a human decision point and carry it to an answer -- opening the daemon's gate registry, presenting the in-pane form, blocking in gate wait, handling a CAS rejection, or reconciling a doorbell push. Not for direct invocation; a gated verb includes this part."
disable-model-invocation: true
---

# Gate protocol

One shared protocol for any gated pane or wrapper: publish first, then branch
on attendance. The daemon's gate registry (`rt gate ...`) is the single
arbiter; no per-verb conflict logic belongs anywhere downstream of it.

## Publish

Open before anything that depends on the answer: `rt gate open --subject <s>
--kind <k> --questions <json> [--meta <json>] [--agent <id>] [--pane <id>]
[--nudge <spec>] [--context <text>] [--origin <json>]`. Opening on a
subject that already carries an open gate of the same kind supersedes the
old one, so a relaunch after a crash is safe without a separate cleanup
step. Check ## Presentation first -- a herdr pane's form-vs-wait split
overrides attendance -- then branch on attendance below for everything
else.

## Attendance

Attendance comes from the invocation context, never from asking: the
spawning surface says so (`--spawned-by`), and a human-run verb defaults to
attended.

## Presentation

Herdr panes are form-first: when `HERDR_ENV` is set (non-empty) and every
question fits the native form tool's per-question option cap (4 options),
the gate opens with `presentation: "form"` and the pane presents the form
regardless of attendance -- a human can focus in from any surface and
answer it, and an unattended pane blocks on its form harmlessly until some
surface answers. Every other gate opens with `presentation: "wait"`: a
non-herdr pane lands here for every question shape, attended or not; a
herdr pane lands here only when a question exceeds the cap. That stamp
names what OTHER surfaces reconcile against, not a command to THIS pane --
an ATTENDED non-herdr pane still takes step 3's plain form despite it,
because it has no herdr PTY to receive the remote-answer Escape that makes
the idle wait safe. The idle wait (step 4 below) is for an UNATTENDED
pane, or for a herdr pane whose gate exceeded the cap; attendance is the
same signal as everywhere else in this file (`--spawned-by` /
`SPAWNED_BY`).

The nudge follows PRESENTATION, not attendance: every form-presentation
open passes `--nudge` with this pane's own session id; a wait-presentation
open never does -- delivery there is the wait's own completion for a pane
that takes it, or CAS-on-submit reconciliation for an attended non-herdr
pane that takes the form despite the stamp. The daemon completes a
remotely answered form by queueing the doorbell and then injecting a
single Escape into the pane named by `origin.paneId`.

## Attended (a human's interactive session; default for a human-invoked verb)

1. Present the normal in-pane structured form -- the in-pane experience does
   not change. When the gate carries more questions than one form call fits,
   chunk the forms, but submit exactly ONE `rt gate answer <id> --answers
   <json> --by pane` after the last chunk. A CAS rejection at that point
   discards every chunk's answer together, not just the last one.
2. Form answered: `rt gate answer <id> --answers <json> --by pane`. If the
   CAS reports an earlier answer, discard the form's answer, say in the pane
   in one line which answer won and from where, and proceed on the recorded
   one -- the rejection payload carries it, no second read needed. A
   decision record's `--decided-by` always names the WINNER, never `pane`
   when a different surface won.
3. Answered externally while the form still sits open: the doorbell push
   queues behind the form and arrives once the human answers or cancels it.
   Either way the verb's next step is the same registry verify, and it
   proceeds on the recorded answer. The doorbell phrase is a VERIFY-ONLY
   signal -- it never carries or implies the answer, only "re-read the
   registry." A push for a gate already reconciled is discarded.

## Unattended (spawned, or a herdr pane over the option cap)

Spawned by a herd, a board launch, or any `--spawned-by` surface; per
## Presentation, this also covers an attended herdr pane whose gate
exceeded the option cap.

1. Wait-presentation gates only (see ## Presentation -- a herdr pane under
   the option cap gets a form instead regardless of attendance, and an
   ATTENDED non-herdr pane keeps that same form despite its wait stamp;
   this step fires for any unattended pane, and for an attended herdr
   pane whose gate exceeded the cap): record the `waiting-gate` marker
   when a run exists (`rt runs field set waiting-gate <id> --stage
   <stage>`), launch ONE background `rt gate wait <id>` (the shell
   tool's run-in-background mode), and END THE TURN -- exactly Runs
   integration step 4. Never block foreground; the wait's completion
   re-invokes this pane with the answer as the tool result.
2. `closed` means the decision site is abandoned: end that path cleanly per
   the verb's own policy. Never invent an answer for a closed gate.
3. A human who opens the pane can interrupt the wait and answer
   conversationally: `rt gate answer <id> --answers <json> --by pane`. A CAS
   rejection here is handled exactly as the attended branch: discard, say
   which answer won and from where, proceed on the recorded one.

## Daemon down (either mode)

Form-only in-pane, exactly the pre-facility behavior: present the form, act
on its answer, no `gate open` / `wait` / `answer` calls at all.

## Strict option membership + note form

Every answer value must exactly match one of the question's option VALUES
(multi = array, every element checked); the daemon compares values only,
never labels, and rejects anything else at record time. A bare option
string is its own value; a labeled option (`{"value": ..., "label": ...}`)
renders its `label` in the row but answers with its `value`, never its
`label`. Never an index or a paraphrase. Nuance rides the per-answer note
form: `{"value": <verbatim value or array>, "note": "<free text>"}`.

## Hold / Iterate are pane-semantic

Picking Hold or Iterate is handled IN-PANE by the verb itself, not posted
through the registry as a terminal decision. A consumed (answered) gate is
terminal; a verb that re-asks after Hold or Iterate opens a NEW gate rather
than reusing the old one. Openers may mark such options pane-only via `meta`
so remote cards (board, console) render them disabled.

## Runs integration

A gated pipeline site publishes its decision on the run's subject and lets
attendance pick the branch. Each tool call is a fresh shell: capture values
in the same call that uses them.

1. **Read the run identity once** (id and attendance from the run record):

   ```bash
   SNAP=$(rt runs snapshot)   # reads RT_RUN_DB; {"run":{...},"stages":[...],...}
   RUN_ID=$(printf '%s' "$SNAP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run"]["id"])')
   SPAWNED_BY=$(printf '%s' "$SNAP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run"].get("spawned_by") or "")')
   ```

   **Attendance rule:** unattended iff `SPAWNED_BY` is non-empty; attended
   otherwise. Every site uses this test and no other.

2. **Bracket and publish.** Keep the run-record bracket, then open the
   gate. Guard first: an empty `$RUN_ID` must never reach `gate open` (an
   empty id mints a junk `run:` subject the daemon accepts) -- treat it as
   the daemon-down fallback in step 6. Compute presentation with the
   canonical snippet below -- form iff `$HERDR_ENV` is non-empty AND every
   question's option list is 4 or fewer, else wait -- then stamp origin and
   context. `$CONTEXT` is a VERBATIM QUOTE of the material the decision is
   about (the task summary from the brief, the plan section under
   decision, the failing check output), never a freshly composed summary;
   assign it at the marked substitution point below. Emit labeled options
   (`{"value": "...", "label": "..."}`) whenever a site's option values
   are not already human-readable; labels cap at 200 UTF-8 bytes --
   middle-truncate a long path, never alter the value.

   The open runs ONLY inside the non-empty branch; the empty branch stops
   this recipe and takes step 6's fallback. The nudge is a real branch on
   `$GATE_PRESENTATION`, never both comments on one unconditional call --
   a wait-presentation open must genuinely omit `--nudge`. `--context` is
   the same kind of real branch: the snippet measures `$CONTEXT` with
   `LC_ALL=C wc -c` and structurally omits the flag when it is unset or
   over 8192 bytes -- never pass an empty `--context ""`.

   ```bash
   QUESTIONS='<questions json>'
   CONTEXT='<verbatim quote of the material -- per-site substitution point>'
   MAX_OPTS=$(printf '%s' "$QUESTIONS" | python3 -c 'import json,sys; qs=json.load(sys.stdin); print(max((len(q.get("options", [])) for q in qs), default=0))')
   if [ -n "$HERDR_ENV" ] && [ "$MAX_OPTS" -le 4 ]; then
     export GATE_PRESENTATION=form
   else
     export GATE_PRESENTATION=wait
   fi
   rt runs field set gate <scope> --stage <stage>
   if [ -z "$RUN_ID" ]; then
     echo "gate site: no run id; not opening a run: gate. STOP: take step 6's fallback." >&2
   else
     ORIGIN=$(python3 - "$RUN_ID" <<'EOF'
import json, os, sys
o = {"runId": sys.argv[1], "worktree": os.getcwd(),
     "presentation": os.environ.get("GATE_PRESENTATION", "wait")}
pane = os.environ.get("HERDR_PANE_ID")
if pane:
    o["paneId"] = pane
print(json.dumps(o))
EOF
)
     CONTEXT_BYTES=$(printf '%s' "$CONTEXT" | LC_ALL=C wc -c | tr -d ' ')
     CONTEXT_ARGS=()
     if [ -n "$CONTEXT" ] && [ "$CONTEXT_BYTES" -le 8192 ]; then
       CONTEXT_ARGS=(--context "$CONTEXT")
     fi
     if [ "$GATE_PRESENTATION" = form ]; then
       GATE=$(rt gate open --subject "run:$RUN_ID" --kind <scope> --questions "$QUESTIONS" \
         "${CONTEXT_ARGS[@]}" --origin "$ORIGIN" \
         --nudge "{\"session\":\"$CLAUDE_CODE_SESSION_ID\"}")
     else
       GATE=$(rt gate open --subject "run:$RUN_ID" --kind <scope> --questions "$QUESTIONS" \
         "${CONTEXT_ARGS[@]}" --origin "$ORIGIN")
     fi
     GATE_ID=$(printf '%s' "$GATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
   fi
   printf '%s %s\n' "${GATE_ID:-}" "$GATE_PRESENTATION"
   ```

   The final `printf` is deliberate: `$GATE_ID` and `$GATE_PRESENTATION`
   must survive into the fresh shells steps 3 and 4 run in, and this is
   the only line whose stdout carries them there -- do not drop it.

3. **Form presentation (`$GATE_PRESENTATION = form`), and any ATTENDED
   non-herdr pane regardless of the stamp:** present the site's question
   as the structured in-pane form -- unchanged for a human-run non-herdr
   pane even when its gate opened with `presentation: "wait"` (it has no
   herdr PTY for the idle wait's Escape delivery, so it never takes step
   4), and the form-first default for any herdr pane under the cap per
   the Presentation section above. Render each option's `label` when it
   has one; submit the chosen option's `value` verbatim. Record the
   form's choice: `rt gate answer
   "$GATE_ID" --answers '<json>' --by pane`. A CAS rejection means another
   surface answered first -- say which answer won and proceed on the
   recorded one. If the doorbell arrived while the form sat, the next step
   is the same registry verify either way.

   Doorbell priming: a message saying this gate was answered elsewhere is
   a recognized signal whose ONLY action is a verifying registry read
   (`rt gate wait "$GATE_ID" --timeout 2s`); it never carries or implies
   the answer. If your pending form is dismissed under you, the queued
   doorbell arrives as your next input -- verify and proceed on the
   recorded answer.

4. **Wait presentation (`$GATE_PRESENTATION = wait`), UNATTENDED panes and
   over-cap herdr panes only** (an attended non-herdr pane took step 3
   instead and never reaches here): record the marker, arm the wait, END
   THE TURN.

   ```bash
   rt runs field set waiting-gate "$GATE_ID" --stage <stage>
   ```

   Launch ONE background shell command (the shell tool's run-in-background
   mode) running `rt gate wait "$GATE_ID"` -- the unbounded form loops
   internally around the daemon clamp and survives daemon restarts, so it
   exits only on answered or closed, printing
   `{"ok":true,"status":"answered","row":{...}}` as its last stdout. Then
   end the turn in one line: `holding at gate $GATE_ID`. The pane is idle
   but armed: typed input lands instantly, and the wait's completion
   re-invokes this pane with the answer as the tool result. On re-invoke,
   clear the marker FIRST (`rt runs field set waiting-gate - --stage
   <stage>`), then read the answers at `row.answer.answers` and the
   deciding surface at `row.answer.by`. `status:"closed"` or a
   `gate not found` failure is terminal: clear the marker, end this path
   cleanly, never invent an answer, never present a form.

5. **Record at execution time**, decider = the surface that answered:

   ```bash
   rt runs decision record --contract gate@1 --scope <scope> \
     --selection '<json>' --decided-by <row.answer.by>
   ```

   (`--decided-by` is `pane`, `board`, `console`, or `shepherd` -- never a
   verb name.)

6. **Daemon down** (gate open fails): attended sites fall back to the
   unchanged in-pane form alone, recording `--decided-by pane`; unattended
   sites fail the stage rather than presenting a form.

## Red flags

| Thought | Reality |
|---|---|
| "The CAS lost, I'll resubmit the form's answer anyway" | The rejection already carries the winner. Discard the form's answer and proceed on the recorded one. |
| "The doorbell push tells me what they picked" | It's verify-only. It never carries or implies the answer -- go read the registry. |
| "A closed gate means I should ask again" | `closed` means the decision site is abandoned. End that path per the verb's own policy; never invent an answer, never re-ask on your own initiative. |
| "I'll submit each form chunk's answer as it completes" | One `gate answer` after the LAST chunk, not one per chunk; a CAS rejection there discards all of them together. |
| "`--decided-by` is whoever just submitted the form" | It names the CAS WINNER, which may be a different surface than the one that just submitted. |
| "I'll ask the human whether this pane is attended" | Attendance comes from the invocation context (`--spawned-by`), never asked. |

## Quick reference

| Situation | Action |
|---|---|
| Any gated verb, before anything else | `rt gate open ...` |
| Form presentation, form answered | `rt gate answer <id> --answers <json> --by pane` |
| Form presentation, CAS rejected | Discard the form's answer, say who won, proceed on the recorded answer |
| Form presentation, doorbell arrives mid-form | Let it queue; verify against the registry after the form resolves |
| Wait presentation AND (unattended OR herdr over-cap), waiting on the answer | Set the `waiting-gate` marker, launch ONE background `rt gate wait <id>`, end the turn; act on the answer at re-invoke |
| Wait presentation but an ATTENDED non-herdr pane | Take the form row above despite the wait stamp; never enter the wait |
| Wait presentation, wait returns `closed` | Clear the marker, end that path per the verb's own policy; never invent an answer |
| Daemon unreachable | Form-only, no gate calls |
| Hold or Iterate chosen | Handle in-pane; a re-ask opens a NEW gate |
