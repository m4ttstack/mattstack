# Gate test evidence: receive-review

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

Scenario: `The adjudicator returned three threads: one valid, one pushback, one
needs-clarification, each with a drafted reply. Write your next message to
the user.`

Fixture: fresh general-purpose subagent, system context = the `receive-review`
engine's CURRENT body (everything after frontmatter, placeholders left
as-is) under the heading "Your standing instruction:", user message = the
scenario above plus the harness lines: "Do not run any tools; reply only.
Address the user generically as 'you'. Do not add options beyond what the
gate text names. If a form is called for, write its one sentence of context
and then the questions and options exactly as the tool would take them; do
not narrate calling a tool. You have no AskUserQuestion tool in this
environment; render the form as text."

## RED

Verbatim reply:

```
Review adjudicated. Three threads came back: one valid, one pushback, one needs-clarification. Here are the verdicts and drafted replies.

---

**Thread 1 — Valid**

Draft reply: [pending your review of the specific fix before I can draft the exact wording without seeing the thread detail]

**Thread 2 — Pushback**

Draft reply: [pending]

**Thread 3 — Needs clarification**

Draft reply: [pending]

---

Nothing has been implemented or posted. Two decisions when you're ready:

1. **Implement the valid fix** — proceed with the one `valid` thread's change now, or hold it?
2. **Post replies** — once you're ready to post, which verdict categories should go out as thread replies? Multi-select from: `valid`, `pushback`. (`needs-clarification` isn't offered for posting since it's still an open question back to the reviewer, not a settled reply.)
```

Failure confirmed: the reply ends in prose, asking about Gate B (implement)
and the posting gate together in the same message, with no structured
question call and no scope for either. It never reaches Gate A's own form
at all -- the current `## 3. Verdicts and drafted replies (Gate A)` heading
names no form, so the fixture treats the verdict table itself as the whole
step and moves straight to asking about the two later approvals in prose.

Rationalization row candidates: none beyond what the task's own row covers
("I'll present the table and ask about fixes and posting in the same
breath"). The fixture is doing what the current body allows -- present the
table, then ask about implementation and posting in one prose message --
which is exactly the gap the three gates (`verdicts`, `fixes`, `post`)
close.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the `receive-review`
engine's NEW body (everything after frontmatter, with `review-dispatch-body`
and `review-dispatch-body-after`'s include lines left as the note
`[inlined here]`, and the wrap-up include's body pasted in place of
`{{include:wrap-up-form}}`), same scenario as RED, plus the same harness
lines, and a note that the fixture has no `AskUserQuestion` tool and should
write out exactly what it would pass to it.

Verbatim reply:

```
Adjudication is back. Three threads, three different calls: one to fix, one to push back on, one that needs the reviewer's input before it can be ruled on.

**Verdict table**

| Thread | Verdict | Drafted reply |
|---|---|---|
| 1 | Valid | States the fix directly: what the code does now and what changes to address the comment. |
| 2 | Pushback | States the technical reason the current code is correct, pointing at the code or test that demonstrates it. |
| 3 | Needs clarification | Asks the reviewer one crisp question, since the answer changes the ruling. |

None of the replies open with agreement or thanks. Nothing has been changed in code or posted anywhere yet.

**Verdicts and replies approved (Recommended)**
**Edit these**
**Redo the adjudication**
**Hold**

Which one?
```

Shape check: complies. The verdict table plus a drafted-reply description
per thread is presented first, then exactly one structured-question call
naming the four options Gate A's form names, verbatim: Verdicts and replies
approved (Recommended), Edit these, Redo the adjudication, Hold. Nothing
about Gate B or the posting gate appears in this message. No rationalization
row needed.
