---
node: capture_after_browser
label: Capture after browser
---

# Capture the AFTER with the browser (browser-evidence)

Ship captures no BEFORE: a BEFORE is only what the evidence record
already holds, taken before implementation changed the surface, so a case
with no bundled BEFORE gets an AFTER board alone.

`Browser screenshot for this case?` is yes when the domain has a
Browser target section (at any heading level) (in its rules, or in the file they point at
for it) and either its What proves a change names a view for this case's
kind of change, or it has no What proves a change block and the plan's
evidence for the case is a screenshot of a web page. A bound domain with
no browser target always answers no. Unbound, it is yes when the case's
BEFORE in the record is a browser board (a `<stem>.spec.json` beside it)
or the plan's evidence for the case is a screenshot of a web page.

A case already in the record keeps its `id`; a new case gets its `id` and
`label` first, since the stem needs the id. The after brief's stem is
`<run id>-<case id>-after[-<theme>]`, the theme only for an image in a
`{light, dark}` slot:

- The case's before has a bundle (a `<stem>.spec.json` beside its board in
  the evidence folder): the brief is a pair, `state: BEFORE → AFTER`, with
  `before:` that spec's absolute path.
- Otherwise (different screens, a ticket link or text as the before, or a
  new case) the after is its own `AFTER` board, with no `before:`.

`page:` comes from Reach the view, on the pushed sha; `show` and `point
at` from What proves a change, the wording from Captions and `hide` from
Personal data. Unbound, every block takes its default.

The first browser case of this pass takes every named browser case not
yet tried into one hand-off: write all their after briefs, then walk
browser-evidence's `Draw the boards` (Browser evidence below) once for
them, so its redaction gate asks about them together. A later browser case
already in that hand-off reads its own terminal from it, with no new
spawn. A retry after `ship:after-attempts` is a hand-off of that case
alone. A browser case named after that hand-off was made starts a hand-off
of its own.

Its terminals answer `AFTER result?`. Board ready is captured: the AFTER
goes into `Record the evidence` with its board. Held at evidence-redaction
is the stage's hold. Not drawn because the developer left it uncaptured,
the doctor stayed red, there was no compose on PATH, the sign-in asks were
spent, there was no driver to spawn, the redaction rounds or openings were
spent, or the confirm was refused twice: no retry fixes those, so the case
goes on without its AFTER and the description names the gap. A failed
brief or spent re-renders count as a failed capture against
`after-attempts`.

A yes case follows browser-evidence alone: the domain's own capture,
preview, draw or annotate steps apply only to its other evidence kinds.
