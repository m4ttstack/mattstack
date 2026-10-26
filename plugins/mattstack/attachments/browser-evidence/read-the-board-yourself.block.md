---
order: 8
---

# Read the board yourself

Read each returned PNG with the image-reading tool. It reads right when:

- the crop shows what `show` names;
- each label sits on what its `point at` line names and shows its tag and
  description (on a `steps` board, each step shows its tag and outcome);
- nothing `hide` names, and no other personal detail, is readable;
- the title is the brief's `claim`, word for word.

A wrong view (a blank page, the change missing from the page) is a Reach
the view problem: apply that block's fixes, then re-render. At most two
re-renders per board (`rerenders:<stem>`).

`Redaction record?` reads the record compose wrote,
`~/.fast-browser/screenshots/<stem>.redactions.json`, never the driver's
`crops` list: crops when that record lists one or more crops, empty when
its `redactions` is `[]`, none when there is no record. Compose writes
no record for a board whose redact marks all sit on live captures (the
page was hidden before the capture left it), so none is expected there.
An empty record
means no panel of the board carries a redact mark, and the upload refuses
it until `fast-browser compose --confirm` marks it confirmed, so it takes
the redaction gate like a record with crops: the human looks at the board
itself and confirms nothing on it needs hiding. The one exception is a
mock-data board (Confirm a mock-data board).

## Confirm a mock-data board

An empty record on a mock-data board (all three conditions under The
browser target) skips the gate: its page holds no real person, so there is
nothing for the human to check. Run the confirm, and only once the record
reads `"confirmed": true` write the run field `evidence-cleared:<stem>`
with the record's `boardSha256`, a space, and the brief's `hide:` line as
its value. evidence-record trusts the field only for those exact bytes, so
any later render of the stem (a re-capture, a revision, another source)
is shown again until it earns a field of its own. A confirm that is refused
or leaves the record unconfirmed sends the board to the gate instead: the
human looks. A board with crops, or one whose source is not mock data,
never takes this path.

## Record the clearance

`evidence-cleared:<stem>` tells evidence-record and the verbs' `boards`
question that nobody needs to look at these bytes again. It is written in
exactly two places, each only after the record reads `"confirmed": true`:

- a mock-data board: `<boardSha256> <the hide line>` (Confirm a
  mock-data board);
- a board in an opening the human answered with `redaction: "confirm"`
  itself (the Confirmed option, never free text read as a yes, and no note
  naming a board): `<boardSha256> approved at <scope>`, `<scope>` the last opening
  that showed it, since the human has already looked at these exact bytes.

Only that explicit answer clears. A board confirmed by inference (one
their words did not name when something needed hiding, one left unpicked
at Ask which board) still runs its confirm but gets no field, and so does
a board that reaches Board ready without a record (its redact marks all
on live captures): the human has not answered for it, so the upload shows
it. A `run_field_set` that errors leaves the field unset, which also shows
the board.

## Every board of this hand-off at the redaction gate or done?

The gate asks about the hand-off's boards together, never one board at a
time. Yes once every board of this hand-off has reached the gate or ended
(ready, not drawn, held); the boards waiting then go into one opening. A
board re-rendered after the gate waits for the others re-rendered with it.
