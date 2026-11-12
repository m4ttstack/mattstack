# The generic board doctor checks for stack children before it rebases

Ticket: RT-363 (project GitHub parity). Size: a small change.

## Why this ticket ends as a small change

RT-363 says every auto-dispatched doctor dead-ends at the stack-parent
check, because that check read rt's open-MR cache, which only holds a
fixed author list over 30 days, so it could never prove a branch had no
children.

That dead end is already gone on GitLab:

- PR #628 (merged 2026-10-01, "live forge reads") made every agent-facing
  MR read ask the forge. `mr_list` with `targetBranch` reads every
  author's MRs live and returns `full`, true only when nothing was cut
  (`lib/mcp/mr-read-tools.ts`, daemon `mr:list-live` in
  `lib/daemon/handlers/mr.ts`). `lib/mcp/__tests__/mr-read-tools.test.ts`
  pins `full`.
- The doctor fills that hold the check today (a team pack's
  `board-doctor` and `board-doctor-api`, and the copies other packs
  carry) call `mr_list {mrUrl, targetBranch: <source
  branch>}`: empty with `full: true` means no children, any MR listed
  means a stack parent, and a tool error is quoted in the hand-back.
- The board's doctor audit log (`~/.mattstack/board/logs/doctor-audit.jsonl`)
  shows the last "cannot prove it is not a stack parent" error on
  2026-09-28, the run the ticket names as its source. Since then doctors
  on unstacked MRs have gone on to diagnose, rebase and push fixes
  (for example rebases on 2026-10-26 and 2026-11-05).

So the ticket's four acceptance bullets hold on GitLab through those
fills. What is still missing is the doctor that runs with no fill.

## The gap

The generic board doctor (`apps/board/skills-src/doctor/`) runs for any
repo with no domain skill bound, which on this machine is every GitHub repo. Its
Diagnose and rebase stage (`diagnose.md`) sends an MR with merge
conflicts straight to `mr_rebase` once `clean-api-rebase` is licensed.
It never asks whether other MRs target the branch. On a stack parent,
that rebase rewrites the parent's commits and strands every child MR
built on the old ones, which then needs a restack by hand.

Nothing tests the GitHub half of the live read either: no test passes
`mr_list` a PR URL with `targetBranch` and checks `full`.

## Goals

- Before the generic doctor's server-side rebase, it proves the branch
  has no open children with the same live read the pack fills use, on
  GitLab and GitHub alike.
- A stack parent ends the run with an error that names the children and
  the restack need, and nothing is rebased.
- A failed read ends the run with an error quoting the failure. It is
  never read as "no children".
- A test pins `mr_list` by PR URL and `targetBranch` on GitHub, at the
  tool and at the daemon verb.

## Non-goals

- No change to the team packs' doctor fills:
  they already do the live check, and that repo is employer-visible.
- No change to `mr_list`, `mr:list-live`, glance, `mr_map` or
  `branch_stack`.
- No check on a stacked MR itself (its target is not the default
  branch). `mr_rebase` moves an MR onto its own target and never
  retargets, so the MR being rebased is safe; only its children are at
  risk.
- No restack: the doctor only stops and says what is needed.
- No change to the classify, watch or domain stages: none of them
  rebases.

## Anti-goals

- A check that passes on a partial or failed read. An empty list with
  `full: false`, or any tool error, must end the run, never let the
  rebase go ahead.
- Any change to GitLab behaviour that works today beyond the new stop
  before a rebase that would strand children.

## Approaches

Picked at the first gate (option A).

- **A, picked: add the live check to the generic doctor and pin the
  GitHub read with tests.** Covers both forges in one lane. Costs a skill
  edit in `diagnose.md`, which the skills-watch-ci lane is also editing;
  the two lanes agreed on separate hunks (below).
- B: test-only close, and a new ticket for the generic path. Smallest and
  no overlap, but the generic doctor keeps rebasing stack parents.
- C: hand the guard to skills-watch-ci. One lane per file, but it widens
  that lane's scope.

## The design

In `diagnose.md`, between `Server-side rebase licensed?` (yes) and
`Lease mode (before the rebase)?`, the stage gains:

1. `mr_list {mrUrl, targetBranch: <source branch>} (stack-parent check)`,
   where `<source branch>` is the `sourceBranch` the stage's first
   `mr_view` read.
2. A diamond `Stack-parent check (doctor)?` with three edges:
   - `full: true, no MR listed` goes on to `Lease mode (before the
     rebase)?`, the existing path.
   - `an MR listed: a stack parent` goes to `Diagnosis ends the run:
     continue at the map's exit` with an `error` status such as
     `MR !<iid> is a stack parent (!<child> targets it); a rebase would
     strand it: needs a restack of the stack root`. Any MR listed counts,
     whatever `full` says.
   - `tool error, or no MR listed with full: false: cannot prove no
     children` goes to the same exit with an `error` status that quotes
     the error, such as `cannot prove MR !<iid> has no stacked children:
     the live target-branch query failed (<error>)`.

The check sits after the license diamond so an unlicensed run, which
ends anyway, spends no read. It sits before the lease check so a stack
parent never claims or touches the lease for a rebase it will not run.

Prose: one new bullet under "What this graph cannot show" explaining
the check and its three outcomes, and one sentence in SKILL.md's Fix
classes entry for `clean-api-rebase` saying a stack parent is never
rebased under it.

`apps/board/skills/doctor/` is regenerated with
`bun run skills:expand:board`.

Tests:

- `lib/mcp/__tests__/mr-read-tools.test.ts`, "on GitHub": `mr_list
  {mrUrl: <PR URL>, targetBranch}` sends `mr:list-live` with the GitHub
  identity and the branch, and returns `full: true` when not truncated
  and `full: false` when truncated.
- `lib/daemon/__tests__/`: one `mr:list-live` case on a GitHub repo
  context that passes `targetBranch` to the provider and returns its rows
  and `truncated`.

## Coordination

skills-watch-ci edits `diagnose.md` from the `mr_rebase {mrUrl}` node
downstream (a GitHub branch with `mr_rebase {wait: true}`, its result
edges, the rebase poll, "The rebase poll" bullet and "Fix what the
mr_rebase error names"), and SKILL.md's GitHub entry stop and lease and
API tier notes. This lane touches only the nodes above the lease check,
one new prose bullet, and the Fix classes line. This lane will probably
push first; skills-watch-ci rebases onto it.

## Shipping

Board skills reach sessions as symlinks from `~/.claude/skills/` into the
board's `skills/` folder, not through the plugin cache, and this change
writes nothing under `plugins/mattstack/`. So no plugin version bump and
no `minEngine` change. If the `plugin-mattstack` job's Engine floor check
asks anyway, the PR body gets `engine-floor: unchanged <reason>`.

Verification: RED and GREEN walks of the generic doctor by fresh agents
against fixtures (no live forge call), `bun run skills:expand:board` and
`bun run skills:check:board`, `check-dot.py` on `diagnose.md`, certify
where it accepts the folder, `bun test` on each touched test file, `bun
run typecheck` and `bun run purity`.

## Left to the builder

- Exact node labels and error wording, kept in the doctor's existing
  style.
- Whether certify accepts `apps/board/skills-src/doctor` directly or
  only the generated folder.
- Which daemon test file holds the `mr:list-live` GitHub case
  (`forge-reads.test.ts` or a handler test), following where the
  existing `mr:list-live` tests live.
