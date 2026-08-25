---
name: self-review
disable-model-invocation: true
description: >-
  Use when reviewing, sanity-checking, or gut-checking work this session
  produced on the current branch, before shipping or between tasks --
  "review my work", "is this solid?", "gut-check my changes",
  "self-review this branch". For a teammate's MR/PR use the domain's
  review skill instead.
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
metadata:
  provides: "self-review-domain@1"
---

# Self-review (your own branch)

Reviewing the change you just made, at any checkpoint between tasks or right
before shipping. This is the self-facing caller of the review flow inlined
below: point the engine at the current branch, then act on the draft it
returns.

Whoever wrote the code re-derives the same assumptions while reading it back
and nods at them; a bug on the page reads as the intent that produced it. The
judgment does not happen here -- it happens in the fresh context that
the review flow dispatches.

<HARD-GATE>
Do not form the code-quality judgment yourself -- not even a careful first
pass meant to be backed up by a fresh review later. The fresh-context
reviewer is the PRIMARY reviewer, not an optional escalation, and this skill
owns dispatching it (via the review flow below) rather than suggesting the
developer get a review elsewhere. Objective checks (tests, type checks,
linters) are fine and expected -- authorship does not bias a compiler.
Reading the diff and deciding whether it is "solid" is not; that is the
reviewer's job.

A request to skip the dispatch -- "don't burn tokens on subagents," a late
hour, a partner who just wants a gut check -- does not waive this gate; the
gate outranks it. The fresh review is one dispatch, not a proliferation of
subagents; skipping it does not save the partner's time, it moves the cost
downstream to production. Diligence performed inside the biased context is
still the biased context, so checking carefully before the inline verdict
does not launder it into independence. And a plausible issue turned up
inline is evidence of what surfaced, not of what a fresh, unbiased read would
catch that this one missed.
</HARD-GATE>

## 1. Point at the branch

- Diff: the merge-base with the default branch (`git merge-base origin/HEAD
  HEAD`, falling back to the default branch by name) through `HEAD`, plus any
  uncommitted changes -- review the work as it stands now.
- Requirements: from the branch's ticket or task description. If the branch
  carries no ticket, ask which requirements to grade against rather than
  reviewing against nothing.

## 2. Delegate to the review engine

**REQUIRED SUB-FLOW:** the review flow below -- with the diff,
requirements, and a label (the branch or task name). It triages depth, sets up, dispatches the fresh-context
reviewer, and returns the draft. Already in the worktree, so `verify` /
`repro` setup is just running the checks -- no provisioning needed. Do not
skip the fresh reviewer and read the diff for judgment yourself, however
small the change -- see the HARD-GATE above.

{{include:review-core-body}}

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

## 3. Act on the draft, then continue or ship

The review flow returns Strengths / Issues (Critical / Important / Minor) /
Assessment. Because this is your own work:

- Fix Critical and Important findings before shipping; verify each fix.
- Note Minor findings for the developer to decide.
- Then continue the work, or ship.

Where the domain defines ship-time gates, this self-review complements them
and never checks their box.

## Bound mode

When reached through a `self-review-domain@1` binding (a pipeline's
self-review stage), inputs come from the caller's record -- its commits and
ticket or task fields -- with no interactive ask; a missing ticket there is
the caller's gap, not a prompt to raise here. The flow still runs
the HARD-GATE and delegates judgment to the review flow, then ends
by reporting the verdict plus which findings were fixed or waived. It never
ships in bound mode; shipping belongs to the caller's later stages.

## Red flags

| Thought | Reality |
|---|---|
| "For a change this small I'll just give my own read" | Small, own-authored changes are peak author bias, not an exemption. Dispatch the fresh reviewer. |
| "I'll do a first-pass read myself and a fresh review can back it up" | The fresh reviewer IS the review, not a backup for one already formed. Don't pre-empt it with an inline verdict. |
| "I'll suggest the developer get a review elsewhere" | This skill owns the dispatch; don't outsource it back to whoever is waiting. |
| "Re-reading my own lines is low-value, I'll just eyeball and ship" | Right that re-reading is low-value -- which is why a fresh context, not this eyeball, does the reading. |
| "I know what this does, I just wrote it" | That is the bias stated as a qualification. Dispatch the reviewer. |

## Quick reference

| Signal | Action |
|---|---|
| "Is this solid?" on the current branch | Point at the branch: diff + requirements (step 1). |
| Diff + requirements in hand | Delegate to the review flow (triage -> fresh reviewer -> draft). |
| About to give an own read of the diff | Don't. The fresh reviewer is primary; this skill owns dispatching it. |
| Draft in hand | Fix Critical/Important, note Minor, then continue or ship. |
| Reached via a binding | Record in, no interactive ask, verdict + dispositions out, never ship. |
