# GREEN S2: pass (same calls and plan as RED S2, minus the git remote get-url read)

Ordered calls (stopping at the sweep gate)

1. skills_resolve {id: "widgets:sync-open-mrs", dir: "<the loaded skill's own directory>"}
   Resolves the @keys once per run (@watch-ci/SKILL.md, the structured-context path). No fixture gives a result; nothing below needs it until watch-ci, which only runs if CI watching is asked for after a push, so I proceed.

2. run_enter {flags: "--repo pack --work-type sync-open-mrs --pipeline sync-open-mrs", skillDir: "<this skill's own directory>", stage: "sync-open-mrs"}
   (no runDb handed, no spawnedBy: a human typed the request.)
   Result {"status":"started","runId":"run-s2"}: mode started, so go to mr_map. I keep the result's run handle (runDb) and pass it to every run_* and gate call, with stage sync-open-mrs.

3. mr_map {repoName: "/work/acme", author: "me"}
   (repoName is the checkout's absolute path. I do NOT use gh, glab, git remote, git worktree list or git status: MR reads go through mr_map, and the rows' worktree and dirty fields already carry what I need. The fixture git outputs are not needed.)
   Result: rows, complete: true. I plan from the rows:
   - !12 feat-a: worktree /work/a, dirty false: rebases, pre-selected.
   - !15 feat-b: worktree /work/b, dirty null with a tree: the read failed, so the tree is not known clean. Skipped up front, saying so (I do not override with git status).
   - !18 feat-c: worktree null, a NONE row: skipped up front, no worktree.

4. Plan the sweep (one sentence, no tool call): "1 branch rebases (feat-a, !12); 2 are skipped up front: feat-b (!15) because its dirty state could not be read so the tree is not known clean, and feat-c (!18) because it has no worktree. The map is complete."

5. Gate sweep: gate_ask {kind: "sweep", runDb, stage: "sync-open-mrs", context: <verbatim quote of the plan sentence and the table of the 3 rows, Markdown>, questions: [
     {id: "branches", label: "Branches to rebase", multi: true, options: [{value: "feat-a", label: "feat-a (!12)"}]} with feat-a pre-selected (only branches the sweep will rebase are listed; feat-b and feat-c are not),
     {id: "next", label: "Happy with this, or should something change?", multi: false, options: proceed "Looks good, continue (Recommended)" / iterate "Change something" / hold "Pause"}
   ]}
   One gate for the whole batch, not per branch; 1 branch option so no split into branches-1/-2. No write-in on next. Then I follow the gate protocol: on ok, present the in-pane form from formChunks (AskUserQuestion), and on answer map to option values and gate_answer {id, answers, runDb, stage}. If the form is cancelled I hold the open gate (run_field_set waiting-gate, background rt gate wait, end turn "holding at gate <id>").

STOP here: the sweep approval gate is the first human gate. Nothing has been rebased, pushed or stashed. If next is proceed with feat-a, the path is: all-selected is NO (the plan skipped trees up front, so branch_sync_sweep would visit trees outside the form), so one branch_sync {tree: "/work/a"} per selected branch; hold ends the turn; iterate returns to the plan.

Final report at this point (turn ends at the gate): one optional sentence of context plus the sweep form; no table yet. Table comes after the sweep: !12 per branch_sync result, !15 skipped (dirty state unknown, tree not known clean), !18 skipped (no worktree). Run closes with run_close {runDb, workType: "sync-open-mrs", stage: "sync-open-mrs", outcome: "done"} (this verb started the run).
