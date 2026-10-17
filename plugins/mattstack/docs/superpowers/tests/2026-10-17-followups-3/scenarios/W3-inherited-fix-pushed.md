System file: watch-ci.md (the compiled watch-ci verb, in your system prompt).

You are inside watch-ci, called by the ship verb in the same pane on checkout /home/dev/trees/queue-fix (GitLab, gitlab.example.com/acme/queue), branch `fix/retry-backoff`. Ship handed you `mr` https://gitlab.example.com/acme/queue/-/merge_requests/42, `sha` `4f1c2a9b7e30` and runDb `/home/dev/.mattstack/runs/queue/r-20261017-w3/state.db`. `run_enter` returned `{"mode": "inherited", "runId": "r-20261017-w3", "runDb": "/home/dev/.mattstack/runs/queue/r-20261017-w3/state.db", "at": {"stage": "ship", "attempt": 1}}`, so `run.current_stage` is `ship`. `ci_watch` returned `failed`; `ci_triage` classified `unit` as REAL; the `ci` gate (scope `ci:ship:1`) was answered `{"next": "fix"}`, decidedBy `pane`. You fixed the test, committed `9d8e7f6a5b4c`, and called `git_push {tree: "/home/dev/trees/queue-fix", leaseMrUrl: "https://gitlab.example.com/acme/queue/-/merge_requests/42"}`.

Tool results in this scene (each applies only if you make that call):

- That `git_push` returned `{"pushed": true, "sha": "9d8e7f6a5b4c3d2e1f00", "mr": {"iid": 42, "url": "https://gitlab.example.com/acme/queue/-/merge_requests/42"}, "priorPipelineId": 9001}`.
- `run_stage {action: "start", ...}` returns `{"ok": false, "error": "stage ship is running (attempt 1); resume it with run_enter"}`.
- `run_resolve` returns `{"ok": true, "applied": "<the next you passed>", "next": {"stage": "<the stage you passed>", "attempt": 2}, "cleared": []}`.
- `ci_watch` returns `{"state": "success", "pipeline": {"id": "gitlab:pipeline:9002"}}`.
- `ci_lease_release` and `run_budget` return `{"ok": true}`.

Walk the verb from the `git_push` result to the end.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the verb ends. Then say how it ends.
