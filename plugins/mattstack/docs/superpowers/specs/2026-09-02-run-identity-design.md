# Run identity for standalone verbs (design)

**Status:** draft for review. **Source:** a standalone review run's record read
back with `rt runs show --json` beside a feature-pipeline run's, and the
console rendering both (2026-09-02). The gates spec
(`2026-09-01-pipeline-gates-design.md`) listed console-facing work as out of
scope; this design picks up the recording half of that deferral and the one
console fallback it needs.

**Sequencing:** after 0.13.4, as a patch. The engines touched overlap plan 3
(standalone verbs as runs) and the engine follow-ups, both merged. The team
pack recompiles once, in its own release. The console app change is
independent of both and can land any time.

## 1. Problem

A standalone verb's run records only what the gate contract writes (`gate`,
`hold`, plus run-start's own `claude-session` and `herdr-pane`). The run
row's `ticket` and `branch` are derived from fields (rt's runs store reads
`fieldValue(fields, ...)`), so the console board shows a bare run id with
"no branch", and the run detail card reads "not recorded" in every fact
column. The work pipeline is whole because its stages produce identity as
fields: provision (`ticket`, `branch`, `worktree`), implement (`commits`),
ship (`mr`).

Every standalone verb already resolves the identity it fails to record, in
its first step, then discards it: review and receive-review resolve one
MR/PR, self-review and ship point at the current branch, watch-ci
establishes branch and MR. Recording at that point closes the gap with no rt
change: `rt runs field set` accepts any key, and the console already reads
the same keys the pipeline produces.

## 2. The contract: one include

New `attachments/run-identity/SKILL.md`, an inert include target
(`{{include:run-identity}}`; slotless, placeholder-free). It states, once:

- The keys are `ticket`, `branch`, and `mr`: the same vocabulary the
  pipeline stages produce, so every reader (board row, detail card, the
  enrichment join keyed on `branch`) works unchanged.
- The command: `rt runs field set <key> <value> --stage <verb>`. Identity is
  own-run only (next bullet), so the stage is always the verb's name; the
  `run.current_stage` case never arises here.
- Ownership: only the verb that ran `run-start` records identity. An
  inherited run's identity belongs to the verb that started it; a review
  invoked inside another live run must not overwrite that run's `branch`
  with the reviewed MR's.
- Timing: record each key the moment the verb resolves it, and skip a key
  the target does not have (a branch with no ticket records no `ticket`).
  Never guess a value, never block on a missing one.
- Why: the console reads these and nothing backfills. A field not recorded
  while the run is live reads "not recorded" forever.

## 3. Recording points, per verb

| engine | where | records |
|---|---|---|
| review | after "1. Resolve the target" lands on one MR/PR | `mr` (its URL), `branch` (its source branch), `ticket` (the id the MR itself names in branch, title, or description, when one exists) |
| receive-review | after "1. Resolve the change and filter the threads" | the same three, from the caller's MR |
| self-review | in "1. Point at the branch" | `branch`; `ticket` when the branch carries one |
| watch-ci | after "1. Establish the target" | `branch`; `mr` when one exists |
| ship | "1. Establish the target" (`branch`); then "2. Ship" once the created MR/PR URL prints (`mr`) | `branch`, then `mr` |

Each engine gains `{{include:run-identity}}` directly after its `## Run`
section, plus one sentence at the recording point naming that verb's keys.
`sync-open-mrs` is untouched: a sweep over many MRs has no single identity.

Plan 3's constraint that the `## Run` section stays verbatim-identical
across verbs holds: the include sits after that section, never inside it.

## 4. Console fallback (console app repo)

The run detail card and the board row render the MR column only from the
enrichment join (`enrichment.mr`, keyed on `run.branch` against the branch
cache); the `mr` field feeds only the copy hotkey. A run whose branch has
left the cache (merged and pruned, or never on the board) shows
"not recorded" despite holding the MR URL on the row.

Change, in the console app: a small resolver that prefers `enrichment.mr`
and otherwise falls back to the `mr` field's URL, parsing the iid from its
tail (`merge_requests/<iid>` or `pull/<iid>`); the fallback renders the
link without state or CI status, which only enrichment knows. Both the
summary card and the board row use it. The copy hotkey's precedence
(enrichment URL, else the field) is already right and stays.

## 5. Release

1. mattstack-skills: the include plus five engines; `sh tests/certify.sh` on
   each touched directory; `tests/repo-purity.sh`; patch bump; commit.
2. `claude plugin update mattstack@mattstack` before any pack compile:
   includes resolve from the installed cache, and the update also delivers
   the pending 0.13.3 and 0.13.4 changes.
3. The team pack: bump its manifest, `rt skills compile`, `rt skills check`
   all current, commit and push, plugin update, session restart.
4. Console app: the resolver plus tests, its own commits in that repo.

## 6. Out of scope

- `worktree` and `commits` on standalone verbs: review holds no tree, and a
  ship's commits belong to the pipeline's implement stage.
- Any rt change: `field set` upserts by key and the store already promotes
  `ticket` and `branch` onto the run row.
- Branch-cache or enrichment changes.
- The board wrappers: they delegate to the pack's verbs, which record.

## 7. Verification

- Engines: writing-skills discipline. Baseline a fresh agent on the current
  review engine (it records nothing), then verify against the edited engine
  that all three keys are recorded and that a ticketless target skips
  `ticket` without stalling.
- Console: unit tests over the resolver and both components: enrichment
  present, field only, neither.
- End to end: one board-launched review of a real MR; read the run back with
  `rt runs show --json` (three identity fields present) and load its console
  page: the board row shows ticket and branch, the card shows the MR link.
