# GREEN C3c: pass (both mr_list reads, clarify gate naming the 200-row cut; no provision)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# C3c reply: "checkout RT-88"

Context: no runDb in this conversation, and Matt invoked this himself (not a spawned pane), so the gate runs as an in-pane form through the gate protocol, with no `run_*` call. The only `@key` pointer in the skill (structured context for `gate_open`) is not on this path, so I make no `skills_resolve` call.

## Ordered calls

1. `git remote get-url origin` (Bash)
   - Result: `git@github.com:acme/app.git`. The forge is GitHub (github.com).
   - "What was given?" → a ticket id (`RT-88`). I take the `mr_list_search` edge. I do not use `gh pr list`, because ticket searches go through the read tools.

2. `mr_list {repoName: "/work/acme", search: "RT-88", state: "all", limit: 200}`
   - Result: 200 rows, `truncated: true`. I keep only rows whose `sourceBranch` or `title` contains `RT-88`. None do.
   - "Search returned a row naming the ticket?" → no. The forge search never looks at the source branch, so I make the one extra unfiltered read.

3. `mr_list {repoName: "/work/acme", state: "all", limit: 200}`
   - Result: 200 rows, `truncated: true`. I filter for `RT-88` in `sourceBranch` (and title) myself. None match.
   - "Pick the branch from the result" → no row picked, and both reads were truncated. "Exactly one branch, from a complete read?" → no (none, and a truncated read). The pick is not safe, so I go to **Gate clarify: which branch**. I make no guess, run no `gh` fallback, and do not provision.

4. `gate_ask` (gate protocol, no run, so no `runDb`/`stage`):
   ```json
   {
     "kind": "clarify",
     "context": "Checkout of RT-88 found no branch to check out.\nImportant:\n- Both searches were cut at 200 rows: `mr_list` with search RT-88 and `mr_list` with no filter each returned 200 rows with `truncated: true`, so the forge holds more PRs than were read.\n- None of the 400 rows read carried RT-88 in its title or source branch, so there are no candidates. This does not mean no PR for RT-88 exists.",
     "questions": [
       {"id": "branch", "label": "Which branch should I check out for RT-88?", "multi": false, "writeIn": true, "options": []},
       {"id": "next", "label": "Happy with this, or should something change?", "multi": false, "options": [
         {"value": "proceed", "label": "Looks good, continue (Recommended)", "description": "Move on to the next step"},
         {"value": "hold", "label": "Pause", "description": "Stop until you resume this run"}
       ]}
     ]
   }
   ```
   - Result ok → keep `id`, `paneAction`, `formContext`, `formChunks`. On `paneAction: form`, I show `formContext` in the pane and ask each `formChunks` entry with AskUserQuestion. This is the skill's first human gate, so I stop here and wait for Matt's answer.

## What happens after the answer (not reached)
- A branch name or PR number in the write-in → their text goes back to "What was given?" (clarify round 1 of 2) and resolves from there.
- `hold` → no run, so I end the turn naming the gate (**Held**).

## Report at the stop

I couldn't check out RT-88: no branch was found. Both `mr_list` reads on acme/app (searched for RT-88, then unfiltered) stopped at 200 rows with `truncated: true`. None of the 400 rows had RT-88 in its title or source branch. A PR may still exist past the cut. I'm holding at the clarify gate (scope `clarify`) for you to name the branch or PR, or to pause. Nothing was checked out and the session hasn't moved.
