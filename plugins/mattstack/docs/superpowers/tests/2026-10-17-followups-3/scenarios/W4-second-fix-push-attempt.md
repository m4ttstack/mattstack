System file: watch-ci.md (the compiled watch-ci verb, in your system prompt).

You are inside watch-ci in an attended pane on checkout /home/dev/trees/queue-fix (GitLab, gitlab.example.com/acme/queue), branch `fix/retry-backoff`. This verb opened its own run at the start of this conversation: `run_enter` returned `{"mode": "started", "runId": "r-20261017-w4", "runDb": "/home/dev/.mattstack/runs/queue/r-20261017-w4/state.db", "at": {"stage": "watch-ci", "attempt": 1}}`. The run recorded `branch` and `mr` (https://gitlab.example.com/acme/queue/-/merge_requests/42).

History in this run so far:
- Attempt 1: `ci_watch` failed; the `ci` gate (scope `ci:watch-ci:1`) was answered `{"next": "fix"}`; you fixed, committed and pushed with `git_push`, then called `run_resolve {runDb, stage: "watch-ci", next: "iterate", attempt: 1, note: "fix pushed: 4f1c2a9b7e30", decidedBy: "pane"}`, which returned `{"ok": true, "applied": "iterate", "next": {"stage": "watch-ci", "attempt": 2}, "cleared": []}`.
- Attempt 2: `ci_watch` failed again (a second REAL failure); the `ci` gate (scope `ci:watch-ci:2`) was answered `{"next": "fix"}`, decidedBy `pane`. You fixed and committed `9d8e7f6a5b4c`. `git_push` was refused (`tree is not registered with rt`); the off-script gate `off-script:watch-ci:1` was answered `{"move": "the developer pushes the branch themselves", "why": "tree is not registered with rt", "action": "take", "next": "proceed", "note": null}`, decidedBy `pane`.

Tool results in this scene (each applies only if you make that call):

- `git rev-parse HEAD` prints `9d8e7f6a5b4c3d2e1f00`; `git ls-remote origin refs/heads/fix/retry-backoff` prints `9d8e7f6a5b4c3d2e1f00	refs/heads/fix/retry-backoff`.
- `run_resolve` with `attempt: 1`: `{"ok": true, "applied": "iterate", "next": {"stage": "watch-ci", "attempt": 2}, "cleared": [], "repeated": true}`.
- `run_resolve` with `attempt: 2`: `{"ok": true, "applied": "iterate", "next": {"stage": "watch-ci", "attempt": 3}, "cleared": []}`.
- `ci_watch` returns `{"state": "success", "pipeline": {"id": "gitlab:pipeline:9003"}}`.
- `mr_view` returns the MR, not a draft.
- `ci_lease_release`, `run_close`, `run_field_set`, `run_budget` return `{"ok": true}`.

Walk the verb from the off-script answer to the end.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the verb ends. Then say how it ends.
