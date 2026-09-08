# Fast-path test evidence: rebase-worktree (SKILLS-45)

Protocol: the fixture from `red-gates-rebase-worktree.md`, driven by
`claude -p --system-prompt-file <engine body> --tools ""` so every rep is a
fresh, reply-only context. System context = the engine's body (everything
after frontmatter, placeholders left as-is). Each user message = the
scenario plus the harness lines: "Do not run any tools; reply only.
Address the user generically as 'you'. Do not add options beyond what the
gate text names. If a form is called for, write its one sentence of
context and then the questions and options exactly as the tool would take
them; do not narrate calling a tool. You have no AskUserQuestion tool in
this environment; render the form as text. Where you would run commands,
list them verbatim in the order you would run them."

Six scenarios, one rep each in RED and GREEN; S3 and S5 got a second GREEN
rep (variance check). Scenario texts are quoted at the head of each
section.

## S1: rt installed, clean preconditions, "what do you run?"

Scenario: clean tree at /Users/dev/wt on feat/json-flag, upstream set,
default branch main, `rt` installed and the repo registered; list the
commands up to the step that moves the branch.

### RED (current body)

```
Here is the sequence for /Users/dev/wt, branch feat/json-flag. Every check runs even though you've told me the state; the skill verifies before anything mutates.

**Preconditions**

```
git -C /Users/dev/wt status --porcelain
git -C /Users/dev/wt status -sb
git -C /Users/dev/wt symbolic-ref refs/remotes/origin/HEAD
```

Empty porcelain output, an `...origin/feat/json-flag` tracking ref on the branch line, and `origin/main` from the symbolic-ref confirm what you stated. If the symbolic-ref were unset I'd fall back to `glab repo view` / `gh repo view`; I never hardcode main.

**Stack guards** (both before any fetch; either refusal ends the run)

```
glab mr view feat/json-flag
glab mr list --target-branch feat/json-flag
```

(`gh pr view feat/json-flag` / `gh pr list --base feat/json-flag` if this repo is on GitHub.) The first must show the MR targeting main or no open MR at all; anything else means the branch is stacked and I refuse, naming the target. The second must come back empty; any dependent MR means rewriting this history strands its children, so I refuse and point at `gitq:sync`. The chain moves together or not at all.

**Capture the old head** (before the fetch, so I can report old head -> new head afterward)

```
git -C /Users/dev/wt log -1 --oneline
```

**Fetch, preview, rebase**

```
git -C /Users/dev/wt fetch origin
git -C /Users/dev/wt log --oneline origin/main..HEAD
git -C /Users/dev/wt rebase origin/main
```

The `log` runs before the `rebase` so you see what's about to replay, not just what replayed. The rebase is the step that moves the branch, so I stop here per your question.

Two notes on what comes after, without running it: if the rebase conflicts, I stop immediately, list the `UU` files in one sentence, and present the conflict form in-pane (RT_RUN_DB is unset, you invoked me directly)... I never resolve, `git add`, `--continue`, or `--skip` myself. On a clean rebase, I report old head -> new head and pushing is a separate `push` gate; I never push unasked.
```

The manual fetch/rebase, never `rt sync`: the gap SKILLS-45 closes.

### GREEN

```
With clean preconditions given, this is the fast path: verify, note the head, then let `rt sync` do the fetch, stack check, rebase, and push in one call. In order:

```
git -C /Users/dev/wt status --porcelain
git -C /Users/dev/wt status -sb
git -C /Users/dev/wt symbolic-ref refs/remotes/origin/HEAD
git -C /Users/dev/wt log -1 --oneline
cd /Users/dev/wt && rt sync --json
```

The first three confirm the preconditions (empty porcelain output, a `...origin/feat/json-flag` tracking ref on the branch line, and `refs/remotes/origin/main` as the discovered default). The `log -1` records the old head so I can report old head -> new head afterward. `rt sync --json` is the step that moves the branch; its exit code alone decides what happens next. On exit 0 the push already happened, so there is no push gate to present... I would just report the move as "pushed by rt sync". Since RT_RUN_DB is unset, no `rt runs` commands run anywhere in this flow.
```

## S2: rt sync exit 4, `kind: stack-refusal`

Scenario: the refusal JSON for feat/json-flag in stack json-rollout
(parent feat/base, child feat/json-ui, tool `gitq sync --stack
json-rollout`). RED already passed: the current stack-guard wording
generalised to the tool's verdict ("Commands I would run next: none. The
refusal ends this run"). GREEN holds: refuses, quotes the hint, names the
tool, "my run ends here".

## S3: rt sync exit 4, `kind: stack-check-unavailable`

