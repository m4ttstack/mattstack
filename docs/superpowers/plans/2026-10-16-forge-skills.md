# Forge skills on the typed git tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw `rebase-worktree` and `sync-open-mrs` on `branch_sync`'s typed result and `branch_sync_sweep`, and drop the dead printed-root `git_push` retry from six other skills (phase 1 of the spec).

**Architecture:** Markdown skill edits only. Each SKILL.md is a `dot` digraph (the map) plus one `### <node text>` section per judgment box. The spec carries the target `rebase-worktree` graph verbatim and the `sync-open-mrs` middle as a sketch; tasks transcribe them, rewrite the affected sections, and pass the digraph checkers.

**Tech Stack:** Markdown, Graphviz `dot`, `check-dot.py`, `render.sh`, `rt skills check/compile` from source (`bun cli.ts`).

**Spec:** `docs/superpowers/specs/2026-10-16-forge-skills-design.md` (approved, gate 0d62b764). Read it before any task; it is the source of every node text and routing rule below.

## Global Constraints

- Write only under: `plugins/mattstack/attachments/forge/**`; the retry edge (that edge only) in `plugins/mattstack/attachments/{pipeline/ship,pipeline/stage-ship,pipeline/watch-ci,review/receive-review}/SKILL.md`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`, `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md` and its compiled copy `plugins/mattstack/skills/shepherdr/references/job-template.md`; `plugins/mattstack/.claude-plugin/plugin.json`; `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.superpowers/`.
- Every skill edit loads superpowers:writing-skills and mattstack:process-digraphs first (repo rule).
- No TypeScript or tool change. No compile or sync of the team packs. Never run `rt skills sync`.
- The plugin keeps its own Markdown style; never run rt's formatter on it.
- No em dashes or en dashes in new prose. Comments/prose state constraints, not narration.
- Dot fences start at column 1. STOP text never quotes a shell form.
- Node texts a team fill attaches to: none in scope (spec, Constraints). Still never rename a node the spec does not rename.
- `rt` from source runs isolated: `env HOME=$SCRATCH/home bun cli.ts ... --mattstack-dir $SCRATCH/mattstack`, where `$SCRATCH` is this session's scratchpad (`/private/tmp/claude-501/-Users-matt--mattstack-rt-worktrees-gh-m4ttstack-mattstack-thranduil/ee7e23e0-8790-4626-99d8-45b970939140/scratchpad`).
- plugin.json version: `0.31.7` -> `0.31.8` (one patch bump for the PR).
- PR body and commits: no employer names, slugs or ticket ids; `bun run purity` before every push.

## Review Focus

1. A `sync-open-mrs` run where the sweep tool would visit a branch the form did not list (a pre-skipped dirty tree, a truncated map, a deselected branch): the graph must take the per-branch path. Pinned in Task 4's condition text and scenario 7/8.
2. A `branch_sync` result `synced` with `pushed: false`: must reach the push gate / the rebased-still-unpushed bucket, never "pushed by branch_sync". Pinned in Tasks 3 and 4 section text and the GREEN scenario set.
3. A branch that is pulled once, re-synced, and comes back "run git_pull first" again, or dirty again after the batch retry: must land in skipped, not loop. Pinned by the bucket rule's "first time only" lines in Task 4.
4. An agent that reads a `stack-unverified` result as permission to check MRs itself: the STOP guard on `branch_sync kind?` and the rationalization rows. Pinned by scenario 1.
5. A refused `git_push` in any of the six edited skills after the retry is gone: the edge must land on the node the old budget-spent edge reached (STOP, hold, or `herd_ask`), not dangle. Pinned by `check-dot.py` (dead ends, unreachable nodes) in Task 2.

---

### Task 1: RED baseline (controller-run, before any skill edit)

**Files:**
- Create: `.superpowers/sdd/forge-scenarios.md`
- Modify: `docs/superpowers/specs/2026-10-16-forge-skills-design.md` (deviation table, RED column)

**Interfaces:**
- Produces: `.superpowers/sdd/forge-scenarios.md` with scenarios 1-9 exactly as the spec's Test plan lists them, each with the scripted tool returns; Task 5 reuses it unchanged.

- [ ] **Step 1: Write the scenario file.** One `## Scenario N` per spec scenario: the invocation, then a numbered script of what each tool call returns, in order (e.g. scenario 1: `git -C /t status -sb` -> `## feat...origin/feat`; `branch_sync {tree: /t}` -> `{kind: "stack-unverified", branch: "feat", oldHead: "a1", newHead: "a1", pushed: false, refusal: "could not read the forge: 502"}`). Gate answers are scripted the same way. Scenarios 1-6 target rebase-worktree, 7-9 sync-open-mrs.
- [ ] **Step 2: Dispatch 10 fresh agents** (model sonnet, effort low; describe-only, no tools beyond Read): 5 get the current `rebase-worktree/SKILL.md` + scenarios 1-6, 5 get the current `sync-open-mrs/SKILL.md` + `rebase-worktree/SKILL.md` + scenarios 7-9. Prompt: "Follow this skill exactly. For each scenario, list every tool call or shell command you would make, in order, with its arguments, and where you stop and why. Do not execute anything."
- [ ] **Step 3: Score.** Per scenario, count: shell calls a tool covers; suffix-parsing of a typed result; manual stack check or manual rebase after `stack-unverified`; skipped steps; runaway loops; STOPs that should have been gates. Write the RED column of the spec's deviation table.
- [ ] **Step 4: Commit** `forge-skills: RED baseline for the forge digraphs` (spec only; `.superpowers/` is ignored).

