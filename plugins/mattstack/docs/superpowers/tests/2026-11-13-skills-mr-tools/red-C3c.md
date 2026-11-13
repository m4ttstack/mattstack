# RED C3c: fails as expected (gh pr list --search, single read; clarify gate)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# Run C3c (checkout RT-88)

## Ordered calls

1. `git remote get-url origin` (Bash, cwd `/work/acme`)
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - What was given? A ticket id (`RT-88`). Next node: Ticket forge host? = GitHub, so the next call is `gh pr list --search`. I make no `mr_list` call: the `mr_list` fixtures belong to the GitLab branch, and this origin is GitHub.

2. `gh pr list --search RT-88 --state all --limit 200 --json number,title,headRefName,state` (Bash, cwd `/work/acme`)
   - Result: a JSON array of 200 entries, none with `RT-88` in `title` or `headRefName`.
   - Pick the branch from the result: I keep only rows whose head branch or title carries `RT-88`, and none do. The array holds exactly the 200-row limit, so the read may also be cut at 200.
   - Exactly one branch, from a complete read? No: none matched, and the read may be truncated. Next node: Gate clarify: which branch.

3. Gate clarify: which branch (scope `clarify`)
   - Gates graph: this conversation holds no `runDb`, so the "Publish and answer" branch (`gate_ask` and the rest) does not apply. Spawned pane? No: a human typed "checkout RT-88" in the session. So: in-pane form only, with nothing recorded and no `run_*` call.
   - I present the form in the pane (AskUserQuestion), and I stop here at this first human gate.
   - Context sentence: "None of the 200 pull requests `gh pr list --search RT-88` returned names RT-88 in its title or head branch, and the list may have been cut at 200 rows, so I have no candidate branch."
   - Questions:
     - `branch` (write-in): "Which branch should I check out for RT-88?" No candidate options, so the only answer is their text (a branch name, PR number or link).
     - `next`, labelled "Happy with this, or should something change?": `proceed` "Looks good, continue (Recommended)" / `hold` "Pause".
   - Selection shape: `{"branch":"<picked>","next":"proceed|hold"}`.

## What happens with the answer (not reached in this run)

- Their text: Clarify rounds = 2? No (round 1), so I go back to "What was given?" and resolve their text. A second text answer ends at **Unresolved: reported**.
- `hold`: there is no run, so I end the turn naming the gate and make no `run_hold` call.

## Final report (this turn)

I couldn't find a branch for RT-88. This repo is on GitHub (`acme/app`). `gh pr list --search RT-88` returned 200 pull requests, and none has RT-88 in its title or head branch. That list may also have been cut at 200 rows. I did not guess a branch, and I have not checked anything out or made a worktree. Which branch should I check out (a branch name, PR number or link), or should I hold?

End state: held at the first human gate, **Gate clarify: which branch**, shown as an in-pane form (no run, human-invoked).