Scenario: hint "could not list open MRs to rule out a stack: gh pr list
failed: gh: not logged in"; what next?

### RED (current body)

```
**Stop: no rebase happens.** Exit 4 with `stack-check-unavailable` is a refusal, not a clean bill. The check *failed*; it did not return "no MRs". "No open MR in either direction" only clears a branch when the check actually ran, so I cannot treat `feat/json-flag` as stack-free, and a single-branch rebase onto main is illegal until the guard can run.

Commands, in order:

1. `gh auth status` ... confirm the hint is what it claims (gh unauthenticated) instead of reasoning from the error string.
2. Nothing further. No `git -C /Users/dev/wt fetch origin`, no rebase, and I never run `gh auth login` myself; authenticating is yours.

What I will not do:

- Interpret the tool failure as "no stack found, proceed."
- Re-run `gh pr view feat/json-flag` or `gh pr list --base feat/json-flag` as a workaround; they fail for the same reason.
- Resolve it by rebasing anyway and letting review catch it.

RT_RUN_DB is unset and you invoked me in-pane, so there are no `rt runs` rows to write, and none of this skill's gates (clarify, conflict, push) covers this failure mode, so no gate form. I report and hand you the fix directly:

You need to run `gh auth login` (it is interactive and takes your credentials). Once you have, tell me and I will retry, in order:

1. `rt sync --json` in /Users/dev/wt
2. If it now passes the stack guard, the skill's rebase flow: `git -C /Users/dev/wt log -1 --oneline` (record old head), `git -C /Users/dev/wt fetch origin`, `git -C /Users/dev/wt log --oneline origin/main..HEAD`, `git -C /Users/dev/wt rebase origin/main`
3. If it instead reports a real stack in either direction, I refuse the single-branch rebase and point at the stack tool.
```

Treats the unverifiable check as a hard stop, runs nothing, and hands the
human an auth chore before it will retry rt sync. The manual guards never
run.

### GREEN (rep 1)

```
Exit 4 with `kind: stack-check-unavailable` means the stack could not be verified either way. That does not stop me, and it does not license a rebase: I run the Manual path's stack guards myself, using the same forge CLI rt tried (`source: "forge"`, gh). Only if those fail too do I stop.

Commands, in order, from `/Users/dev/wt`:

1. `gh pr view feat/json-flag`
   (child check: an open PR targeting anything other than main is a REFUSE)
2. `gh pr list --base feat/json-flag`
   (parent check: any open PR based on this branch is a REFUSE)

**Expected outcome here:** both fail with the same `gh: not logged in` that rt sync reported. In that case I stop and report both failures in one line, something like: rt sync could not verify the stack (`stack-check-unavailable`), and my manual guard checks failed for the same reason (`gh: not logged in`), so I am not rebasing `feat/json-flag` until gh is authenticated. I never rebase an unverified branch. No fetch, no rebase, no stash, no form... the skill names no gate for this path, so it ends with the report.

**Only if both guards succeed** (gh happens to be authenticated for my invocation) and both come back clean (no PR targeting a non-main branch, no dependents), I continue the Manual path:

3. `git -C /Users/dev/wt fetch origin`
4. `git -C /Users/dev/wt log --oneline origin/main..HEAD`
5. `git -C /Users/dev/wt rebase origin/main`
6. `git -C /Users/dev/wt log -1 --oneline`

Then, on a clean rebase, I report old head -> new head (the head noted before rt sync is still the old head, since exit 4 moved nothing) and, since RT_RUN_DB is unset and you invoked me in-pane, present the push gate in-pane:

`<old-sha> <subject>` -> `<new-sha> <subject>` on `feat/json-flag`.

- Push with force-with-lease now
- Leave it unpushed (recommended when the branch has an open MR others may have pulled)
- Iterate here
- Hold

On conflict at step 5 instead: stop, list the conflicted files in one sentence, and present the `conflict` form in-pane (Leave the rebase in progress for me (recommended) / Abort the rebase / Iterate here / Hold). I would not resolve, `git add`, `--continue`, or `--skip` anything myself.
```

### GREEN (rep 2)

