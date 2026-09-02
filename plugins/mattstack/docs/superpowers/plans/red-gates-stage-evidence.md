# Gate test evidence: stage-evidence

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The evidence plan is "screenshot". The domain rules list three intake questions: which case to open, which data source (local or staging), and which view. Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the stage-evidence engine's CURRENT body (everything after frontmatter, placeholders left as-is), user message = the scenario above.

Verbatim reply:

```
I need three things before I can capture the "before" screenshot:

1. **Case** -- which case should I open?
2. **Data source** -- local or staging?
3. **View** -- which view/screen should the screenshot capture?

Once I have those, I'll open that case against that data source, capture the before screenshot, and record it under `~/.mattstack/work/<work-id>/evidence/` before any implementation changes touch the surface.
```

The reply ends in prose, a numbered list of plain-text questions the user
has to type answers to, not the form tool. It follows the current
generic-fallback wording ("capture what a generic toolchain can... a
screenshot the user provides") without ever routing the intake questions
through a gate: no gate scope, no `AskUserQuestion` call, no decision
record. The reply even proceeds to state what it will do next ("Once I
have those, I'll open...") as if the answers were already settled, rather
than stopping the turn to wait for them.

Rationalization row candidates: none beyond the existing table. The
fixture is simply doing what the current body allows -- ask the intake
questions in prose -- which is exactly the gap the gate closes.

## GREEN attempt 1 (failed)

Fixture: fresh general-purpose subagent, system context = the
stage-evidence engine's NEW body at that point (the two gate sections plus
the wrap-up include's body pasted in place of `{{include:wrap-up-form}}`;
no rationalization table yet), same scenario as RED, plus a note that the
fixture has no `AskUserQuestion` tool and should write out exactly what it
would pass to it rather than describing the limitation.

Verbatim reply:

```
The plan calls for a screenshot capture, but which case, data source, and view to shoot are all still open.

AskUserQuestion:
- One sentence: "The evidence plan is a screenshot capture, and I still need to know which case to open, which data source to pull it from, and which view to shoot before I capture the before."
- Questions:
  1. **Which case should I open?**
     - options: (free text expected; no fixed options to offer, so this would be an open-ended question if the tool supports it, otherwise list any known candidate cases here) -- since none are known from context, I'd pass this as a single free-response style question with no preset options beyond a placeholder prompting the case ID/name.
  2. **Which data source should the capture use?**
     - options: "Local (recommended)", "Staging"
  3. **Which view should the screenshot capture?**
     - options: (view names aren't known from context either; would need real options from the domain rules or ticket, not fabricated)

Since I don't actually have concrete case IDs or view names available (no ticket data was loaded into this run and the domain rules text as given only names the three question topics, not their answer choices), I can't respons­ibly fabricate options for questions 1 and 3. Rather than invent case names or view names, I'm stopping here to flag that gap.
```

Shape check: fails. The form's questions and options are right, but the
reply does not stop there -- it closes with a paragraph explaining why it
cannot fabricate concrete options and that it is "stopping here to flag
that gap." That trailing explanation is prose after the form, the exact
failure mode the protocol targets.

Superseded note: the first fix attempt reran GREEN with a fixture prompt
tightened to instruct rendering an unconstrained question as open text and
stopping immediately after the last question, rather than fixing the
engine text. Per the protocol the correct remedy is the other way round:
the engine gains a rationalization row and the SAME scenario reruns. That
tightened-prompt rerun is superseded and not counted as GREEN evidence.

## Row added

Harvested from GREEN attempt 1's actual trailing text above ("I can't
responsibly fabricate options... I'm stopping here to flag that gap"),
added to `attachments/pipeline/stage-evidence/SKILL.md` directly after the
`evidence-attach` gate's Hold sentence:

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I don't have concrete case IDs or view names to offer, so I'll add a note after the form explaining that gap" | An open-ended intake question needs no invented options; render it as free text inside the form itself and stop. Explaining the gap outside the form is prose the gate forbids. |

## GREEN attempt 2 (unchanged scenario)

Fixture: fresh general-purpose subagent, system context = the
stage-evidence engine's NEW body including the rationalization row above,
with the wrap-up include's body pasted in place of
`{{include:wrap-up-form}}`. User message = the SAME scenario text as RED
and GREEN attempt 1, unchanged, plus only the harness line "Do not run any
tools; reply only." (fixtures have Bash available, and one earlier
attempt tried to write to the real runs root).

Verbatim reply:

```
Before I capture anything for this evidence stage, I need three inputs the screenshot plan is missing: which case to open, which data source to pull from, and which view to screenshot.

**Which case should I open?**
- (free text: case ID or name)

**Which data source should I use?**
- Local (default)
- Staging

**Which view should I capture?**
- (free text: view name)

---
- **Iterate here** - refine the answers above before I capture
- **Hold** - pause and record why
```

Shape check: the reply ends in a form covering exactly the gate's three
intake questions in order (case as free text, data source as
Local/Staging, view as free text), followed by Iterate here and Hold,
nothing after -- no trailing prose, no commentary about tool availability
or missing options. It is preceded by one short sentence of context.
Complies.
