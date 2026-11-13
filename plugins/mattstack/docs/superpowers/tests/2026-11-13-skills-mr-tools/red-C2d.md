# RED C2d: fails as expected (alias origin; gh pr view; improvised clarify gate; no tool path, no fork terminal)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# Reply: scenario C2d (checkout skill)

Trigger: a teammate's branch to check out, given as `https://github.com/acme/app/pull/40`. Human-invoked, no run (no `runDb`), not a spawned pane.

## Ordered calls

1. `git remote get-url origin` (Bash)
   - Result: `git@work-github:acme/app.git`. `work-github` is an SSH host alias, and the link I was given is on github.com, so I treat the forge host as GitHub.
   - What was given? An MR/PR link, so I go to "MR forge host?" and take the GitHub edge: `gh pr view`. I do not call `mr_resolve_branch`, because that is the GitLab path.

2. `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` (Bash)
   - Result: `headRefName: "main"`, head repo `someone/app-fork`, `isCrossRepository: true`, `state: OPEN`.
   - Pick the branch from the result: the head branch is `main`, but it lives on the fork `someone/app-fork`, not on `origin` (acme/app).
   - Exactly one branch, from a complete read? The read is complete, but the name `main` does not pick the PR's code safely. Here, `main` means acme/app's own `main`. That branch is already checked out at `/work/acme` (the cwd's own branch). `worktree_provision {branch: "main"}` would also give me origin's `main`. Neither one is sam's fork branch. If I reported either path as "PR 40's branch" I would be guessing, and the skill says "Never a guess". The skill has no fork path. So I take the `no` edge to the clarify gate rather than go on to `git worktree list` and `worktree_provision`.

3. `gate_ask` (Gate clarify: which branch; no run, so no `runDb` or `stage`)
   ```json
   {
     "kind": "clarify",
     "context": "PR 40 (https://github.com/acme/app/pull/40, opened, by sam) has head branch `main` on the fork someone/app-fork (isCrossRepository: true), not on origin acme/app.\nImportant:\n- `main` on origin is acme/app's own main, already checked out at /work/acme\n- checking out `main` through worktree_provision would give origin's main, not sam's fork branch",
     "questions": [
       {"id": "branch", "label": "Which branch should I check out?", "multi": false, "writeIn": true,
        "options": [{"value": "main", "label": "main (opened, head on fork someone/app-fork)"}]},
       {"id": "next", "label": "Happy with this, or should something change?", "multi": false,
        "options": [
          {"value": "proceed", "label": "Looks good, continue (Recommended)", "description": "Move on to the next step"},
          {"value": "hold", "label": "Pause", "description": "Stop until you resume this run"}
        ]}
     ]
   }
   ```
   - On `ok` I keep `id`, `paneAction`, `formContext` and `formChunks`. With `paneAction: form` I show `formContext`, then present the in-pane form (one AskUserQuestion per chunk), and wait for Matt's answer. This is the first human gate, so I stop here.

## Final report (at the gate)

PR 40 (https://github.com/acme/app/pull/40) is sam's and is open. Its head branch is `main`, but on sam's fork `someone/app-fork`, not on acme/app. Locally, `main` is acme/app's own main and is already checked out at `/work/acme`. Provisioning `main` would also give me origin's main, not sam's code. So I have not checked anything out or picked a path. I need you to tell me which branch to check out (or write in how you want the fork branch fetched) at the "which branch" gate. Nothing was committed or pushed.

End: held at **Gate clarify: which branch** (first human gate).
