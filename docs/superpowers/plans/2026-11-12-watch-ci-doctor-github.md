# watch-ci and board doctor on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub PR walks watch-ci (verb and stage) and board doctor through the shared MCP tools, the respond reply check and triage marker sentence say what the graphs do, and the GitLab walk is unchanged.

**Architecture:** Skill-source edits only. The watch-ci verb and stage are mattstack block trees (Mermaid graph in `index.block.md`, one block per judgment node), compiled by `rt skills compile`. Board doctor and respond are hand-written dot-graph skills in `apps/board/skills-src/`, expanded to the committed `apps/board/skills/`. A scratch projection script proves the GitLab walk unchanged.

**Tech Stack:** Markdown skills (Mermaid, graphviz dot), the rt CLI from source (`bun cli.ts`), certify (`sh`), `check-dot.py`, a bun TypeScript scratch script.

**Spec:** `docs/superpowers/specs/2026-11-12-watch-ci-doctor-github-design.md` (read it first; every task implements a section of it).

## Global Constraints

- GitLab behaviour does not change. Text on the GitLab path changes only as the spec's allowlist says ("Proving the GitLab walk is unchanged").
- One forge per team; the 60 second GitHub poll and its request cost are settled (`ci_watch`'s default; never pass `intervalSeconds`).
- Write only: `plugins/mattstack/attachments/pipeline/watch-ci/`, `plugins/mattstack/attachments/pipeline/stage-watch-ci/`, `apps/board/skills-src/doctor/`, `apps/board/skills-src/respond/`, the compiled `apps/board/skills/` (by expand only), `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/README.md` and `plugins/mattstack/plugin/schemas/skills-manifest.md` (ci-forge lines only), `docs/superpowers/plans/`, `.superpowers/`. Nothing under `lib/`, `packages/`, any other `apps/board` path, or any other skill.
- Do not touch the stack-parent nodes, bullet or section in `diagnose.md` (PR #1113, rt-363-doctor-stack), nor `SKILL.md`'s `clean-api-rebase` Fix classes line.
- No live forge calls of any kind. No walker agent posts to or polls a real PR. No `rt`, daemon or built binary against the real HOME: every `bun cli.ts` runs through `.superpowers/verify.sh` or under `env -i HOME=<scratch>/home`. Never `rt skills sync` or `claude plugin update`. Never touch `~/Documents/GitHub/repo-tools`.
- No em or en dashes. Stage named files only (`git add <path>`), never `-A` or `.`.
- No bare `glab` or `gh` token in any graph fence or code span you add: write "the GitLab or GitHub CLI" in words (the strict mcp lint flags bare `glab`).
- Every new GitHub-only region's entry edge label contains the word "GitHub", so the projection drops it.
- Invented names only in fixtures and scenarios (the repo is public): `acme/widgets`, `https://github.com/acme/widgets/pull/42`.
- Commit messages: short and imperative, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Shared commands

- **Verify:** `sh .superpowers/verify.sh` from the worktree root. It compiles every graph-bearing engine in a scratch dir (CI shape), runs `check-dot.py --short-ids` on the compiled watch-ci verb and stage, runs the strict mattstack pack check, the board skills check and certify on the four skill folders, and prints `scratch: <dir>`. The compiled verb is `<dir>/pack/skills/watch-ci/`, the stage `<dir>/pack/attachments/stage-watch-ci/`.
- **Expand board skills:** `env -i HOME="$(mktemp -d)" PATH="$PATH" RT_SKIP_SETUP=1 RT_BATCH=1 bun cli.ts skills expand --src apps/board/skills-src --out apps/board/skills --mattstack-dir . --strict`
- **Projection:** `bun .superpowers/gitlab-walk.ts` (Task 1) prints `GitLab walk unchanged` and exits 0, or prints each difference and exits 1.
- **Baseline today (main at the merge-base):** verify is clean except one certify `FAIL fm-description: description is 564 chars (max 500)` on `apps/board/skills/respond`. Task 6 fixes it.

## Review Focus

1. A GitHub check with no Actions log (a commit status, or a check another app reported) in a red watch: it is UNCLEAR in watch-ci and `real, or no licensed fix` in doctor, never retried. Pinned by scenarios W2 and D2.
2. An `mr_retry` refusal that does not say the run is still going: it goes to the retry gate or escalation at once and never enters the 60 second wait. Pinned by W3.
3. A resumed respond pane whose reply landed before a crash: the reply check counts it and never posts twice. Pinned by R1.
4. A GitHub PR GitHub will not rebase (conflicts): doctor ends with "the conflicts need a checkout" and quotes the error, with no fix-once loop. Pinned by D1.
5. A GitHub rebase that succeeds: doctor watches the `sha` `mr_rebase` returned, with no extra `mr_view` rebase poll and never the pre-rebase sha. Pinned by D4.

The GitLab walk through every edited graph is pinned separately, by the projection script in every task's verify step.

## Walker scenarios (RED in Task 2, GREEN in Task 8)

A walker is a fresh subagent (model `sonnet`, effort `medium`) given one skill folder to read and one scenario. It may use Read only. It answers with the ordered tool calls it would make (name and arguments), the canned result it reads for each, and where the run ends. It never calls a real tool.

Canned results come from the scenario row. Bookkeeping calls the row does not name return ordinary success:
- status and field writes are ok;
- `run_enter` and `run_field_get` return what the row states;
- `run_budget` is not exhausted unless the row says so;
- git reads return the row's branch and sha;
- `ci_lease_read` returns null and `ci_lease_claim` returns `claimed: true`;
- `ci_lease_release` and `run_close` are ok.

Every doctor row runs `resolve-args.sh` with a nonzero exit (no domain skill), so the generic path runs. Any other call the scenario does not answer ends the walk with "unscripted: <call>".

| Id | Skill | Scenario (canned results) | GREEN expects |
|---|---|---|---|
| W1 | watch-ci verb | Own run on branch `fix-42`, origin `https://github.com/acme/widgets.git`, no PR known. `mr_for_branch` returns PR 42. `ci_watch {attend: true}` returns `failed`, `pipeline.id: github:run:9001`, one blocking failed job `{jobId: 777, name: "unit (2/6)", traceTail: "ETIMEDOUT registry.npmjs.org"}`. `ci_triage` returns that job INFRA, `yours`. `mr_retry` ok. Next `ci_watch` returns `success`. `mr_view` returns `draft: true`. Gate mark-ready answers "mark ready now". | `mr_for_branch`, `ci_watch` with `attend: true`, `ci_triage` with no `pipelineId`, `run_budget` infra-retries, `mr_retry {jobId: 777, leaseMrUrl}`, `ci_watch`, `mr_view`, the mark-ready gate, `mr_ready`, `ci_lease_release`, `run_close done`. No CLI forge command, no `ci_lease_claim` or heartbeat by hand. |
| W2 | watch-ci stage | Stage entered with `mr` = PR 42, `pushed` set at HEAD. `ci_watch` returns `failed` with two blocking failures: a commit status `{jobId: null, name: "ci/external"}` and `{jobId: 778, name: "lint", traceTail: <ESLint error in a touched file>}`. `ci_triage` returns 778 REAL and `ci/external` under `crossProject`. | `ci_triage` with no `pipelineId`; `ci/external` UNCLEAR, 778 REAL; the `ci` gate; never `mr_retry`. |
| W3 | watch-ci verb | As W1 to the retry. First `mr_retry` errors `"rerun refused: the workflow run is still in progress"`; second `mr_retry` errors `"403 Resource not accessible by integration"`. | First error: `run_budget` retry-waits, one background `sleep 60`, the turn ends, then `mr_retry` again. Second error: the retry gate at once, no second wait. |
| D1 | board doctor | Launched on `https://github.com/acme/widgets/pull/42`, own mode, `--fix-classes clean-api-rebase,retry-flake`. `mr_view` returns `conflicts: true`, head pipeline success. `mr_rebase {wait: true}` errors `"GraphQL: PullRequest::RebaseConflictError"`. | No GitHub stop at entry; lease claim; `mr_rebase {mrUrl, wait: true}`; error "the conflicts need a checkout" quoting it; no fix-once retry. |
| D2 | board doctor | As D1 but `mr_view` returns no conflicts, head pipeline failed. `mr_pipeline` returns jobs `github:check:5001` (`runId: 9001`, failed, "unit (3/6)") and `github:check:5002` (`runId: null`, failed, "codecov/patch"). `mr_job_trace` for 5001 returns a network-timeout tail. | 5002 is classified without a trace read and the run ends `real, or no licensed fix` naming `codecov/patch` and that it has no Actions log; no `mr_retry`. |
| D2b | board doctor | As D2 but only 5002 failed (`runId: null`, "codecov/patch"). | No `mr_job_trace` call; the run ends `real, or no licensed fix` naming `codecov/patch`; no `mr_retry`. |
| D4 | board doctor | As D1 but `mr_rebase {wait: true}` returns `{status: "rebased", sha: "abc1234", previousSha: "def5678"}`; then `ci_watch` returns `success`. | `mr_rebase {mrUrl, wait: true}`, then `ci_watch {sha: "abc1234", ...}`; no rebase-poll `mr_view`, no sleep; the run ends green. |
| D3 | board doctor | As D2 but only 5001 failed. First `mr_retry` errors `"rerun refused: the workflow run is still in progress"`; second ok. | Retry-wait count, one background `sleep 60`, the turn ends, then the lease check and `mr_retry` again, then the watch. |
| R1 | board respond | Post phase on a resumed pane. `--report` holds `gate-2-answer: {"answers":{...},"by":"shepherd","answeredAt":1794500000000}`. `mr_reply_thread` for row `t1` errored with a timeout earlier. `mr_threads {refresh: true}` shows, in t1's discussion, a note by this run's account created at 1794500050000 whose text starts with the reply's first line. | The reply counts as posted (created after `answeredAt`); no second `mr_reply_thread`. |
| R2 | board respond | Triage. The filtered `mr_threads` read succeeds; the unfiltered marker read errors twice; the off-script gate's answer is take, with the human pasting the threads. | The marker read takes the fetch fix-once path and the off-script gate; the take goes on to adjudication. |

---

### Task 1: Projection script and the scratch verify

**Files:**
- Create: `.superpowers/gitlab-walk.ts` (uncommitted; `.superpowers/` is gitignored)
- Exists: `.superpowers/verify.sh` (written by the controller; read it, do not change it)

**Interfaces:**
- Produces: `bun .superpowers/gitlab-walk.ts [--base <ref>]`. Default base is `git merge-base HEAD origin/main`. Compares base against the working tree. Exit 0 with `GitLab walk unchanged`, else exit 1 with one line per difference: `<graph>: - <old edge or node>` / `<graph>: + <new edge or node>`.

- [ ] **Step 1: Write the script.**
  - Graphs:
    - Mermaid `watch_ci` in `plugins/mattstack/attachments/pipeline/watch-ci/flow/index.block.md` and `plugins/mattstack/attachments/pipeline/stage-watch-ci/index.block.md`.
    - Dot digraphs in `apps/board/skills-src/doctor/{entry,diagnose,watch,classify,SKILL}.md`. One md file may hold several digraphs; key each by its digraph name.
  - Parse:
    - Mermaid: declarations `id<shape-open>text<shape-close>` (strip quotes and shape brackets; a bare `id` line means text = id) and edges `a -->|label| b`, `a --> b`, `a -.-> b`.
    - Dot: nodes by their quoted name; edges `"a" -> "b" [label="..."]`.
  - Project onto GitLab:
    1. Drop every edge whose label matches `/GitHub/` and not `/GitLab/`.
    2. Splice out each forge diamond by its GitLab edge: every edge into the diamond is redirected to the GitLab edge's target, and the diamond's other edges are dropped. The diamonds and their GitLab-edge labels are:
       - `target_forge_host`: `GitLab, no MR known`, or after Task 3 `GitLab or GitHub, no MR known`.
       - `retry_forge_host`, `draft_forge_host`, `mark_ready_forge_host`: `GitLab`.
       - `mrUrl on github.com (doctor)?`: `no`.
       - `Forge (before the rebase)?`: `GitLab`.
       - A diamond absent from one side is a no-op there.
    3. Keep only what is reachable from every node with no inbound edge (each trigger), as check-dot seeds its walk.
  - Compare:
    - Compare edges as `(fromText, label, toText)` triples, plus the node texts.
    - Before comparing, apply the allowlist to the base side as text substitutions. The allowlist is a const array of `[old, new]` pairs, filled from the spec's list as Tasks 3 to 6 land; each task appends its own pairs.
- [ ] **Step 2: Run it on the unedited tree.** Run: `bun .superpowers/gitlab-walk.ts`. Expected: `GitLab walk unchanged`, exit 0.
- [ ] **Step 3: Prove it sees a GitLab change.** Change one GitLab edge label in `watch-ci/flow/index.block.md` (`retried: watch again` to `retried: watch`). Run the script: expected exit 1, naming that edge. Restore the label with `git checkout -- plugins/mattstack/attachments/pipeline/watch-ci/flow/index.block.md`, and run the script again: expected exit 0.
- [ ] **Step 4: Run `sh .superpowers/verify.sh`.** Expected: matches the baseline in Shared commands.
- [ ] **Step 5: No commit** (nothing tracked changed). Report the script's line count and both run outputs.

### Task 2: RED baselines (controller)

**Files:**
- Create: `.superpowers/redgreen/red-<id>.md` per scenario, `.superpowers/redgreen/red-skills/` (copies of the compiled skills walked).

- [ ] **Step 1:** Re-read Linear SKILLS-108, RT-370 and RT-546. If any of the three tickets' acceptance has changed since the spec, stop and `herd_ask`.
- [ ] **Step 2:** Run `sh .superpowers/verify.sh`. Copy `<scratch>/pack/skills/watch-ci/`, `<scratch>/pack/attachments/stage-watch-ci/`, `apps/board/skills/doctor/` and `apps/board/skills/respond/` into `.superpowers/redgreen/red-skills/`.
- [ ] **Step 3:** Dispatch the ten walkers from the scenario table in parallel, each on its RED skill copy (model `sonnet`, effort `medium`). Save each transcript summary to `red-<id>.md`.
- [ ] **Step 4:** Record what each RED run did wrong against "GREEN expects". Expected misses include a CLI forge command for the retry or the draft check (W1, W3), doctor stopping at entry (D1 to D3), an unclear reply check (R1) and a refusal to adjudicate (R2). A scenario whose RED already matches GREEN is noted; its region still gets the spec's edit.

### Task 3: watch-ci verb on the shared path

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/flow/index.block.md` (header, graph)
- Delete: `plugins/mattstack/attachments/pipeline/watch-ci/flow/{classify-failing-checks,fix-claim-error,gate-claim-refused,gate-reclaim-refused}.block.md`
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/flow/{fix-watch-error,classify-failed-jobs,classify-triage-report,gate-ci,reading-gitlab-facts}.block.md`
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/{the-attendant-lease,what-the-graph-cannot-show,domain-rules}.block.md`, plus `budgets-in-this-verb.block.md`, `forge.block.md` and `run/` only where they name a deleted node, budget key or CLI forge command.

**Interfaces:**
- Produces, for Task 4 to mirror:
  - Node ids `run_budget_retry_waits[/"run_budget {key: watch-ci:retry-waits:<sha12>, limit: 20, stage}"/]`, `retry_waits_spent{"retry-waits spent (watch-ci)?"}`, `sleep_before_retry[/"sleep 60 as a background Bash task (GitHub retry wait)"/]`, `end_turn_retry_wait["End the turn: waiting to retry (watch-ci)"]`, `retry_wait_done(["Trigger: the retry wait's sleep finished (watch-ci)"])`.
  - Entry edge label `GitHub: tool error, the job's run is still in progress`.

- [ ] **Step 1: Graph removals (spec section 1).**
  - Delete the `unsupported_forge` edge and every node only it reaches (the spec lists them). Delete `gh_pr_list` and its edges.
  - The `target_forge_host` edge becomes `-->|GitLab or GitHub, no MR known| mr_for_branch`.
  - Splice out `retry_forge_host`, `draft_forge_host` and `mark_ready_forge_host`. Inbound edges go to `mr_retry`, `mr_view_draft` and `mr_ready`.
  - Delete `ci_lease_claim_retry`, `reclaim_result`, `gate_reclaim_refused`, `gh_run_rerun`, `gh_pr_view_draft` and `gh_pr_ready`.
  - Delete the four block files.
- [ ] **Step 2: Retry wait (spec "Retry wait on GitHub").**
  - Add the Interfaces nodes and these edges:
    - `mr_retry_result -->|GitHub: tool error, the job's run is still in progress| run_budget_retry_waits`
    - `run_budget_retry_waits --> retry_waits_spent`
    - `retry_waits_spent -->|no| sleep_before_retry`
    - `sleep_before_retry --> end_turn_retry_wait`
    - `end_turn_retry_wait -.-> retry_wait_done`
    - `retry_wait_done --> mr_retry`
    - `retry_waits_spent -->|yes: GitHub retry waits spent| gate_retry_refused`
  - The existing `tool error` edge stays.
  - In `what-the-graph-cannot-show`, add one bullet: the wait edge is taken only when the error plainly says the job's workflow run is still in progress; any other refusal takes the tool-error edge.
- [ ] **Step 3: Text edits (spec section 1, Prose and Guards).**
  - `ci_triage` node label becomes `ci_triage {mrUrl: <mr>, pipelineId: <N> on GitLab, config?}`; the header says GitHub omits `pipelineId`.
  - Widen the guards to these exact texts (the stage drops the ` (watch-ci)` suffix, trimming the space):
    - `STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry (watch-ci)` becomes `STOP: CI goes through ci_watch, the read tools, gitlab_get on GitLab and mr_retry (watch-ci)`.
    - `STOP: GitLab triage goes through ci_triage (watch-ci)` becomes `STOP: triage goes through ci_triage (watch-ci)`, and the `domain-rules` quote of it changes to match in both trees.
    - The edge label `tempted to watch with a script or the GitLab CLI` becomes `tempted to watch with a script or the GitLab or GitHub CLI`.
    - The `the-attendant-lease` row "A ci_watch error, so a script or the GitLab CLI" becomes "...or the GitLab or GitHub CLI".
  - Apply the block prose the spec lists.
- [ ] **Step 4: Allowlist.** Append this task's `[old, new]` text pairs to the script's allowlist: the target-lookup label, the `ci_triage` label, and each widened STOP text and edge label.
- [ ] **Step 5: Verify.**
  - Run `sh .superpowers/verify.sh`: check-dot `ok, 0 warning(s)`, strict check `mcp lint clean`, watch-ci certify `no FAIL`.
  - Run `bun .superpowers/gitlab-walk.ts`: `GitLab walk unchanged`.
  - Run `grep -n -E '(^|[^a-z_])gh ' plugins/mattstack/attachments/pipeline/watch-ci -r`: no hits.
- [ ] **Step 6: Read the compiled `<scratch>/pack/skills/watch-ci/` in full.** Confirm no deleted node is referenced and no `{{` remains.
- [ ] **Step 7: Commit** the named files, the deletions included: `watch-ci: one tool path for GitLab and GitHub`.

### Task 4: watch-ci stage on the shared path

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-watch-ci/index.block.md`
- Delete: `plugins/mattstack/attachments/pipeline/stage-watch-ci/{classify-failing-checks,fix-claim-error,gate-claim-refused,gate-reclaim-refused}.block.md`
- Modify: `plugins/mattstack/attachments/pipeline/stage-watch-ci/{fix-watch-error,classify-failed-jobs,classify-triage-report,gate-ci,reading-gitlab-facts,the-attendant-lease,what-the-graph-cannot-show,domain-rules}.block.md` and `budgets-in-this-stage.block.md` as needed.

**Interfaces:**
- Consumes: Task 3's node ids and labels. Replace `(watch-ci)` in each label with nothing, since the stage's labels carry no verb suffix, and trim the space it leaves (`retry-waits spent?`, `End the turn: waiting to retry`). The budget key `watch-ci:retry-waits:<sha12>` takes `stage`.

- [ ] **Step 1:** Mirror Task 3, Steps 1 to 3, on the stage (spec section 2).
  - Also drop `draft_forge_host`'s "anything else" edge to `run_field_set_ci_green`.
  - Drop edges into `run_field_set_ci_red` from the deleted gates.
  - Leave `scripts/ci-triage.sh` and `tests/` untouched.
- [ ] **Step 2:** Append the stage's allowlist pairs.
- [ ] **Step 3: Verify.** As Task 3, Step 5, on the stage paths. Also run `sh plugins/mattstack/attachments/pipeline/stage-watch-ci/tests/test-ci-triage.sh`: it passes as it did before the change.
- [ ] **Step 4:** Read the compiled `<scratch>/pack/attachments/stage-watch-ci/` in full.
- [ ] **Step 5: Commit:** `stage-watch-ci: one tool path for GitLab and GitHub`.

### Task 5: Board doctor runs on GitHub (entry, rebase, watch)

**Files:**
- Modify: `apps/board/skills-src/doctor/entry.md`, `apps/board/skills-src/doctor/SKILL.md` (the GitHub entry edge and prose only), `apps/board/skills-src/doctor/diagnose.md` (the rebase region from the status write down, and "The rebase poll" bullet), `apps/board/skills-src/doctor/watch.md`
- Regenerate: `apps/board/skills/doctor/` (expand)

**Interfaces:**
- Produces:
  - Node names `"Forge (before the rebase)?"` (edges `GitLab` and `GitHub`), `"mr_rebase {mrUrl, wait: true} (GitHub)"` and `"mr_rebase result (GitHub)?"`.
  - The `mr_rebase result (GitHub)?` edges, each label starting `GitHub:` except the STOP edge:
    - rebased, to `Rebased or running: continue at Watch the pipeline`;
    - pending, to `Diagnosis ends the run: continue at the map's exit`;
    - will not rebase, to the same exit;
    - any other tool error, to `Fixed the mr_rebase call once already?`;
    - `tempted to rebase the GitHub PR with the forge CLI or a checkout`, to `STOP: rebases go through mr_rebase` (check-dot requires every edge into a guard STOP to start "tempted").
  - Only the region's entry edge (`Forge (before the rebase)?` to the GitHub call, label `GitHub`) must name GitHub for the projection; the rest is unreachable once it drops. Every label above still names GitHub.

- [ ] **Step 1: Entry (spec section 3, Entry).** Remove the `mrUrl on github.com (doctor)?` diamond, its status write, print box, exit, edges and sections; the trigger goes to `--resumed-gate given (doctor)?`. Remove `SKILL.md`'s `doctor can't run on GitHub` edge and any prose naming that outcome. In `entry.md`'s `ci_lease_read` fix text, add the `/pull/<number>` URL shape beside `/-/merge_requests/<iid>`.
- [ ] **Step 2: Rebase (spec section 3, Rebase).**
  - Insert `Forge (before the rebase)?` between the `rebasing` status write and `mr_rebase {mrUrl}`. Its `GitLab` edge goes to `mr_rebase {mrUrl}`; its `GitHub` edge goes to the GitHub call and its result diamond, with the edges in Interfaces.
  - Add one GitHub sentence to "The rebase poll". Rename the diamond label `conflicts GitLab cannot rebase: error, needs a checkout` to `conflicts the forge cannot rebase: error, needs a checkout`, and the same words in the "rebase poll" prose bullet. In `Fix what the mr_view error names`, "GitLab's own refusal" becomes "the forge's own refusal".
  - Add the GitHub refusal rule to `Fix what the mr_rebase error names`: by meaning, anchored on `PullRequest::RebaseConflictError`.
  - Leave the stack-parent nodes and bullet from PR #1113 exactly as they are, if present.
- [ ] **Step 3: Watch (spec section 3, Watch).**
  - The `Waiting results in a row = 2` exit label and its status text become `no pipeline seen for the sha after two watches`.
  - `Fix what the ci_watch error names` names `priorPipelineId` as GitLab's `N` only.
  - The watched-sha bullet gains "or, on GitHub, the `sha` `mr_rebase` returned".
- [ ] **Step 4:** Append the allowlist pairs: `conflicts the forge cannot rebase` and `no pipeline seen for the sha after two watches`.
- [ ] **Step 5:** Run Expand board skills.
- [ ] **Step 6: Verify.**
  - Run `sh .superpowers/verify.sh`: board check `current`, doctor certify `no FAIL`.
  - Run `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py apps/board/skills/doctor/*.md`: no warning.
  - Run `bun .superpowers/gitlab-walk.ts`: unchanged.
  - Run `grep -n -i "github" apps/board/skills-src/doctor/entry.md`: no "can't run on GitHub".
- [ ] **Step 7: Commit** the named source files and `apps/board/skills/doctor/`: `board doctor: run on GitHub PRs, rebase with mr_rebase wait`.

### Task 6: Doctor classify on GitHub, and respond

**Files:**
- Modify: `apps/board/skills-src/doctor/classify.md`, `apps/board/skills-src/respond/post.md`, `apps/board/skills-src/respond/triage.md`, `apps/board/skills-src/respond/SKILL.md` (description length only)
- Regenerate: `apps/board/skills/doctor/`, `apps/board/skills/respond/`

**Interfaces:**
- Produces the doctor retry-wait nodes:
  - `"Retry waits = 20 (doctor)?"`
  - `"One background Bash task: sleep 60 (retry wait)"`
  - `"End the turn: waiting to retry"`
  - `"Trigger: the retry wait's sleep finished"`
- Produces the entry edges:
  - `"mr_retry result?" -> "Retry waits = 20 (doctor)?" [label="GitHub: tool error, the job's run is still in progress"]`
  - `"mr_job_trace result (doctor)?" -> "Classify each failed job (doctor)" [label="GitHub: no Actions log for the check"]`
  - `"Failed jobs listed in pipeline.jobs (doctor)?" -> "Classify each failed job (doctor)" [label="GitHub: every failed row has no Actions log"]`
  - `"Trace tails enough to classify (doctor)?" -> "Classify each failed job (doctor)" [label="GitHub: every row without a tail has no Actions log"]`

- [ ] **Step 1: No-log rows (spec section 3, Classify).**
  - Name both jobId forms in the three Fix sections.
  - Add the three no-log edges.
  - In prose, add the signals:
    - `github:status:` id, or a `github:check:` row with `runId` null, in `mr_pipeline`;
    - `jobId` null in `failedJobs`.
  - Such rows skip the trace read and classify as `real, or no licensed fix`, naming the check and that it has no Actions log. The rule lives in the `Classify each failed job (doctor)` section; the `mr_job_trace` node reads "per failed job" with a sentence there that a no-log row gets no trace call (a mixed red traces only the rows with a log).
- [ ] **Step 2: Retry wait (spec section 3, Retry wait).**
  - Add the nodes and edges:
    - `Retry waits = 20 (doctor)?` "no" goes to the sleep;
    - the sleep goes to the end-turn node;
    - a dashed edge from the end-turn node to the trigger;
    - the trigger goes to `Lease mode (before the retry)?`;
    - "yes: GitHub retry waits spent" goes to `Fixed the mr_retry call once already?`.
  - The end-turn node gets a section carrying the one-line turn-end message and the one-sleep-at-a-time rule, as the existing rebase-poll end-turn section does. The verb and stage end-turn nodes in Tasks 3 and 4 get the same in their block prose.
  - In prose, the count resets with a new watched sha, and only an error that plainly says the run is still in progress takes the edge.
- [ ] **Step 3: Respond (spec section 4).**
  - In both "Check the MR for the reply" sections of `post.md`, replace "made in this pass" with "created after the `answeredAt` in `--report`'s `gate-2-answer` line".
  - Replace `triage.md`'s marker-read sentence ending "nothing is adjudicated until both reads succeed" with "...until both reads succeed or that gate's take supplies the threads".
  - Trim `SKILL.md`'s description to 500 characters or fewer, keeping the invocation string and every flag.
- [ ] **Step 4:** Run Expand board skills.
- [ ] **Step 5: Verify.**
  - Run `sh .superpowers/verify.sh`: board check `current`; doctor and respond certify `no FAIL`. The respond `fm-description` FAIL is gone.
  - Run check-dot on `apps/board/skills/{doctor,respond}/*.md`.
  - Run the projection: unchanged.
- [ ] **Step 6: Commit:** `board doctor and respond: GitHub classify, retry wait, reply check by answeredAt`.

### Task 7: README and schema

**Files:**
- Modify: `plugins/mattstack/README.md` (the Forge cluster intro and the `mattstack:ci-forge-gitlab` entry, near line 228), `plugins/mattstack/plugin/schemas/skills-manifest.md` (the example `bindings` block, near line 27)

- [ ] **Step 1:** Rewrite the README entry and intro as spec section 5 says; the tests-path example stays. Drop the `mattstack:stage-watch-ci/forge` line from the schema example, keeping the JSON valid (no trailing comma).
- [ ] **Step 2: Verify.** Run `grep -n "ci-forge" plugins/mattstack/README.md plugins/mattstack/plugin/schemas/skills-manifest.md`: only the legacy entry and the tests path remain. Run `sh .superpowers/verify.sh`: strict check clean.
- [ ] **Step 3: Commit:** `plugin README and manifest schema: CI goes through ci_watch and ci_triage`.

### Task 8: GREEN walks and revision (controller)

- [ ] **Step 1:** Run `sh .superpowers/verify.sh`, then dispatch the ten walkers again on the edited compiled skills, as in Task 2. Save `green-<id>.md`.
- [ ] **Step 2:** Each scenario must match "GREEN expects", with no CLI forge command and no shell call a tool covers. On a miss:
  - revise the source;
  - repeat the owning task's verify and projection steps;
  - commit `<area>: <fix>`;
  - re-walk that scenario.
  
  At most 3 craft rounds per scenario. Past that, `herd_ask` quoting the deviation.
- [ ] **Step 3:** Write `.superpowers/redgreen/results.md`: one line per scenario with RED miss, GREEN result and rounds.

### Task 9: Land the branch (controller)

- [ ] **Step 1:** `git fetch origin main`. If PR #1113 or anything else touching these files merged, rebase onto `origin/main`.
  - Resolve `diagnose.md` by keeping both lanes' hunks.
  - Re-run Expand board skills and commit the regenerated `apps/board/skills/doctor/` if it changed.
- [ ] **Step 2:** Set `plugins/mattstack/.claude-plugin/plugin.json` `version` one patch past `origin/main`'s.
  - Leave `pack/requires.json` alone. The minEngine of 0.32.58 already covers `ci_watch`, `ci_triage` and `mr_retry` on GitHub (0.32.57); the board ships its doctor with the app.
  - Run `sh .superpowers/verify.sh` again, since the compile stamps carry the version. Commit: `mattstack: bump to <version>`.
- [ ] **Step 3: Final checks.** Record each result for the report:
  - `sh .superpowers/verify.sh`: clean;
  - `bun run purity`: passes;
  - `bun .superpowers/gitlab-walk.ts`: unchanged; quote its output and the allowlist;
  - `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh`: passes.
- [ ] **Step 4:** Final whole-branch review (subagent-driven-development's final reviewer, model `opus`, effort `xhigh`). Fix its findings, then re-run Step 3.
- [ ] **Step 5:** Right before pushing, `git fetch origin main` and re-check that the version is one past main. Then `git_push {tree: <root>, setUpstream: true}`.
- [ ] **Step 6:** `gh pr create` against `main`. The PR body carries:
  - the change summary;
  - the projection output and allowlist;
  - the RED/GREEN results table;
  - `engine-floor: unchanged, minEngine 0.32.58 already covers ci_watch, ci_triage and mr_retry on GitHub (0.32.57)`;
  - that the retry-wait refusal is matched by meaning, since its text is not yet seen live;
  - the spec's follow-ups.
- [ ] **Step 7:** Wait for CodeRabbit and CI, and address actionable findings. Never merge.
- [ ] **Step 8:** Write `.superpowers/report-draft.md` in the brief's format, then `herd_report` with its full contents. If `herd_report` refuses, `chat_dm` it to `justin.xjdp`.
