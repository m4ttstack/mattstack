# RED/GREEN: review@1 and findings@1 in the structured-context table

Scope: `attachments/gate-protocol/SKILL.md`, "Structured context (gate-ctx@1)"
section. Added two rows to the shape table (`review@1`, `findings@1`), an
enums sentence covering `readiness`, `findings@1` `severity`, and
`disposition`, a join-and-degraded-recipe bullet for `findings@1` right
after the `thread@1` / `replies@1` join bullet, and a Size-bullet sentence
for trimming `findings@1` entries (`evidence` then `fix`, whole fields
only).

Method: single-shot tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt <system-file> -p
<scenario-file>`, run in a fresh empty directory per rep, 5 reps per side,
run in parallel. Verified tool-less by direct probe before scoring: a rep
asked to write a marker file printed a narrated tool call but the file
never appeared on disk, confirming no tools were actually bound.
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
  "reviewer": "!87", "replies": 2}` -- no `readiness`, no findings count;
  its findings object borrowed `replies@1` with `verb: "reply"` and the
  raw finding body copied into `text`, no `severity` field anywhere.
- Reps 2, 4, 5 all borrowed `plan@1` for the gate object plus `replies@1`
  for the findings question, since those are the closest fields the table
  offers. Rep 2's gate object: `{"gate-ctx": "plan@1", "reviewer":
  "review-post", "threads": {"total": 2, "blocking": 1}, "adjudication":
  "with-fixes: the live path still re-enqueues permanent failures."}` --
  `adjudication` (a display string) stands in for the missing `readiness`
  enum and `summary` field. Rep 5's findings object: `{"gate-ctx":
  "replies@1", "replies": [{"thread": "f1", "file": "queue/worker.ts",
  "verb": "fix", "text": "a job marked retryable: false goes back on the
  queue after every failure, so it never leaves."}, ...]}` --
  `thread`/`verb`/`text` stand in for the missing
  `id`/`severity`/`title`/`body` fields, and `severity` never appears.
- Rep 3 took a third path: it minted its own gate-ctx names,
  `"gate-ctx": "review-post@1"` for the gate object (with `reasoning`
  instead of `summary`, and `findings: {"total": 2, "blocking": 1}`
  instead of counts by severity) and `"gate-ctx": "findings@1"` for the
  findings object -- the right NAME for the second shape, guessed cold,
  but the wrong fields: `{"value": "f1", "tier": "Critical", "title":
  "...", "file": "queue/worker.ts", "fix": "...", "text": "..."}` uses
  `value`/`tier`/`text` where the shape needs `id`/`severity`/`body`, and
  `severity` is never lowercase because it never appears at all.
- Failure classes: borrowed shapes (`post@1` or `plan@1` + `replies@1`,
  4 of 5 reps) standing in for the missing pair, and one near-miss where
  a rep guessed the `findings@1` name correctly but not its field
  contract. No rep refused or asked a clarifying question this run,
  unlike the earlier (tools-available) run's rep 3.

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
surfaced; the borrowed-shape and near-miss-name failure modes from RED
both closed once the table carried the matching rows.

Superseded run: an earlier pass used `--allowedTools ""`, which does not
actually remove tools, so that run's reps had tools available even though
the scenario never required one. It was re-run with a verified tool-less
harness (`--tools "" --strict-mcp-config`, confirmed by a direct probe:
a rep asked to write a marker file narrated a tool call but no file
appeared on disk). The tallies did not change: RED was 0/5 in both runs
and GREEN was 5/5 in both runs; the failure-class details above are from
the tool-less run. The superseded run's raw outputs are kept, not
committed, under
`.superpowers/micro-tests/gate-protocol/superseded-with-tools/`.
