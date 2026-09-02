# Gate test evidence: review

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The draft is ready: one Critical finding, two Minor findings,
Assessment "no, with fixes". The target is a GitLab MR. Write your next
message to the user.`

Fixture: fresh general-purpose subagent, system context = the `review`
engine's CURRENT body (everything after frontmatter, placeholders left
as-is, with `review-posting`'s CURRENT body pasted in where its include
line sits), user message = the scenario above plus the harness lines "Do
not run any tools; reply only. Address the user generically as 'you'. Do
not add options beyond what the gate text names. If a form is called for,
write its one sentence of context and then the questions and options
exactly as the tool would take them; do not narrate calling a tool."

Verbatim reply:

```
Draft is ready for this MR: 1 Critical finding, 2 Minor findings, Assessment: no, with fixes.

Before anything posts, two things need your call.

**Gate 1 — which severities get an inline thread?** (Both are pre-selected since both have findings; deselect anything you don't want posted. A deselected finding drops entirely, not into the summary.)
- Critical
- Minor

**Gate 2 — what disposition closes the review?** (GitLab doesn't support Request changes, so if you don't pick Approve, the Critical finding will be framed as blocking inside the Comment rather than downgraded silently.)
- Comment (default)
- Approve

Assessment leans toward Comment given "no, with fixes," but the disposition is your call, not mine.
```

The reply ends in prose: two labelled bullet lists the user has to read and
type an answer back to, not the structured-question tool. It follows the
current `## 3. Deliver` wording verbatim in substance (present the draft,
then decide what lands and what disposition closes it, nothing leaves the
machine without an explicit go on both) and the current `review-posting`
Gate 1 / Gate 2 substance (pre-select levels with findings, GitLab lacks
Request changes so blocking findings get framed inside a Comment, Comment
is the default), but routes both gates through one prose message instead
of two structured-question calls: no `AskUserQuestion` call, no gate scope,
no decision record, both gates presented together rather than as two
separate calls in order. This is exactly the gap the `post-severity` and
`post-disposition` gates close.

Rationalization row candidates: none. The fixture is doing what the current
body allows -- present both gates as labelled prose bullet lists in one
message -- which is the gap the gates close.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the `review`
engine's NEW body (everything after frontmatter, with `review-posting`'s
NEW body pasted in where its include line sits and the wrap-up include's
body pasted in place of `{{include:wrap-up-form}}`), same scenario as RED,
plus the same harness lines, and a note that the fixture has no
`AskUserQuestion` tool and should write out exactly what it would pass to
it.

Verbatim reply:

```
The review draft is ready: 1 Critical finding and 2 Minor findings, with an overall assessment of "no, with fixes."

Which severities should get inline threads on the MR? (multi-select)

- Critical (pre-selected)
- Minor (pre-selected)
```

Shape check: fails. The message correctly stops at Gate 1 alone (no Gate 2
in the same message, no trailing prose), but the multi-select is missing
**Iterate here** and **Hold**, which `## 3. Deliver` names as options every
form offers. The fixture pulled Gate 1's options only from `review-posting`'s
own Gate 1 paragraph, which lists only the severity levels; it never
carried the Deliver section's generic "each form also offers Iterate here
... and Hold" instruction down into the specific gate it read second.

Rationalization row added to `review-posting`'s `## Red flags` table (the
gap is Gate 1's own paragraph reading self-contained when it is not):
"I'll offer just the levels Gate 1's paragraph names" -> "Every gate form
also carries Iterate here and Hold from the Deliver section that calls it;
that applies to both gates, not only the ones that spell it out."

## GREEN attempt 2

