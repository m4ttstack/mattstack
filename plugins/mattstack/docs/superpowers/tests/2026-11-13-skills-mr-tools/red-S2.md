# RED S2: GitLab walk recorded (git remote get-url, mr_map, plan skips dirty:null tree)

# red-S2: ordered calls

1. `run_enter {flags: "--repo pack --work-type sync-open-mrs --pipeline sync-open-mrs", skillDir: "<sync-open-mrs skill dir>", stage: "sync-open-mrs"}` (no runDb handed, no spawnedBy: a human typed the request). Result `status: started`, runId run-s2: keep it as the run handle and pass it to every later run_* and gate call as `runDb` with `stage: sync-open-mrs`. Edge: started -> git remote.
2. `git -C /work/acme remote get-url origin` -> `git@gitlab.com:acme/app.git`, so Forge = GitLab. Edge: mr_map. (No gitlab CLI, no glab.)
3. `mr_map {repoName: "/work/acme", author: "me"}` -> rows (3), complete: true. Edge: plan_sweep.
   - Not called: `git worktree list`, `git -C <tree> status`. On GitLab the row's `dirty` decides, so the worktree list and the porcelain fixtures are not read. skills_resolve is not called before the gate: no @pointer is followed on the GitLab path before the sweep gate (map-open-mrs is the GitHub path, watch-ci comes after the push gate).
4. Plan the sweep (no tool call). Sentence: "1 branch rebases (feat-a, !12); 2 are skipped up front: feat-b (!15) because its tree's dirty state could not be read (dirty is null with a worktree, so it is not known clean), and feat-c (!18) because it has no worktree (nothing local to rebase). The map is complete (under 200 open MRs)."
   - feat-b is NOT listed in the form (a tree the rebase would refuse or cannot confirm is a skipped row, named up front). feat-c is a NONE row.
5. Gate sweep: `gate_ask {kind: "sweep", runDb: <run-s2>, stage: "sync-open-mrs", context: <verbatim quote of the plan sentence and the three map rows, as Markdown with label lines and `-` bullets>, questions: [ {id: "branches", label: "Branches to rebase", multi: true, options: [{value: "feat-a", label: "feat-a (!12 Add feature A)"}]} (feat-a pre-selected), {id: "next", label: "Happy with this, or should something change?", multi: false, options: [proceed "Looks good, continue" (Recommended), iterate "Change something", hold "Pause"]} ]}`.
   - The runs-gate rule: this conversation holds a runDb, and a fresh run has no recorded sweep decision, so the gate is published (not pane-form-only, not a recorded answer).
   - Only 1 branch option, under the 4-option cap, so no `branches-1` split. `next` is its own question.
6. On gate_ask ok with paneAction form: show `formContext` then ask each `formChunks` via AskUserQuestion, then `gate_answer {id, answers: {"branches": ["feat-a"], "next": "proceed"}, runDb, stage}` with the human's values. STOP here: this is the sweep-approval gate, and nothing is rebased, pulled or pushed before the answer.

## What I would not do before the gate
- No branch_sync_sweep, branch_sync, git_pull or git_push.
- No stashing the dirty feat-b tree and no list of it in the form.

## Report I would give at the gate (nothing finished yet)
"Sweep plan: 1 branch to rebase (feat-a !12, clean tree). Skipped up front: feat-b !15 (dirty state unknown: the map's dirty read failed, so the tree is not known clean) and feat-c !18 (no worktree). Map complete. Waiting at the sweep gate for your pick; nothing has been rebased or pushed. run-s2 stays open (this verb started it)."
