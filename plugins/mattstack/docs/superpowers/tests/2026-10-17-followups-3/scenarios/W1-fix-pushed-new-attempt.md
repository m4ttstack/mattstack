System file: watch-ci.md (the compiled watch-ci verb, in your system prompt).

You are inside watch-ci in an attended pane on checkout /home/dev/trees/queue-fix (GitLab, gitlab.example.com/acme/queue), branch `fix/retry-backoff`. This verb opened its own run at the start of this conversation: `run_enter` returned `{"mode": "started", "runId": "r-20261017-w1", "runDb": "/home/dev/.mattstack/runs/queue/r-20261017-w1/state.db", "at": {"stage": "watch-ci", "attempt": 1}}`. The run recorded `branch` and `mr` (https://gitlab.example.com/acme/queue/-/merge_requests/42). `ci_watch` returned `failed` for sha `4f1c2a9b7e30`; `ci_triage` classified `unit` as REAL (a test in the touched file); the `ci` gate (scope `ci:watch-ci:1`) was answered in this pane: `{"next": "fix", "note": null}`, decidedBy `pane`. You fixed the test, committed it as `9d8e7f6a5b4c`, and called `git_push {tree: "/home/dev/trees/queue-fix", leaseMrUrl: "https://gitlab.example.com/acme/queue/-/merge_requests/42"}`.

Tool results in this scene (each applies only if you make that call):

- That `git_push` returned `{"pushed": true, "sha": "9d8e7f6a5b4c3d2e1f00", "mr": {"iid": 42, "url": "https://gitlab.example.com/acme/queue/-/merge_requests/42"}, "priorPipelineId": 9001}`.
- `run_stage {action: "start", stage: "watch-ci"}` returns `{"ok": false, "error": "stage watch-ci is running (attempt 1); resume it with run_enter"}`.
- `run_resolve` returns `{"ok": true, "applied": "<the next you passed>", "next": {"stage": "watch-ci", "attempt": 2}, "cleared": []}`.
- `run_budget` returns `{"spent": 1, "limit": <the limit you passed>}`.
- `ci_watch` returns `{"state": "success", "pipeline": {"id": "gitlab:pipeline:9002"}}`.
- `mr_view` returns the MR, not a draft.
- `ci_lease_release`, `run_close`, `run_field_set` return `{"ok": true}`.

Walk the verb from the `git_push` result to the end.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments, until the verb ends. Then say how it ends.