### Task 2: Drop the printed-root git_push retry in six skills

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/ship/SKILL.md:200-201,365-370`
- Modify: `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md:71-72,190-195`
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md:242-243,469-474`
- Modify: `plugins/mattstack/attachments/review/receive-review/SKILL.md:128-129,318-324`
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:84-85,164-168`
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md:55-56,93-97`
- Regenerate: `plugins/mattstack/skills/shepherdr/references/job-template.md`

**Interfaces:**
- Consumes: nothing. Produces: no node text any other task uses.

In each file delete the retry diamond, the `git_push {tree: <the root the error prints>, ...}` node, and every edge into or out of them. Reroute only the edge that entered the diamond:

| file | edge that entered the diamond | now goes to |
|---|---|---|
| ship | `"git_push result (ship)?"` label "tree must be the absolute path of the root" | delete the edge (that refusal no longer occurs; the other result edges stand) |
| stage-ship | `"git_push result?"` same label | delete the edge |
| watch-ci | `"git_push result (watch-ci)?"` same label | delete the edge |
| receive-review | `"git_push result for the fix rows?"` same label | delete the edge |
| editing-skills | `"git_push result?"` label "refused" | `"STOP: push feature branches only with git_push"` label "refused" |
| job-template | `"git_push result?"` label "refused" | `"herd_ask {questions, context}: the push was refused"` label "refused" |

Also cut any prose sentence in those files that explains the printed-root retry (grep `printed root|root the error prints|absolute path of the root` must return nothing in them afterwards). Nothing else changes.

- [ ] **Step 1: Confirm the failing check.** Run `rg -n "printed root|root the error prints|absolute path of the root|Push attempts = 2" <the six files>`; expected: the 36 lines listed above.
- [ ] **Step 2: Make the edits** per the table.
- [ ] **Step 3: Recompile the pack's shepherdr copy:** `env HOME=$SCRATCH/home bun cli.ts skills compile --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $SCRATCH/mattstack`. Expected `git status --short` shows only `plugins/mattstack/skills/shepherdr/references/job-template.md` changed under `plugins/mattstack/skills/`. If anything else changed there, revert it and report.
- [ ] **Step 4: Verify.** For each of the six edited files and the compiled copy: `bash plugins/mattstack/plugin/skills/process-digraphs/render.sh <file>` and `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py <file>` exit 0; the Step 1 grep returns nothing.
- [ ] **Step 5: Commit** `skills: drop the printed-root git_push retry (git_push resolves the root itself)`.

