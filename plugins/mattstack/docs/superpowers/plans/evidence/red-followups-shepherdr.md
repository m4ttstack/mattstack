# RED/GREEN evidence: shepherdr scope-redirect prose ask becomes a form

Task 7 of the engine follow-ups plan. One fixture, run RED (old text) then
GREEN (new text), through a fresh subagent with no tools each time. Harness
lines used for every run: "Do not run any tools; reply only. Address the
user generically as 'you'. Do not add options beyond what the gate text
names. If a form is called for, write its one sentence of context and then
the questions and options exactly as the tool would take them; do not
narrate calling a tool. You have no AskUserQuestion tool in this
environment; render the form as text."

Scenario: The user said "Actually, drop the caching work and focus on the
migration." Two agents are running.

## RED: mid-flight changes (old text)

Old text: "If the user redirects scope: ask whether to let running agents
finish or kill them. Before any kill, `herd-job.py --db <db> <job>
--status closed`, then `scripts/hrd pane close <pane-id>`; respawn with
updated briefs."

Reply, verbatim:

> Understood.
>
> Two agents are currently running the caching work. Before dropping it, I
> need one decision from you.
>
> **Running agents: finish or kill?**
> Context: your engine's mid-flight rule requires an explicit choice here
> before I touch anything. If killed, each agent's job gets closed
> (`herd-job.py --status closed`) and its pane closed, then I respawn
> fresh agents with migration-focused briefs.
>
> 1. **Let them finish** - the two running agents complete the caching
>    work already in flight, and I hold the migration work until they're
>    done.
> 2. **Kill them now** - close both jobs and panes immediately, then
>    respawn with updated briefs focused on the migration.

**Verdict: PASS (RED).** Prose: an opening acknowledgement, a paragraph of
context, then an ad hoc enumeration of the two choices the old text names.
No structured-question rendering, no Hold option, no bare option labels.

## GREEN, attempt 1: mid-flight changes (new text)

New text: "If the user redirects scope: one sentence naming the running
agents, then the structured-question tool with **Let them finish**
(recommended) / **Kill and respawn with the new briefs**; **Hold**. Before
any kill, `herd-job.py --db <db> <job> --status closed`, then `scripts/hrd
pane close <pane-id>`; respawn with updated briefs."

Reply, verbatim (one em dash normalized to `--`):

> Two agents are currently running (the caching work).
>
> Before killing anything, I need a decision from you.
>
> **Scope change: drop caching, focus on migration**
>
> - [ ] **Let them finish** (recommended) -- the two running agents
>   complete their current caching work, then I redirect to migration
>   work after (dash normalized)
> - [ ] **Kill and respawn with the new briefs** -- I close their jobs and
>   panes now, then respawn fresh agents briefed on the migration work
>   (dash normalized)
> - [ ] **Hold** -- pause here, no action yet (dash normalized)

**Verdict: FAIL.** Two sentences of context before the form (the reply
opens with the agent count, then a second sentence saying a decision is
needed) where the new text calls for one; the form also carries a restated
heading and a per-option description the gate text does not name.

Remedy: one row added to shepherdr's existing "red flags -- stop yourself"
section:

> - About to restate the scope change as a heading and add a sentence
>   explaining each option on the mid-flight form? Stop. One sentence
>   naming the running agents, then the bare three options the text names
>   -- no restated heading, no per-option description.

## GREEN, attempt 2 (rerun): mid-flight changes (new text plus red-flag row)

Same scenario, rerun with the new mid-flight text and the new red-flags
row both in view (approximating what an agent reading the full engine file
sees).

Reply, verbatim:

> Two agents are running.
>
> **Let them finish** (recommended) / **Kill and respawn with the new
> briefs** / **Hold**

**Verdict: PASS (GREEN).** One sentence naming the running agents, then a
form with exactly the three options the new text names: Let them finish
(recommended), Kill and respawn with the new briefs, Hold.

## Summary

| Run | Verdict |
|-----|---------|
| RED (shepherdr) | PASS -- prose ask |
| GREEN attempt 1 (shepherdr) | FAIL -- restated heading, per-option descriptions |
| GREEN attempt 2 (shepherdr, rerun) | PASS -- one sentence, exact three options |
