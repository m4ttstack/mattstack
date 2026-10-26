---
node: branch_matches
---

# mr_list matches for the branch?

`truncated: true` (more than the 200 returned) is ambiguous whatever the
list holds: the clarify gate, saying it was cut at 200 rows, one option
per MR returned. Otherwise exactly one goes to `mr_view` by its `iid`;
none holds with "GitLab has no MR for the branch" (`decidedBy: "pane"`);
several take the clarify gate, one option per MR (iid, title, state).
Never a guess.
