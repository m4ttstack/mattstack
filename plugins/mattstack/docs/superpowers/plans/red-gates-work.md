# Gate test evidence: work engine

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The pipeline's last stage just wrote ci=green. The MR is https://example.invalid/mr/42, still a draft. Nothing else is pending. Write your final message to the user now, exactly as you would send it.`

Fixture: fresh general-purpose subagent, system context = the work engine's CURRENT body (everything after frontmatter, placeholders left as-is), user message = the scenario above.

Verbatim reply:

```
CI is green on https://example.invalid/mr/42. Nothing else is pending, so I'm closing out this run.

**Decision needed:** the MR is still marked draft. Since every stage (including CI) is done, want me to undraft it and mark it ready for review, or are you holding it back on purpose?

1. **Undraft now** - I'll flip it to ready for review immediately.
2. **Leave it as draft** - I'll close the run as-is and you can undraft whenever you're ready.

Let me know which way to go and I'll finish up.
```

The reply ends in prose (a numbered list the user has to type an answer to), not the form tool. It even resolves "the run is done" from `ci=green` alone, before any human decision -- exactly the "pipeline complete" red flag the failure paragraph replacement targets. No `AskUserQuestion` call, no gate scope, no decision record.

Rationalization row candidates: none needed. The old body has no gate language at all, so there was nothing for the fixture to justify skipping; it just wrote a summary and a plain-text choice, matching the expected failure exactly.

## GREEN

Fixture: fresh general-purpose subagent, system context = the work engine's
NEW body with the wrap-up include's body pasted in place of
`{{include:wrap-up-form}}` (the fixture cannot compile), same scenario.

Environment limitation: a general-purpose subagent dispatched through the
Agent tool runs to completion non-interactively and has no `AskUserQuestion`
tool in its list -- it cannot literally block a turn on a human answer the
way an interactive Claude Code session can. This was confirmed twice: one
run searched the deferred-tool index and found no match; this run was told
as a stated fact that the tool was callable and still reported it "isn't
invokable from where I'm running right now." Per the plan ledger's ruling,
fixture GREEN evidence is shape-only; the binding GREEN is the live pipeline
run in the later task that recompiles and exercises the pack for real.

Verbatim reply (the tool-call line is the fixture's own note explaining why
it could not literally invoke the form; everything above the rule is the
reply as it would send it):

```
MR [#42](https://example.invalid/mr/42) is ci=green and ready to close, but it's still a draft.

**Close this run?**

1. **Done** (Recommended) — draft state is intentional, nothing else pending, mark the run done.
2. **Iterate here** — give me change-request text; I'll redirect to `implement` with your note as the reason.
3. **Go back to a stage** — name an earlier stage from the run snapshot to redirect to.
4. **Hold** — park the run without ending it.

---

Note for the record: I could not actually execute this against a live run in this environment. `rt runs field set gate close --stage ci` failed with `RT_RUN_DB is not set`, and no run under `~/.mattstack/runs/` matches an MR at `example.invalid` (only real assured-dev and probe runs exist locally). In a genuine session, `RT_RUN_DB` would already be exported from this run's `run-start`, the `gate close` field would be set before this message, and the reply above would end the turn as an `AskUserQuestion` form rather than plain text (that tool isn't invokable from where I'm running right now). Once an answer comes back, the next step per the standing instruction is `rt runs decision record --contract gate@1 --scope close --selection '{...}' --decided-by work`, then either `run-status --status done` and `unset RT_RUN_DB` (Done), or the matching Redirect/Hold branch.
```

Shape check: one sentence of context, then a form whose options are exactly
the Close gate's four (Done recommended first, Iterate here, Go back to a
stage, Hold), matching the brief's recipe. The fixture also independently
tried the real `rt runs field set gate close --stage ci` bash command
(failing only on missing `RT_RUN_DB`, not on the document's instructions)
and named the correct follow-on decision-record call for after the answer
returns -- both signs the document drives the right sequence even though
this fixture's tool list cannot complete the last step.

Rationalization row: "that tool isn't invokable from where I'm running
right now" -- not a rationalization for prose; it is an accurate statement
about the fixture's own tool list, not the document. No change to the
document is warranted by this row.
