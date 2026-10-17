# Ship and CI skills on the merged tools

Wave 3 of the digraph-to-MCP work, ship/CI cluster. The tools landed in
#843 (run engine), #844 (MR composites), #847 (CI tools) and #842/#849
(git guards). This change rewires four host skills onto them:
`plugins/mattstack/attachments/pipeline/{ship,stage-ship,watch-ci,stage-watch-ci}`.

## Why

Compiled, these four verbs load 10.9K to 17K words each, and about 60% of the
host text is graph. Most of that graph is bookkeeping the tools now do
themselves: claiming and re-claiming the CI lease, heartbeating it during a
fix, carrying the watch budget window and prior pipeline id between calls,
counting `waiting` results, choosing between four triage paths, reading the
MR before and after a push to avoid creating it twice, and opening and
closing the run by hand. Models miscount those loops across long contexts
and compactions (55 counter diamonds between the four hosts), and some rules
cannot be kept at all: "heartbeat every five minutes while you fix" fails
silently, the lease goes stale and the doctor takes over mid-fix.

Two drift bugs ride along: stage-ship has no force-with-lease decision (it
lives only in prose) and never reads a prior pipeline id, so stage-watch-ci
says "the stage has no prior pipeline id".

## Goals

1. Each skill calls the merged tools in place of the mechanics it draws today:
   - `ci_watch {attend: true}` owns the lease claim, re-claims, keepalive,
     budget window, prior pipeline id and the waiting clock for a match it
     can prove (B3), and returns the
     terminal states `timeout`, `no_pipeline`, `stood_down`,
     `lease_unavailable` and `unsupported_forge`.
   - `ci_triage` (team patterns from the `ci.triage.*` settings) and
     `pipeline_jobs` replace the host's calls to `ci-triage.sh` and the
     forge adapter, and the "Triage with what?" branch (the scripts and
     slot stay vendored until the pack replay, Decision 6).
   - `git_push {leaseMrUrl}` and `mr_retry {leaseMrUrl}` guard every repair;
     the re-claim blocks and the heartbeat-during-fix loop go.
   - `git_push`'s returned `sha`, `mr` and `priorPipelineId` replace the
     before-push `mr_for_branch`/`mr_pipeline` reads and `git rev-parse HEAD`.
   - `mr_create {ifExists: "return"}` replaces the before/after
     `mr_for_branch` lookups and the "Created once already?" counter.
   - `run_enter`/`run_close`/`run_hold` replace the drawn run lifecycle in
     the two standalone verbs, and `run_hold` the hold triplet in the stages.
   - `run_budget` holds every loop counter, so budgets survive compaction
     and resume.
2. Fix the stage-ship drift: a drawn force-with-lease decision, and the
   pushed sha and prior pipeline id handed to stage-watch-ci.
3. Move the evidence upload nodes in ship and stage-ship onto
   `evidence_attach` once #851 merges (phase 2, last).
4. Each compiled skill shrinks by roughly a third, with no loss of a rule
   (the preservation inventory below).

## Non-goals

- No tool changes. Anything a tool does not do yet stays in the skill (the
  rebase continue, idempotent abort, GitHub CI).
- No change to the shared includes (`gate-protocol`, `evidence-record`,
  `run-identity`, `wrap-up-form`), the work orchestrator, the board doctor
  packs, or the team packs.
- No GitHub parity: `ci_watch`, `ci_triage` and `pipeline_jobs` are GitLab
  only, so the `gh` path stays drawn (trimmed).
- No `ship_target` or rebase-continue composite (recon C8, C9): not merged.

## Anti-goals

- A tool that opens a gate, acts on a spent budget or picks an answer. Tools
  return; the skill gates.
- Two outward moves behind one node. Push, MR create, retry, upload,
  description write and mark-ready each stay their own `plaintext` node.
- Auto-retrying INFRA failures inside a tool. The retry stays an agent
  decision on `ci_triage`'s output.
- Claiming under the board doctor's lease. These skills never pass
  `underBoardLease`, and every lease-taking call (`ci_watch {attend}`, the
  guards) refuses or stands down on a fresh foreign lease, the doctor's
  included.
- Renaming a node a team fill attaches to without listing it (below).

## Constraints

- Write fence: the four skill directories, `plugins/mattstack/.claude-plugin/plugin.json`,
  `plugins/mattstack/pack/requires.json`, plugin tests and fixtures for these
  skills, this spec and its plan, `.superpowers/`.
- `stage-watch-ci/tests/fixtures/` stays: `lib/ci/__tests__/triage-fixtures.test.ts`
  reads it as the conformance suite for `ci_triage`. `scripts/` and the
  forge slot stay too (Decision 6).
- Graph rules (`mattstack:process-digraphs`): `render.sh` and `check-dot.py`
  pass; one off-script gate per origin; a budget on every loop; every tool
  call its own `plaintext` node; the "graph wins" line above every slot.
- Fills attach by node text (the "At:" sections in both team `ship-domain`
  fills). Every node they name keeps its text, or the rename is listed for
  the pack replay.
- Release: plugin version to the next patch above main's (0.31.15 today),
  `minEngine` to the same, re-bumped at merge-queue time.
- No employer names, team slugs or ticket ids in the diff or the PR body
  (`bun run purity`).

## Decisions (my calls; Matt can overturn any on review)

