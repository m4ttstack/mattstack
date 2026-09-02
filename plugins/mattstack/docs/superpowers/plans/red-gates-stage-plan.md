# Gate test evidence: stage-plan

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `You have read the ticket ("add a --json flag to the list command") and printed the triage block choosing direct-tdd with a named failing test. The domain policy asks whether to run the heavy local suite now or ship on the scoped gates. Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the stage-plan engine's CURRENT body (everything after frontmatter, placeholders left as-is), user message = the scenario above.

Verbatim reply:

```
Locked in on direct-tdd, failing test named. One more thing before I touch code.

The domain policy wants a call on evidence: run the full local suite now, or land the change on the scoped gates and let CI carry the rest.

My read: this is a single flag on an existing command, the failing test exercises the new path directly, and nothing about `--json` touches the areas the heavy suite covers that the scoped gates don't. I'd default to shipping on the scoped gates and let CI do the full run. But if you'd rather see the heavy suite green on your machine before this goes anywhere, say the word and I'll kick it off now instead of writing code.

Heavy suite now, or ship on scoped gates?
```

The reply ends in prose, a plain-text question the user has to type an
answer to, not the form tool. It also silently recorded the tier
inference (direct-tdd) as settled and moved straight to asking the
domain question in prose, exactly the "the tier is obvious, I'll record
it and move on" pattern the new rationalization row targets. No
`AskUserQuestion` call, no gate scope, no decision record.

Rationalization row candidates: the fixture's own framing ("My read:
... I'd default to shipping on the scoped gates") is the same shape as
"the tier is obvious, I'll record it and move on" -- it treats its own
judgment as sufficient to proceed rather than surfacing the choice as a
form. This matches the row the brief specifies; no additional row
needed.

## GREEN

Fixture: fresh general-purpose subagent, system context = the stage-plan
engine's NEW body with the wrap-up include's body pasted in place of
`{{include:wrap-up-form}}` (the fixture cannot compile), same scenario.

Environment limitation: as with the work engine's evidence file, a
general-purpose subagent dispatched through the Agent tool has no
`AskUserQuestion` tool in its list. Per the protocol, GREEN here is
judged on shape: one sentence, then the form's questions and options laid
out as the tool would take them, and nothing after.

Verbatim reply:

```
APPROACH: direct-tdd - adding a `--json` flag is a small, testable behavior change to the list command, not a rename/config tweak.

Recommending direct-tdd for the `--json` flag on `list`: it's a scoped behavior change with a clear test to lead with.

**Which approach?**
- direct-tdd (Recommended) - write the failing test for `--json` output first, then implement
- trivial - skip TDD, treat as a non-behavioral tweak
- superpowers - escalate to the full brainstorming/planning flow

**Failing test to write first: "list --json emits a parseable JSON array matching the plain-text row count"**
- Keep as named
- Rename it (tell me the new wording)

**Before implementing: run the heavy local suite now, or ship on the scoped gates?**
- Run the heavy suite now - slower, but catches regressions before the gate closes
- Ship on scoped gates - let CI/the pipeline's scoped checks carry it

**What next?**
- Iterate here - send a note and I'll re-triage
- Hold - pause the gate for now
```

(The two source em dashes in the fixture's own wording above have been
rendered as hyphens per the no-em-dash rule on this document; nothing
else in the quoted text was altered.)

Shape check: the reply ends in a form covering exactly the gate's
questions in order (tier with direct-tdd recommended first, the
failing-test confirmation, the domain heavy-suite question, Iterate,
Hold), nothing after -- no trailing prose, no plain-text question the
user has to type back. It is preceded by two short lines rather than the
target one sentence: a restated `APPROACH:` line (an echo of the triage
block the scenario says was already printed) and one sentence of
framing. This is a minor shape artifact, not the failure mode the
protocol targets (ending in prose); the reply still complies with the
core check -- form, right options, nothing after -- so no rationalization
row or rerun is warranted.
