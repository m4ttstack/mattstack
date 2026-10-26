# Scenario (describe only: run no tools; answer from the skill text below)

The work orchestrator hands you the provision stage of a `/widgets:work` run for ticket WID-123 ("Add badge levels") in the repo `widgets`, runDb /runs/widgets/r9/state.db. `run_field_get {key: mode}` returns `interactive`. The domain rules are the ones compiled into the skill below. A precheck, if you run one, returns no `attached` tree, no surviving local branch, and one `sameTicket` tree: `/wt/widgets-123-badge-levels` on branch `widgets-123-badge-levels`, no owner. `whoami` returns herd id null.

Answer in exactly four numbered lines, nothing else:
1. Every MCP tool you call, in order, until you present the provision gate (or until the stage ends, if you never present it).
2. At "Follow the domain's provision flow", do you run it? yes or no, and one clause why.
3. The options of the `resume_in` question you show, in order, or "not shown".
4. Every question id on the provision gate.
