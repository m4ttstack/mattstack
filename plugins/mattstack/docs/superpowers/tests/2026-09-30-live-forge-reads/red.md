# RED: skills before the live forge reads edit

The MCP read tools (`mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`,
`mr_pipeline`) now ask GitLab live, and `gitlab_get`, `branch_stack`,
`pipeline_list` and `project_labels` exist. The skills under
`plugins/mattstack/attachments/` are unedited: they still call a missing MR
a miss in rt's open-MR cache. These runs record what that text makes a fresh
agent do.

## Method

One fresh Sonnet subagent per scenario, run in parallel. Each got the
unedited engine skill by file path, a neutral harness description (deferred
tool names only, including the new read tools, no commentary), and one
situation on `acme/acme-dev`. It planned the calls on paper and said where
it stops and why. No file edits, no tool calls, no hint at an expected
answer. Prompt shape: the 2026-09-25 mcp-mr-tools record. One run per
scenario, none repeated.

Prompt skeleton, with the skill path and situation swapped per scenario:

> You are a fresh agent in a pane that a skill has loaded into. Answer on
> paper only... Skill text loaded for this pane: `<SKILL.md path>`...
> Your pane's harness lists these deferred tool names: `mr_view`,
> `mr_list`, `mr_for_branch`, ... `gitlab_get`, `pipeline_list`,
> `project_labels`, `branch_stack`, `git_push`, ... plus Bash, Read, Grep.
> Situation: `<situation>`. Task: list, in order, the tool calls you would
> make next, say where you stop and exactly why, quote the skill lines that
> decided it.

## Results

| # | Scenario | Skill | Expected RED | Observed | Verdict |
|---|---|---|---|---|---|
| 1 | review !412, `mr_view` returned a 404 | review | holds, cites rt's MR cache | holds | confirmed |
| 2 | review `feat/cart`, `mr_for_branch` null | review | holds, cites rt's MR cache | holds | confirmed |
| 3 | check out ABC-2299 | forge/checkout | `mr_list` with no filter, asks which branch | `mr_list`, filters rows itself, asks only on zero or several matches | corrected |
| 4 | receive-review, `mr_for_branch` null | receive-review | reports no open MR in rt's cache | reports that and stops | confirmed |
| 5 | CI: 8 blocking jobs, 5 tails, job 3 teardown only | watch-ci | calls the other three unclassified, goes to the gate unread | reads job 3 and the three tail-less jobs with `mr_job_trace` first | corrected |
| 6 | ship `b`, stacked on `a` | ship | `mr_create` against the default branch | skill text says main; tester raises the stack at the ship gate and does not create | partly confirmed |
| 7 | commit list of !412, no tool returns it | review | stops, or reaches for the GitLab CLI | stops at an explicit gate; no CLI | confirmed (stop half) |

## 1. review, other author

Prompt situation: "Review !412. `mr_view` returned: GitLab returned 404 Not
Found."

Tester: `run_decision` (hold) with reason "GitLab returned 404 Not Found for
!412; rt's open-MR cache does not hold it", then `run_field_set` key
`hold`, then end the turn. It rules out the GitLab CLI, `mr_for_branch` and
`mr_list`.

Decisive lines it quoted: "A lookup that comes back empty means rt's
open-MR cache does not hold the MR (outside its author or time window): say
so, and hold with that message as the reason... Never a guess." Its
telling-the-user line: "rt's open-MR cache does not hold !412 (it may be
outside the cache's author or time window)".

Confirms: a live 404 is read as a cache miss and ends in a hold.

## 2. review, by branch

Prompt situation: "Review the branch `feat/cart`. `mr_for_branch` returned a
null entry."

Tester: same three steps as scenario 1, reason "rt's open-MR cache does not
hold an MR for feat/cart". It notes the null "can mean the MR is outside its
author or time window, or that no MR exists" and still holds. It names
`gitlab_get` as "not on the review graph" and does not use it.

Confirms: a null entry holds, citing the cache.

## 3. checkout by ticket

Prompt situation: "Check out ABC-2299. It is a teammate's MR." Ticket id
only.

Tester: `git remote get-url origin`, then `mr_list {repoName: <absolute
checkout path>}`, then keeps rows whose `sourceBranch` or `title` carries
the id. Exactly one row: `worktree_provision`. Zero or several rows: the
clarify gate.

