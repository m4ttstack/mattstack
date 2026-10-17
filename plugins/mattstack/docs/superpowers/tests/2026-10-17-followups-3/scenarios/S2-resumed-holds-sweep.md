System file: sync-open-mrs.md (the compiled sync-open-mrs verb, in your system prompt).

You are inside sync-open-mrs in an attended pane on checkout /home/dev/src/queue (GitLab, gitlab.example.com/acme/queue). A human typed the verb. `run_enter` returned `candidates` naming one running run, the human picked Resume, and the second `run_enter` returned `{"mode": "resumed", "runId": "r-20261017-s2", "runDb": "/home/dev/.mattstack/runs/pack/r-20261017-s2/state.db", "at": {"stage": "sync-open-mrs", "attempt": 1}, "clearedHold": true}`. `run_snapshot` shows the decision `{"contract": "gate@1", "scope": "sweep", "selection": {"branches": ["acme-3-fix", "acme-4-docs"], "next": "proceed"}, "decidedBy": "pane"}` and no other decision. `mr_map` returned the same two clean rows (`!3` on `acme-3-fix` at `/home/dev/trees/queue-3`, `!4` on `acme-4-docs` at `/home/dev/trees/queue-4`), `complete: true`. You planned the sweep: two branches rebase. You are at "Gate sweep".

Tool results in this scene (each applies only if you make that call):

- `gate_ask` returns `{"id": "g-sweep-2", "presentation": "form", "paneAction": "form", "subject": "run:r-20261017-s2", "formChunks": 1}`.
- `gate_answer`, `run_field_set`, `run_decision` and `gate_record` return `{"ok": true}`.

Walk the verb from "Gate sweep" until the sweep answer is in hand and you are about to call the rebase tool. Stop there.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments. Then say where you stopped.