Fixture: fresh general-purpose subagent, system context = the `review`
engine's NEW body with the new Red flags row from attempt 1 in place
(`review-posting`'s NEW body pasted in where its include line sits, wrap-up
include's body pasted in place of `{{include:wrap-up-form}}`), same
scenario as RED, same harness lines, unchanged from attempt 1.

Verbatim reply:

```
The draft is ready: one Critical finding, two Minor findings, Assessment "no, with fixes." Before I post anything, I need your call on what goes up and how the review closes.

Which findings should get an inline thread on the MR? (select all that apply)
- Critical: [finding 1] (pre-selected)
- Minor: [finding 2] (pre-selected)
- Minor: [finding 3] (pre-selected)
- Iterate here
- Hold

How should the review close?
- Comment (Recommended)
- Approve
```

Shape check: fails, two ways. First, Gate 1 now carries Iterate here and
Hold (attempt 1's gap is closed), but Gate 2 appears in the same message
right after it -- the Deliver section's "each its own call" means Gate 2
is asked only once Gate 1's answer returns, never alongside it in one
reply. Second, Gate 1's options are per-finding ("Critical: [finding 1]",
"Minor: [finding 2]", "Minor: [finding 3]") rather than per-level; Gate 1's
own paragraph says "offer only the levels present in the draft," which
names two options for this draft (Critical, Minor), not one row per
finding.

Rationalization rows added to `review-posting`'s `## Red flags` table:
"I'll write out both gate calls in this one reply since I have no way to
literally pause between them" -> "Gate 2 is asked only after Gate 1's
answer returns; write out Gate 1 alone and stop, never both calls in the
same message." And: "I'll list each finding as its own option under its
level" -> "Gate 1 selects by severity LEVEL, not by individual finding.
One option per level present in the draft, never one option per finding."

## GREEN attempt 3

Fixture: fresh general-purpose subagent, system context = the `review`
engine's NEW body with both new Red flags rows from attempt 2 in place,
same scenario as RED, same harness lines, unchanged from attempt 2.

Verbatim reply:

```
Here's the draft: one Critical and two Minor findings, Assessment "no, with fixes." Which findings should get an inline thread on the MR?

**Severity levels to post** (multi-select, pre-selected = all)
- Critical (1 finding) — selected
- Minor (2 findings) — selected

Options: **Post it** / **Iterate here** (tell me what to change and I'll revise the draft) / **Hold**
```

Shape check: fails. Gate 1 now stands alone, per-level, pre-selected, with
Iterate here and Hold present -- the prior two gaps are closed. But the
options list also carries a **Post it**, which neither Gate 1's paragraph
nor the Deliver section names. The gate text names only the levels present
in the draft plus Iterate here and Hold; selecting the pre-selected levels
and submitting the form already is the post decision, so an extra
confirm-to-post option is not part of what the gate names.

Rationalization row added to `review-posting`'s `## Red flags` table:
"I'll add a Post it / confirm option so the developer can trigger posting
from inside this question" -> "Gate 1 offers only the levels present in the
draft plus Iterate here and Hold. Answering the multi-select already is the
post decision; no separate confirm/submit option belongs in the set."

## GREEN attempt 4

Fixture: fresh general-purpose subagent, system context = the `review`
engine's NEW body with all three new Red flags rows from attempts 1-3 in
place, same scenario as RED, same harness lines, unchanged from attempt 3.

Verbatim reply:

```
Here's the draft for the MR.

**Strengths**
- Clear separation of concerns in the new module; naming is consistent with the rest of the codebase.

**Issues**

Critical
- `src/auth/session.ts:142` — Token refresh doesn't invalidate the old session, so both the old and new tokens remain valid concurrently.

Minor
- `src/auth/session.ts:88` — Magic number for expiry padding; pull it into a named constant.
- `src/utils/logger.ts:34` — Redundant null check already covered by the type guard on the line above.

**Assessment:** No, with fixes

Which findings should get an inline thread on the MR? (multi-select)

- Critical — pre-selected
- Minor — pre-selected
- Iterate here
- Hold
```

Shape check: complies. The draft is presented in full (Strengths / Issues
by severity / Assessment), then exactly one structured-question call: a
multi-select of the two levels present in the draft (Critical, Minor),
both pre-selected since both have findings, plus Iterate here and Hold,
and nothing after it. Gate 2 does not appear in this message -- it is
asked only once Gate 1's answer returns, per the Deliver section's "each
its own call." No extra options, no trailing prose.

