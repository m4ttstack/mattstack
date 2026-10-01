# GREEN: skills after the live forge reads edit

The same situations as `red.md`, run against the edited engine skills
under `plugins/mattstack/attachments/`, plus an eighth check that only
exists after the edit.

## Method

One fresh Sonnet subagent per scenario, run in parallel, one run each. Same
prompt shape as the RED record: the edited skill by file path, the harness
described by deferred tool names (the live read tools included), one
situation on `acme/acme-dev`, answered on paper with no file edits and no
tool calls. No hint at an expected answer. Scenario 5 is the two-job-class
case from RED (five tails, three without, job 3 teardown only).

## Results

| # | Scenario | Skill | Expected | Observed | Verdict |
|---|---|---|---|---|---|
| 1 | review !412, `mr_view` returned a 404 | review | holds quoting GitLab's text, no cache wording | holds with reason "GitLab returned 404 Not Found"; no `mr_list`, no CLI | met |
| 2 | review `feat/cart`, `mr_for_branch` null | review | `mr_list {sourceBranch, state: all}`; none found holds saying GitLab has no MR | calls `mr_list {sourceBranch: "feat/cart", state: "all"}`; one match goes to `mr_view`, several to the clarify gate, none holds "GitLab has no MR for the branch" | met |
| 3 | check out ABC-2299 | forge/checkout | `mr_list {search, state: all}`; picks on one match, asks on zero or several | `mr_list {search: "ABC-2299", state: "all"}`, then `mr_list {state: "all", limit: 200}` only when no row names the ticket; provisions on exactly one branch, clarify gate otherwise | met |
| 4 | receive-review, `mr_for_branch` null | receive-review | reports GitLab has no open MR, no cache wording | no further calls; reports GitLab has no open MR with that source branch and stops | met |
| 5 | CI: 8 blocking jobs, 5 tails, job 3 teardown only | watch-ci | `mr_job_trace` for the three tail-less jobs, more of job 3 | `mr_job_trace` for the three tail-less jobs and a `grep` or `headLines` read of job 3 before classifying | met |
| 6 | ship `b`, stacked on `a` | ship | `branch_stack` before the gate, gate names `a`, `mr_create` with `targetBranch: "a"` | `branch_stack {tree}` before `gate_ask`, target `a` named in the gate sentence, `mr_create {... targetBranch: "a"}` | met |
| 7 | commit list of !412 | review | `gitlab_get` on `projects/:id/merge_requests/412/commits`, no gate | one `gitlab_get` call on that path, no gate, no CLI | met |
| 8 | watch-ci, needs a job's artifact file list | watch-ci | `gitlab_get` on the job, no gate | `gitlab_get {repoName, path: "projects/:id/jobs/9041"}`, no gate, no CLI or `curl` | met |

All eight met on the first run; no skill text changed after GREEN.

## Notes

- Scenario 4's tester read the first 837 lines of the 1374 line skill and
  said so; the deciding graph edge and its step text sit inside that range.
- Scenario 8 ran against the engine source, since the in-repo compile
  produces only the `shepherdr` verb.
