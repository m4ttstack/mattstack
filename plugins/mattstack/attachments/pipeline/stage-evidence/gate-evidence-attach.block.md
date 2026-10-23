---
order: 2
---

# Gate `evidence-attach` (the domain attaches here and the lookup found an open MR or PR)

One sentence above the form: what was captured and where it sits. Once a
board is drawn, open the gate with `gate_open` (gate-protocol, Structured
context): the source's `context` is a `boards@1` object whose `summary` is
that sentence and whose `boards` are the boards drawn so far, at most 12
(any more are shown at `Attach the evidence`'s evidence-boards gate), each browser
case's Board ready board by its absolute path in the screenshots folder
(the home directory written out, never `~`), with `slot: before`, its
`theme` when it has one and the brief's claim as `caption`. With no board
drawn yet (a ticket image's board is drawn at Record), it opens through
`gate_ask` with the sentence as its context.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `boards` (write-in) | **Nothing here should stay private** / **Hide something first**, with free text naming the board and what shows; no option recommended, since only the human, looking at the boards, can say | a board is drawn that is not cleared: cleared means its `evidence-cleared:<stem>` field starts with `shasum -a 256` of `~/.fast-browser/screenshots/<stem>.png` and passes the same backing check as evidence-record's Any file to show? |
| `annotations` | the proposed labels per board, each written `<TAG> \| <title> \| <description>` (browser-evidence, Labels), multi-select, all pre-selected; an image left with nothing selected goes to the waiver question (evidence record below); split `annotations-1`, ... over 4 | always |
| `attach` (write-in) | **Hand back the markdown (Recommended)** (ship attaches) / **Attach to the MR now** | always |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Selection: `{"boards":"clear|hide|<their words>|null","annotations":[...],"attach":"now|handback"}`.

**Hide something first**, or words naming a board, is a revision of that
board as under Iterate here, adding a `redact` mark over what they name;
then this gate is asked again. `Attach the evidence` still shows every
board but a cleared board at its evidence-boards gate before anything
goes up, these included.

For a board not yet drawn (a ticket image, a non-browser image), the kept
labels are its brief's `point at`. A browser case's board is already
drawn: kept labels that differ from its `point at` are a revision, as
under Iterate here, and an image left with nothing selected keeps its
board unless the note asks to waive it.

**Iterate here** with a drawn board the note names is a revision. The
board is not recorded yet and still sits in `~/.fast-browser/screenshots/`,
so walk browser-evidence's Revise a board steps 3 to 5 on it, then re-ask
this gate; `Record the evidence` records the revised board. A Hold at its
redaction gate (step 5) is the stage's hold (`run_hold`); a refused
confirm, a confirm that left an empty record unconfirmed, or spent
redaction rounds or openings re-asks this gate with the output or the spent
budget quoted.

| Thought | Reality |
|---|---|
| "I have no concrete case ids to offer, so I'll explain the gap after the form" | An open-ended intake question needs no invented options: it is free text inside the form. Prose after the form is what the gate forbids. |
