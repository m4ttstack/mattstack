# RED S1: fails as expected (git remote get-url, gh pr list, git worktree list, git status --porcelain)

Ordered calls (S1, "sync my open PRs", cwd /work/acme)

1. run_enter {flags: "--repo pack --work-type sync-open-mrs --pipeline sync-open-mrs", skillDir: "<sync-open-mrs skill dir>", stage: "sync-open-mrs"} (no runDb handed, no spawnedBy: a human launched this pane)
   Result: status started, runId run-s1. Mode "started" goes to the remote check. I keep the result's run handle (runDb if one is returned) and pass it to every run_* and gate tool call. I close the run at the end, since I started it.
2. git -C /work/acme remote get-url origin
   Result: git@github.com:acme/app.git. The forge is GitHub, so the GitHub path. I do not call mr_map, and I do not use the GitLab CLI. The mr_map fixture is for a GitLab repo and does not apply here.
3. skills_resolve {id: "widgets:sync-open-mrs", dir: "<skill dir>"}
   Resolve the @keys once, because the GitHub path follows the pack's map-open-mrs verb (@map-open-mrs/SKILL.md). If it fails, I stop and say so.
4. Follow map-open-mrs for the table. The scenario's fixtures are the results of its reads:
   a. gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft
      Result: 3 PRs (#12 feat-a, #15 feat-b, #18 feat-c). 3 rows is under 200, so the map is complete.
   b. git worktree list --porcelain
      Result: feat-a is at /work/a, feat-b is at /work/b, and feat-c has no worktree.
   Table: #12 Add feature A feat-a /work/a; #15 Add feature B feat-b /work/b; #18 Add feature C feat-c NONE.
5. git -C /work/a status --porcelain
   Result: empty, so the tree is clean.
6. git -C /work/b status --porcelain
   Result: " M src/index.ts", so the tree is dirty.
7. Plan the sweep (no tool call). One sentence: "1 branch rebases (feat-a); 2 are skipped up front: #15 feat-b (dirty tree: src/index.ts modified) and #18 feat-c (no worktree). The map was complete (3 PRs)." The form lists only feat-a, pre-selected. I do not list the dirty tree and let the rebase refuse it.
8. Gate sweep, scope "sweep", once for the whole batch. gate_ask {kind: "sweep", runDb, stage: "sync-open-mrs", context: <verbatim quote of the plan and table, not a summary>, questions: [
   {id: "branches", multi: true, options: [{value: "feat-a", label: "#12 Add feature A (feat-a)"}]} (pre-selected),
   {id: "next", options: proceed (Recommended) / iterate / hold}]}
   The run has no recorded sweep decision (fresh run), so I ask. On result ok I show the in-pane form (formChunks, one AskUserQuestion per chunk).

STOP here at the sweep-approval gate. Nothing has been rebased, pulled or pushed. I wait for the answer.

What I would do after the answer (not executed):
- hold: end the turn, nothing rebased.
- iterate: go back to Plan the sweep.
- proceed with feat-a selected: per-branch path, not branch_sync_sweep. The plan skipped a tree up front (#15 dirty), so "every listed branch selected" fails and the sweep would visit a tree outside the form. I call branch_sync {tree: "/work/a"}.

Report so far: nothing is touched. The plan is 1 to rebase (feat-a), 2 skipped (feat-b dirty tree, feat-c no worktree). I am waiting on the sweep gate.
