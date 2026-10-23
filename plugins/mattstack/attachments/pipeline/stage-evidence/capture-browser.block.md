---
node: capture_browser
---

# Capture with the browser (browser-evidence)

`Browser screenshot for this case?` is yes when the domain has a
`## Browser target` section (in its rules, or in the file they point at
for it) and either its What proves a change names a view for this case's
kind of change, or it has no What proves a change block and the plan's
evidence for the case is a screenshot of a web page. A bound domain with
no browser target always answers no. Unbound, it is yes when the plan's
evidence for the case is a screenshot of a web page.

Give the case its `id` and `label` first: the brief's stem needs the id.
Each case's before board is one brief built from the browser target:
`state: FOUND`, `page:` from Reach the view, `show` and `point at` from
What proves a change, the wording from Captions and `hide` from Personal
data. Unbound, every block takes its default.

The first browser case of a stage pass takes every planned browser case
not yet captured into one hand-off: give each its `id` and `label`, write
all their briefs, and walk browser-evidence's `Draw the boards` (Browser
evidence below) once for them, so its redaction gate asks about them
together. A later browser case already in that hand-off reads its own
terminal from it, with no new spawn. A retry after `capture-attempts`
(another view or record) is a hand-off of that case alone, and a browser
case added after that hand-off was made starts a hand-off of its own.

Its terminals answer `Captured?`:

- **Board ready** is yes. Keep the capture, the board
  (`~/.fast-browser/screenshots/<stem>.png`) and the brief's claim for
  `Record the evidence`.
- **Held at evidence-redaction** is the stage's hold.
- **Not drawn** for a reason no retry can fix (the developer left it
  uncaptured, the doctor stayed red, no compose on PATH, sign-in asks
  spent, no driver to spawn, redaction rounds or openings spent, confirm
  refused twice) reopens the evidence gate with what was tried, which then
  offers **Hand back** and **Go on without this BEFORE** in place of
  **Proceed**, since the same pass would end Not drawn again.
- **Not drawn** for a failed brief or spent re-renders takes the no edge,
  counted against `capture-attempts`.

A yes case follows browser-evidence alone. The domain's own capture steps
(its Capture the BEFORE text, any preview capture, any draw or annotate
step) apply only to its other evidence kinds: on a browser case, the
domain's browser target supplies facts, never steps.
