---
name: review
disable-model-invocation: true
description: "Use when reviewing someone else's MR or PR before it merges -- a pasted MR/PR link or !iid, 'review this MR', 'check my co-worker's change', 'is this MR solid'. For your own uncommitted work use self-review; for feedback on your own MR use receive-review."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
metadata:
  slots: "criteria"
  slot-criteria: "optional review-criteria@1 -- the domain's review standards: extra triage lines, per-depth commands, and the addendum appended to the reviewer dispatch"
---

# review

The standalone entry for reviewing someone else's change.

## 1. Resolve the target

From the conversation: an MR/PR URL, a bare !iid or #number, a ticket id,
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity goes back to the
user as a question, never a guess.

## 2. Resolve the slots

In a compiled skill (see the header comment), bindings are already resolved
-- do not run resolve-args.sh.

Run `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`; nonzero exit: print
`errors` verbatim and stop. Then print one provenance line: the criteria
binding and the manifest path it came from, or "criteria: unbound
(generic review)".

## 3. Review

Fetch the diff (`glab mr diff` / `gh pr diff`). Then follow the core
review flow for depth triage, fresh-context reviewer dispatch, and the
structured draft: locate the mattstack plugin's install
dir once (`claude plugin list --json`, the `mattstack@...` entry's
`installPath`, realpathed) and read
`attachments/review-core/SKILL.md` under it. If the plugin entry or that file is missing, say so and stop -- never improvise a path. Criteria bound: read the
criteria content first (inlined below in a compiled skill, else the
SKILL.md at `resolved.criteria.path`) and apply its triage lines and
addendum exactly as it directs.

## 4. Deliver

Present the draft to the user. Nothing leaves the machine without an
explicit go. On approval, post using the forge's thread mechanics: on GitLab read
`attachments/gitlab-mr-threads/SKILL.md` under the mattstack plugin's
install dir (located as above) and follow it. If the plugin entry or that file is missing, say so and stop -- never improvise a path. On GitHub use
`gh pr review` / `gh pr comment`.
