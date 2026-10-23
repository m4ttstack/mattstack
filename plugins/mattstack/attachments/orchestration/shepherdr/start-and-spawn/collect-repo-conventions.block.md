---
node: collect_repo_conventions
props:
  rules:
    merge: add
    default: ""
---

# Collect the repo conventions

A herd pane is a real `claude` session in a git worktree: user-level
plugins and tracked repo conventions load, untracked state (`node_modules`,
`.env`, `settings.local.json`) does not, and a gate skill nobody names may
never load. Collect conventions from the workflow rules loaded in your
session and the repo's convention docs (CLAUDE.md, AGENTS.md,
CONTRIBUTING); this read is orchestration input, not artifact review.

Each brief's `Repo conventions` section carries exactly three things: the
gate skills that bind the job, by absolute path; task A0 for untracked
state (dependency install, env or secrets sync); and the branch, which is
the job name (with ticket-derived branches, resolve the ticket first and
name the job for it). The shipping process (target branch, MR conventions,
CI) goes in the integration job's brief; the rest lives in the skill that
owns it.

**Domain hook -- conventions.** Unbound: as above. When the bound domain
part's method skill owns the conventions, `Repo conventions` names only the
branch; a brief that restates gates, process or evidence competes with the
worker's skill chain.

{{props.rules}}
