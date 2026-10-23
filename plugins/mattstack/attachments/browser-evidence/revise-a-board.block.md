---
order: 11
---

# Revise a board

A change that needs a recapture (a new crop, new targets) goes back
through `Draw the boards` with the edited brief. Never a browser tool
yourself. Every other change needs no browser, and works in
`~/.fast-browser/screenshots/`; the run's evidence folder is never written
by hand:

1. Find the image in the record's `value`; its `annotated` path's folder
   holds the bundle. No `<stem>.spec.json` there: say so and offer a new
   capture.
2. Bring the recorded bundle back into the screenshots folder, then clear
   its redaction files there so no stale record rides into the new render,
   each as its own command (a glob that matches nothing stops a whole zsh
   command):
   `cp <bundle folder>/<stem>.* ~/.fast-browser/screenshots/`
   then, for a pair, each capture the spec's `panels` name, with its PNG,
   from the bundle folder, then
   `find ~/.fast-browser/screenshots -maxdepth 1 \( -name '<stem>.redact-*.png' -o -name '<stem>.redactions.json' \) -delete`
3. Edit `~/.fast-browser/screenshots/<stem>.spec.json`: the wording, tags,
   marks or redactions asked for, keeping the Labels rule, and append
   `{ "asked": "<their words>", "changed": "<what you changed>" }` to its
   top-level `revisions` list (create it if absent). On a return from step
   5, add their words to this revision's entry instead of appending one,
   so `<k>` stays the same for the whole revision.
4. `fast-browser compose ~/.fast-browser/screenshots/<stem>.spec.json`, and
   read the board as in Read the board yourself.
5. A redaction record beside it (`<stem>.redactions.json`, with crops or
   empty): Gate evidence-redaction, then `fast-browser compose --confirm`
   on that spec. An empty record takes Confirm a mock-data board instead
   only when the board's `evidence-cleared:<stem>` field read `<sha> no
   redact marks: mock data from ...` before this revision and nobody asked
   for anything to be hidden in it; the hide line comes from that field. A
   confirm either way writes the field anew (Record the clearance). Naming this board returns to step 3
   with their words, counted against `redaction-rounds:<stem>:r<k>`. A Hold there
   holds the revision with nothing recorded; a refused confirm, a confirm
   that left an empty record unconfirmed, or spent redaction rounds or
   openings ends the revision, the output or the spent budget quoted.
6. Record the board (above) for every image the board shows, the claim as
   `caption` (changed or not), through evidence-record's `Record the
   evidence`. The changed bundle lands in a content folder beside the old
   one and the record moves to it.
7. Attach the evidence (evidence-record): `evidence_attach` uploads the
   changed board and rewrites the evidence section.

A revision counts its own budgets and gates: every `evidence:*` key used
while walking it (re-renders, redaction openings and rounds, confirm
refusals, and on a recapture sign-in asks and doctor reds, and
evidence-record's `redaction-repairs:<stem>` in step 7) ends in `:r<k>`,
and its redaction gate's scope is `evidence-redaction:<stage>:r<k>:<n>`,
where `<k>` is the length of the spec's `revisions` list after step 3. A
run that already spent them drawing the board still gets a fresh
allowance, and no earlier gate answer reads as this one.