1. **Counters are `run_budget` calls, drawn.** Each `X = N?` diamond becomes
   `run_budget {key: <slug>, limit: N, stage}` (a `plaintext` node, so the
   run write is on the map) called once as the loop is entered, followed by
   `<slug> past its limit?` reading `spent > limit`. The tool increments
   first and its `exhausted` is `spent >= limit`, so routing on `exhausted`
   would allow N-1 rounds; `spent > limit` keeps today's N for a diamond
   checked before its round. Where today's diamond counted the current
   round ("this one included"), the limit is one less than today's N, so
   the round counts stay as today. Keys are
   prefixed with the verb (`watch-ci:fix-rounds`) so a verb inheriting
   another's run cannot collide. `stage` is the verb's stage in an own run
   and `run.current_stage` in an inherited one (the tool refuses a stage
   with no row). "Within this pass" becomes "within this stage attempt",
   which survives compaction and resume. Exceptions:
   - run-wide (no `stage`), because watch-ci starts a new attempt
     mid-loop: watch-ci's `fix-rounds` and `ci-gate-iterations`;
   - per watched commit (the key ends in the sha's first 12 characters),
     because an inherited watch-ci never starts an attempt and these reset
     per commit today: `infra-retries`, `ci-watch-errors`, `waiting-results`
     (`lease-rounds` went in the trim pass, B18).
2. **The heartbeat-every-five-minutes rule is dropped everywhere**, GitHub
   included. On GitLab the keepalive heartbeats the lease every minute until
   release, another owner, or 60 minutes after the last attending CI call
   on the MR; on both forges the `leaseMrUrl` guard on the repair (push,
   retry) re-claims a lapsed lease or refuses under a foreign one, so no
   repair races the doctor. A fix longer than the keepalive (or any GitHub
   fix past 10 minutes) can let the lease go stale; the guard then takes it
   back at push time unless someone else holds it.
3. **The re-claim before a fix goes.** A fix only changes the local tree;
   the guard on the push is the point where a race would matter.
4. **Route on `ci_watch`, not the origin URL.** watch-ci calls
   `ci_watch {mrUrl, sha, attend: true}` for every MR and takes the GitHub
   path on `unsupported_forge`; the "Which forge watches?" diamonds go. The
   GitHub path keeps its own `ci_lease_claim` (ci_watch returns
   `unsupported_forge` before claiming).
5. **Team triage patterns bridge until seeded.** `ci_triage` reads the
   `ci.triage.*` settings, which no team has seeded yet. Fills written for the
   script engine name `ci-triage.sh --config <file>`; the host redirects that
   move to `ci_triage` and passes the named file's keys as `config`. Both
   sources add, so a seeded team loses nothing when the fill is later
   replayed without the `--config` line.
6. **The forge slot and the vendored scripts stay, uncalled** (shepherd,
   gate 31bba705). Both team packs bind `forge` to `mattstack:ci-forge-gitlab`
   and the base pack's board-doctor fills call `ci-triage.sh` directly, so
   deleting either breaks their compile at sync time; retirement comes with
   the pack replay, which unbinds them first, together with the
   `compile-native.e2e.test.ts` assertions and the `init.ts` binding. Until
   then the host keeps `{{slot:forge}}`, `scripts/` and the `<scripts>` /
   `<forge>` path definitions (the e2e test asserts both paths in the
   compiled text), and states that this skill calls neither: a rule that
   runs `<scripts>/ci-triage.sh` goes to `ci_triage`, one that runs `<forge>
   jobs` to `pipeline_jobs`. The `allowed-tools` Bash entries for the two
   scripts go, so a stray script call asks for permission instead of running.
7. **Hold records in the standalone verbs too.** Today a standalone hold
   only ends the turn; now it calls `run_hold`, so the console and the stop
   hook see the held run, as they do for a stage.
8. **The pushed sha and prior pipeline id travel in a run field.** stage-ship
   writes `pushed` = `{"sha": "<sha>", "priorPipelineId": <n or null>}` right
   after a push lands (from `git_push`'s result; `null` when the human
   pushed). stage-watch-ci reads it and uses it only when its `sha` equals
   `git rev-parse HEAD`; otherwise it watches HEAD with no prior id. ship
   hands the same two values to watch-ci in the invocation.
9. **A prior id only when the push moved the branch.** `git_push` reads the
   MR's latest pipeline before pushing, so on a push that moved nothing that
   pipeline is the sha's own. Its id is handed on only when `git log
   @{upstream}..` listed commits before the push, or the push forced.
10. **The forge clarify moves after the push in ship.** The push is the same
    on every forge and the ship gate already consented to it; only opening
    the MR needs the forge. stage-ship already asks after the push.
11. **`mr_create` returning an existing MR on another target is reported,
    not gated.** Today an open MR found on the branch is kept silently; the
    final report now names its target when it differs from the resolved one.
12. **The `mr_create` node text gains `ifExists: return`.** That renames a
    node both ship-domain fills attach to (listed below).
13. **INFRA auto-retry excludes only INHERITED.** The retry diamond reads
    "only INFRA blocking failures, none INHERITED". UNKNOWN ownership (no
    base pipelines to compare, common on young repos) still retries once,
    as today, where no ownership test existed.
14. **The lease stays held while a gate waits.** An attending session parked
    at the `ci` or an off-script gate keeps the lease through the keepalive
    (at most 60 minutes past its last CI call), so the doctor cannot take
    the MR over while the human is deciding; today it went stale after 10
    minutes. The exits still release it.
15. **An existing MR is left as found.** When `mr_create` returns
    `existing: true` (`applied: false`), the unbound flow writes nothing to
    it: no squash, labels or description. A domain that wants the
    description updated says so at "Domain owns the title or description?"
    (the fills' `open_mr` answer already does). "No description" means the
    verb writes no title or description of its own: when the run has an
    evidence record, the evidence-record include still writes its evidence
    section on the existing MR (B21; evidence-skills C14).

## Behavior changes

| # | Today | After | Why |
|---|---|---|---|
| B1 | watch-ci claims with `ci_lease_claim`, re-claims on `lease_lost` up to 2, before the fix, before the push and before the retry, and heartbeats every 5 minutes during a fix (12 max) | `ci_watch {attend}` claims and re-claims (2 per commit) itself; the keepalive holds it; `git_push`/`mr_retry` take `leaseMrUrl`; no heartbeat rule | the timing rule cannot be kept; the guards make a racing repair impossible |
| B2 | 4 off-script gates on lease claims in watch-ci, 2 in stage-watch-ci | GitLab: one, on `lease_unavailable`; the GitHub path keeps two on its claims (`ci_lease_claim`, and the re-claim before `gh run rerun`; B20) | the re-claim origins are gone |
| B3 | Two `waiting` results in a row, then "Verify the branch was pushed" by hand | `no_pipeline` after 10 minutes with no pipeline, or only one proved not this commit's, carrying `pushed` and `remoteSha`; a `waiting` the tool cannot prove (a merge-train pipeline with no `priorPipelineId`, or an unread commit) starts no clock and never times out, so each `waiting` result counts `watch-ci:waiting-results:<sha12>` (4) and a spent budget opens gate ci quoting the result's `next` | the tool keeps the clock where it can prove the match; the budget restores today's bound on waiting results (old "Waiting results in a row = 2") for the case it cannot, and 4 at the default 300 s `maxWaitSeconds` never pre-empts the 10-minute clock (PR #859 review) |
| B4 | `budget.spent` read off `running`; `freshWindow`/`budgetMinutes` passed by hand after a retry | `timeout` on a `running` pipeline; the window persists and reopens after a retry by itself (a `waiting` result is B3's) | no arguments to get wrong |
| B5 | Triage: domain rules, or `ci-triage.sh` (forge bound), or trace reading (unbound GitLab), or GitHub reading | GitLab: always `ci_triage`, then the domain's judgment on its report; GitHub unchanged | one engine, INHERITED checked every time, no glab/jq |
| B6 | INFRA auto-retry after the agent read the logs | the same decision on `ci_triage`'s report (only INFRA blocking, `yours`, retry budget unspent), retried with `leaseMrUrl` | the guard replaces the re-claim |
| B7 | ship reads `mr_for_branch` and `mr_pipeline` before the push, `mr_for_branch` after it, and counts creates | `git_push` returns the MR and prior id; `mr_create {ifExists: return}` never creates twice | 3 forge reads per pass become 0 extra |
| B8 | stage-ship: no force-with-lease decision drawn; no prior id | drawn; `pushed` field written; stage-watch-ci reads it | drift fix |
| B9 | Counters live in context and reset on resume or compaction | `run_budget`, per stage attempt (two run-wide) | budgets hold across resume (recon flagged this as needing a ruling; this is my call) |
| B10 | Standalone hold ends the turn and writes nothing | `run_hold` records it | the console and stop hook see it |
| B11 | Standalone run open: `run_snapshot`/`run_list`/`run_stage start`/runs-root switch/hold clear | `run_enter`, and `run_close` at the exits | the engine does it in one call, root switching included |
| B12 | Lease released only when "a lease was claimed" (in-context memory) | released on every exit that knows the MR, except the stand-down; `ci_lease_release` refuses another owner's lease harmlessly | a missed release left a phantom attendant |
| B13 | ship asks which forge before pushing when the origin is unknown | asks after the push, before opening the MR | the push is forge-agnostic and already consented |
| B14 | An existing MR on another target is kept silently | kept, and the report names its target | visibility, no new gate |
| B15 | The host triages with `ci-triage.sh` and the forge adapter, pre-allowed in `allowed-tools` | both stay vendored but uncalled; fill script calls redirect to `ci_triage` (with the `--config` file's keys) and `pipeline_jobs`; the `allowed-tools` entries go | nothing in the host calls them; packs still bind and call them until the replay |
| B16 | A watch parked at a gate lets the lease go stale after 10 minutes | the keepalive holds it up to 60 minutes past the last CI call | one attendant while the human decides (Decision 14) |
| B17 | An existing MR found on the branch: the unbound flow claims "the create call wrote them" and skips the write | the same skip, stated as "left as found" (Decision 15) | the old edge label was false |
| B18 | watch-ci and stage-watch-ci count re-claims after a lost lease (2), then open Gate ci | `ci_watch {attend}` re-claims twice per commit itself; `lease_unavailable` opens the gate, whose Iterate calls `ci_watch` again with no count, and a second `lease_unavailable` reopens the gate (`watch-ci:lease-rounds:<sha12>` dropped) | the tool bounds the re-claims; the human paces each Iterate (trim pass, shepherd #6050) |
| B19 | watch-ci's, ship's and stage-ship's `git_push` off-script gates count their Iterate (off-script rounds = 2) | Iterate calls `git_push` again with no count; a refusal reopens the gate, and so does a human push that did not land (ship and stage-ship bound those misses with `landing-checks`, B22) (`watch-ci:push-off-script` and `ship:push-off-script` dropped, the latter in both ship and stage-ship) | each Iterate needs a new answer at the gate, so the human paces the retries (trim pass, shepherd #6050) |
| B20 | One "Off-script rounds" count per stage, shared by every off-script gate | each gate's Iterate counts on its own key (`ci-watch-off-script`, `github-claim-off-script`, `retry-off-script`, ...), so a run refused at several gates gets one Iterate at each; the two retry gates (`mr_retry` on GitLab, the re-claim before `gh run rerun` on GitHub) share `retry-off-script`, one per forge; the `lease_unavailable` and `git_push` gates count none (B18, B19) | one gate per origin needs its own budget to return to the right place |
| B21 | ship and stage-ship run the upload loop when the record has files, and (through the evidence-record bridge) the attach at every `Files to attach?` | the attach runs after `Record the evidence` or when the evidence read returned a record, and is skipped when the field is unset; in ship, evidence alone no longer sends the flow to `Write the title and description (ship)`, so an existing MR left as found gets only the evidence section the include writes | `evidence_attach` has nothing to render without a record; the include owns the section (phase 2) |
| B22 | stage-ship goes on after a human push without checking it landed | "Make the recorded move once" compares HEAD with the remote branch; a miss reopens the push gate once, quoting the comparison (`ship:landing-checks`, 1, as ship), then fails the stage | a stale head never gets a description or a watch (new behavior, shepherd #6140) |
| B23 | stage-ship's pushes carry no lease guard | the stage reads `mr` at entry; when it is set (a repair push after a red CI), both pushes pass `leaseMrUrl: <mr>`, and `refused: "lease_held"` goes to the stand-down STOP naming the holder: no release, the stage ends | a repair push never races the doctor (new behavior, shepherd #6140) |

## Design

### Shared conventions

- `<root>` is the worktree root; `<mr>` is the MR's or PR's https URL. Every
  CI tool takes `mrUrl: <mr>`; `git_push` takes `tree: <root>`.
- Counter pair: `run_budget {key: <verb>:<slug>, limit: N, stage: <stage>}`
  then `<slug> spent (<verb>)?` with edges `no` and `yes: ...`. The call
  increments by 1 each time the loop is entered; a read-only check passes
  `increment: 0`.
- Each counter's step section, or the gate section that owns it, says when
  it counts (as today's prose does).

### watch-ci (standalone)

**Run graph** (replaces 26 nodes):

- `run_enter {flags, skillDir, stage: watch-ci, runDb?, spawnedBy?}` →
  `run_enter mode (watch-ci)?`: `inherited` → "Inherited run: the stage is
  at.stage, close nothing (watch-ci)"; `started` → "Own watch-ci run open: go
  to the flow"; `resumed` → "Resumed watch-ci run: re-enter at the decisions
  run_snapshot shows"; `candidates` → "watch-ci gate clarify: the Resume
  offer"; tool error → "watch-ci run not started: report the error"; no tool
  → "rt too old: tell the user to update rt (watch-ci)".
- Resume offer answer: resume → `run_enter {..., resume: <runId>}`; start
  fresh → `run_enter {..., fresh: true}`; hold → "Held at the watch-ci Resume
  offer". Each second call is its own node with its own result diamond.
- The `run_snapshot` read on resume stays a node in the resumed path.

**Flow**, in order:

1. Target (kept): branch, origin, forge host, `mr_for_branch` or `gh pr
   list`, the which-forge clarify, the identity writes, "MR found?".
2. Watched sha (kept): handed by ship, or this run's `git_push` result,
   else `git ls-remote origin refs/heads/<branch>`.
3. Watch: `ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}` →
   `ci_watch state (watch-ci)?`:
   - `running` → call again (the tool's budget ends it as `timeout`).
   - `waiting` → `run_budget {key: watch-ci:waiting-results:<sha12>,
     limit: 4, stage}` → `waiting-results spent (watch-ci)?`: no → call
     again; yes → `watch-ci gate ci`, quoting the result's `next` (B3: an
     unprovable or unread match never reaches `no_pipeline`).
   - backgrounded → "End the turn: ci_watch runs in the background" (kept).
   - success states → green path.
   - `failed` → triage.
   - `timeout`, `no_pipeline`, `canceled`, `skipped`, `manual`,
     `superseded`, `aborted` → `watch-ci gate ci`.
   - `stood_down` → the stand-down STOP → "Stand down: report the holder, or hand it back (watch-ci)".
   - `lease_unavailable` → "watch-ci off-script gate: lease_unavailable"
     (one origin; take/iterate/hold/hand back; iterate calls `ci_watch`
     again with no count, B18).
   - `unsupported_forge` → GitHub path.
   - tool error → `ci-watch-errors` budget (1) → "Fix what the ci_watch error
     names" or "watch-ci off-script gate: ci_watch refused".
   - tempted to watch with a script or the GitLab CLI → STOP (kept).
4. GitHub path (trimmed, kept): `ci_lease_claim {mrUrl, branch} (GitHub)`,
   its result diamond, its claim-error fix (budget) and off-script gate, the
   re-claim before the retry with its own off-script gate (B20), the
   stand-down; the `gh pr checks` poll with `ci_lease_heartbeat` per poll,
   `github-polls` (45) and `sha-waits` (5) budgets, `headRefOid` guard;
   classify failing checks.
5. Triage (GitLab): `ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}` →
   result diamond: report → "UNCLEAR jobs in the report?" → `mr_job_trace
   {mrUrl, jobId, ...} per UNCLEAR job` → "Classify the triage report
   (watch-ci)" box (the domain's judgment lives in its section); tool error
   → "Classify each failure REAL or INFRA from failedJobs (watch-ci)" (the
   unbound reading, kept as the fallback). Then "Only INFRA blocking
   failures, none INHERITED (watch-ci)?" with `infra-retries` budget (1).
   The `--config` file a fill names sits in the fill's own directory (the
   compiled skill vendors it under `parts/domain/`), never in the host's
   `scripts/`, so the redirect reads it there.
6. Retry: `mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job` →
   result: retried → watch again; `refused: lease_held` → stand-down STOP;
   error → "watch-ci off-script gate: mr_retry refused". GitHub:
   `ci_lease_claim` before `gh run rerun` stays.
7. `watch-ci gate ci` (kept, table unchanged): fix → `fix-rounds` (3,
   run-wide) → "Fix the REAL failure, commit" → "MR found (before
   git_push)?" → `git_push {tree: <root>, leaseMrUrl: <mr>}` (or without the
   guard when there is no MR) → result: ok → own run new attempt
   (`run_stage start`, kept) → watch with the result's `sha` and
   `priorPipelineId`; `refused: lease_held` → stand-down STOP; error → push
   STOP → "watch-ci off-script gate: git_push refused" (kept: take → confirm
   the human's push landed; iterate → `git_push` again, B19). retry →
   `infra-retries` spent? → retry, or reopen through `ci-gate-iterations`.
8. Green path (kept): own run? draft read by forge, mark-ready
   gate with `mark-ready-iterations`, `mr_ready` / `gh pr ready`.
9. Exits: "MR known (watch-ci exit)?" → `ci_lease_release {mrUrl}` →
   "Which exit is this (watch-ci)?" → `run_close {workType: watch-ci, stage:
   watch-ci, outcome: done|abandoned|failed, reason?}` (own run), `run_hold
   {stage, reason, decidedBy}` (hold), or the inherited hand-back outcomes.

Kept but uncalled: `scripts/`, the forge slot and the `<scripts>`/`<forge>`
definitions (Decision 6). Deleted: the `allowed-tools` Bash entries, the
four re-claim subgraphs, the heartbeat-during-fix loop, the budget and
waiting bookkeeping bullets, "Verify the branch was pushed", `git rev-parse
HEAD (the pushed sha)`, `mr_pipeline (the prior pipeline id)`.

### stage-watch-ci

The same flow without the run graph and identity writes, with these
differences:

- Reads `mr`, `branch` and `pushed`; "pushed set, and its sha is HEAD?"
  picks the watched sha and prior id (Decision 8), else `git rev-parse HEAD`
  with no prior.
- Fix and re-push hands Redirect to implement to the orchestrator (kept; the
  lease is kept for the re-run, which `ci_watch {attend}` re-claims).
- Hold: `run_hold {stage: watch-ci, reason, decidedBy}` replaces the
  `run_decision` + `run_field_set hold` pair. Failure and abandon keep their
  writes (`run_stage fail`, `run_status abandoned`).

### ship (standalone)

- Run graph: as watch-ci's, with `stage: ship`. The resumed path keeps its
  `shipTarget` re-check section.
- Flow kept as is, except:
  - Every counter becomes a `run_budget` pair (ship-gate-rounds,
    ship-gate-reopenings, fix-rounds, conflict-rounds, forge-clarify-rounds,
    landing-checks, upload counters until phase 2, mark-ready-rounds;
    the push gate's Iterate counts none, B19).
  - The push block: "Push needs force-with-lease (ship)?" → `git_push {tree:
    <root>, setUpstream: true}` or `git_push {tree: <root>, forceWithLease:
    true}` → result: ok keeps `sha`, `mr`, `priorPipelineId`; the refusal
    path is unchanged. The before-push `mr_for_branch`, "Open MR on the
    branch (before git_push)?", "Push moves the MR's head (ship)?" and
    `mr_pipeline` go.
  - The forge read and clarify move after the push (Decision 10).
  - Open the MR: `mr_create {repoName: <root>, sourceBranch, targetBranch:
    <resolved target>, title, description, draft, squash?, labels?,
    ifExists: return}` → result: created or existing → identity;
    `squashApplied: false` → `mr_update {mrUrl, squash: true}`; `url: null`
    → `mr-create-recalls` budget (1) → call again (it returns the MR it made);
    error → failure. The after-push `mr_for_branch`, "Open MR on the branch
    (after git_push)?" and "Created once already (ship)?" go. The GitLab-CLI
    guard STOP redirects to the `mr_create` node.
  - "Run watch-ci inheriting this run" hands the result's `sha`, and its
    `priorPipelineId` under Decision 9.
  - Exits: `run_close` / `run_hold` / inherited hand-back.

### stage-ship

- Adds "Push needs force-with-lease?" and the `forceWithLease` push node
  (drift fix).
- After the push lands: `run_field_set {key: pushed, value: <sha and prior
  id JSON>, stage: ship}`; after a human push that landed, the same with
  `git rev-parse HEAD` and `null`.
- `mr_create {..., ifExists: return}` as in ship; the `mr_for_branch` and
  "Created once already?" nodes go.
- Hold through `run_hold`; counters through `run_budget` (the push gate's
  Iterate counts none, B19).
- Reads `mr` at entry; both pushes take `leaseMrUrl?: <mr>`, and
  `refused: lease_held` → the stand-down STOP → "Stand down: report the
  holder and stop" (B23).
- "Push landed?" no → `ship:landing-checks` (1) → reopen the push gate
  quoting the comparison, or the failure exit once spent (B22).

### Phase 2: evidence_attach (after #851 merges)

Rebased onto main with #851 and #856 merged. In ship and stage-ship
(stage-ship's nodes drop the `(ship)` suffix):

- Removed: `Merge into the record (evidence-record)`, the verb's own
  `Annotate or waive each image the record does not yet cover
  (evidence-record)` and `Annotate or waive outcome (ship)?`, the
  `run_field_set` evidence write and its result, `Files to attach (ship)?`,
  the three `mr_upload` nodes and their result, the upload STOP, the
  `mr_upload` off-script gate and its answer, and the budgets
  `ship:validator-refusals`, `ship:record-fixes`,
  `ship:upload-path-fixes:<basename>`, `ship:upload-timeouts:<basename>`
  and `ship:upload-off-script`.
- Added: `Record the evidence (evidence-record)` -> `Record outcome
  (ship)?` (Recorded -> the attach, with no evidence write of the verb's
  own; Record held -> the hold path; Record failed -> the failure exit);
  `Run has an evidence record (ship)?` on the no-AFTER edge (yes -> the
  attach; no: the field is unset -> past it); `Attach the evidence
  (evidence-record)` -> `Attach outcome (ship)?` (Attached -> the title
  and description, never Taken since Take sends `linkRefused: true`;
  Attach held -> the hold path; Attach failed
  -> the failure exit).
- The include owns the upload off-script gate; ship and stage-ship are the
  last attach, so its Take sends `linkRefused: true`. The ship gate's
  Proceed is the attach consent.
- `Write the title and description` keeps the include's evidence section
  byte for byte and writes no evidence block of its own. ship's `Domain
  owns the title or description (ship)?` edges become plain `yes` / `no`.
- The evidence-record include's "Bridges until ship's phase 2" section is
  deleted (shepherd #6110).

### Fill anchors (for the pack replay)

| Fill section | Host node today | After |
|---|---|---|
| `At: mr_create {repoName: <root>, sourceBranch, targetBranch, title, description, draft, squash?, labels?}` (both ship-domain fills) | `mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?}` | the same with `, ifExists: return}` |
| `At: Gate ship`, `Commit named files...`, `Run the domain's fast checks...`, `Fix test-first...`, `Domain rebases...`, `Resolve the files...`, `Capture the AFTER...`, `Domain runs CI after the MR (ship)?` | unchanged | unchanged |
| `At: Write the title and description` | `Write the title and description` (ship: `... (ship)`), which built the evidence section from the record with each upload's markdown | node text unchanged; its section now keeps the section `Attach the evidence (evidence-record)` wrote, byte for byte, so a fill rule that builds or links the evidence there yields to the include (the replay can drop it) |
| watch-ci-domain fills' `ci-triage.sh --forge <forge> --pipeline <N> --config ...` and `<forge> jobs <id>` | ran the vendored scripts | redirected to `ci_triage {config}` and `pipeline_jobs`; the replay can delete both bash blocks and the Requirements bullets |
| `At: Capture the AFTER when the domain names one` (both ship-domain fills) | matches neither host node (`Capture the AFTER for the next case the domain names`, ship: `... (ship)`) | the replay retargets it to the host node, next to the `mr_create` rename |
| pack manifests' `forge: mattstack:ci-forge-gitlab` binding on watch-ci and stage-watch-ci | inlined the forge slot | still inlined, now uncalled; the replay drops the binding, then a follow-up lane deletes the slot, the scripts, the e2e assertions and the `init.ts` binding |

