# GREEN S1: pass (run_enter, one mr_map call; feat-a rebases, feat-b skipped as dirty null with a tree, feat-c NONE; no gh, git remote or git status)

# green-S1: ordered calls

1. `run_enter {flags: "--repo pack --work-type sync-open-mrs --pipeline sync-open-mrs", skillDir: "<the skill's own directory>", stage: "sync-open-mrs"}` (no runDb handed, no spawnedBy: a human typed the request).
   Result `{status: "started", runId: "run-s1"}`: mode is started, so go to mr_map. Keep the result's run handle and pass it as `runDb` to every later `run_*` and gate call.
2. `mr_map {repoName: "/work/acme", author: "me"}` (repoName is the checkout's absolute path). I do not run `git remote get-url`, `gh pr list` or `git worktree list`: MR and PR reads go through mr_map only.
   Result is rows with `complete: true`, so go to Plan the sweep. No skills_resolve call: no `@key` pointer is reached before the gate (`@watch-ci/SKILL.md` is only needed at follow-watch-ci).
3. Plan the sweep (no call). Rows are PRs (`#` marker):
   - `#12` feat-a, `/work/a`, `dirty: false`: rebases, pre-selected.
   - `#15` feat-b, `/work/b`, `dirty: null` with a tree: read failed, tree not known clean, so skipped up front, saying so (not listed in the form).
   - `#18` feat-c, `worktree: null`: NONE row, skipped, no worktree.
   - Map complete, so no cut-short note.
   Sentence: "1 PR (#12 feat-a) rebases; 2 are skipped up front: #15 feat-b (its tree's dirty state could not be read, so it is not known clean) and #18 feat-c (no worktree)."
4. Gate sweep: `gate_ask {kind: "sweep", runDb: <run-s1 handle>, stage: "sync-open-mrs", context: <verbatim quote of the plan sentence, Markdown with a framing line and one `-` bullet per branch>, questions: [{id: "branches", label: "Branches to rebase", multi: true, options: [{value: "feat-a", label: "#12 feat-a: Add feature A"}]} (pre-selected), {id: "next", label: "Happy with this, or should something change?", multi: false, options: [proceed "Looks good, continue" (Recommended), iterate "Change something", hold "Pause"]}]}`.
   No resumed decision exists (fresh run), so it asks. On `ok` with `paneAction: form`, present `formContext` then `formChunks` via AskUserQuestion, and STOP at this human gate. Nothing is touched before the answer.

# Final report (at the gate)

Run run-s1 started. The map found 3 open PRs, all mine. Plan: 1 rebases (#12 feat-a), 2 skipped up front (#15 feat-b: dirty state unknown, tree not known clean; #18 feat-c: no worktree). Sweep gate is open for the answer: `branches` (feat-a pre-selected) and `next` (proceed/iterate/hold). Nothing rebased or pushed yet.
Note for after the gate: because a tree is skipped (`dirty: null` with a worktree), the sweep path does not apply, so the next step on proceed would be one `branch_sync {tree: "/work/a"}`, never `branch_sync_sweep`.
