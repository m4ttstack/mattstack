# browser-evidence: an empty redaction record takes the redaction gate

Scenario: `scenario.md`. The driver returns a board whose
`<stem>.redactions.json` has `"redactions": []` and `"confirmed": false`.
Fresh sonnet agent at medium effort, Read tool only.

## RED (skill on main)

1 rep. The agent answered `Crops listed?` no and went straight to Board ready.
It opened no gate and did not run `compose --confirm`, citing the skill:
"The skill says the upload accepts an empty record whose board hash
matches." Once the guard refuses unconfirmed empty records, that board's
upload would be refused.

## GREEN (edited skill)

2 reps, both the same:

- `Redaction record?` takes the empty branch.
- Both name the self-confirm STOP and do not run `--confirm` on their own.
- Both take `redaction-openings`, then open `evidence-redaction:evidence:1`.
- The sentence above the form names the board's absolute path and asks the
  human to check that no personal detail is readable.
- `redaction-c1` offers Confirmed: nothing needs hiding / Hide something.
- `compose --confirm` runs only after a confirm and Proceed, then Board ready.
- Hide something re-renders through `redaction-rounds`.

No shell command that a tool covers.

## Round 2: a confirm that exits clean but confirms nothing

Scenario: `scenario-2.md`. Fast Browser before 0.1.16 exits 0 on an empty
record and leaves it unconfirmed.

- RED (round 1 skill): "a confirm that exits clean is ok" sent the board to
  Board ready, so its upload would be refused later. The agent named the
  gap itself.
- GREEN: the board is not drawn, with the output quoted and the advice to
  update Fast Browser. No refusal budget is spent.
- Scenario 1 re-run on the round 2 skill: unchanged, plus the new
  clean-but-unconfirmed branch.

## Round 3: on #889's boards@1 gate

Re-run of both scenarios after rebasing onto #889's evidence-redaction gate.

- Scenario 1: the empty record budgets `redaction-openings:<stem>:board`.
  The `boards@1` context holds the board alone, and the summary asks that
  no personal detail be readable. `Crops left?` answers no at once.
  `--confirm` runs only after a confirm and Proceed, then Board ready.
- Scenario 2: Not drawn with the update advice; no refusal budget spent.

## Round 4: widen rounds inside a revision

Scenario: `scenario-3.md`. The human answers Hide something every time the
revision's gate opens.

- RED: each return to step 3 appended a `revisions` entry, so `<k>` grew,
  every `:r<k>` budget key was fresh, and the revision never ended. The
  agent said so: "The only bound is the human's patience."
- GREEN: a return from step 5 adds the human's words to the same entry, so
  `<k>` stays at 2. `redaction-rounds:<stem>:r2` is spent on the third
  round, and the revision ends with nothing recorded.
- The callers (evidence-record's Not revised and Not repaired,
  stage-evidence's Iterate here) now list the unconfirmed-empty and
  spent-budget endings next to a refused confirm.