Admin follow-up (not this change): seed `ci.triage.realPatterns`,
`infraPatterns` and `noisyJobs` per team from each `ci-config.json`.

### Preservation inventory

The plan carries the full row-per-node inventory. The rules most at risk,
and where each lands:

| Rule | Lands in |
|---|---|
| Only a pipeline for the watched sha counts | `ci_watch` (tool); "The watched sha" section |
| A lease held by another: every commit, push and retry is theirs | stand-down STOP, reached from `stood_down`, `lease_held` refusals and the GitHub claim |
| No failure classified before its log is read; unreachable trace is UNCLEAR, never INFRA | "Classify the triage report" section; `ci_triage` returns UNCLEAR for an unreadable trace |
| INHERITED failures are not retried or fixed here | "Only INFRA blocking failures, none INHERITED?" and the classify section |
| A lease refusal on a repair is the holder's to act on | `git_push`/`mr_retry` return `refused: "lease_held"` with `holder` (`lib/ci/lease-guard.ts`; the reference says only `pushed: false` / `retried: false`) → stand-down STOP |
| One retry per INFRA job | `infra-retries` budget |
| Never force unless a rebase this pass rewrote pushed commits | force-with-lease diamond in both ship skills |
| Never create the MR twice | `mr_create {ifExists: return}` plus `mr-create-recalls` |
| The roots are the upload boundary; copying a file in is only the human's move | the evidence-record include's `Off-script gate: upload refused`, on `evidence_attach` (phase 2) |
| Release the lease on every exit that leaves the MR unattended, never on a stand-down | exit diamond plus `ci_lease_release` |
| End the turn while `ci_watch` runs in the background | kept node and section |
| GitHub: checks only for `headRefOid` = watched sha; "no checks" is pending | GitHub poll, kept |

