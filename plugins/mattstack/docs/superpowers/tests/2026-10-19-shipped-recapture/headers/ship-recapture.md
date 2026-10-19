# Scenario (describe only: run no tools; answer from the skill text below)

The operator invokes ship in a pane in the worktree /repo/wt (branch widgets-123-badge, GitLab) with: "the AFTER on the MR for run r7 is stale, case badge shows the old state; re-capture the AFTER and re-attach the evidence". Run r7 is this branch's standalone ship run, runDb /runs/widgets/r7/state.db. It already shipped: it pushed the branch, opened https://gitlab.example.com/acme/widgets/-/merge_requests/42, recorded `mr`, and closed done. Nothing changed in the code since: the tree is clean and `git log --oneline @{upstream}..` lists nothing. The domain is unbound. Case badge's BEFORE in the record is a browser board with a spec beside it; the stale AFTER needs a new capture, not a relabel of the old board.

Answer in exactly five numbered lines, nothing else:
1. Every MCP tool you call, in order from the invocation to the end, tool names only, comma-separated. Leave out run_budget, run_field_get and run_snapshot, and write the whole browser-evidence capture as `capture`.
2. Do you call git_push? yes or no.
3. Do you call mr_create? yes or no.
4. If the human answers Hold at the redaction gate during the new capture, which run tool records the hold, and does the run accept it? Tool name (or none), then yes or no.
5. The last run tool call that ends the run, with its arguments, or none.
