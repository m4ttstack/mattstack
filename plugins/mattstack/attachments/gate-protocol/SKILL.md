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
[--nudge <spec>]`. Opening on a subject that already carries an open gate of
the same kind supersedes the old one, so a relaunch after a crash is safe
without a separate cleanup step. After open, branch on attendance below.

## Attendance

Attendance comes from the invocation context, never from asking: the
spawning surface says so (`--spawned-by`), and a human-run verb defaults to
attended.

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

## Unattended (spawned by a herd, a board launch, or any `--spawned-by` surface)

1. No form. Block in `rt gate wait <id>`; the answer returns as the tool
   result.
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

Every answer value must be one of the question's option strings VERBATIM
(multi = array, every element checked); the daemon rejects anything else at
record time. Render options in the row's order and submit the chosen
option's text verbatim, never an index or a paraphrase. Nuance rides the
per-answer note form: `{"value": <verbatim option or array>, "note": "<free
text>"}`.

## Hold / Iterate are pane-semantic

Picking Hold or Iterate is handled IN-PANE by the verb itself, not posted
through the registry as a terminal decision. A consumed (answered) gate is
terminal; a verb that re-asks after Hold or Iterate opens a NEW gate rather
than reusing the old one. Openers may mark such options pane-only via `meta`
so remote cards (board, console) render them disabled.

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
| Attended, form answered | `rt gate answer <id> --answers <json> --by pane` |
| Attended, CAS rejected | Discard the form's answer, say who won, proceed on the recorded answer |
| Attended, doorbell arrives mid-form | Let it queue; verify against the registry after the form resolves |
| Unattended, waiting on the answer | `rt gate wait <id>`; act on the returned result |
| Unattended, wait returns `closed` | End that path per the verb's own policy; never invent an answer |
| Daemon unreachable | Form-only, no gate calls |
| Hold or Iterate chosen | Handle in-pane; a re-ask opens a NEW gate |
