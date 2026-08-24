---
name: review-core
description: >-
  Use when a resolved change needs a structured review -- a caller holds a
  diff or branch plus its requirements and wants a severity-bucketed
  draft. Invoked by the self-review flow for your own branch and by
  domain review callers for a teammate's MR/PR; not usually invoked
  directly.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "criteria"
  slot-criteria: "optional review-criteria@1 -- the domain's review standards: extra depth-triage lines plus an addendum template appended to the fresh-context reviewer or adjudicator prompt"
---

# Review core

Size the change, set up to that depth, dispatch the judgment to a fresh
context, return a draft. The caller resolved the target and owns what
follows.

## Caller inputs

- The diff source, already confirmed to resolve. With no named base: the
  branch point (`git merge-base origin/HEAD HEAD`, falling back to the
  default branch by name), plus uncommitted changes for own-branch flows.
- The requirements, from the ticket or task description.
- A human-readable label for the change.

Take these as given: never re-resolve, never fabricate. An absent,
unreadable, or mismatched input is the draft's first finding. The checkout
is the caller's job; run checks in the one you are handed.

## 1. Commit to a review depth

<HARD-GATE>
Print this block in visible output before any setup: before a test runs, a
checkout is touched, or the diff is read. A commitment, not reasoning. Only
step 2's resolver call precedes it, since it supplies the provider lines.
</HARD-GATE>

> REVIEW DEPTH: read | verify | repro -- \<one-line reason\>
> EVIDENCE CHECK: screenshot | data-shape | none -- \<why\>
> \<provider triage lines, when the criteria slot is bound\>

- **read** -- diff only, no build or run: small, self-contained, or
  pure-logic changes with clear requirements.
- **verify** -- the project's tests and checks against the checkout, then
  review: moderate changes.
- **repro** -- also run the change and capture before/after evidence with
  the project's tooling, compared against what the MR/PR attached:
  significant or user-visible changes.

EVIDENCE CHECK: `screenshot` if a user can see the change, `data-shape` for
a backend-only change, `none` only when there is no runtime surface.

The tier is a recommendation: the developer can raise or lower it, against
a printed tier rather than a silent one.

## 2. Resolve the `criteria` slot

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
```

Nonzero exit: print `errors` verbatim and stop.

**Unbound** (`resolved.criteria.binding` is `null`): no triage lines, no
addendum.

**Bound**: read the SKILL.md at `resolved.criteria.path`. Evaluate each
triage line it declares (`NAME: <values> -- <observable predicate>`) and
print the resolved line in the block. Its addendum goes to step 4 with two
placeholders filled -- `{TRIAGE_FLAGS}` (those values), `{SETUP_OBSERVATIONS}`
(step 3's observations, or `none`) -- everything else verbatim.

## 3. Set up for the depth

Run what the chosen depth defines. Record commands, output, values seen,
evidence compared: observations feed the dispatch and the draft, so a check
with no recorded result was not run.

## 4. Dispatch the review

**REQUIRED SUB-FLOW:** the review-dispatch flow -- read
`../review-dispatch/SKILL.md` (the sibling attachment, relative to this
file), reviewer shape. Hand it
the full payload:

- a one-or-two-sentence description of the change
- the requirements
- the commit range
- the setup observations from step 3
- the filled criteria addendum, when the slot is bound

It owns the template, the subagent, and the standard blocks. Judgment forms
there, not here: whoever sized this change carries assumptions about it, and
reading the diff here inherits them rather than tests them. No exemption for
a small diff, a clear requirement, or your own code.

## 5. Assemble the draft

Fold your observations in; present exactly this shape:

- **Strengths** -- specific.
- **Issues** -- **Critical** (must fix) / **Important** (should fix) /
  **Minor** (nice to have). Every finding lands in one bucket, with
  `file:line`, what is wrong, why it matters, and the fix.
- **Assessment** -- Ready to merge: yes | no | with fixes, plus reasoning.

Those names and those three words are fixed vocabulary: downstream callers
read the draft by them. Return the draft; never post it, approve, or ship.

## Red flags

| Thought | Reality |
|---|---|
| "It's ~20 lines, or it's my own code" | The bias the fresh context removes. Dispatch it (step 4). |
| "I understand it from sizing it" | The understanding IS the bias. Dispatch it. |
| "I'll decide the depth as I go" | Print the block first (step 1). |
| "Tests first, depth after" | Running them IS the depth decision, unprinted. Print, then set up. |
| "This writes up better its own way" | The five headings ARE the write-up; anything outside them is unreadable downstream. |
| "I'll post the findings myself" | Return the draft; the caller owns what follows. |

## Quick reference

| Signal | Action |
|---|---|
| Inputs in hand | Resolve `criteria`, print REVIEW DEPTH / EVIDENCE CHECK and provider lines. |
| Criteria bound | Its triage lines into the block, its addendum into the dispatch. |
| About to judge the diff | Don't. The review-dispatch flow (dispatch part / sibling attachment), reviewer shape, full payload. |
| Draft assembled | Buckets, `file:line`-what-why-fix, assessment word; return it. |
