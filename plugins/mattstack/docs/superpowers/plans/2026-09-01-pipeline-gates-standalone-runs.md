# Pipeline Gates, Plan 3: Standalone Verbs as Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `review`, `self-review`, `receive-review`, `ship`, `watch-ci`, and `sync-open-mrs` start a single-stage run for themselves when no run is active, so the Stop hook covers their panes (board-launched reviews included) and the console shows them as runs.

**Architecture:** Each verb gains a `## Run` section at its start: the Resume offer, `run-start` with the compiler-rendered `{{run-start.flags:<verb>}}` line, `export RT_RUN_DB`, `stage-start`; and a close after its final gate (`stage-done`, `run-status done`, `unset RT_RUN_DB`). The guard is "no running run in `RT_RUN_DB`", so a verb invoked inside a pipeline stage or another verb inherits instead. `watch-ci` gains the `mark-ready` gate when it started its own run.

**Tech Stack:** Markdown engines; the rt compiler's `{{run-start.flags:<verb>}}` placeholder variant (rt follow-up item 1, on rt branch `run-start-flags-verb`); `rt skills compile` with the hidden `--pack-dir` and `--mattstack-dir` flags; `tests/certify.sh`.

**Spec:** `docs/superpowers/specs/2026-09-01-pipeline-gates-design.md`, section 6 (and the standalone rows of section 9). Plans 1 and 2 must be merged first.

## Global Constraints

- Blocked until the rt release that renders `{{run-start.flags:<verb>}}` is installed on this machine (Task 1 proves it). Until then the verbs' gates run under the contract's "outside a run" rule and nothing here is edited.
- Every touched directory passes `sh tests/certify.sh <dir>`; the tree passes `sh tests/repo-purity.sh`; no `Matt`, no `/Users/matt`, no em or en dashes.
- The `## Run` section is the first section of the body after the verb's opening paragraph, and its text is the same in every verb except the verb name in `{{run-start.flags:<verb>}}`, `--stage <verb>`, and `--decided-by <verb>`.
- A verb that inherited a run writes no `stage-done`, no `run-status`, and fires no gate beyond its own; the close block is reached only by the verb that ran `run-start`.
- Work in `.worktrees/pipeline-gates` (rebased onto `main` after plan 2 merged); commit and push after every task.

## The Run section (verbatim, `<verb>` substituted)

````markdown
## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when `RT_RUN_DB` is set
and `rt runs snapshot` shows `run.status` = `running`: you were invoked
from inside that run, you inherit it, `run.current_stage` is your stage,
and you close nothing at the end.

Otherwise, first the Resume offer: list `~/.mattstack/runs/<repo>/` for a
run whose `snapshot` shows `status` = `running` and `work_type` = `<verb>`
(read each with `RT_RUN_DB` pointed at its `state.db`; never raw sqlite).
One found: gate `clarify`, one sentence naming it, the structured-question
tool with **Resume it** (recommended) / **Start fresh**. Resume: `export
RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage <verb>` (a new
attempt, which re-records this session) and `rt runs field set hold -
--stage <verb>`.

Fresh:

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start {{run-start.flags:<verb>}} --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage <verb>
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage <verb>`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage <verb>`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.
````

---

### Task 1: Prove the placeholder variant is installed

**Files:**
- Read only.

- [ ] **Step 1: Check the installed rt renders the variant**

```bash
rt --version
cd /Users/matt/Documents/GitHub/mattstack-skills/.worktrees/pipeline-gates
mkdir -p attachments/run-flags-probe
cat > attachments/run-flags-probe/SKILL.md <<'EOF'
---
name: run-flags-probe
description: "Use never; a compile probe for the run-start.flags variant."
type: pipeline-step
---

# probe

{{run-start.flags:review}}
EOF
python3 - <<'PY'
import json, re
p = "pack/stubs.jsonc"; s = open(p).read()
s = s.replace('"verbs": {', '"verbs": {\n    "run-flags-probe": { "engine": "run-flags-probe", "description": "probe" },', 1)
open(p, "w").write(s)
PY
rt skills compile --pack mattstack --verb run-flags-probe --pack-dir "$PWD" --mattstack-dir "$PWD" --preview
git checkout pack/stubs.jsonc
rm -rf attachments/run-flags-probe
```

Expected: the preview contains one line beginning `--repo ` and containing `--work-type review --pipeline review --mattstack-sha`. An error naming `run-start.flags:review` as unknown means the rt on this machine predates the variant: stop, report, and wait for the release.

---

### Task 2: review

**Files:**
- Modify: `attachments/review/review/SKILL.md` (insert `## Run` after the opening paragraph; add the close to section 3)

**Interfaces:**
- Consumes: the gates `clarify`, `post-severity`, `post-disposition` from plan 2.

