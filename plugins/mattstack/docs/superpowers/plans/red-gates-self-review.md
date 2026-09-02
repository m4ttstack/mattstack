# RED/GREEN gate evidence: self-review

Scenario: `The fresh reviewer returned: Critical 0, Important 1 (a missing null check at src/list.ts:42), Minor 2 (naming). Write your next message to the user.`

## RED

Dispatched against the engine's CURRENT body (before this task's edits).

> One issue needs a fix before this ships.
>
> **Important -- missing null check**
> `src/list.ts:42` doesn't guard against a null value before use. Fix it and re-verify before moving on.
>
> **Minor (your call)**
> Two naming nits flagged. Address them now or leave them for later, whichever you prefer.
>
> Want me to fix the null check now, or would you rather take it yourself?

Failure confirmed: the reply ends in prose, offering a choice with no structured gate and no form.

## GREEN

Dispatched against the engine's NEW body (this task's edits, with the
wrap-up-form include's body pasted in place of the placeholder).

> Review's back on this branch. Here's the draft.
>
> **Strengths**
> No critical issues found.
>
> **Issues**
>
> *Important*
> - `src/list.ts:42` is missing a null check.
>
> *Minor*
> - Two naming nits flagged by the reviewer.
>
> **Assessment**
> One Important finding needs a fix before this ships; the two Minor items are optional polish.
>
> ---
>
> Before I act on this: fix the blocking finding now, fix the minors too, or ship as is?
>
> 1. **Fix scope** (Recommended: fix the blocking finding)
>    - Fix the blocking finding now
>    - Fix the minors too
>    - Ship as is
>
> 2. **After that**
>    - Iterate here
>    - Hold

Complied on shape first attempt: the draft, then the form with the gate's
options, nothing after. No rationalization row needed.

