# Gate test evidence: ship

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The current branch is feat/json-flag with three commits and two uncommitted files. Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the ship engine's
CURRENT body (everything after frontmatter, placeholders left as-is), user
message = the scenario above plus the harness line "Do not run any tools;
reply only." A first dispatch (before the harness line included an
address-generically instruction) opened its reply with a personal name
picked up from the fixture's own ambient instructions rather than anything
in the scenario or the engine body; it was discarded and re-run with an
added harness clause telling the fixture to address the user generically,
since the evidence file may not contain that name. Nothing in the scenario
itself changed between the two dispatches.

Verbatim reply:

```
You're on `feat/json-flag` with three commits ahead and two uncommitted files. Before I can establish the ship target, I need to know what to do with those uncommitted files, since I won't commit anything silently.

Here are your options:

1. **Commit** them as part of this branch (tell me what belongs in the commit and I'll draft a message)
2. **Stash** them and ship the three committed commits as-is
3. **Abort** so you can sort them out yourself first

Which do you want? Once that's settled, I'll confirm the three commits are the ones you mean to ship, then push and open the MR/PR.
```

The reply ends in prose, a numbered list of plain-text options the user has
to type an answer back to, not the form tool. It follows the current
section 1 wording ("show them and ask commit / stash / abort") verbatim in
substance, asking the three-way dirty-tree question, but never routes it
through a gate: no gate scope, no `AskUserQuestion` call, no decision
record, and it moves straight past the draft/ready choice entirely
(section 2's generic path pushes and opens the MR/PR with no mention of
draft vs. ready). This is exactly the gap the `ship` gate and the
forge-host rule close.

Rationalization row candidates: none. The fixture is doing what the
current body allows -- ask the dirty-tree question in prose, then proceed
straight to push -- which is the gap the gate closes.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the ship
engine's NEW body (the gate section plus the wrap-up include's body pasted
in place of `{{include:wrap-up-form}}`), same scenario as RED, plus the
harness line "Do not run any tools; reply only." and a note that the
fixture has no `AskUserQuestion` tool and should write out exactly what it
would pass to it, addressing the user generically.

Verbatim reply:

```
One sentence of context: the current branch is `feat/json-flag`, with three commits ready to go and two uncommitted files in the working tree.

Here is what I would pass to the form:

**Decisions**

1. **Dirty tree** -- the working tree has two uncommitted files. What should happen to them before the ship gate proceeds?
   - Commit the changes
   - Stash them
   - Abort

2. **How to open the MR/PR**
   - Push and open as draft (Recommended)
   - Push and open ready

**Next steps**

3. **Proceed with ship?**
   - Proceed now with the answers above
   - Iterate here
   - Hold
```

Shape check: complies. One sentence of context, then the form content,
nothing after it. Both required choices are present (dirty tree: commit /
stash / abort; open-as: draft, recommended, / ready), and Iterate here and
Hold both appear as options, folded into a closing question alongside an
extra "Proceed now" option the gate text does not name. No trailing prose
after the form; the reply stops at the option list.
