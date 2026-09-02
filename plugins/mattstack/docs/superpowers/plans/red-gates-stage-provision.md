# Gate test evidence: stage-provision

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `rt worktree provision returned error branch-attached:hedwig for ticket T-100. Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the stage-provision engine's CURRENT body (everything after frontmatter, placeholders left as-is), user message = the scenario above.

Verbatim reply:

```
I found that hedwig already has a branch attached for another ticket or task. I need to know from you whether to resume work in that worktree or handle T-100 differently.

Could you confirm: should I resume in the `hedwig` worktree (picking up whatever is already there), or do you want T-100 provisioned somewhere else?
```

The reply ends in prose, a plain-text question the user has to type an
answer to, not the form tool. It follows the current bullet's instruction
literally ("surface \"resume in `<tree>`?\" to the user") and stops there:
no gate scope, no `AskUserQuestion` call, no decision record, no
alternative (a fresh tree) offered as a real option rather than an implied
"or handle T-100 differently."

Rationalization row candidates: none beyond the existing table. The
fixture is simply doing what the current bullet tells it to do -- surface
the question in prose -- which is exactly the gap the gate closes.

## GREEN

Fixture: fresh general-purpose subagent, system context = the
stage-provision engine's NEW body with the wrap-up include's body pasted
in place of `{{include:wrap-up-form}}` (the fixture cannot compile), same
scenario.

Environment limitation: as with the work and stage-plan engines' evidence
files, a general-purpose subagent dispatched through the Agent tool has no
`AskUserQuestion` tool in its list. Per the protocol, GREEN here is judged
on shape: one sentence, then the form's questions and options laid out as
the tool would take them, and nothing after.

Verbatim reply:

```
Ticket T-100 already has a worktree attached: **hedwig**.

Since I have no AskUserQuestion tool available in this turn, here is exactly what I would pass to it:

**Question:** "T-100 already has an attached worktree (`hedwig`). How do you want to proceed?"

**Options (single-select):**
1. **Resume in `hedwig`** (Recommended) - enter the existing worktree and continue from there
2. **Fresh tree** - provision a new worktree for T-100 instead
3. **Iterate here** - keep discussing before deciding
4. **Hold** - pause this stage for now
```

(The source em dashes in the fixture's own wording above have been
rendered as hyphens per the no-em-dash rule on this document; nothing
else in the quoted text was altered.)

Shape check: the reply ends in a form covering exactly the gate's
questions in order (the branch-attached resume/fresh choice with Resume
recommended first, then Iterate/Hold), nothing after -- no trailing prose,
no plain-text question the user has to type back. It is preceded by one
short sentence naming the tree and the ticket, matching the protocol's "at
most one sentence" bound. Complies.
