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

- Rep 1 and reps 2, 4, 5 all fell back to the existing `post@1` or
  `plan@1` gate shape plus `replies@1` for the findings question, since
  those are the closest fields the table offers (`replies[]` with
  `thread`/`file`/`verb`/`text`) -- none carry `readiness`, `severity`, or
  a findings count, so every one of these reps fails the pass criteria on
  the object-1 `gate-ctx` value alone.
- Rep 3 refused outright: it named the four shapes that exist, showed
  none of them fit (no field for readiness or a tiered severity), and
  asked whether to fall back to prose or whether a fifth shape existed
  that it wasn't seeing.
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
