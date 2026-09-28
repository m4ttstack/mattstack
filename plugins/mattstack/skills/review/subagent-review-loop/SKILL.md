---
name: subagent-review-loop
description: >-
  Use when a spec or plan document needs adversarial review before
  implementation -- "have a subagent review the spec and loop until
  satisfied", pressure-testing a design doc that brainstorming or
  plan-writing just produced, or getting explicit sign-off on a spec/plan
  before execution starts. For reviewing code, a branch, or an MR/PR, use
  the review cluster's other skills instead.
---

# Subagent Review Loop

## Overview

One reviewer subagent reads the spec or plan and returns a verdict; the
driving agent fixes the doc and loops with that SAME reviewer until it
approves. The reviewer keeps its context across rounds, so round two is
"did the fixes hold?" rather than a fresh cold read.

## Process

1. Resolve the target document: the path given, else the spec/plan this
   session just wrote. Confirm it exists before dispatching.
2. Pick the reviewer's model: if the operator named one ("have a fable
   subagent review..."), use it. Otherwise read
   `${CLAUDE_SKILL_DIR}/../../../attachments/model-tiering/SKILL.md` and
   apply it to choose; adversarial spec review is high-judgment work, so expect it
   to land on the top tier.
3. Spawn ONE reviewer with the Agent tool on that model, using the
   reviewer prompt described below.
4. Read the verdict. On "Status: Approved", report and stop.
5. On "Issues Found": apply the findings to the document. Findings that
   are wrong get pushed back on with technical reasons, not silently
   applied (superpowers:receiving-code-review applies).
6. Message the SAME reviewer (SendMessage to the agent spawned in step 3):
   list what changed and what was rejected and why, and ask it to re-read
   the document from disk and give a fresh verdict.
7. Repeat from step 4. If round 4 ends without approval, stop and surface
   the remaining disagreement to the operator instead of grinding.

## Reviewer prompt

Do not write a custom review prompt; pick by document type:

- **Implementation plan:** use the reviewer template that ships with
  superpowers:writing-plans (plan-document-reviewer-prompt.md in that
  skill's directory). Fill [PLAN_FILE_PATH] with the plan and
  [SPEC_FILE_PATH] with the spec it implements.
- **Anything else** (spec, design doc, RFC, any document): use the
  generic template below. Fill [DOC_FILE_PATH] with the target and
  [REF_FILE_PATH] with whatever it answers to (spec, ticket, brief);
  drop that line if nothing upstream exists.

Either way, append this loop clause to the prompt:

```
This is a review loop: after you report, fixes will be applied to the
document and you will be asked to re-review. Re-read the document from
disk each round; do not review from memory. End every report with the
Status line.

Do all of this review yourself. Never spawn a subagent to review part of
the document, and never spawn another reviewer for a second opinion.

Do not say "Approved" without re-reading, do not give feedback on
sections you did not actually read, and never end a report without a
clear Status verdict.
```

## Generic document template

```
You are a document reviewer. Verify this document is complete and ready
for what comes next.

**Document to review:** [DOC_FILE_PATH]
**Upstream reference:** [REF_FILE_PATH]

## What to Check

| Category | What to Look For |
|----------|------------------|
| Completeness | TODOs, placeholders, missing sections, unanswered open questions |
| Internal consistency | contradictions, assumptions made in one section broken in another |
| Alignment | covers the upstream reference's requirements, no silent scope creep |
| Actionability | could the next person act on this without getting stuck? |

## Calibration

Only flag issues that would cause real problems downstream. A reader
building the wrong thing or getting stuck is an issue. Minor wording,
stylistic preferences, and "nice to have" suggestions are not.

Approve unless there are serious gaps -- missing requirements,
contradictory content, placeholder sections, or statements so vague they
cannot be acted on.

If you find issues with the upstream reference itself rather than this
document, say so rather than counting them against the document.

## Output Format

## Document Review

**Status:** Approved | Issues Found

**Issues (if any):**
- [Section]: [specific issue] - [why it matters]

**Recommendations (advisory, do not block approval):**
- [suggestions for improvement]
```

## Guardrails

- One reviewer, all rounds. A fresh Agent call is a fresh context that
  re-litigates settled findings.
- The loop's exit is the reviewer's explicit "Status: Approved", not the
  driver's judgment that things look fine.
- Recommendations are advisory and do not block approval (per the
  template's calibration); fix or note them in the final report.
