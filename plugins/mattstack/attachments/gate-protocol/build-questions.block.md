---
node: build_questions
---

# Build the gate's questions and context

Open before anything that depends on the answer. A question is `{"id",
"label", "multi", "options"}`, plus `"writeIn": true` where the site marks
`(write-in)`; `kind` is the gate's scope. Pass `subject` only for a subject
not your own.

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
  the option the table writes; a row with none, such as the stage-end
  `next`, marks none.
- **`next` values** are exactly `proceed`, `iterate`, `go-back`, `hold`,
  and `abandon`, `done`, `handback` or `goon` where the site's table offers
  them; the tools read `proceed` and `iterate`. A site lists `next` by
  value; send each as `{value, label, description}` from this table,
  under the question label `Happy with this, or should something
  change?`. A site's `(recommended)` after a value makes that label end
  ` (Recommended)`, and an option the site writes in bold keeps the
  site's label and takes no description:

  | Value | Label | Description |
  |---|---|---|
  | `proceed` | Looks good, continue | Move on to the next step |
  | `iterate` | Change something | Say what to change, then redo this step |
  | `go-back` | Redo an earlier step | Return to a step that needs redoing |
  | `hold` | Pause | Stop until you resume this run |
  | `abandon` | Abandon | End this run for good |
- **Write-ins** go only on a decision question whose free text you can act
  on, never on `next` or a review-post, respond, doctor or pane-attention
  question.
- **At most 4 options per question**, or the whole gate goes to the wait.
  Navigation (`iterate`, `go-back`, `hold`, Abandon) is its own `next`
  question; a longer list splits into `<id>-1`, `<id>-2`, ... read as one
  union.
