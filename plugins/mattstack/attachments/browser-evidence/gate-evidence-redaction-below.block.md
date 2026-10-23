---
order: 9
kind: gate
label: Evidence redaction
---

# Gate evidence-redaction (below)

Scope `evidence-redaction:<stage>:<n>`, where `<n>` counts this gate's
openings in this stage pass from 1;
`redaction-openings:<first entry of this opening>:<first crop of this
opening, or board>` (file names) budgets each opening, so a long
hand-off's later openings, and the later openings of one board's long run
of crops, are not charged to the first. Open it with `gate_open` (gate-protocol,
Structured context): the source's `context` is a `boards@1` object, so the
human sees the whole board, not only its crops.

- `summary`: one sentence asking the human to look at every board and
  crop in this opening and check that nothing on any of them should stay
  private: no personal detail, token, internal link or other customer's
  data is readable.
- `boards`: for each waiting board, the board itself, then each crop
  `<stem>.redactions.json` lists. Every entry's `path` is absolute (the
  home directory written out, never `~`) and its `case` is the brief's
  case. The board's `slot` is its stem's `before` or `after`, its `theme`
  the stem's when it has one, and its `caption` the brief's claim; each
  crop's `slot` is `crop` and its `caption` names the crop and its board
  (`Crop 1 of the badge board`).
- At most 12 entries per opening: fill each opening with whole boards (a
  board and its crops) in case order, and open the next with the boards
  left. A board with more than 11 crops spreads them over consecutive
  openings, the board first in each with the next 11 crops, until every
  crop has been shown (Crops left for this board?); its confirm waits
  until every one of those openings is answered.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `redaction` (write-in) | **Confirmed: nothing here should stay private (Recommended)** / **Something needs hiding**, with free text naming the board and what shows | always, once per opening |
| `next` | **Proceed** / **Hold** | always |

Selection: `{"redaction":"confirm|<their words>","next":"proceed|hold","note":"<their words or null>"}`.

## Their words name the boards?

Yes when their words (or the note) pick out one or more boards of this
opening, by case, claim or what the board shows. Those boards re-render
with their words; every other board of the opening counts as confirmed by
that answer and goes on to its confirm at once, without waiting for the
re-renders.

## Ask which board

A clarify question through gate-protocol, scope
`clarify:redaction-which:<n>`, in a form of its own with no `next`
question: which boards of the opening need something hidden, multiple
choice, one option per board (its case and claim), at most four options
per question, so more boards spread over consecutive questions in that
form. The form's one-line context says that boards left unpicked count as
confirmed, and that picking none confirms them all. Their earlier words
travel with each board they pick. A Hold in the form is Held at
evidence-redaction.

## Crops left for this board?

Yes while this board has crops after the ones the last opening showed:
open the next opening with the board first and the next 11 crops. No once
every crop has been in an opening answered confirmed, and at once for a
board with an empty record; only then does
`fast-browser compose --confirm` run. A re-render in any opening starts
the board again from its first crop.

- Confirm runs `fast-browser compose --confirm` on Bash on the spec that
  rendered the board, `~/.fast-browser/screenshots/<stem>.spec.json`, and
  only a board that passed it is recorded.
- `Confirm result?`: a confirm that exits clean is ok, except on an empty
  record that still lacks a top-level `"confirmed": true` afterwards (Fast
  Browser before 0.1.16 exits clean without confirming it): that board is
  not drawn, with the output quoted and the advice to update Fast
  Browser. The first refusal for a board re-renders it through the driver
  with the refusal quoted, counted against `redaction-rounds:<stem>`; a
  second refusal for the same board is not drawn, with the output quoted.
- A named board re-renders, and the new render opens this gate again.
- Every render with a redaction record (crops or empty) that a verb
  records, during a run or in a revision, passes this gate first, or, for
  a mock-data board's empty record, Confirm a mock-data board.
