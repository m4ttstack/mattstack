# RED/GREEN evidence: self-review clarify gate

Task 8 of the engine follow-ups plan. One fixture, run RED (old text) then
GREEN (new text), through a fresh subagent with no tools. Harness lines
used for both runs: "Do not run any tools; reply only. Address the user
generically as 'you'. Do not add options beyond what the gate text names.
If a form is called for, write its one sentence of context and then the
questions and options exactly as the tool would take them; do not narrate
calling a tool. You have no AskUserQuestion tool in this environment;
render the form as text."

Scenario (both runs): The branch is `fix-flaky-timeouts`, no ticket id;
the task description in the conversation says "stabilize the timeout
tests".

## RED: self-review's `- Requirements:` bullet (old text)

Bullet given to the fixture:

> - Requirements: from the branch's ticket or task description. If the
>   branch carries no ticket, gate `clarify`: one sentence, then the
>   structured-question tool with the candidate sources (the task as
>   stated, a linked doc, their text) rather than reviewing against
>   nothing.

Reply, verbatim:

> No ticket is linked to this branch, so before reviewing I need to
> confirm what requirements to hold the change against.
>
> One sentence: `fix-flaky-timeouts` carries no ticket id, so I'm asking
> you which requirements source to review against before proceeding.
>
> **Question:** Which source should the review use as the requirements
> baseline?
>
> - The task as stated ("stabilize the timeout tests")
> - A linked doc
> - Your text (you provide requirements directly)

**Verdict: PASS (RED).** The form lists the three candidate sources but
carries no Hold option, matching the expected pre-fix behavior.

## GREEN: self-review's `- Requirements:` bullet (new text)

Bullet given to the fixture:

> - Requirements: from the branch's ticket or task description. If the
>   branch carries no ticket, gate `clarify` (`rt runs field set gate
>   clarify --stage <stage>` before, `rt runs decision record --contract
>   gate@1 --scope clarify --selection '{"source":"<picked>"}'
>   --decided-by self-review` after): one sentence, then the
>   structured-question tool with the candidate sources (the task as
>   stated, a linked doc, their text, and **Hold**) rather than reviewing
>   against nothing.

Reply, verbatim:

> Branch `fix-flaky-timeouts` carries no ticket, so requirements review
> needs a picked source rather than nothing to review against.
>
> **What should requirements review use as the source of truth for this
> branch?**
>
> 1. The task as stated: "stabilize the timeout tests"
> 2. A linked doc (you provide the link)
> 3. Their text (you provide the requirements directly)
> 4. Hold

**Verdict: PASS (GREEN).** One sentence of context, then a form with the
three candidate sources, their text, and Hold. No rationalization row was
needed; the fixture passed on the first GREEN run.
