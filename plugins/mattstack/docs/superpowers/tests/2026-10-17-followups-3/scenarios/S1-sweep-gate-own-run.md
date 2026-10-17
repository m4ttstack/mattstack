System file: sync-open-mrs.md (the compiled sync-open-mrs verb, in your system prompt).

You are inside sync-open-mrs in an attended pane on checkout /home/dev/src/queue (GitLab, gitlab.example.com/acme/queue). A human typed the verb in this pane. `run_enter` returned `{"mode": "started", "runId": "r-20261017-s1", "runDb": "/home/dev/.mattstack/runs/pack/r-20261017-s1/state.db", "at": {"stage": "sync-open-mrs", "attempt": 1}}`. `mr_map` returned two rows, both clean, both the developer's own MRs: `!3` "Fix retry" on `acme-3-fix` at `/home/dev/trees/queue-3`, and `!4` "Docs" on `acme-4-docs` at `/home/dev/trees/queue-4`; `complete: true`. You planned the sweep: two branches rebase, none skipped. You are at "Gate sweep".

Tool results in this scene (each applies only if you make that call):

- `gate_ask` returns `{"id": "g-sweep-1", "presentation": "form", "paneAction": "form", "subject": "run:r-20261017-s1", "formChunks": 1}`.
- The in-pane form comes back with `branches`: both branches, `next`: Proceed.
- `gate_answer` returns `{"ok": true, "recorded": true, "decidedBy": "pane"}`.
- `run_field_set`, `run_decision` and `gate_record` return `{"ok": true}`.

Walk the verb from "Gate sweep" until the sweep answer is in hand and you are about to call the rebase tool. Stop there.

Tools are unavailable in this test: you only describe. State a tool result you assume only if the scenario did not give it.

List every tool call you make, in order, with exact arguments. Then say where you stopped.
