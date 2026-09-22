# RED/GREEN: review@1 and findings@1 in the structured-context table

Scope: `attachments/gate-protocol/SKILL.md`, "Structured context (gate-ctx@1)"
section. Added two rows to the shape table (`review@1`, `findings@1`), an
enums sentence covering `readiness`, `findings@1` `severity`, and
`disposition`, a join-and-degraded-recipe bullet for `findings@1` right
after the `thread@1` / `replies@1` join bullet, and a Size-bullet sentence
for trimming `findings@1` entries (`evidence` then `fix`, whole fields
only).

Method: single-shot tool-less reps, `claude --model sonnet
--allowedTools "" --append-system-prompt <system-file> -p <scenario-file>`,
run in a fresh empty directory per rep, 5 reps per side, run in parallel.
Scenario: a review verb opening a review-post gate for a PR, readiness
with-fixes, one reasoning line, two findings (one Critical with a file and
no line, one Minor with a file:line), both riding one multi-select
`findings-1` question; the reply is exactly two JSON objects, the gate
`--context` object then the `findings-1` question's `context` object.
Pass criteria: object 1 carries `"gate-ctx": "review@1"`, `readiness`
exactly `with-fixes`, a non-empty `summary`, and `findings` counts
`{"critical": 1, "minor": 1}`; object 2 carries `"gate-ctx": "findings@1"`
and a `findings` array of two entries with `id` f1/f2, lowercase
`severity`, `title`, the full finding text as `body`, and `file` set to
the real `path:line` anchor for each.

RED (system file = the section before this edit): 0/5 PASS.

- Rep 1 borrowed `post@1` for the gate object: `{"gate-ctx": "post@1",
  "reviewer": "code-review", "replies": 2, "fixes": [{"sha": null}]}` --
  no `readiness`, no findings count, `sha: null` invented to fill a field
  the payload has nothing for.
- Reps 2, 4, 5 all borrowed `plan@1` for the gate object plus `replies@1`
  for the findings question, since those are the closest fields the table
  offers. Rep 2's gate object: `{"gate-ctx": "plan@1", "reviewer":
  "code-review", "threads": {"total": 2, "blocking": 1}, "adjudication":
  "with-fixes: the live path still re-enqueues permanent failures."}` --
  `adjudication` (a display string) stands in for the missing `readiness`
  enum and `summary` field. Rep 4's findings object: `{"gate-ctx":
  "replies@1", "replies": [{"thread": "f1", "file": "queue/worker.ts",
  "verb": "fix", "text": "drop non-retryable jobs in the catch
  block"}, ...]}` -- `thread`/`verb`/`text` stand in for the missing
  `id`/`severity`/`title`/`body` fields, and `severity` never appears.
- Rep 3 refused outright: "None of the four shapes this protocol defines
  (`plan@1`, `post@1`, `thread@1`, `replies@1`) actually fit this
  payload, so I can't produce a valid pair of JSON objects here without
  either dropping required data or mislabeling it" -- then asked whether
  to fall back to prose or whether a fifth shape existed that it wasn't
  seeing.
- Failure class: exactly as expected, invented or borrowed shapes
  (`post@1`, `plan@1` + `replies@1`) standing in for the missing
  `review@1` / `findings@1` pair, with one rep declining to guess at all
  rather than inventing keys.

GREEN (system file = the edited section): 5/5 PASS.

- All five reps emitted exactly two JSON objects, gate-ctx `review@1`
  then `findings@1`, with `readiness: "with-fixes"`, a non-empty
  `summary` line quoting the reasoning, and `findings: {"critical": 1,
  "minor": 1}` (no `important` key, which the protocol's "absent reads
  0" line covers).
- All five findings arrays carried both entries with `id` f1/f2,
  lowercase `severity` (`critical` / `minor`), the given `title`, the
  full finding text as `body`, and `file` as the real anchor
  (`queue/worker.ts` for f1, `queue/enqueue.test.ts:132` for f2). All
  five also carried `fix` for both entries even though it is optional,
  reading it straight from the scenario's fix text.

Verdict: 5/5 on the first pass, no iteration needed. No loopholes
surfaced; the borrowed-shape and refuse-and-ask failure modes from RED
both closed once the table carried the matching rows.