```
rt sync could not verify the stack either way (`stack-check-unavailable`), so I do not treat that as a refusal and I do not rebase yet. Per the skill, I run the manual path's stack guards myself, using the same forge CLI:

1. `gh pr view feat/json-flag` (child check: does its open PR target anything other than main?)
2. `gh pr list --base feat/json-flag` (parent check: any open PRs targeting this branch?)

Given the hint (`gh: not logged in`), I expect both to fail for the same reason. In that case I stop and report both failures: rt sync could not rule out a stack, and the manual guards failed the same way (`gh` is not authenticated). I never rebase an unverified branch, so no fetch, no rebase, no push, and no gate form... the skill defines no gate for this path, just the report. Once you log in with `gh auth login`, I can retry from `rt sync`.

Only if the guard commands unexpectedly succeed, and they show the PR targets main with no open PRs based on `feat/json-flag`, would I continue:

3. `git -C /Users/dev/wt fetch origin`
4. `git -C /Users/dev/wt log --oneline origin/main..HEAD`
5. `git -C /Users/dev/wt rebase origin/main`
6. `git -C /Users/dev/wt log -1 --oneline`

then present the push gate in-pane (RT_RUN_DB is unset, you invoked me directly), with the old head -> new head line as its one sentence of context:

Rebased feat/json-flag: \<old head\> -> \<new head\>.

- Push with force-with-lease now
- Leave it unpushed (recommended when the branch has an open MR others may have pulled)
- Iterate here
- Hold
```

Both reps: run the manual guards with the same forge CLI; stop and report
both failures if they fail for the same reason; otherwise the manual path
with its push gate. No rebase on an unverified branch.

## S4: rt sync exit 3 (paused conflict bundle)

Scenario: bundle with `unresolvedFiles: [src/app.ts, src/flags.ts]`,
`state: mid-rebase`, a backup branch; human in-pane, no run. RED already
passed (one sentence, the four options verbatim). GREEN holds and adds the
backup branch to the sentence; only `git rebase --abort` on that answer.

## S5: rt sync exit 0, heads moved, tracking ref clean

Scenario: old head `abc1234 add flag`, rt sync exit 0 with no output, new
head `def5678 add flag`, `status -sb` shows no ahead/behind.

### RED (current body)

```
feat/json-flag rebased cleanly onto origin/main: `abc1234 add flag` -> `def5678 add flag`.

**Gate: push**

Push?
- Push with force-with-lease now
- Leave it unpushed (recommended when the branch has an open MR others may have pulled)
- Iterate here
- Hold
```

A push gate for a push rt sync already made.

### GREEN (rep 1)

```
Synced: `rt sync` rebased feat/json-flag onto origin/main and pushed with force-with-lease.

- `abc1234 add flag` -> `def5678 add flag`, pushed by rt sync

The push already happened as part of the fast path, so there is nothing left to decide here.
```

### GREEN (rep 2)

```
Synced: rt sync rebased feat/json-flag onto origin/main and force-with-lease pushed it.

`abc1234 add flag` -> `def5678 add flag`, pushed by rt sync.

Nothing left to decide here... the push is already done, so there's no push gate to offer. The worktree is current with main and tracking `origin/feat/json-flag`.
```

## S6: rt not installed

Scenario: `command -v rt` prints nothing; otherwise as S1. RED passed
(manual path) and is the control; GREEN holds: "rt is absent, so this is
the Manual path", guards then rebase, no `rt sync`.

## Sweep: sync-open-mrs step 4 with two fast-path branches and one manual

Scenario: feat/a and feat/b came back "pushed by rt sync", feat/c took the
manual path and is unpushed; write the step-4 sentence and gate.

RED (current sync-open-mrs body) already listed only feat/c in the
multi-select ("feat/a and feat/b are already on their new heads remotely,
so they are not listed"). No guidance was authored; the step-3 sentence
claiming rebase-worktree "asks per branch whether to push" was corrected
as a statement of fact, and the multi-select now names "the clean,
still-unpushed branches". GREEN with the corrected body:

```
All three branches rebased clean: feat/a (aaa1111 -> aaa2222) and feat/b (bbb1111 -> bbb2222) were already pushed by rt sync, and feat/c (ccc1111 -> ccc2222) rebased on its manual path and is the only one still unpushed.

Commands, in order:

```bash
RT_RUN_DB=<runDb> rt runs field set gate push --stage sync-open-mrs
```

Gate `push` (kind: `push`), rendered as the tool would take it:

**Question 1** (multi-select): Which branches should I `git push --force-with-lease`?
- [x] feat/c (ccc1111 -> ccc2222) ... pre-selected
- [ ] Iterate here (tell me what to change)
- [ ] Hold

**Question 2**: Watch CI after pushing?
- Yes
- No

After your answer:

```bash
RT_RUN_DB=<runDb> rt runs decision record --contract gate@1 --scope push --selection '{"branches":["feat/c"],"watch_ci":<true|false>}' --decided-by <the answer's by>
```

Nothing is pushed until you answer.
```

## Rationalization rows added

From the RED shapes: "exit 4 but I can see the MR targets the default
branch, so I'll rebase by hand"; "exit 0, so now the push gate"; "the
check could not run, so the safe move is to stop and ask".
