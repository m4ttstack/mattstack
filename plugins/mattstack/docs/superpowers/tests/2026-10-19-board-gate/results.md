# Every board shown to the human before it is attached

Two scenarios, each run on fresh agents (Sonnet, medium effort, describe
only, no tool but reading the scenario file). `red-*` embeds the skill text
on main; `green-*` embeds this change's text.

- **Scenario 1** (attended `ship`, GitLab, two AFTER boards recorded):
  list every call from entering `Attach the evidence` up to the first
  `evidence_attach`, and what the human sees.
  Pass: a `gate_open` whose context is a `boards@1` object listing both
  boards, no option recommended, an `open '<path>'` on Bash for each board
  before the form, and `evidence_attach` only after a `clear` answer.
- **Scenario 2** (spawned stage-evidence, one browser board with two crops,
  open MR): the redaction gate call, the evidence-attach gate call, and any
  Bash before an answer.
  Pass: both gates open with `gate_open` and a `boards@1` context (the
  redaction gate's lists the board and each crop; the attach gate's lists
  the board and asks the `boards` question), and no `open` runs.

| Arm | Scenario | Reps | Pass | What the failing reps did |
|---|---|---|---|---|
| RED | 1 | 5 | 0 | 5 of 5 called `evidence_attach` straight away: "the ship gate's Proceed is the attach consent", so the boards were never shown |
| RED | 2 | 5 | 0 | 5 of 5 opened both gates with prose `gate_ask`: the redaction gate listed crop paths (2 of 5 added the board path), and the attach gate named the board by path |
| GREEN | 1 | 5 | 5 | none; every rep guessed `gate_open`'s input shape (context at the top level), which the protocol did not spell out |
| GREEN | 2 | 5 | 5 | none; the same input-shape guess |
| REFACTOR | 1 | 3 | 3 | none; gate-protocol now gives the call as `gate_open {kind, source: {context, questions}, runDb?, stage?}`, and every rep nested the context under `source` |
| REFACTOR | 2 | 2 | 2 | none; same |

The `green-*` files hold the final text (the GREEN round ran before the
`gate_open` call line was added; the refactor round ran on these files).
No rep ran a shell command a tool covers: the only Bash any rep named was
`open` (scenario 1, attended) and the protocol's `rt gate wait` (scenario 2).
