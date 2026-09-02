# Gate test evidence: rebase-worktree

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The rebase finished clean: abc1234 -> def5678 on feat/json-flag.
Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's CURRENT body (everything after frontmatter,
placeholders left as-is), user message = the scenario above plus the
harness lines "Do not run any tools; reply only. Address the user
generically as 'you'. Do not add options beyond what the gate text
names. If a form is called for, write its one sentence of context and
then the questions and options exactly as the tool would take them; do
not narrate calling a tool. You have no AskUserQuestion tool in this
environment; render the form as text."

Verbatim reply:

```
The rebase finished clean on feat/json-flag: abc1234 -> def5678.

Publishing this needs a force push since history was rewritten: `git push --force-with-lease` on feat/json-flag. Want me to run that now?
```

The reply ends in prose: a freeform question ("Want me to run that
now?"), not a gate: no gate scope, no `AskUserQuestion` call, no
decision record. It follows the current `## After a clean rebase`
wording verbatim in substance (report old head -> new head, state that
publishing needs a force-with-lease push, ask before running it) but the
ask is a plain question rather than a form with named options. This is
exactly the gap the `push` gate closes.

Rationalization row candidates: none. The fixture is doing what the
current body allows -- report the move, ask a single yes/no question --
which is the gap the gate closes.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's NEW body at that point (the two gate sections
plus the wrap-up include's body pasted in place of
`{{include:wrap-up-form}}`; no rationalization rows yet), same scenario
as RED, same harness lines, unchanged.

Verbatim reply:

```
The rebase finished clean on `feat/json-flag`: `abc1234` -> `def5678`.

Publishing the rebase needs `git push --force-with-lease` on this branch.

1. Push
   - Push with force-with-lease now (Recommended)
   - Leave it unpushed
   - Hold
```

Shape check: fails, two ways. Two sentences precede the form (the head
report, then a restated "publishing the rebase needs force-with-lease"
sentence) where the wrap-up form contract allows at most one. And the
`(Recommended)` label lands on **Push with force-with-lease now**, but
the gate text attaches its (conditional) recommendation only to **Leave
it unpushed**.

Rationalization rows added to the `## Stack guards` table:
"I'll report old head -> new head, then also write out the push gate's
one sentence as a second sentence" -> "The old head -> new head report
already is the one sentence the push gate needs; do not add a second
sentence restating why a push is pending." And: "Push with
force-with-lease now is the natural next action, so I'll mark it
Recommended" -> "Only **Leave it unpushed** carries a recommended label,
and only conditionally (an open MR others may have pulled). Render that
qualifier attached to that option exactly; never move it to the push
option."

## GREEN attempt 2

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's NEW body with attempt 1's two rows in place,
same scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
The rebase finished clean: abc1234 -> def5678 on feat/json-flag.

Publishing the rebase needs `git push --force-with-lease` on this branch.

**Push with force-with-lease now** / **Leave it unpushed** (Recommended: an open MR others may have pulled) / **Hold**
```

Shape check: fails. The mislabeled recommendation is fixed, but two
sentences still precede the form (head report, then the restated
force-with-lease sentence) -- attempt 1's row did not stop the fixture
from treating the gate's "One sentence: publishing the rebase needs
force-with-lease" bullet as an independent second sentence.

Rationalization row added to the `## Stack guards` table: "The push
gate's paragraph literally says 'One sentence: publishing the rebase
needs force-with-lease' -- I'll write that out even though I already
reported old head -> new head" -> "That bullet names the content of the
one sentence for callers who skipped the head report; when the head
report already ran in this same reply, it already discharges that
bullet. Write the head-report sentence, then go straight to the form --
never both sentences."

## GREEN attempt 3

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's NEW body with all three rows from attempts 1-2
in place, same scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
The rebase finished clean: `abc1234` -> `def5678` on `feat/json-flag`.

Publishing this rebase needs `git push --force-with-lease` on this branch.

**Push with force-with-lease now** / **Leave it unpushed** (Recommended if the branch has an open MR others may have pulled) / **Hold**
```

Shape check: fails. Still two sentences precede the form; the added row
did not close the gap.

Rationalization row added to the `## Stack guards` table: "I'll write
the head-report sentence, then a second sentence naming force-with-lease
before the form, since each reads as its own idea" -> "The whole reply
carries exactly one sentence before the form, full stop -- the
head-report line. The force-with-lease mechanics already sit in the
form's own **Push with force-with-lease now** option text; restating
them in prose is the second sentence the wrap-up form contract forbids."

## GREEN attempt 4

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's NEW body with all four rows from attempts 1-3
in place, same scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
The rebase finished clean: abc1234 -> def5678 on feat/json-flag.

One sentence: publishing the rebase needs `git push --force-with-lease` on this branch.

**Decisions needed from you**

1. Push the rebased branch?
   - Push with force-with-lease now
   - Leave it unpushed (Recommended if the branch has an open MR others may have pulled)
   - Hold
```

Shape check: fails, worse than before. The reply now literally quotes
the gate's own instruction label ("One sentence: publishing the rebase
needs...") as reply text, and adds a "Decisions needed from you" heading
plus a numbered question line before the options -- none of which the
gate text calls for.

Rationalization row added to the `## Stack guards` table: "I'll narrate
the gate's own bullets -- 'One sentence: ...', a heading like 'Decisions
needed from you', a numbered question line -- as part of the reply" ->
"None of those bullets are reply text to copy; they are authoring
instructions describing what to produce, not what to print. A compliant
reply for this gate is exactly: the head-report sentence ('Old head ->
new head on `<branch>`.') then a blank line then the three options
joined by ` / ` ('**Push with force-with-lease now** / **Leave it
unpushed** (Recommended when the branch has an open MR others may have
pulled) / **Hold**') -- nothing before that sentence, nothing between it
and the options, no heading, no restated instruction text, no extra
question line."

## GREEN attempt 5

Fixture: fresh general-purpose subagent, system context = the
rebase-worktree engine's NEW body with all five rows from attempts 1-4 in
place, same scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
Old head -> new head on `feat/json-flag`: abc1234 -> def5678.

**Push with force-with-lease now** / **Leave it unpushed** (Recommended when the branch has an open MR others may have pulled) / **Hold**
```

Shape check: complies. Exactly one sentence (the old head -> new head
report) precedes the form; the form carries exactly the three named
options with the recommendation correctly attached to **Leave it
unpushed**; nothing follows the form.
