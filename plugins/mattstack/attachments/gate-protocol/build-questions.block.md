---
node: build_questions
---

# Build the gate's questions and context

Open before anything that depends on the answer. A question is `{"id",
"label", "multi", "options"}`, plus `"writeIn": true` where the site marks
`(write-in)`; `kind` is the gate's scope. Pass `subject` only for a subject
not your own.

- **Reach** is how far the gate's outcome travels: `worktree`, `draft`,
  `teammates` or `public`. A site names it as "Runs integration with kind
  `<scope>`, reach `<reach>`", or in its own words for one open; pass that
  value as `reach`. A site that names none passes none, and that gate
  always asks.
- **needsOperator** is a one-line reason, passed only where the site's
  guidance asks for one: a recommendation that turns on a product or
  people call, or a reopening the site says must ask. The gate then asks
  in every mode and shows the reason.

- **Context** is a VERBATIM QUOTE of the material under decision (the
  brief's task, the plan section, the failing output), never a fresh
  summary, and never sent empty. Lay it out as Markdown that reads the same
  unrendered: a framing line, then label lines (`Important:`) with one `-`
  bullet per item. Never trim it; the daemon drops what overflows. A
  question's own `context` sets up that question alone; an option's
  `description` is its one-line why.
- **Options** are `{value, label}` objects when values are not
  human-readable; a recommended pick's `label` ends ` (Recommended)`, its
  `value` bare. In a site table headed `Options (recommended first)`, mark
  the option the table writes; a row with none marks none.
- **The questions are the site's table, and only those.** A gate asks no
  navigation question: an answer with no `next` reads as `proceed`, and a
  write-in is the way to ask for a change (`Act on a write-in`). The
  daemon refuses an answer key the gate did not ask, except the kit form's
  run controls, `next: hold` and `next: go-back` with `to`, which Run
  control routes. Any other `next` (`iterate`, `abandon`) reaches a site
  only through a hand-back; the site's `Read next` lines still route it.
- **A gate with no question to show opens nothing.** Print its one
  sentence of context and take the site's `proceed` edge.
- **Write-ins** go only on a decision question whose free text you can act
  on, never on a review-post, respond, doctor or pane-attention question.
- **At most 4 options per question**, or the whole gate goes to the wait;
  a longer list splits into `<id>-1`, `<id>-2`, ... read as one union.
