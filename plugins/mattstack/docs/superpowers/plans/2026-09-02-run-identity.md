# Run Identity on Standalone Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone verb runs (`review`, `receive-review`, `self-review`, `watch-ci`, `ship`) record `ticket`, `branch`, and `mr` fields when they resolve their target, so the console board and run detail show identity instead of "not recorded".

**Architecture:** One new inert include (`attachments/run-identity/SKILL.md`) states the contract once; each of the five engines gains the identical `{{include:run-identity}}` line above its first numbered step plus one recording sentence at its target-resolution point. No rt change: `rt runs field set` accepts any key and the store already promotes `ticket`/`branch` onto the run row. The console fallback is a separate plan in the console app repo.

**Tech Stack:** Markdown engines; `rt skills` compile/check; `tests/certify.sh`, `tests/repo-purity.sh`, `tests/stubs-no-source-collision.sh`.

**Spec:** `docs/superpowers/specs/2026-09-02-run-identity-design.md`

## Global Constraints

- The include line is `{{include:run-identity}}`, identical in every engine, standing alone immediately above the verb's first numbered step heading (the last line before "## 1. ..."), with one blank line on each side.
- The `## Run` sections themselves are not edited; plan 3's verbatim-identicality constraint on them stays intact.
- Identity is own-run only: recording happens "when the run is yours" (this verb ran `run-start`); an inherited run's identity is never overwritten. The stage flag is always the verb's own name.
- The include must be inert: no `{{` placeholders, no `slots` in frontmatter (the compiler's loadInclude rejects both).
- Every touched directory passes `sh tests/certify.sh <dir>`; the tree passes `tests/repo-purity.sh` and `tests/stubs-no-source-collision.sh`. No em or en dashes anywhere (ASCII `--` is fine); no personal names or home paths; no domain terms.
- Work in a worktree (branch `run-identity`, directory `.worktrees/run-identity`); commit after every task.
- `sync-open-mrs` is untouched.

---

### Task 1: The run-identity include

**Files:**
- Create: `attachments/run-identity/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the include name `run-identity`, referenced by Tasks 2 and 3 as `{{include:run-identity}}`.

- [ ] **Step 1: Verify the name is free**

Run: `ls attachments/ | grep run-identity; sh tests/stubs-no-source-collision.sh`
Expected: no `attachments/run-identity` yet; collision check passes.

- [ ] **Step 2: Write the include**

Create `attachments/run-identity/SKILL.md` with exactly:

````markdown
---
name: run-identity
description: "Use when a standalone verb has just resolved the target its run is about -- recording the run's ticket, branch, and mr fields so the console board and run detail can show them."
type: pipeline-step
---

# Run identity

A run's identity is three fields: `ticket`, `branch`, `mr`. They are the
same keys the pipeline stages produce, and the console reads them from
every run: the board row shows `ticket` and `branch`, the run detail card
shows all three. Nothing backfills them: a field not recorded while the
run is live reads "not recorded" forever.

Record identity only when this verb ran `run-start`. An inherited run's
identity belongs to the verb that started it, and must not be overwritten
with the target of a review or a watch invoked mid-run.

When the run is yours, record each key the moment the target-resolution
step produces it: `rt runs field set <key> <value> --stage <verb>`.

Skip a key the target does not have: a branch with no ticket records no
`ticket`. Never guess a value, and never block on a missing one.
````

- [ ] **Step 3: Certify**

Run: `sh tests/certify.sh attachments/run-identity && sh tests/repo-purity.sh && sh tests/stubs-no-source-collision.sh`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add attachments/run-identity/SKILL.md
git commit -m "run-identity: the include stating the standalone-run identity contract"
```

---

### Task 2: The review engine records identity

**Files:**
- Modify: `attachments/review/review/SKILL.md`

**Interfaces:**
- Consumes: `{{include:run-identity}}` from Task 1.
- Produces: the recording-sentence pattern ("When the run is yours, record ... per Run identity above") that Task 3 repeats in the other engines.

- [ ] **Step 1: Baseline (RED)**

Run: `grep -n "field set \(ticket\|branch\|mr\) \|run-identity" attachments/review/review/SKILL.md`
Expected: no matches. The engine resolves the MR in its step 1 and records nothing.

Then the fresh-reader baseline (spec section 7):

```bash
claude -p "Read attachments/review/review/SKILL.md. Scenario: you started this run yourself via its Run section, and step 1 just resolved one MR (URL https://forge.example.com/g/p/-/merge_requests/9, source branch team/x-12-fix, and the branch name carries the ticket id X-12). List every rt runs field set command the text instructs you to run at this point, verbatim. If it instructs none, say NONE."
```

Expected: NONE (or only `gate`/`hold` writes). Record the output in the task report.

- [ ] **Step 2: Insert the include line**

In `attachments/review/review/SKILL.md`, immediately above the line `## 1. Resolve the target`, insert (blank line above and below):

```
{{include:run-identity}}
```

- [ ] **Step 3: Add the recording sentence**

At the end of the `## 1. Resolve the target` section body (after the paragraph ending "Never a guess."), append as its own paragraph:

```
When the run is yours, record the resolved target per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id the
MR itself names in branch, title, or description, when one exists).
```

- [ ] **Step 4: Verify (GREEN)**

Run: `grep -n "run-identity\|When the run is yours, record" attachments/review/review/SKILL.md`
Expected: the include line directly above `## 1. Resolve the target`, and the sentence inside section 1.

Then the fresh-reader verify, same scenario as Step 1's baseline but against the edited text, with the include body inlined the way a compiled verb would carry it:

```bash
{ sed '1,/^---$/d;1,/^---$/d' attachments/run-identity/SKILL.md; cat attachments/review/review/SKILL.md; } > /tmp/review-with-include.md
claude -p "Read /tmp/review-with-include.md. Scenario: you started this run yourself via its Run section, and step 1 just resolved one MR (URL https://forge.example.com/g/p/-/merge_requests/9, source branch team/x-12-fix, and the branch name carries the ticket id X-12). List every rt runs field set command the text instructs you to run at this point, verbatim. Then the same scenario with a branch carrying no ticket id: list those commands too, and say whether the text tells you to stop and ask about the missing ticket."
```

Expected: first scenario yields `mr`, `branch`, and `ticket` field set commands with `--stage review`; second yields `mr` and `branch` only, with no stop-and-ask. Record both outputs in the task report; a miss is a wording fix in the engine sentence or the include, then re-run.

- [ ] **Step 5: Certify and commit**

Run: `sh tests/certify.sh attachments/review/review && sh tests/repo-purity.sh`
Expected: pass.

```bash
git add attachments/review/review/SKILL.md
git commit -m "review: record mr/branch/ticket when the resolved target is this run's own"
```

---

### Task 3: The other four engines (batched, same shape)

**Files:**
- Modify: `attachments/review/receive-review/SKILL.md`
- Modify: `attachments/review/self-review/SKILL.md`
- Modify: `attachments/pipeline/watch-ci/SKILL.md`
- Modify: `attachments/pipeline/ship/SKILL.md`

**Interfaces:**
- Consumes: `{{include:run-identity}}` from Task 1; the sentence pattern from Task 2.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Baseline (RED)**

Run: `grep -ln "run-identity" attachments/review/receive-review/SKILL.md attachments/review/self-review/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/pipeline/ship/SKILL.md`
Expected: no matches.

- [ ] **Step 2: receive-review**

Insert the bare `{{include:run-identity}}` line (blank line each side) immediately above `## 1. Resolve the change and filter the threads`. Append to the end of that section (after the line "Fetch mechanics belong to the forge CLI (`gh` / `glab`) and the adapter."), as its own paragraph:

```
When the run is yours, record the resolved change per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id it
names, when one exists).
```

- [ ] **Step 3: self-review**

Insert the include line immediately above `## 1. Point at the branch`. Append to the end of that section, as its own paragraph:

```
When the run is yours, record the branch per Run identity above: `branch`
(the current branch), `ticket` (the branch's ticket, when it carries one).
```

- [ ] **Step 4: watch-ci**

Insert the include line immediately above `## 1. Establish the target`. Append to the end of that section, as its own paragraph:

```
When the run is yours, record the target per Run identity above:
`branch`, and `mr` when one exists.
```

- [ ] **Step 5: ship**

Insert the include line immediately above `## 1. Establish the target, then the ship gate`. Append to the end of that section, as its own paragraph:

```
When the run is yours, record `branch` per Run identity above.
```

Then append to the end of `## 2. Ship` (after the generic path's "Print the URL." paragraph), as its own paragraph:

```
Either path, when the run is yours: record `mr` (the created MR/PR URL)
per Run identity above.
```

- [ ] **Step 6: Verify (GREEN)**

Run: `grep -c "run-identity" attachments/review/receive-review/SKILL.md attachments/review/self-review/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/pipeline/ship/SKILL.md`
Expected: exactly 1 per file. Then eyeball each include line sits directly above the named heading.

- [ ] **Step 7: Certify and commit**

Run: `for d in attachments/review/receive-review attachments/review/self-review attachments/pipeline/watch-ci attachments/pipeline/ship; do sh tests/certify.sh "$d" || exit 1; done && sh tests/repo-purity.sh`
Expected: all pass.

```bash
git add attachments/review/receive-review/SKILL.md attachments/review/self-review/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/pipeline/ship/SKILL.md
git commit -m "standalone verbs: receive-review, self-review, watch-ci, ship record run identity"
```

---

### Task 4: Bump and repo checks

**Files:**
- Modify: `.claude-plugin/plugin.json` (version only)

**Interfaces:**
- Consumes: Tasks 1-3 committed.
- Produces: version `0.13.5`, which the release steps below install.

- [ ] **Step 1: Bump**

In `.claude-plugin/plugin.json`, change `"version": "0.13.4"` to `"version": "0.13.5"`.

- [ ] **Step 2: Full checks**

Run: `sh tests/repo-purity.sh && sh tests/stubs-no-source-collision.sh && rt skills check --pack mattstack`
Expected: purity and collision pass; the pack check reports `current` (the touched engines are not in mattstack's own roster; `pack/stubs.jsonc` holds only `shepherdr` and `wrap-up`).

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "mattstack: bump to 0.13.5 for run identity on standalone verbs"
```

---

### Task 5: Release (operator-gated)

**Files:** none in this repo beyond Task 4; the team pack clone gets its own bump/compile commit.

**Interfaces:**
- Consumes: version 0.13.5 on `main`.
- Produces: the installed caches and the recompiled team pack.

- [ ] **Step 1: Land the branch**

Merge `run-identity` into `main` (fast-forward or merge per repo habit). HUMAN GATE before pushing `main` anywhere.

- [ ] **Step 2: Update the mattstack cache**

Run `readlink ~/.claude-swap-backup/sessions/*/plugins` first; for every distinct config, run `claude plugin update mattstack@mattstack` (prefixed with `CLAUDE_CONFIG_DIR=<session dir>` for any account that keeps its own cache). This also delivers the pending 0.13.3 and 0.13.4.

- [ ] **Step 3: Recompile the team pack**

In the team pack clone (under `~/.mattstack/teams/`): bump the pack's `plugin.json` patch version first (the version is stamped into compiled output), then `rt skills compile --pack <pack>`, then `rt skills check --pack <pack>` until every line reads `current`. Expect the recompile to also pick up the pending 0.13.4 work-engine change; that is intended.

- [ ] **Step 4: Publish the pack (HUMAN GATE)**

Commit the pack clone (compiled verbs plus the bump, one commit). Pushing is the team publish: hold for explicit operator approval, then push. Derive the update name from the teams-clone `.claude-plugin/marketplace.json` (`<plugin>@<marketplace>`; the two names routinely differ) and run `claude plugin update <plugin>@<marketplace>` for each config dir from Step 2.

- [ ] **Step 5: End-to-end verification**

Restart a session, then run one board-launched review of a real MR. Read the run back: `rt runs show <runId> --repo <repo> --json` shows `ticket`, `branch`, and `mr` fields, and `run.ticket`/`run.branch` non-null. Load the run's console page: the board row shows ticket and branch; the detail card shows the MR link (via enrichment where the branch is cached).