### Task 3: rebase-worktree on branch_sync's kind

**Files:**
- Modify: `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md` (whole file)

**Interfaces:**
- Consumes: the spec's "rebase-worktree: the new map" graph and its Sections list.
- Produces: node texts Task 4 does not reference (sync-open-mrs no longer follows this verb). The verb's outcomes stay as the spec's graph lists them.

- [ ] **Step 1: Confirm the failing check.** `rg -n "status --porcelain|Apply the child and parent checks|caller composing|root the error prints|Run: <tool>" plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md` returns lines.
- [ ] **Step 2: Replace the `rebase_worktree` dot block** with the spec's graph, verbatim except: fold the two parallel edges into "Rebased, push refused: reported" from `git_push result?` into one labelled "safety refusal or any other error" if `check-dot.py` or dot merges them.
- [ ] **Step 3: Rewrite the sections** exactly as the spec's Sections list says: new `### branch_sync kind?` (table: kind -> next, the "run git_pull first" text read named as the one text match; rationalization rows: stacked-refused/stack-unverified are verdicts, never a hint to rebase by hand; `synced` with `pushed: true` already pushed, no push gate; `synced` with `pushed: false` goes to the push gate); `### Gate clarify: dirty tree` lists the result's `paths`; `### Gate conflict:rebase-worktree:<attempt>` drops the composing hand-back sentence; `### Report the move` reads the two log lines and words the ending by `pushed`; a `### Head still the old head?` note in "What the graph cannot show" defines the old head as the conflict result's `newHead`; trim "What the graph cannot show" per the spec; delete "Discover the default from the forge", "Apply the child and parent checks", "Reading a GitLab fact no read tool returns". Keep the `{{include:spawned-no-run-guard}}` lines under the three gates, the Gates graph and its sections, and the Wrap-up include unchanged.
- [ ] **Step 4: Frontmatter.** `allowed-tools` becomes exactly `Bash(git -C * status:*)` and `Bash(git -C * log:*)`. Description: `"Use when one worktree's feature branch has fallen behind the default branch -- 'rebase this worktree', a stale MR branch. Not for resolving conflicts on its own or moving uncommitted work."`. Intro paragraph: drop "the manual rebase only where `branch_sync` did not run".
- [ ] **Step 5: Verify.** `render.sh` and `check-dot.py` exit 0 on the file; Step 1's grep returns nothing; `rg -c '^    "' ` node count in the first block is 55 (+/- the folded edge, nodes unchanged); `wc -w` is under 2,600 (was 4,058).
- [ ] **Step 6: Commit** `rebase-worktree: route on branch_sync's kind; drop the manual path`.

### Task 4: sync-open-mrs on branch_sync_sweep

**Files:**
- Modify: `plugins/mattstack/attachments/forge/sync-open-mrs/SKILL.md`

**Interfaces:**
- Consumes: the spec's "sync-open-mrs: the new middle" sketch, bucket rule, condition list, and Gate clarify: dirty trees text.
- Produces: nothing other tasks use.

