---
node: capture_after_browser
label: Capture after browser
---

# Capture the AFTER with the browser (ship, browser-evidence)

Ship captures no BEFORE: a BEFORE is only what the evidence record
already holds, taken before implementation changed the surface, so a case
with no bundled BEFORE gets an AFTER board alone.

`Browser screenshot for this case (ship)?` is yes when the domain has a
Browser target section, at any heading level, in its rules (or in the
file they point at for it) and either its What proves a change names a view for this case's
kind of change, or it has no What proves a change block and the plan's
evidence for the case is a screenshot of a web page. A bound domain with
no browser target always answers no. Unbound, it is yes when the case's
BEFORE in the record is a browser board (a `<stem>.spec.json` beside it)
or the plan's evidence for the case is a screenshot of a web page.

A case already in the record keeps its `id`; a new case gets its `id` and
`label` first, since the brief's stem needs the id. Write the case's after
brief (browser-evidence's `Write one brief per board`), stem
`<run id>-<case id>-after[-<theme>]`:

- The case's BEFORE has a bundle (a `<stem>.spec.json` beside its board):
  a pair, `state: BEFORE → AFTER`, with `before:` that spec's absolute
  path. The pair board covers the BEFORE image too, unless the BEFORE's
  board is an import board (Record the evidence).
- Otherwise (a different screen, a ticket link or text, a new case): its
  own `AFTER` board, with no `before:`.

`page:` comes from Reach the view, on the sha just pushed; `show` and
`point at` from What proves a change, the wording from Captions and
`hide` from Personal data. Unbound, every block takes its default.

The first browser case of this pass takes every named browser case not
yet tried into one hand-off: write all their after briefs, then walk
browser-evidence's `Draw the boards` (Browser evidence below) once for
them, so its redaction gate asks about them together. A later browser case
already in that hand-off reads its own terminal from it, with no new
spawn. A retry after `ship:after-attempts` is a hand-off of that case
alone. A browser case named after that hand-off was made starts a hand-off
of its own.

Its terminals answer `AFTER result (ship)?`. Board ready is captured; the
board is recorded with the rest in `Record the evidence (evidence-record)`.
Held at evidence-redaction is the verb's hold. Not drawn splits by its
reason: the developer left it uncaptured, the doctor stayed red, no
compose on PATH, sign-in asks spent, no driver to spawn, redaction rounds
or openings spent, or confirm refused twice goes on without the AFTER,
and the description names the gap. A failed brief or spent re-renders is
a failed capture, counted against `ship:after-attempts:<case id>`.

A yes case follows browser-evidence alone: the domain's own capture
steps (its AFTER capture, any preview, any draw or annotate step) apply
only to its other evidence kinds.
