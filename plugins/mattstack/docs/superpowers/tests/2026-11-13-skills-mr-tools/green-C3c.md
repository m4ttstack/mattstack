# GREEN C3c: pass (both mr_list reads, in-pane clarify form naming the 200-row cut; no provision)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# C3c reply: "checkout RT-88"

No `@key` pointer sits on this path (the only one is in the structured-context part, which a clarify gate with no run never reaches), so I make no `skills_resolve` call.

## Ordered calls

1. `git remote get-url origin`
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - What was given? A ticket id (`RT-88`), so I take the `mr_list` search edge. I do not use `gh pr list`: ticket searches go through the read tools.

2. `mr_list {repoName: "/work/acme", search: "RT-88", state: "all", limit: 200}`
   - Result: 200 rows, `truncated: true`, and no row has `RT-88` in `title` or `sourceBranch`.
   - Search returned a row naming the ticket? No. The forge's search never looks at the source branch, so I make the one extra unfiltered read.

3. `mr_list {repoName: "/work/acme", state: "all", limit: 200}`
   - Result: 200 rows, `truncated: true`. I filter `sourceBranch` for `RT-88` myself and find no match.
   - Pick the branch: no row picked, and both reads were cut at 200 rows. The pick is not safe.
   - Exactly one branch, from a complete read? No (none found, and the read was truncated), so I go to **Gate clarify: which branch**.

4. Gate clarify: which branch (scope `clarify`)
   - Gates graph: this conversation holds no `runDb`. Not a spawned pane, because a human typed "checkout RT-88". So I show an **in-pane form only, with nothing recorded**: no `gate_ask` and no `run_*` call.
   - One `AskUserQuestion` call, with this context sentence:
     > I searched GitHub for RT-88 in acme/app: the forge search (`search: RT-88`) and an unfiltered list both stopped at 200 rows (`truncated: true`), and none of the 400 rows returned has RT-88 in its title or source branch. A matching PR or branch may sit past the cut.
   - Questions:
     - `branch` (write-in): "Which branch should I check out for RT-88?" There are no candidates, so the only option is their own text (a branch name, PR link or number).
     - `next`: "Happy with this, or should something change?": `proceed` "Looks good, continue (Recommended)" / `hold` "Pause"
   - Selection shape: `{"branch":"<picked>","next":"proceed|hold"}`.

## Stop point

This is the skill's first human gate, **Gate clarify: which branch**, so I stop here. Nothing has been checked out and no worktree has been provisioned.

## Report

I couldn't find a branch for RT-88 in acme/app. The forge search and the full PR list both stopped at 200 rows, and none of the 400 rows returned mentions RT-88 in its title or branch name. A matching PR may exist past the cut, so I won't guess. Tell me the branch name, PR link or PR number to check out, or choose hold.