- [ ] **Step 1: Insert the Run section**

Insert the Run section (from the header, with `<verb>` = `review`) between `The standalone entry for reviewing someone else's change.` and `## 1. Resolve the target`.

- [ ] **Step 2: Rewrite the gate bracketing and add the close**

In section 3, replace `When `RT_RUN_DB` is set, each gate is bracketed by` with `Each gate is bracketed by` (the run exists now; the outside-run rule no longer applies here), and change `--stage review` to `--stage <stage>` where `<stage>` is `review` for an own run and `run.current_stage` for an inherited one. Append to section 3, after the posting mechanics sentence:

```markdown

Close, only when `## Run` started this run: `rt runs stage-done --stage
review`, `rt runs run-status --status done`, `unset RT_RUN_DB`. The final
message still ends with the target's link (the close HARD-GATE below).
```

- [ ] **Step 3: Certify, compile check, commit**

Run: `sh tests/certify.sh attachments/review/review` (exit 0). Then, with the team pack's name from `rt skills packs` and its checkout path: `rt skills compile --pack <that name> --verb review --pack-dir <that checkout> --mattstack-dir "$PWD" --dry-run --json` prints a rendered `--work-type review --pipeline review` line and no error.

```bash
git add attachments/review/review/SKILL.md
git commit -m "review: standalone runs as its own single-stage run"
git push
```

---

### Task 3: self-review

**Files:**
- Modify: `attachments/review/self-review/SKILL.md`

- [ ] **Step 1: Insert the Run section**

Insert the Run section with `<verb>` = `self-review` between the paragraph ending `then act on the draft it returns.` and the paragraph beginning `Whoever wrote the code`.

- [ ] **Step 2: Bracket the gate and add the close**

In section 3, replace both `When `RT_RUN_DB` is set: ` prefixes with nothing (the lines become unconditional) and `--stage <run.current_stage>` with `--stage <stage>` (`self-review` for an own run, `run.current_stage` inherited). Append after the `Where the domain defines ship-time gates` paragraph:

```markdown

Close, only when `## Run` started this run: after the fixes the gate
selected are verified, `rt runs stage-done --stage self-review`, `rt runs
run-status --status done`, `unset RT_RUN_DB`.
```

- [ ] **Step 3: Certify, commit**

Run: `sh tests/certify.sh attachments/review/self-review` (exit 0).

```bash
git add attachments/review/self-review/SKILL.md
git commit -m "self-review: standalone runs as its own single-stage run"
git push
```

---

### Task 4: receive-review

**Files:**
- Modify: `attachments/review/receive-review/SKILL.md`

- [ ] **Step 1: Insert the Run section**

Insert the Run section with `<verb>` = `receive-review` between the paragraph ending `posting each wait for their own explicit approval.` and the paragraph beginning `Baseline agents already fetch threads`.

- [ ] **Step 2: Bracket the gates and add the close**

In sections 3, 4, and 5, drop every `When `RT_RUN_DB` is set: ` prefix and `When `RT_RUN_DB` is set, ` clause, and replace `--stage <run.current_stage>` with `--stage <stage>` (`receive-review` for an own run, `run.current_stage` inherited). Append to section 5, after `Posting mechanics belong to the forge CLI and the adapter.`:

```markdown

Close, only when `## Run` started this run: after the selected categories
are posted, `rt runs stage-done --stage receive-review`, `rt runs
run-status --status done`, `unset RT_RUN_DB`. Zero unresolved human
threads (step 1) closes the same way, right after the sentence that says
so.
```

- [ ] **Step 3: Certify, commit**

Run: `sh tests/certify.sh attachments/review/receive-review` (exit 0).

```bash
git add attachments/review/receive-review/SKILL.md
git commit -m "receive-review: standalone runs as its own single-stage run"
git push
```

---

### Task 5: ship

**Files:**
- Modify: `attachments/pipeline/ship/SKILL.md`

- [ ] **Step 1: Insert the Run section**

Insert the Run section with `<verb>` = `ship` between the paragraph ending `reached directly: target from the checkout.` and `## 1. Establish the target, then the ship gate`.

- [ ] **Step 2: Bracket the gates and add the close**

In sections 1 and 3, drop every `When `RT_RUN_DB` is set: ` prefix (`--stage ship` stays). Append to section 3 after the forge-host sentence:

