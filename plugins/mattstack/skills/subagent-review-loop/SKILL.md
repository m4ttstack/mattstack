---
name: "subagent-review-loop"
description: "Use when a spec or plan document needs adversarial review before implementation -- \"have a subagent review the spec and loop until satisfied\", pressure-testing a design doc that brainstorming or plan-writing just produced, or getting explicit sign-off on a spec/plan before execution starts. For reviewing code, a branch, or an MR/PR, use the review cluster's other skills instead."
metadata:
  compiled: "mattstack@0.30.26"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:subagent-review-loop version=0.30.26 path=attachments/review/subagent-review-loop/SKILL.md lines=15-131 -->

# Subagent Review Loop

## Overview

One reviewer helper reads the spec or plan and returns a verdict; the
driving agent fixes the doc and loops with that SAME reviewer until it
approves. The reviewer keeps its context across rounds, so round two is
"did the fixes hold?" rather than a fresh cold read.

## Process

1. Resolve the target document: the path given, else the spec/plan this
   session just wrote. Confirm it exists before dispatching.
2. Pick the reviewer's model: if the operator named one ("have <model>
   review the spec..."), use it. Otherwise adversarial spec review is
   high-judgment work: the deep tier, named as Models (below) says.
3. Start ONE reviewer helper on that model (Starting and messaging the
   reviewer, below), using the reviewer prompt described below.
4. Read the verdict. On "Status: Approved", report and stop.
5. On "Issues Found": apply the findings to the document. Findings that
   are wrong get pushed back on with technical reasons, not silently
   applied (superpowers:receiving-code-review applies).
6. Message the SAME reviewer helper started in step 3: list what changed
   and what was rejected and why, and ask it to re-read the document from
   disk and give a fresh verdict.
7. Repeat from step 4. If round 4 ends without approval, stop and surface
   the remaining disagreement to the operator instead of grinding.

## Starting and messaging the reviewer

<!-- part: harness:delegation target=claude path=attachments/harness/claude-code.md lines=37-41 -->
Start the helper with the Agent tool: the prompt the step gives, and
`model` set to the alias the models fragment gives for its tier. It returns
its report as the tool result. To talk to the same helper again, use
SendMessage with the agent id the Agent call returned; a new Agent call is a
new helper with none of the earlier context.

## Models

<!-- part: harness:models target=claude path=attachments/harness/claude-code.md lines=45-72 -->
| Tier | Claude Code alias |
|---|---|
| light | `haiku` |
| standard | `sonnet` |
| deep | `opus` |
| long-horizon | `fable` |

Aliases track the provider's recommended version (Bedrock, Foundry and
Google Cloud resolve `opus` and `sonnet` differently from the first-party
API). A rejected alias exits 1 at launch: a visible failure, not a silent
downgrade.

| | Spawn-time (`claude` CLI, `herd_spawn`) | Delegation-time (Agent tool) |
|---|---|---|
| Model | alias or full ID | enum: `haiku`, `sonnet`, `opus`, `fable` |
| Effort | `--effort` flag (`effort` on `herd_spawn`) | no effort parameter exists |
| `best` / `default` / `[1m]` | accepted | rejected |

So an effort change is spawn-time only here. `opusplan` upgrades only inside
Claude Code's plan permission mode, which skill-driven workers never enter:
never pick it. `best` and `default` resolve by org entitlement, not work
shape. `[1m]` variants pick a context window, not a tier; quote them
(`'opus[1m]'`), since brackets are zsh glob characters.

Claude Code clamps an unsupported effort level to the highest supported
level at or below it, so no per-model matrix is needed. Organization effort
caps clamp silently in background agents and JSON output modes. `ultracode`
is a Claude Code setting (xhigh plus workflow orchestration), not a level.

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

- One reviewer, all rounds. A newly started helper is a fresh context that
  re-litigates settled findings.
- The loop's exit is the reviewer's explicit "Status: Approved", not the
  driver's judgment that things look fine.
- Recommendations are advisory and do not block approval (per the
  template's calibration); fix or note them in the final report.