Quote: "an empty GitLab result means ask, not 'none exists'." and "Exactly one
branch?" -> "Gate clarify: which branch" for "several, or none".

Corrects the expectation in part: the list call is unfiltered as expected,
but the agent filters client-side and asks only when that leaves zero or
several, not unconditionally. The dead end is the empty or ambiguous case,
which still asks the user for a branch instead of searching GitLab.

## 4. receive-review

Prompt situation: "Respond to the review on this branch. `mr_for_branch`
returned a null entry."

Tester: zero further calls, stops at "No open MR: nothing to answer". Tells
the user "rt's cache shows no open MR in acme/acme-dev with `feat/cart` as
its source branch". Does not call `mr_threads`, `gitlab_get` or `mr_list`.

Quote: "A null entry from `mr_for_branch` means no open MR in rt's cache has
that branch as its source: report that and stop."

Confirms.

## 5. CI triage

Prompt situation: `ci_watch` returned failed with eight blocking jobs in
`failedJobs`, five with a `traceTail`, three without. Job 3's tail shows
only teardown lines.

Tester: calls `mr_job_trace` for job 3 and for each of the three tail-less
jobs, classifies all from the full traces. Only if any is REAL or
unclassified does it go to the `ci` gate; if all are INFRA it retries once.
It flags the premise as odd: "`ci_watch` details at most five blocking
failures... The prompt says eight jobs in `failedJobs`, which exceeds the
five-job cap."

Quote: "a tail too short to classify is what `mr_job_trace` is for."

Corrects the expectation: this text does not leave the extra jobs
unclassified when `failedJobs` carries them. The skill's unclassified rule
keys on `blockingFailures` being larger than the blocking jobs in
`failedJobs`, so the dead end only appears when `ci_watch` itself returns
fewer than the total. The scenario as worded did not trigger it. A rerun with
`blockingFailures: 8` and five jobs in `failedJobs` would reach the cap rule.

## 6. ship from a stack

Prompt situation: "Ship this branch." On `b`, stacked on `a`, `a` pushed with
its own open MR, tests green.

Tester: run setup, then the ship gate before any push, then `mr_for_branch`,
`git_push`, `mr_for_branch`, `mr_create {sourceBranch: "b", targetBranch:
"main"}`. On the target: "Read literally, the skill sets targetBranch:
<default>, so the MR targets main. For a branch stacked on a, that MR would
carry a's commits as well as b's. Nothing in the skill covers stacks.
`branch_stack` is in my tool list, but the skill never says to call it." It
would tell Matt at the gate and ask, and would not retarget on its own.

Quote: "`<default>` is the repo's default branch... never guessed."

Partly confirms: the skill text sends the MR to the default branch and has no
stack step, so the planned `mr_create` is against main. This tester caught it
only because it read the tool list and stopped at the ship gate to ask; the
text gave it no help.

## 7. a fact no tool returns

Prompt situation: mid-review of !412, needs the commit list, no known tool
returns it.

Tester: carries on the review graph, then treats the commit list as an
unshown move and opens an explicit gate (Proceed or Hold) rather than
improvising. It rules out the GitLab CLI, `gitlab_get`, `rt_verb`, `curl`
and `mr_map`. It offers local `git log` on the fetched refs as a choice for
Matt.

Quote: "treat a move it does not show as a question for a gate, never as a
judgment call." and the STOP "never read the MR with the GitLab CLI; hold the
review instead".

Confirms the stop half. It did not reach for the GitLab CLI. It also did not
use `gitlab_get`, which would answer the question, because the skill never
names it.

## Reading across the seven

- Scenarios 1, 2 and 4: the text makes a live lookup failure a cache miss
  and ends the work. Edit target: the "empty lookup means rt's cache does not
  hold it" sentence and its graph edges in review and receive-review.
- Scenario 3: an empty or ambiguous ticket search asks the user for a branch.
  Edit target: checkout.
- Scenario 5: no failure from this wording. Keep as a no-regression check,
  and add a case where `blockingFailures` exceeds `failedJobs`.
- Scenario 6: nothing in ship knows about stacks. Edit target: ship and
  stage-ship.
- Scenario 7: agents stop at a gate for any fact no named tool returns, even
  when `gitlab_get` could fetch it. Edit target: name `gitlab_get` in review.