```markdown

Close, only when `## Run` started this run: after the mark-ready answer is
acted on (or the gate said keep it draft), `rt runs stage-done --stage
ship`, `rt runs run-status --status done`, `unset RT_RUN_DB`. Abort at the
ship gate closes with `run-status --status abandoned` instead.
```

- [ ] **Step 3: Certify, commit**

Run: `sh tests/certify.sh attachments/pipeline/ship` (exit 0).

```bash
git add attachments/pipeline/ship/SKILL.md
git commit -m "ship: standalone runs as its own single-stage run"
git push
```

---

### Task 6: watch-ci, with mark-ready when it started the run

**Files:**
- Modify: `attachments/pipeline/watch-ci/SKILL.md`

- [ ] **Step 1: Insert the Run section**

Insert the Run section with `<verb>` = `watch-ci` between the paragraph ending `and the verdict goes to the user.` and `## 1. Establish the target`.

- [ ] **Step 2: Bracket the ci gate, add mark-ready and the close**

In `## Verdict`, drop the `When `RT_RUN_DB` is set: ` prefixes; `<run.current_stage>` becomes `<stage>` (`watch-ci` for an own run, inherited otherwise). Replace `Green: one sentence, the verdict, then stop.` with:

```markdown
Green: one sentence, the verdict. Then, only when `## Run` started this
run, `mr` is set, and the MR is a draft, gate `mark-ready`:

- `rt runs field set gate mark-ready --stage watch-ci`
- One sentence: CI is green for the MR's head.
- The form: **Mark ready now** (recommended) / **Keep it draft**;
  **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by watch-ci`
- Yes: the forge-host rule (read `git remote get-url origin`; GitLab means
  `glab mr update <iid> --ready`, GitHub means `gh pr ready <number>`,
  anything else is a `clarify` gate).

Then the close. Any other outcome is gate `ci`:
```

Append after the inherited-verb paragraph:

```markdown

Close, only when `## Run` started this run: after the green verdict's
mark-ready answer, or after the `ci` gate's Hand back, `rt runs stage-done
--stage watch-ci`, `rt runs run-status --status done`, `unset RT_RUN_DB`.
Fix and re-push keeps the run `running` and re-enters section 3 after the
push (a new `stage-start --stage watch-ci`).
```

- [ ] **Step 3: Certify, commit**

Run: `sh tests/certify.sh attachments/pipeline/watch-ci` (exit 0).

```bash
git add attachments/pipeline/watch-ci/SKILL.md
git commit -m "watch-ci: standalone runs as its own run; mark-ready on green"
git push
```

---

### Task 7: sync-open-mrs

**Files:**
- Modify: `attachments/forge/sync-open-mrs/SKILL.md`

- [ ] **Step 1: Insert the Run section**

Insert the Run section with `<verb>` = `sync-open-mrs` between the paragraph ending `not reimplemented here.` and `## 1. Discover`.

- [ ] **Step 2: Bracket the gates and add the close**

In sections 2 and 4, drop every `When `RT_RUN_DB` is set: ` prefix. Append to section 5:

```markdown

Close, only when `## Run` started this run: after the report, `rt runs
stage-done --stage sync-open-mrs`, `rt runs run-status --status done`,
`unset RT_RUN_DB`. The per-branch `rebase-worktree` and `watch-ci` calls
inherit this run and close nothing.
```

- [ ] **Step 3: Certify, commit**

Run: `sh tests/certify.sh attachments/forge/sync-open-mrs` (exit 0).

```bash
git add attachments/forge/sync-open-mrs/SKILL.md
git commit -m "sync-open-mrs: standalone runs as its own single-stage run"
git push
```

---

### Task 8: Release plan 3

- [ ] **Step 1: Verify**

```bash
for d in attachments/review/review attachments/review/self-review attachments/review/receive-review attachments/pipeline/ship attachments/pipeline/watch-ci attachments/forge/sync-open-mrs; do sh tests/certify.sh "$d" || exit 1; done
sh tests/repo-purity.sh
grep -c 'run-start.flags:' attachments/review/review/SKILL.md attachments/review/self-review/SKILL.md attachments/review/receive-review/SKILL.md attachments/pipeline/ship/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/forge/sync-open-mrs/SKILL.md
```

Expected: every certify exits 0, purity ok, each file reports `1`.

- [ ] **Step 2: Bump, merge, install**

Bump the minor version in `.claude-plugin/plugin.json`; `rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"` and `check` (the pack's own roster does not compile these verbs, so this only refreshes stamps); commit `mattstack: bump for standalone verbs as runs`; push; fast-forward `main`; `claude plugin update mattstack@mattstack`; restart. The team pack recompiles against this version in its own release (companion spec).

- [ ] **Step 3: Prove it live (operator at a terminal)**

Launch a review from the board on a real MR. Expected: the console lists a run of work type `review` for the repo while the pane works; the two posting gates arrive as two forms; the `done` badge carries the human's disposition; the run reads `done` in the console after the close; an attempt to end the review turn in prose before the gates is blocked by the hook.
