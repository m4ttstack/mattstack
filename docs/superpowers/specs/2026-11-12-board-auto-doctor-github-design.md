# Board auto-doctor fires on GitHub (BOARD-64)

Short design, P-RT-28 GitHub parity. Brainstorm decisions were taken through
the herd gate on 2026-11-12 (gate 4098e497).

## Intent

A GitHub team's board should run the auto-doctor the way a GitLab team's
does: a red PR the seat owns gets a doctor, a new push counts as a new
pipeline, and a PR behind its base gets the needs-rebase edge where the repo
requires an up-to-date branch. GitLab behaviour does not change.

## What main does today (verified at 7acf4a7be)

- **Pipeline id.** glance 0.31 gives a GitHub PR `github:run:<n>`, where `n`
  is a workflow run's numeric database id (the failing counted run, else the
  highest run id). `numericPipelineId` already parses that to `n`. Only the
  fallback `github:checks:<prUrl>`, which a PR gets when no check carries a
  workflow run (commit statuses only), parses to null. The audit's "returns
  null on GitHub" holds only for that fallback.
- **New push.** A push starts new workflow runs with new ids, so the parsed
  id changes and `detectEdges` sees a new pipeline. A re-run of failed jobs
  keeps the run id, the same as a GitLab job retry keeps the pipeline id.
- **Needs-rebase.** `blockers.needsRebase` is `blockerReasons`' `behind`,
  from `shouldBeRebased`, which `githubFill.ts` sets on `mergeStateStatus ===
  'BEHIND'`. GitHub reports BEHIND only when branch protection requires an
  up-to-date branch, which is the "where the repo requires it" condition.
  `ownMrFacts` already carries it. `behindTarget` stays null on GitHub and
  nothing in triage reads it.
- **The real blocker.** `bin/triage.ts` calls `triageForgeSkip`, which on a
  GitHub team skips the whole non-peer pass (auto-doctor, respond asks, the
  re-review latch), and its owner identity comes from a GitLab token's
  `validateToken`. So no edge is ever evaluated on GitHub.
- **Fixture.** `tests/fixture-github/data.json` still carries the
  pre-0.31 `github:checks:<n>` ids and has no red or behind PR the seat owns.

## Decisions

1. **Identity (Matt's pick).** On a GitHub team the triage identity is the
   team record's `forgeUsername` for the active org (`activeTeam().username`
   from `@mattstack/rt-client`, which reads it locally; no forge call).
   Ownership stays `triageOwns`: seat AND that identity. Branch-writing fix
   classes are licensed against it exactly as today. With no recorded
   username, triage owns nothing and logs one line, like a seatless board.
   The GitHub identity is never written into `memory.identity`, which stays
   the GitLab token cache.
2. **Pipeline id (shepherd's call).** Keep the numeric id. No change to the
   triage memory shape or the board's state.db schema, so the older bundled
   board the cron runs reads the same shape. A statuses-only PR gets no
   pipeline-red edge; triage logs one line naming it. The PR body lists that
   gap as a follow-up.

## Approaches considered

- **Forge-neutral string id with a migration.** Covers statuses-only CI, but
  changes stored memory, and an older bundled board comparing a stored
  string with its number would see every red PR as new. Rejected (decision 2).
- **Seat-only ownership, null identity.** Runs the doctor without the
  branch-writing classes. Rejected for decision 1.
- **A daemon verb for the GitHub token's login.** Closest match to GitLab's
  token identity, but outside this job's write fence. Rejected for decision 1.

## Design

- `src/triage/forge-skip.ts` becomes the forge plan for one triage run, a
  pure function of the forge kind and the recorded username:
  - GitLab: unchanged. Identity from the GitLab token as today, every pass
    runs, no skip line.
  - GitHub: auto-doctor runs with the recorded username as identity. Respond
    asks and the re-review latch still skip, with one line saying so. No
    recorded username: the auto-doctor is skipped with one line too.
- `bin/triage.ts` reads the plan instead of the single skip flag. It keeps
  `resolveUsername` for GitLab, takes the username from the plan on GitHub,
  runs `runTriage` when the plan allows, and gates the nudge pass and the
  latch pass on the plan's GitHub skip exactly as `forgeSkip` gates them now.
  Peer mode is unchanged (its GitHub branch already declines respond asks).
- A pure helper in `src/triage/` lists the own PRs whose pipeline is failed
  but whose id did not parse. `bin/triage.ts` logs one line per PR:
  `triage: <url> has no workflow run id (commit statuses only), auto-doctor skips it`.
  On GitLab the id always parses, so the line never appears there.
- `numericPipelineId`, `edge.ts`, `memory.ts` and `memory-store.ts` are not
  changed. Their doc comments that say "GitLab" are widened to name both id
  shapes where that keeps them true.
- **Fixture.** `tests/fixture-github/data.json` moves to the 0.31 id shape
  (`github:run:<n>` with `runIds`; the statuses-only fallback
  `github:checks:<prUrl>` on one row) and gains two seat-owned PRs: one with a
  failed Actions run, one behind its base (`blockers.needsRebase: true` and
  `actions.rebase` visible, as `buildBoard` serves a BEHIND PR). The README
  table lists them, its "rebase shows only when a row needs one, which none
  here do" sentence is corrected, and the `members` counts in `data.json`
  follow the new rows. The capture baselines use only
  `tests/fixture`, so they do not move.

## Tests

- The forge plan: GitLab unchanged; GitHub with and without a recorded
  username; the skip lines.
- Edges from GitHub rows: `ownMrFacts` on the fixture's rows, then
  `observe` and `detectEdges` with the seat as identity. The red PR gives
  `pipeline-red` with its run id; after `markHandled`, the same id gives
  nothing and a new run id (a new push) fires again. The BEHIND PR gives
  `needs-rebase`. The statuses-only PR gives no edge and is named by the
  helper. Rows the seat does not own give nothing.
- Username case: a recorded username in a different case from
  `author.username` still owns the PR (`triageOwns` ignores case), and the
  branch-writing classes follow `composeFixClasses`' exact match as today.
- `src/__tests__/forge-door.test.ts` asserts today's GitHub skip line
  exactly; it moves with the forge plan. That change is expected, not a
  GitLab regression.
- A GitLab regression check: every other triage suite passes unchanged.

## Non-goals

- The doctor skill still stops at entry on a GitHub PR. The skills-watch-ci
  lane lifts that; the PR body says end to end needs it.
- Respond asks and the re-review latch on GitHub (BOARD-65).
- Board writes and the manual doctor launch's identity (BOARD-63); the
  row-actions, CommentsDrawer and mr action routes are not touched.
- No new poll, interval or forge read: triage reads the daemon store as now.
- Statuses-only CI on GitHub (follow-up).
- Mixed CI (follow-up): a failing commit status beside green Actions runs
  gives `github:run:<highest>`, a green run's id, with a failed status. The
  edge fires, but the doctor finds no failed run. Listed with the
  statuses-only gap in the PR body.

## Rollout

The trigger only reaches a real board once the bundled board is rebuilt
from a merged ref. Until the skills-watch-ci lane lands, a dispatched doctor
stops at entry, and the dispatch still latches `lastHandledPipelineId`, so
that run's red will not fire again; the next push will. The PR body asks for
this PR to ship with or after the skill change.

## Write scope

`apps/board/src/triage/`, `apps/board/bin/triage.ts` (the board file that
holds the triage identity lookup), `apps/board/src/__tests__/` for tests
beside the existing triage suites, and `apps/board/tests/fixture-github/`.
