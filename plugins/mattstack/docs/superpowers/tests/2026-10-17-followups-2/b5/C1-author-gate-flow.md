You are a skill author writing two things for a mattstack pack, using only the convention in the system prompt (the parameterized-skills convention) as your reference; the run and gate tools it names are on the mattstack MCP server.

1. A new pipeline stage `stage-triage` that runs under `work`. It consumes `ticket`, produces `triage-notes`, and asks the human one decision (scope `triage`) with the standing options.
2. A new standalone verb `triage-flaky` that a developer runs by hand. It opens its own run (stage `triage-flaky`), asks one decision (scope `pick`), and must close its run at the end.

For each, list the exact run and gate tool calls its skill text must prescribe, in order: how it enters, how it opens the gate under the run, what records the answer, what happens on a Hold answer, how the stage or verb ends, and what is written by hand versus by a tool. Name every field the skill itself writes. Do not invent tools the convention does not name.
