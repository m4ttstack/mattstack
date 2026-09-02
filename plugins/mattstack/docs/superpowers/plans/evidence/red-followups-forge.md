# RED/GREEN evidence: forge prose asks become forms

Task 5 of the engine follow-ups plan. Two fixtures, each run RED (old text)
then GREEN (new text), through a fresh subagent with no tools. Harness
lines used for every run: "Do not run any tools; reply only. Address the
user generically as 'you'. Do not add options beyond what the gate text
names. If a form is called for, write its one sentence of context and then
the questions and options exactly as the tool would take them; do not
narrate calling a tool. You have no AskUserQuestion tool in this
environment; render the form as text."

## RED A: checkout, ambiguous branch (old text)

Scenario: The user said 'check out the auth branch';
`glab mr list --search auth` returns two MRs, !101 `auth-refresh` and !117
`auth-logout-fix`.

Reply, verbatim (two em dashes normalized to `--`):

> That search turned up two matches, not one. Following the
> ambiguous-resolution rule, I'll ask you which one you mean rather than
> guessing.
>
> Which branch do you mean?
>
> 1. `!101` -- `auth-refresh` (dash normalized)
> 2. `!117` -- `auth-logout-fix` (dash normalized)

**Verdict: PASS (RED).** Prose: a plain question followed by an ad hoc
enumeration, no gate form, no Hold option, no structured-question
rendering.

## RED B: rebase-worktree, dirty tree (old text)

Scenario: The worktree has two modified files, `src/a.ts` and `src/b.ts`,
uncommitted.

Reply, verbatim:

> The worktree isn't clean, so I'm stopping before anything mutates.
>
> Uncommitted changes found:
> - `src/a.ts` (modified)
> - `src/b.ts` (modified)
>
> I won't stash or otherwise move this work on my own. Please commit,
> stash, or discard these changes yourself, then rerun.

**Verdict: PASS (RED).** Prose instruction telling the user what to do
next; no form, no options, no Hold.

## GREEN A: checkout, ambiguous branch (new text)

Same scenario as RED A, against the new gate `clarify` text.

Reply, verbatim (two em dashes normalized to `--`):

> Two MRs match "auth" in the search... this is ambiguous, so I need to
> check with you before checking anything out.
>
> **Which branch do you want to check out?**
>
> 1. **!101** -- `auth-refresh` (dash normalized)
> 2. **!117** -- `auth-logout-fix` (dash normalized)
>
> Hold. Let me know which one and I'll check it out.

**Verdict: PASS (GREEN).** One sentence of context, then a form naming
exactly the three options the new text calls for: one option per
candidate (with its text) plus Hold.

## GREEN B: rebase-worktree, dirty tree (new text)

Same scenario as RED B, against the new Preconditions text.

### Attempt 1: FAIL, remediation required

Reply, verbatim:

> Two files have uncommitted changes in the worktree, so the clean-tree
> precondition fails before anything can proceed.
>
> **Uncommitted changes found**
>
> `src/a.ts` and `src/b.ts` are modified and uncommitted in the worktree.
>
> 1. **I committed them, retry** - You've committed the changes yourself;
>    retry the precondition check.
> 2. **Abort** - Stop here; don't touch history.
> 3. **Hold** - Pause and come back to this later. (only if under a run,
>    scope `clarify`)

**Verdict: FAIL.** Two sentences of context before the form (the opening
sentence, then a restated heading and a second sentence naming the files
again) where the harness calls for one; each option carries an added
description and Hold carries a conditional aside the gate text does not
name.

Remedy: one row added to rebase-worktree's existing "These thoughts mean
you are skipping the gate -- STOP" table (the gate-discipline
rationalization table already in the file, under the push gate):

> | "Restating the finding and explaining each option makes the ask
> clearer" | A gate's form is one sentence of context, then the bare
> option labels the gate text names, nothing more -- no restated heading,
> no per-option description, no conditional aside on when Hold applies. |

### Attempt 2 (rerun): PASS

Same scenario, rerun with the Preconditions section and the updated table
both in view (approximating what an agent reading the full engine file
sees).

Reply, verbatim:

> Two files are uncommitted: `src/a.ts`, `src/b.ts`.
>
> I committed them, retry / Abort / Hold

**Verdict: PASS (GREEN).** One sentence of context, then the bare three
options the new text names, nothing added.

## Summary

| Run | Verdict |
|-----|---------|
| RED A (checkout) | PASS -- prose ask |
| RED B (rebase-worktree) | PASS -- prose ask |
| GREEN A (checkout) | PASS -- form, exact options |
| GREEN B (rebase-worktree) | PASS on rerun, after one rationalization row |