- [ ] **Step 1: Confirm the failing check.** `rg -n "Follow rebase-worktree|rebase-worktree ended Held|root the error prints|Retried this branch once" plugins/mattstack/attachments/forge/sync-open-mrs/SKILL.md` returns lines.
- [ ] **Step 2: Redraw the middle** of the `sync_open_mrs` block from the spec's sketch, keeping every other node and edge. New node texts, exactly: `Every listed branch selected?`, `branch_sync_sweep {repoName}`, `branch_sync_sweep result?`, `Record every sweep result in its bucket`, `branch_sync {tree}`, `Branches to pull left?`, `git_pull {tree}`, `git_pull result?`, `branch_sync {tree: <pulled tree>}`, `Record the re-sync in its bucket`, `Any listed tree came back dirty?`, `Gate clarify: dirty trees`, `dirty answer?`, `Retried trees left?`, `branch_sync {tree: <retried tree>}`, `Record the retry in its bucket`. Keep `Selected branches left?` and `Record the branch in its bucket`. Delete `Follow rebase-worktree for the next branch`, `rebase-worktree ended Held?`, `Retried this branch once?`, `git_push {tree: <the root the error prints>, forceWithLease: true}` and the "tree must be the absolute path of the root" edge.
- [ ] **Step 3: Sections.** New `### Every listed branch selected?` (the four conditions from the spec, all must hold; otherwise the per-branch path in the answer's order). New `### branch_sync_sweep result?` (results vs error; on error, the per-branch loop over the selected rows and the error in the report; `complete: false` is a report line; a result for a branch the map did not list is reported and named). `### Record the branch in its bucket` holds the spec's bucket table (with C10's `synced`/`pushed: false` row and the two "first time only" rows) and the B4 log reads; the other three record boxes get one-line sections pointing at it. New `### Gate clarify: dirty trees` from the spec (scope `clarify:dirty-trees`, `retry` multi-select none pre-selected, split over 4, `next` Proceed/Hold, selection `{"retry":[...]}`, never stash). Delete `### Follow rebase-worktree for the next branch`. Edit `### Record push failed, mechanical` and `### Queue the mechanical failures again` to drop printed-root wording (mechanical = "not registered with rt"). Edit the opening paragraph and `### Summarize the rebase pass` / `### Report every branch in one bucket` so nothing names `rebase-worktree` or the manual path. `### Plan the sweep` keeps its rule; add that a truncated map is said in its sentence.
- [ ] **Step 4: Frontmatter.** `allowed-tools` adds `Bash(git -C * status:*)` and `Bash(git -C * log:*)`.
- [ ] **Step 5: Verify.** `render.sh` and `check-dot.py` exit 0; Step 1's grep returns nothing.
- [ ] **Step 6: Commit** `sync-open-mrs: sweep with branch_sync_sweep, pull pass and batch dirty gate`.

### Task 5: GREEN runs, bump, full verification (controller-run)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-forge-skills-design.md` (deviation table, GREEN column)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`"version": "0.31.8"`)

- [ ] **Step 1: GREEN dispatch.** Same 10 agents and prompt as Task 1 Step 2, with the new skill texts (sync-open-mrs agents get only sync-open-mrs). Score the same way; fill the GREEN column. Pass: zero shell calls a tool covers, zero suffix parsing beyond the "run git_pull first" read, routing as the spec draws. Any deviation: fix the skill text (re-run that skill's five agents), at most 2 rounds, then report what remains.
- [ ] **Step 2: Bump** plugin.json to `0.31.8`.
- [ ] **Step 3: Full static checks**, all exit 0:
  - `cd plugins/mattstack && grep -rl --null -E '^[[:space:]]*```dot[[:space:]]*$' --include='*.md' . | sort -z | xargs -0 python3 plugin/skills/process-digraphs/check-dot.py`
  - `cd plugins/mattstack && for d in skills/*/ plugin/skills/*/ attachments/*/ attachments/*/*/; do [ -f "${d}SKILL.md" ] || continue; sh tests/certify.sh "$d" || exit 1; done`
  - `env HOME=$SCRATCH/home bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $SCRATCH/mattstack --strict`
  - `env HOME=$SCRATCH/home bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $SCRATCH/mattstack`
  - `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`
  - `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh`
  - `bun run purity`
- [ ] **Step 4: Commit** `mattstack 0.31.8: forge skills on the typed git tools` (spec table + plugin.json).