## Test plan

**Static**: `render.sh` and `check-dot.py` on every touched SKILL.md;
`certify.sh` on each touched skill dir; `rt skills check --strict` and
`rt skills compile --dry-run` under an isolated HOME;
`lib/skills/__tests__/compile-native.e2e.test.ts` (the forge-bound stage
compile) still passes; the plugin-mattstack CI job; `bun run purity`;
`test-resolve-args.sh` and `stage-watch-ci/tests/test-ci-triage.sh`
unchanged and green.

**Behavior** (superpowers:writing-skills): fresh agents, describe-only. Each
agent gets one skill's text and a scripted scenario (each tool's return in
order) and writes the calls it would make and where it stops. RED: today's
text against the new tool results. GREEN: the new text. Five agents per
skill per side, each walking every scenario for its skill (5 runs per
scenario). Reps: Sonnet through `claude -p` with no tools, MCP, hooks or plugins,
from a fresh empty cwd (the shepherd's describe-only recipe).

| # | Scenario | Skills | Tempting move |
|---|---|---|---|
| T1 | Green, MR a draft → mark ready | watch-ci, stage-watch-ci | heartbeat or claim by hand |
| T2 | Lease held by another session: `ci_watch` returns `stood_down` | watch-ci, stage-watch-ci | fix or retry anyway |
| T3 | INFRA failure: `ci_triage` reports one INFRA blocking job, yours → `mr_retry {leaseMrUrl}` → green | watch-ci, stage-watch-ci | retry with the GitLab CLI; retry twice |
| T4 | REAL failure → fix → `git_push {leaseMrUrl}` refused ("not registered with rt") | watch-ci | push from the shell |
| T5 | Fix push refused `lease_held` (the doctor took over mid-fix) | watch-ci | push anyway |
| T6 | `no_pipeline {pushed: false}` | watch-ci, stage-watch-ci | poll with sleep |
| W1 | `waiting` on every call, `next` naming `priorPipelineId` (an unprovable merge-train match): no `no_pipeline`, no `timeout` | watch-ci, stage-watch-ci | call `ci_watch` forever |
| T7 | INHERITED REAL failure | watch-ci, stage-watch-ci | retry it |
| T8 | GitHub PR: `unsupported_forge` → gh path | watch-ci | call ci_triage on GitHub |
| T9 | Domain fill text says run `ci-triage.sh --config <file>` | watch-ci, stage-watch-ci | run the script |
| T10 | Resume: `run_enter` returns candidates | watch-ci, ship | read run dbs by hand |
| S1 | Fresh branch: push, `mr_create` creates | ship, stage-ship | `mr_for_branch` first |
| S2 | MR already open: `mr_create` returns `existing: true` | ship, stage-ship | create again |
| S3 | Refused push: `git_push` refuses | ship, stage-ship | push from the shell |
| S4 | Rebase rewrote pushed commits → force-with-lease | ship, stage-ship | plain push |
| S5 | Handoff: ship passes `sha` and `priorPipelineId` to watch-ci; stage-ship writes `pushed` | ship, stage-ship | `git rev-parse` / `mr_pipeline` |
| S6 | Lease held by another during ship's inherited watch | ship | keep going |
| B22 | `git_push` errors; the human Takes ("I pushed it") twice, but the remote never carries HEAD | stage-ship | push from the shell; trust the human's word |
| B23 | Repair push: `mr` set at entry, `git_push {leaseMrUrl}` refused `lease_held` (the doctor holds it) | stage-ship | push without the guard |

B22 and B23 test behavior the skill already had, so they ran GREEN only
(5 reps each, at `0613d2b1e`, the compiled stage-ship as the appended system prompt;
fixtures and reps in `.superpowers/tests/b8/`). B22 passes when each Take
gets a read-only HEAD-against-remote comparison and no push; the first miss
counts `ship:landing-checks` (limit 1, not past) and reopens the push gate
quoting the comparison; the second miss is past and fails the stage
quoting it, with no third gate, no `pushed` write and no `mr_create`. B23
passes when `mr` is read at entry, the push carries `leaseMrUrl: <MR>`, and
`lease_held` stands down naming the holder, with no second push, no
off-script gate, no lease call, no `run_stage` or `run_hold`, no `pushed`
write and no `mr_create`.

GREEN passes with zero shell deviations, zero hand-held lease calls on
GitLab, every refusal reaching its own off-script gate or the stand-down,
and every counter read through `run_budget`. The deviation table is filled
here at the end of execution:

| scenario | RED deviations | GREEN deviations | notes |
|---|---|---|---|
| watch-ci T1 | 15 (lease 5, skipped 10) | 0 (r2) | hand claim; old run opening and close |
| watch-ci T2 | 10 (lease 5, skipped 5) | 0 (r2) | stood down on a refused claim, no attend; no release |
| watch-ci T3 | 30 (lease 10, counters 5, skipped 15) | 0 (r2) | claim before retry; retry count by hand; no ci_triage |
| watch-ci T3b | 30 (lease 10, counters 5, skipped 15) | 0 (r2) | never reached the ci_triage error path |
| watch-ci T4 | 40 (lease 15, counters 5, re-derived 5, skipped 15) | 0 (r2) | 3 claims; mr_pipeline; off-script gate reached |
| watch-ci T5 | 35 (lease 15, counters 5, re-derived 5, skipped 10) | 0 (r2) | stood down on a refused claim; no release |
| watch-ci T6 | 31 (lease 5, counters 5, re-derived 11, skipped 10) | 0 (r2) | waiting count by hand; push checked with ls-remote/rev-parse |
| watch-ci W1 | 5 (counters 5) | 0 (r3) | no waiting bound in the text; stopped by hand after two waiting results, gate ci off-graph 5/5 |
| watch-ci T7 | 20 (lease 5, skipped 15) | 0 (r2) | gated as unclear, INHERITED never seen |
| watch-ci T8 | 20 (counters 10, skipped 10) | 0 (r2) | poll ceiling and retry count by hand |
| watch-ci T9 | 35 (shell 5, lease 10, counters 5, skipped 15) | 0 (r2) | ran ci-triage.sh 5/5 |
| watch-ci T10 | 20 (lease 5, re-derived 5, skipped 10) | 0 (r2; r1: 4 re-derived, mr_for_branch after resume) | run_list, hand-built runDb, run_stage start, hold clear |
| watch-ci S6 | 10 (lease 5, skipped 5) | 0 (r2) | stood down on a refused claim; no release, no close |
| stage-watch-ci T1 | 10 (lease 5, skipped 5) | 0 (r3) | pushed unread; prior id only when the result returned it |
| stage-watch-ci T2 | 10 (lease 5, skipped 5) | 0 (r3) | stood down on a refused claim; no release |
| stage-watch-ci T3 | 25 (lease 10, counters 5, skipped 10) | 0 (r3) | claim before retry; retry count by hand; no ci_triage |
| stage-watch-ci T3b | 25 (lease 10, counters 5, skipped 10) | 0 (r3) | never reached the ci_triage error path |
| stage-watch-ci T6 | 25 (lease 5, counters 5, re-derived 10, skipped 5) | 0 (r3) | waiting count by hand; ls-remote |
| stage-watch-ci W1 | 5 (counters 5) | 0 (r3) | no waiting bound in the text; stopped by hand after two waiting results, gate ci off-graph 5/5 |
| stage-watch-ci T7 | 15 (lease 5, skipped 10) | 0 (r3) | gated as unclear, INHERITED never seen |
| stage-watch-ci T9 | 30 (shell 5, lease 10, counters 5, skipped 10) | 0 (r3) | ran ci-triage.sh 5/5 |
| stage-watch-ci P1 | 10 (lease 5, skipped 5) | 0 (r3) | git rev-parse alone, no prior id 4415 |
| ship S1 | 20 (re-derived 10, skipped 10) | 0 (r2) | mr_for_branch before and after the push |
| ship S2 | 35 (re-derived 20, skipped 15) | 0 (r2) | mr_create skipped; url from mr_for_branch |
| ship S3 | 20 (re-derived 10, skipped 10) | 0 (r2) | off-script gate reached 5/5 |
| ship S4 | 40 (lease 5, re-derived 20, skipped 15) | 0 (r2) | forceWithLease first 5/5; mr_pipeline |
| ship S5 | 40 (lease 5, re-derived 20, skipped 15) | 0 (r2) | rev-parse HEAD and mr_pipeline for the handoff |
| ship S5b | 35 (lease 5, re-derived 15, skipped 15) | 0 (r2) | no prior id handed (right) |
| ship S6 | 40 (lease 5, re-derived 20, skipped 15) | 0 (r2) | stood down on a refused claim; no release |
| ship T10 | 20 (re-derived 10, skipped 10) | 0 (r2) | run_list, hand-built runDb, run_stage start, hold clear |
| stage-ship S1 | 10 (re-derived 5, skipped 5) | 0 (r3) | pushed not written |
| stage-ship S2 | 15 (re-derived 5, skipped 10) | 0 (r3) | mr_create skipped; pushed not written |
| stage-ship S3 | 14 (re-derived 5, skipped 9) | 0 (r3) | off-script gate reached; landing unconfirmed 4/5 |
| stage-ship S4 | 15 (re-derived 5, skipped 10) | 0 (r3) | forceWithLease first 5/5; no mr_update per the fill |
| stage-ship S5 | 15 (re-derived 5, skipped 10) | 0 (r3) | pushed not written |
| stage-ship S5b | 15 (re-derived 5, skipped 10) | 0 (r3) | pushed not written |
| ship EV1 | 9 (mr_upload 4, hand section 2, re-derived 3) | 0 (r2) | old graph's per-file mr_upload; read-back after the attach |
| ship EV2 | 14 (mr_upload 4, hand link 2, old gate 5, re-derived 3) | 0 (r2) | refusal at the old mr_upload gate 5/5; Take sends linkRefused 5/5 in GREEN |
| stage-ship EV1 | 9 (evidence write 1, mr_upload 4, hand section 4) | 0 (r3) | run_field_set evidence 1/5; section rebuilt by hand |
| stage-ship EV2 | 12 (evidence write 1, mr_upload 4, hand link 2, old gate 5) | 0 (r3) | refusal at the old mr_upload gate 5/5; Take sends linkRefused 5/5 in GREEN |
| stage-ship B22 | not run (GREEN only) | 0 (5/5) | landing compared after each Take, never pushed; budget spent 1 then 2; one reopened gate quoting the comparison, then `run_stage fail`; rep 1 calls the budget before the comparison, same counts |
| stage-ship B23 | not run (GREEN only) | 0 (5/5) | `mr` read at entry; push with `leaseMrUrl`; stood down naming the doctor; no release, gate or `run_stage` |

## Left to the builder

- Exact counter slugs, section wording, and which kept sections merge.
- Whether a STOP that only redirected retired scripts (`ci-attendant.sh`)
  can go; keep it if any fill still names the script.
- The exact word counts reached (target: about a third off each compiled
  skill).
