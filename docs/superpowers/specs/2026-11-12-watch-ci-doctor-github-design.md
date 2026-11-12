# watch-ci and board doctor on GitHub

Tickets: SKILLS-108, RT-370 (GitHub budget part only). Project P-RT-28,
GitHub parity.

## Why

The MCP CI tools now speak GitHub (RT-546, glance 0.31): `ci_watch`,
`ci_triage`, `pipeline_jobs`, `mr_job_trace`, `mr_retry`, `mr_view`,
`mr_ready`, `mr_for_branch` and `mr_rebase {wait: true}` all take a PR
URL. The skills never caught up:

- `watch-ci/flow` and `stage-watch-ci` still poll GitHub with a
  `gh pr checks` loop on a hard-coded 46-poll budget, behind a
  `ci_watch` `unsupported_forge` edge the tool no longer returns, and
  never read `ci.watch.budgetMinutes` (RT-370's GitHub bullet).
- Board doctor ends every run on a GitHub PR at entry ("CI watch and
  server-side rebase are GitLab only for now").
- Two respond sentences are wrong on either forge: `post.md`'s reply check
  matches a note "made in this pass" with no way to date a pass, and one
  `triage.md` sentence contradicts the fetch gate's take edge.
- The plugin README and the skills manifest schema still present
  `mattstack:ci-forge-gitlab` as the way CI reaches GitLab.

Success: a GitHub PR walks the same graph nodes as a GitLab MR through
watch-ci, the watch-ci stage and doctor, with the tools doing the
forge-specific work, and the GitLab walk does not change.

## Goals

1. watch-ci (verb and stage) watch, triage, retry, draft-check and mark
   ready on GitHub through the shared tool path.
2. Board doctor runs on a GitHub PR: diagnose, rebase, watch, classify and
   retry.
3. The respond reply check and the triage marker sentence say what the
   graphs do.
4. The README and schema stop presenting ci-forge-gitlab as the CI route.

## Non-goals

- Any GitLab behaviour change (standing ruling). GitLab nodes, edges and
  tool arguments stay as they are. Text changes only where a sentence,
  guard or label names GitLab alone for something both forges now share.
  Each such change is on the projection allowlist below.
- Changing the 60 second GitHub poll or its request cost (settled; it is
  `ci_watch`'s default).
- RT-370's merge-train waiting reason: `ci_watch` has no waiting `reason`
  field, and adding one is `lib/ci/watch.ts` work, outside this lane.
- Retiring the `forge` prop slot, the `ci-forge-gitlab` attachment, ci-forge
  code under `lib/`, or the `gh` rules in `lib/setup/base-permissions.ts`.
  A team pack may still bind the slot, so it stays. All are follow-ups.
- Board doctor's stack-children check (the rt-363-doctor-stack lane).

## Anti-goals

- A GitHub path that differs from GitLab's only by calling `gh` instead of
  a tool. Any `gh` command left in these skills counts as a failure.
- A separate GitHub include, prop or pack (one forge per team, and the
  tools already branch on forge).
- A change to the shared tools' contracts; this lane only edits skills.

## Approaches

| Approach | Trade-off | Verdict |
|---|---|---|
| Collapse: delete the GitHub-only branches; both forges walk the path GitLab walks today | Smallest graph; the tools own polling, budget, lease and sha guard on both forges | **Picked** (shepherd, gate ef1ab7eb) |
| Keep the `gh` loop, read `ci.watch.budgetMinutes` into its poll budget | Keeps ~25 nodes, a hand-rolled heartbeat and sha guard the tool already does; both tickets ask for the loop gone | Rejected |
| A GitHub fill for the `forge` prop | Contradicts one forge per team, and a fill cannot remove graph nodes | Rejected |

## Design

### 1. watch-ci verb (`plugins/mattstack/attachments/pipeline/watch-ci/`)

`flow/index.block.md` graph `watch_ci`:

- **Target lookup.** `target_forge_host`'s "GitLab, no MR known" edge
  becomes "GitLab or GitHub, no MR known" to `mr_for_branch`;
  `gh_pr_list` and its edges go. The "anything else" edge to
  `gate_which_forge` stays.
- **Watch.** The `unsupported_forge: a GitHub PR` edge goes, with every
  node only it reaches: `ci_lease_claim_github`, `github_claim_result`,
  `stop_hand_rolled_claim`, the `github-claim-errors` and
  `github-claim-off-script` budgets and diamonds, `fix_claim_error`,
  `gate_claim_refused`, `gh_pr_checks`, `checks_exit_code`, the
  `github-polls` and `github-sha-waits` budgets and diamonds,
  `ci_lease_heartbeat`, `heartbeat_result`, `sleep_between_polls`,
  `gh_pr_view_head_sha`, `checks_match_sha`, `checks_passed_or_failed`,
  `classify_failing_checks`. On GitHub `ci_watch {attend: true}` claims,
  heartbeats, keeps the lease, budgets from `ci.watch.budgetMinutes` and
  guards the sha, and returns the same states GitLab does.
- **Retry.** `retry_forge_host` is spliced out: its inbound edges point at
  `mr_retry`. `ci_lease_claim_retry`, `reclaim_result`,
  `gate_reclaim_refused` and `gh_run_rerun` go. `mr_retry` with `jobId`
  reruns an Actions job on GitHub.
- **Retry wait on GitHub** (gate 7acd33b8, Matt's pick). `ci_watch`
  returns `failed` as soon as a blocking job fails while others run, and
  GitHub reruns a job only once its workflow run has finished. So
  `mr_retry_result` gains one edge, "tool error: GitHub says the job's
  run is still in progress", to
  `run_budget {key: watch-ci:retry-waits:<sha12>, limit: 20, stage}`:
  - not spent: one background Bash task `sleep 60`, end the turn, and on
    its trigger the same `mr_retry` again;
  - spent: `gate_retry_refused`, as any other refusal.
  - The match is by meaning, since the refusal's text has not been seen
    live. A refusal that does not plainly say the run is still going takes
    the existing tool-error edge to `gate_retry_refused`, so an unmatched
    refusal can never loop. On GitLab the edge never fires.
- **Draft and ready.** `draft_forge_host` and `mark_ready_forge_host` are
  spliced out; `gh_pr_view_draft` and `gh_pr_ready` go. `mr_view` and
  `mr_ready` serve both forges.
- **Deleted blocks:** `flow/classify-failing-checks`, `flow/fix-claim-error`,
  `flow/gate-claim-refused`, `flow/gate-reclaim-refused`.
- **Prose.**
  - Header: `<N>` is the number in `pipeline.id` (`gitlab:pipeline:N`).
    On GitHub, `ci_triage` and `pipeline_jobs` are called with no
    `pipelineId`: their default is every check on the PR head, while a
    `github:run:N` names one workflow run and would miss failures in the
    others. The head is the watched sha, since a moved head makes
    `ci_watch` return `superseded` first. *(My call, from
    `lib/mcp/ci-tools.ts` and `lib/ci/github-forge.ts`.)* The
    `domain-rules` sentence "call `ci_triage` with `pipelineId: <N>`"
    gains the same GitHub exception, and the `ci_triage` node label reads
    `pipelineId: <N> on GitLab`.
  - Guards that name GitLab only (`stop_gitlab_ci_shortcut`,
    `stop_gitlab_triage_shortcut`, the "a script or the GitLab CLI" row in
    `the-attendant-lease`) widen to name both forges' CLIs (`glab`, `gh`).
    The text changes and the edges stay, and the projection allowlist
    lists each changed text. *(My call.)*
  - `reading-gitlab-facts` stays GitLab's. On GitHub, a fact no read tool
    returns is unreadable: a classification takes UNCLEAR, and any other
    step takes its off-script gate, quoting what was missing. The block
    says so in one sentence. *(My call.)*
  - `flow/fix-watch-error`: `priorPipelineId` is GitLab's `N`; on GitHub
    the tool ignores it, so it is never the input to correct.
  - `flow/classify-failed-jobs` (the `ci_triage`-errored fallback): the
    bridges read is GitLab's; on GitHub an empty `failedJobs` on `failed`
    is read with `pipeline_jobs`, and a failed check with `jobId` null (a
    commit status, or a check another app reported) has no trace, so it is
    UNCLEAR.
  - `flow/classify-triage-report`: a `crossProject` entry on GitHub is a
    failed check with no readable log, so it is UNCLEAR (the existing rule
    "an unreadable trace is UNCLEAR, never INFRA" already sends it to the
    gate, which is why a commit-status failure is never retried).
  - `the-attendant-lease`: only `ci_watch {attend: true}` claims, on both
    forges; the "On GitHub the graph claims and heartbeats" sentence and
    the "On GitLab" qualifier in the rationalization row go.
  - `what-the-graph-cannot-show`: the sha-guard bullet loses its GitHub
    `headRefOid` and `gh run rerun` sentence.
  - `flow/gate-ci`: where `no_pipeline` is described, add that on GitHub it
    means no check reported for the sha.
  - `budgets-in-this-verb`, `domain-rules`, `forge`, `run/`: change only if
    they name a deleted node, budget key or `gh` command.

### 2. watch-ci stage (`plugins/mattstack/attachments/pipeline/stage-watch-ci/`)

The same changes as section 1 on `index.block.md` and its blocks: the
`unsupported_forge: GitHub` edge and the GitHub node set it reaches,
`retry_forge_host`, `draft_forge_host`, `mark_ready_forge_host`, the four
GitHub-only blocks (`classify-failing-checks`, `fix-claim-error`,
`gate-claim-refused`, `gate-reclaim-refused`), and the matching prose in
the header, `fix-watch-error`, `classify-failed-jobs`,
`classify-triage-report`, `the-attendant-lease` and
`what-the-graph-cannot-show`, plus the same GitHub retry wait. The stage has no target lookup (it reads
`mr` from the run). Edges into `run_field_set_ci_red` from a deleted gate
go with it. The vendored `scripts/ci-triage.sh` and its `tests/` are
untouched.

### 3. Board doctor (`apps/board/skills-src/doctor/`)

- **Entry.** `entry.md` loses the `mrUrl on github.com (doctor)?` diamond,
  its status write, its print box, its exit and their sections; the
  trigger goes straight to `--resumed-gate given (doctor)?`. `SKILL.md`
  loses the `doctor can't run on GitHub` edge out of
  `Entry outcome (doctor)?`, and any prose naming that outcome.
- **Rebase** (gate 06908e35). After the status write, a new diamond
  `Forge (before the rebase)?` routes:
  - GitLab: `mr_rebase {mrUrl}` and everything after it, unchanged.
  - GitHub: `mr_rebase {mrUrl, wait: true}` then
    `mr_rebase result (GitHub)?`:
    - `rebased`: `Rebased or running: continue at Watch the pipeline`,
      watching the returned `sha`.
    - `pending`: `Diagnosis ends the run` with an error naming the state
      (`rebase still pending on <sha>`, plus `lastError` when present).
    - a tool error saying GitHub will not rebase (conflicts, already up
      to date, a fork that blocks edits): `Diagnosis ends the run`, error
      "the conflicts need a checkout", quoting the error. The match is by
      meaning, anchored on the one string measured live for conflicts
      (`PullRequest::RebaseConflictError`). A misread costs at most one
      fix-once and one escalation, which a human answers. *(My call.)*
    - any other tool error: the existing `Fixed the mr_rebase call once
      already?` path (fix once, then `doctor off-script escalation:
      mr_rebase refused`).
    - the existing STOP edge for the forge CLI or a checkout applies here
      too.
  - The "Rebase poll" prose bullet gains one GitHub sentence; `Fix what
    the mr_rebase error names` gains the GitHub refusal rule. No new
    escalation.
  - The `mr_rebase` off-script gate's take ("the human rebased") keeps its
    edge to the `mr_view` rebase poll on both forges. On GitHub
    `rebaseInProgress` is always false, so the poll reads a moved sha as
    rebased cleanly and an unchanged sha with conflicts as needing a
    checkout. That diamond's "conflicts GitLab cannot rebase" label
    becomes "conflicts the forge cannot rebase" (allowlisted). The gate's
    iterate goes back through the lease check and the new forge diamond,
    as it does today. *(My call.)*
- **Watch.** `watch.md`'s `Waiting results in a row = 2` exit keeps its
  GitLab meaning, but its label and status text stop claiming no pipeline
  ran: "no pipeline seen for the sha after two watches". `Fix what the
  ci_watch error names` names `priorPipelineId` as GitLab's `N` only.
  Doctor keeps calling `ci_watch` without `attend` (board-mode lease rules
  unchanged).
- **Classify.** `classify.md`'s three jobId sentences name both forms
  (`gitlab:job:N`, or `github:check:N` on GitHub). A failed GitHub check
  with `jobId` null or no Actions trace cannot be read or retried, so it
  takes `real, or no licensed fix` with the error naming the check and
  why; it is never retried as flaky.
- **Retry wait on GitHub.** Doctor's `mr_retry {mrUrl, jobId}` result
  gains the same edge as watch-ci. An error saying the job's run is still
  in progress counts `Retry waits = 20 (doctor)?`. Not yet: one
  background `sleep 60`, end the turn, then on its trigger back through
  the lease check to the same retry. Yes, and any refusal that does not
  plainly say so: today's fix-once and `mr_retry refused` escalation.
  The count resets with a new watched sha.
- **Untouched:** the stack-children nodes, bullet and section that
  rt-363-doctor-stack inserts between `Server-side rebase licensed?` (yes)
  and `Lease mode (before the rebase)?`, and `SKILL.md`'s Fix classes
  `clean-api-rebase` line, as agreed by DM. If that lane lands first, this
  branch rebases onto it and keeps its hunks.

The diagnosis itself needs no change: on GitHub `mr_view` returns
`conflicts` and a head `pipeline` (glance `githubFill.ts`).

### 4. Respond (`apps/board/skills-src/respond/`)

- `post.md`, both "Check the MR for the reply" sections: "made in this
  pass" becomes "created after the `answeredAt` in `--report`'s
  `gate-2-answer` line", the anchor `launch.md` already uses for the same
  question. That line is written before any post, so every post this
  Gate 2 answer licensed counts, including one a resumed pane made before
  a crash.
- `triage.md`: the marker-read sentence gains the take exception: a marker
  read that errors takes the fetch read's fix-once path and its off-script
  gate, and nothing is adjudicated until both reads succeed or that gate's
  take supplies the threads.

### 5. README and schema

- `plugins/mattstack/README.md`: the `mattstack:ci-forge-gitlab` entry is
  rewritten to say it is a legacy fill for the watch-ci `forge` prop, and
  that CI watch and triage go through `ci_watch` and `ci_triage` on both
  forges. The Forge cluster intro loses "with the seam left open for
  GitHub". The tests-path example stays (the folder still exists).
- `plugins/mattstack/plugin/schemas/skills-manifest.md`: the example drops
  the `mattstack:stage-watch-ci/forge` binding line.

### 6. Version and compile

Edit only `*.block.md` sources and `skills-src/`; compiled output comes
from the compile. `plugin.json` is set one past main right before the
push, and the PR body carries the engine-floor line.

## Proving the GitLab walk is unchanged

The shepherd asked that this claim be checkable. The plan adds a scratch
script under `.superpowers/` (committed with the branch, never shipped)
that, for each edited graph (`watch_ci` in both trees, and doctor's
`entry`, `diagnose`, `watch` and `classify` digraphs):

1. parses the graph's nodes and edges at `main` and at the branch head;
2. projects each onto GitLab: drops edges whose label names GitHub only,
   splices out each forge diamond by following its GitLab edge, and keeps
   only what the entry node reaches;
3. diffs the two projections by node text and edge label.

The expected output is empty except for an allowlist the plan writes out
(renamed edge labels such as "GitLab or GitHub, no MR known", and
doctor's "no pipeline seen" label). The final review runs it and quotes
the output. Certify, `rt skills check --strict` and the board skills check
under an isolated temp HOME show the compiled skills are well formed; the
projection diff shows the GitLab path is the same.

## Constraints

- Write fence: the two watch-ci trees, `apps/board/skills-src/{doctor,respond}`,
  their compiled output (by compile only), `plugin.json`, `pack/`, the
  README and schema lines above, plugin test fixtures certify needs,
  `docs/superpowers/`, `.superpowers/`.
- Every skill edit follows mattstack:editing-skills, superpowers:writing-skills
  and mattstack:process-digraphs: baseline a fresh agent (RED), edit, compile,
  verify (GREEN), certify. RED and GREEN runs make no live forge call and
  never post to or poll a real PR.
- No em or en dashes. No live forge calls. Built binaries only under an
  isolated HOME.

## Left to the builder

- Exact node names for the doctor GitHub rebase nodes, and the wording of
  each error string, within the meanings above.
- Whether a deleted node's budget key needs a mention in `budgets-in-*`.
- The RED/GREEN scenarios, as long as each changed graph region has one
  (watch-ci on a GitHub PR, doctor on a GitHub PR with conflicts, the
  respond reply check after a crash).

## Follow-ups (listed in the PR)

- Confirm GitHub's refusal text for a job rerun on a running workflow,
  and pin it in the retry-wait edges. The PR body says it is matched by
  meaning today.

- Remove the `gh` rules from `lib/setup/base-permissions.ts`.
- Retire ci-forge code under `lib/`, the `attachments/ci-forge-gitlab`
  attachment and the `forge` prop slot.
- The ci-forge references in `creating-a-pack/SKILL.md` and
  `extending-a-pack/props.md`.
- RT-370's merge-train waiting reason (needs `lib/ci/watch.ts`).
- The `lib/command-tree-def.ts` and `.claude/rules/mcp-and-gates.md`
  wording RT-546 noted.
