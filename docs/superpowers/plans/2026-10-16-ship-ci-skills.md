# Ship and CI skills on the merged tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw `ship`, `stage-ship`, `watch-ci` and `stage-watch-ci` on `ci_watch {attend}`, `ci_triage`, the `leaseMrUrl` guards, `git_push`'s returns, `mr_create {ifExists}`, `run_enter`/`run_close`/`run_hold` and `run_budget`; then (phase 2) move ship's evidence upload onto `evidence_attach`.

**Architecture:** Markdown skill edits only. Each SKILL.md is a `dot` digraph (the map) plus one `### <node text>` section per judgment box. The spec's per-skill Design section is the source of every node change; each task applies it to one skill, keeps every node text not listed for change, and passes the digraph checkers.

**Tech Stack:** Markdown, Graphviz `dot`, `check-dot.py`, `render.sh`, `certify.sh`, `rt skills check/compile` from source (`bun cli.ts`).

**Spec:** `docs/superpowers/specs/2026-10-16-ship-ci-skills-design.md` (approved, gate 60aef67c). Read it in full before any task: Decisions 1-15 and the Behavior changes table are binding.

## Global Constraints

- Write only under: `plugins/mattstack/attachments/pipeline/{ship,stage-ship,watch-ci,stage-watch-ci}/**`, `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/pack/requires.json`, `plugins/mattstack/docs/superpowers/tests/2026-10-16-ship-ci-skills/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.superpowers/`.
- Never delete `scripts/`, `tests/` or the forge slot in `watch-ci` / `stage-watch-ci`, and keep the `<scripts>` and `<forge>` path definitions in their text (spec Decision 6; `lib/skills/__tests__/compile-native.e2e.test.ts` asserts both paths in the compiled stage).
- Every skill edit loads superpowers:writing-skills and mattstack:process-digraphs first (repo rule), and mattstack:editing-skills for the check/compile commands.
- No TypeScript or tool change. Never compile, sync or edit the team packs. Never run `rt skills sync`.
- The plugin keeps its own Markdown style; never run rt's formatter on it. No em or en dashes in new prose.
- Dot fences start at column 1. STOP text never quotes a shell form. One exact call per `plaintext` node.
- Keep every node a team fill attaches to (spec "Fill anchors"); the only rename is the `mr_create` node (adds `, ifExists: return`).
- Counter convention (spec Decision 1): `run_budget {key: <key>, limit: N, stage: <stage>}` called once on entering the loop, then a diamond `<slug> past its limit (<verb>)?` reading `spent > limit`, edges `no` / `yes: <exit>`. `<stage>` is the verb's stage in an own run, `run.current_stage` in an inherited one.
- `rt` from source runs isolated: `env HOME=$SCRATCH/home bun cli.ts ... --mattstack-dir $SCRATCH/mattstack`, `$SCRATCH` = `/private/tmp/claude-501/-Users-matt--mattstack-rt-worktrees-gh-m4ttstack-mattstack-hamfast/2fc6791b-0869-4444-b534-fb92db74630b/scratchpad`.
- plugin.json and `pack/requires.json` `minEngine`: 0.31.15 is a placeholder (evidence-tools takes it); re-bump to the next patch above main on the merge-queue turn.
- Commits and PR body: no employer names, team slugs or ticket ids; `bun run purity` before every push.
- RED/GREEN reps are describe-only (shepherd's rule, recipe in Task 1 Step 2): no tools, no MCP, no hooks, no plugins, a fresh empty cwd. No rep may reach `~/.mattstack`, the daemon, GitHub or GitLab.

## Counter keys

| Skill | key (prefix `<verb>:` as shown) | limit | scope |
|---|---|---|---|
| watch-ci, stage-watch-ci | `watch-ci:ci-watch-errors:<sha12>` | 1 | stage, per commit |
| | `watch-ci:ci-watch-off-script` | 2 | stage |
| | `watch-ci:lease-rounds:<sha12>` | 2 | stage, per commit |
| | `watch-ci:infra-retries:<sha12>` | 1 | stage, per commit |
| | `watch-ci:retry-off-script` | 2 | stage |
| | `watch-ci:ci-gate-iterations` | 3 | run-wide (no `stage`) in watch-ci; stage in stage-watch-ci |
| | `watch-ci:fix-rounds` | 3 | run-wide (watch-ci only; the stage hands fixes to implement) |
| | `watch-ci:push-off-script` | 2 | stage (watch-ci only) |
| | `watch-ci:mark-ready-iterations` | 2 | stage |
| | `watch-ci:github-claim-errors` | 1 | stage |
| | `watch-ci:github-claim-off-script` | 2 | stage |
| | `watch-ci:github-polls:<sha12>` | 45 | stage, per commit |
| | `watch-ci:github-sha-waits:<sha12>` | 5 | stage, per commit |
| ship, stage-ship | `ship:ship-gate-rounds` | 2 | stage |
| | `ship:ship-gate-reopenings` | 2 | stage |
| | `ship:fix-rounds` | 3 | stage |
| | `ship:conflict-rounds` | 3 | stage |
| | `ship:forge-clarify-rounds` | 2 | stage |
| | `ship:push-off-script` | 2 | stage |
| | `ship:landing-checks` | 2 | stage (ship only) |
| | `ship:mr-create-recalls` | 1 | stage (counts re-calls after `url: null`, not the first call) |
| | `ship:after-attempts:<case id>` | 3 | stage |
| | `ship:validator-refusals` | 2 | stage |
| | `ship:record-fixes` | 1 | stage |
| | `ship:upload-path-fixes:<basename>` | 1 | stage (until phase 2) |
| | `ship:upload-timeouts:<basename>` | 1 | stage (until phase 2) |
| | `ship:upload-off-script` | 2 | stage (until phase 2) |
| | `ship:mark-ready-rounds` | 2 | stage (ship only) |

`<sha12>` is the watched sha's first 12 characters.

## Review Focus

1. A push that moved nothing (no commits listed by `git log @{upstream}..`, no force) must not hand `git_push`'s `priorPipelineId` to the watch: on a fast-forward merge train it would stall. Pinned in Task 4/5 section text and scenario S5b.
2. watch-ci inheriting ship's run must pass `stage: run.current_stage` to `run_budget` and `run_hold` (the tool refuses a stage with no row), and its per-commit counters must reset on a new pushed sha. Pinned in Task 2's section "Budgets in this verb" and scenario S6.
3. A `ci_triage` tool error must reach the failedJobs fallback classify box, never read as "no failures". Pinned by the result diamond's error edge in Tasks 2/3 and scenario T3b.
4. The stand-down (from `stood_down`, a `lease_held` refusal, or a GitHub claim refused) must never call `ci_lease_release`. Pinned by `check-dot.py` reachability plus the exit section in Tasks 2/3 and scenario T2/T5.
5. Fill text written for the script engine (`ci-triage.sh --config`, `<forge> jobs`, `ci-attendant.sh`) must redirect to `ci_triage {config}` / `pipeline_jobs` / `ci_watch`. Pinned by the Domain rules redirect paragraph in Tasks 2/3 and scenario T9.

---

### Task 1: RED baseline (controller-run, before any skill edit)

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-ship-ci-skills/scenarios.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-ship-ci-skills/red-green.md`
- Modify: `docs/superpowers/specs/2026-10-16-ship-ci-skills-design.md` (deviation table, RED column)

**Interfaces:**
- Produces: `scenarios.md` with T1-T10 and S1-S6 (spec Test plan) plus T3b (`ci_triage` returns a tool error) and S5b (nothing unpushed: `git log @{upstream}..` empty, `git_push` returns `priorPipelineId: 4410` equal to the sha's own pipeline), each as an invocation and a numbered script of every tool return and gate answer in order. Tool returns use the shapes in `plugins/mattstack/attachments/mcp-tools/reference.md`, plus `git_push`/`mr_retry` refusals as `{pushed|retried: false, refused: "lease_held", holder: {owner: "session:other", holder: "doctor"}}` (`lib/ci/lease-guard.ts`). T9 carries a synthetic domain fill (repo `acme/app`, no real names) whose triage section says to run `<scripts>/ci-triage.sh --forge <forge> --pipeline <N> --config "${CLAUDE_SKILL_DIR}/ci-config.json"` and `<forge> jobs <id> --scope failed`. Task 7 reuses the file unchanged.

- [ ] **Step 1: Write `scenarios.md`.** Group by skill: watch-ci (T1-T10, T3b, S6 as the inherited case), stage-watch-ci (T1-T3, T3b, T6, T7, T9, plus a `pushed` field read), ship (S1-S6, S5b, T10), stage-ship (S1-S5, S5b).
- [ ] **Step 2: Run 20 fresh describe-only reps** (5 per skill) with the shepherd's approved recipe (room message 6019): from a fresh empty directory `$SCRATCH/reps/<skill>-<n>/`, with the real HOME (keychain login only), run `claude --model sonnet --tools "" --strict-mcp-config --setting-sources local --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence -p "$(cat <prompt-file>)"`. `<prompt-file>` holds the skill's current SKILL.md (ship and stage-ship reps also get the current watch-ci / stage-watch-ci text for the handoff), that skill's scenarios, and: "Follow this skill exactly. For each scenario, list every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything." Probe the recipe once first (a rep that tries a tool must get none). Save each rep's output to `$SCRATCH/reps/<skill>-<n>.md`.
- [ ] **Step 3: Score into `red-green.md`.** Per scenario and run, count: shell calls a tool covers; hand-held lease calls (claim, heartbeat, release) a tool now owns; counters kept in context; re-derived values (`git rev-parse`, `mr_pipeline`, `mr_for_branch`) a result already carries; skipped steps; runaway loops; refusals that missed their off-script gate or the stand-down; a release on a stand-down. Fill the spec table's RED column with the totals per scenario.
- [ ] **Step 4: Commit** `ship-ci-skills: RED baseline for the ship and CI digraphs`.

### Task 2: watch-ci on the merged tools

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md` (whole file)

**Interfaces:**
- Consumes: the counter keys table above.
- Produces: watch-ci's handoff contract, which Task 4 relies on: an inherited watch-ci accepts from its caller `mr` (url), `sha`, and optionally `priorPipelineId` (a number), and hands back one of: verdict green, verdict red after its `ci` gate, an off-script answer, a failure, a stand-down (with `holder`), or a hold.

Apply spec "watch-ci (standalone)" exactly. Node texts to add (verbatim):

- Run graph: `run_enter {flags, skillDir, stage: watch-ci, runDb?, spawnedBy?}`, `run_enter mode (watch-ci)?`, `run_enter {flags, skillDir, stage: watch-ci, resume: <runId>}`, `run_enter {flags, skillDir, stage: watch-ci, fresh: true}`, `Second run_enter result (watch-ci)?`, outcomes kept from today where the meaning holds (`Inherited run: the stage is run.current_stage, close nothing (watch-ci)`, `Held at the watch-ci Resume offer`, `Resumed watch-ci run: re-enter at run_snapshot's decisions`, `watch-ci run not resumed: report the refusal`, `watch-ci run not started: report the error`, `rt too old: tell the user to update rt (watch-ci)`, `Own watch-ci run open: go to the flow`).
- Watch: `ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}`; off-script box `watch-ci off-script gate: ci_watch could not hold the lease`.
- Triage: `ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}`, `ci_triage result (watch-ci)?`, `UNCLEAR jobs in the report (watch-ci)?`, `mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job`, `Classify the triage report (watch-ci)`, `Classify each failure REAL or INFRA from failedJobs (watch-ci)`, `Only INFRA blocking failures, none INHERITED (watch-ci)?`.
- Repairs: `mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job`, `mr_retry result (watch-ci)?`, `watch-ci off-script gate: mr_retry refused`, `git_push {tree: <root>, leaseMrUrl: <mr>}`, `git_push {tree: <root>}` (no MR), `git_push result (watch-ci)?`.
- GitHub path: `ci_lease_claim {mrUrl: <mr>, branch} (GitHub)`, `ci_lease_claim result (GitHub)?`, `Fix what the claim error names (GitHub)`, `watch-ci off-script gate: ci_lease_claim refused (GitHub)`, `ci_lease_claim {mrUrl: <mr>, branch} (before the GitHub retry)`, `Re-claim result (before the GitHub retry)?`; the existing `gh pr checks` poll nodes stay.
- Exits: `MR known (watch-ci exit)?`, `ci_lease_release {mrUrl: <mr>}`, `run_close {workType: watch-ci, stage: watch-ci, outcome: done}`, `run_close {workType: watch-ci, stage: watch-ci, outcome: abandoned}`, `run_close {workType: watch-ci, stage: watch-ci, outcome: failed, reason}`, `run_hold {stage, reason, decidedBy}`.
- Every counter as a pair per the convention, keys from the table.

Delete: the run graph's `run_snapshot`/`run_list`/`Build runDb`/runs-root/`hold` clear nodes; `ci_lease_claim {mrUrl, branch}` and its result, fix and off-script nodes on GitLab; the three re-claim blocks; `Fix committed (watch-ci)?`, `Fix heartbeats = 12 (watch-ci)?`, `ci_lease_heartbeat {mrUrl} (during the fix)`, `Heartbeat result (during the fix)?`; `Which forge watches (watch-ci)?`, `budget.spent (watch-ci)?`, `Waiting results in a row = 2 (watch-ci)?`, `Re-claims after a lost lease = 2 (watch-ci)?`, `Verify the branch was pushed`, `Triage with what (watch-ci)?`, `Triage with the domain's rules`, `<scripts>/ci-triage.sh ...`, `Read the triage report`, `Trace tails enough to classify (GitLab)?`, `Which MR (before git_push)?`, `mr_pipeline ... (the prior pipeline id)`, `git rev-parse HEAD (the pushed sha, watch-ci)`, `Was a lease claimed (watch-ci exit)?`, the `run_stage`/`run_status` exit pairs; `allowed-tools` from the frontmatter.

Sections: rewrite "What the graph cannot show" to the watched sha, the prior id (from the caller or `git_push`'s result), and "the tool owns the watch budget"; rewrite "The attendant lease" (one attendant; `attend` claims and keeps it; the guards; the keepalive's 60-minute idle stop; release on exits, never on a stand-down; Decision 14); add "Budgets in this verb" (the keys, their scopes, `stage: run.current_stage` when inherited); "Classify the triage report (watch-ci)" carries today's REAL/INFRA/log-reading rules, the domain's judgment, and "never INFRA without a log read". Domain rules: keep the "graph wins" line and `{{slot:domain}}`; replace the compatibility paragraph with the redirect (a rule running `<scripts>/ci-triage.sh` goes to `ci_triage`, passing its `--config` file's keys as `config`; `<forge> jobs` goes to `pipeline_jobs`; `ci-attendant.sh`/`ci-watch.sh` go to `ci_watch`). Keep the `## Forge` section with its "graph wins" line and `{{slot:forge}}`, and a one-line definition of `<scripts>` and `<forge>` as vendored for fills, uncalled by this skill.

- [ ] **Step 1:** Load superpowers:writing-skills, mattstack:process-digraphs and mattstack:editing-skills.
- [ ] **Step 1b: Preservation inventory.** Before editing, write `.superpowers/sdd/inventory-watch-ci.md`: one row per current node and per `###` section, with where it lands (kept as is / new node text / the tool that now does it / deleted, citing the spec line). A row with no landing place is a gap: stop and report it.
- [ ] **Step 2:** Edit the file as above.
- [ ] **Step 3: Verify.** `bash plugins/mattstack/plugin/skills/process-digraphs/render.sh plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md` and `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md` exit 0; `(cd plugins/mattstack && sh tests/certify.sh attachments/pipeline/watch-ci/)` exits 0; `rg -n "ci_lease_heartbeat \{mrUrl\} \(during|Waiting results in a row|budget.spent|freshWindow|Triage with what" plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md` prints nothing; `wc -w` is reported (today 7,726).
- [ ] **Step 4: Commit** `watch-ci: watch with ci_watch attend, triage with ci_triage, guard repairs with leaseMrUrl`.

### Task 3: stage-watch-ci on the merged tools

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-watch-ci/SKILL.md` (whole file)

**Interfaces:**
- Consumes: Task 2's node texts minus the `(watch-ci)` suffixes (stage nodes keep today's unsuffixed style, e.g. `ci_watch state?`); the `pushed` field written by Task 5: `{"sha": "<40 hex>", "priorPipelineId": <number or null>}`.

Apply spec "stage-watch-ci". Add `run_field_get {key: pushed}`, `pushed set, and its sha is HEAD?`, keep `git rev-parse HEAD (the pushed sha)`. Hold path: `run_hold {stage: watch-ci, reason, decidedBy}` replaces the `run_decision` + `run_field_set hold` pair. Fix and re-push keeps its handoff outcome and keeps the lease. No `fix-rounds` or `push-off-script` keys here. Same section rewrites as Task 2, scoped to the stage (no run graph, no own-run branches).

- [ ] **Step 1:** Load the three skills as in Task 2.
- [ ] **Step 1b: Preservation inventory** as Task 2 Step 1b, into `.superpowers/sdd/inventory-stage-watch-ci.md`.
- [ ] **Step 2:** Edit the file.
- [ ] **Step 3: Verify** render.sh, check-dot.py and certify on the stage dir as in Task 2; `bash plugins/mattstack/attachments/pipeline/stage-watch-ci/tests/test-ci-triage.sh` still exits 0; `bun test lib/skills/__tests__/compile-native.e2e.test.ts` passes (run from the repo root); report `wc -w` (today 4,812).
- [ ] **Step 4: Commit** `stage-watch-ci: watch with ci_watch attend, triage with ci_triage, read the pushed field`.

### Task 4: ship on the merged tools

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/ship/SKILL.md` (whole file)

**Interfaces:**
- Consumes: Task 2's handoff contract.

Apply spec "ship (standalone)". Run graph as Task 2's with `stage: ship` and `(ship)` suffixes; keep "Resumed ship run: re-enter at run_snapshot's decisions" and its `shipTarget` re-check section. Push block: `git_push {tree: <root>, setUpstream: true}` and `git_push {tree: <root>, forceWithLease: true}` stay, now reached straight from `Push needs force-with-lease (ship)?`; `git_push result (ship)?` ok edge keeps `sha`, `mr`, `priorPipelineId`. Move `git remote get-url origin (ship)`, the forge clarify trio and its counter after the push, feeding `Forge host (ship, open the MR)?` (Decision 10). MR node (renamed, Decision 12): `mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}`; result edges: `created` / `existing: keep its url, write nothing to it` / `squashApplied: false` / `url null` (through `ship:mr-create-recalls`) / error; the GitLab-CLI guard STOP redirects to the `mr_create` node. "Domain owns the title or description (ship)?" gets the edge label `no, or an existing MR the domain leaves alone: nothing to write` (Decision 15). "Run watch-ci inheriting this run" section hands `mr`, `sha`, and `priorPipelineId` only when the push moved the branch (Decision 9). Exits: `run_close {workType: ship, stage: ship, outcome: done|abandoned|failed, reason}` (one node per outcome, as in Task 2), `run_hold {stage, reason, decidedBy}`, inherited hand-back; the final report names an existing MR's target when it differs (Decision 11). Every counter per the table. Delete the before/after-push `mr_for_branch` nodes and their diamonds, `Push moves the MR's head (ship)?`, `mr_pipeline ... (ship)`, `Created once already (ship)?`, the `run_stage`/`run_status` exit pairs.

- [ ] **Step 1:** Load the three skills.
- [ ] **Step 1b: Preservation inventory** as Task 2 Step 1b, into `.superpowers/sdd/inventory-ship.md`.
- [ ] **Step 2:** Edit the file.
- [ ] **Step 3: Verify** render.sh, check-dot.py and certify on `attachments/pipeline/ship/`; `rg -n "mr_for_branch|mr_pipeline|Created once already|Push moves the MR" plugins/mattstack/attachments/pipeline/ship/SKILL.md` prints nothing; report `wc -w` (today 7,466).
- [ ] **Step 4: Commit** `ship: run_enter/run_close, git_push returns, mr_create ifExists, run_budget counters`.

### Task 5: stage-ship on the merged tools, with the drift fixed

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md` (whole file)

**Interfaces:**
- Produces: the `pushed` field Task 3 reads, written as `run_field_set {key: pushed, value: <{"sha", "priorPipelineId"} JSON>, stage: ship}` right after `git_push result?` ok, and (human push that landed) `run_field_set {key: pushed, value: <{"sha": HEAD, "priorPipelineId": null} JSON>, stage: ship} (after the human's push)` after "Make the recorded move once" confirms it landed. `priorPipelineId` is null unless the push moved the branch (Decision 9).

Apply spec "stage-ship": add `Push needs force-with-lease?` and `git_push {tree: <root>, forceWithLease: true}` (drift fix; the force rule moves from "What the graph cannot show" into that diamond's section); the `mr_create` rename and result edges as in Task 4; delete `mr_for_branch {repoName: <root>, branches: [<branch>]}`, `Open MR on the branch?`, `Created once already?`; hold through `run_hold {stage: ship, reason, decidedBy}` replacing the `run_decision` + `run_field_set hold` pair; counters per the table.

- [ ] **Step 1:** Load the three skills.
- [ ] **Step 1b: Preservation inventory** as Task 2 Step 1b, into `.superpowers/sdd/inventory-stage-ship.md`.
- [ ] **Step 2:** Edit the file.
- [ ] **Step 3: Verify** render.sh, check-dot.py and certify on `attachments/pipeline/stage-ship/`; `rg -n "Push needs force-with-lease\?|key: pushed" plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md` finds both; report `wc -w` (today 4,869).
- [ ] **Step 4: Commit** `stage-ship: draw force-with-lease, record the pushed sha and prior id, mr_create ifExists`.

### Task 6: Release bump and static gates

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`"version": "0.31.15"`)
- Modify: `plugins/mattstack/pack/requires.json` (`{ "minEngine": "0.31.15" }`)

- [ ] **Step 1:** Re-read main's version (`git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`); bump to the next patch above it in both files.
- [ ] **Step 2: Run** `mkdir -p $SCRATCH/home $SCRATCH/mattstack && env HOME=$SCRATCH/home bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $SCRATCH/mattstack --strict` and `env HOME=$SCRATCH/home bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $SCRATCH/mattstack`; both exit 0, and check prints no `fieldContract` line naming `pushed`.
- [ ] **Step 3: Run** the CI loop locally: `cd plugins/mattstack && for d in attachments/pipeline/{ship,stage-ship,watch-ci,stage-watch-ci}/; do sh tests/certify.sh "$d"; done`, `bash plugin/skills/process-digraphs/test-check-dot.sh`, `bash plugin/tests/test-resolve-args.sh`; all exit 0. Then `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack` and `bun run purity` from the root exit 0.
- [ ] **Step 4: Commit** `mattstack 0.31.15: ship and CI skills on the merged tools`.

### Task 7: GREEN (controller-run)

**Files:**
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-16-ship-ci-skills/red-green.md`, the spec's deviation table; any of the four SKILL.md files for wording gaps.

- [ ] **Step 1: Run 20 fresh describe-only reps** exactly as Task 1 Step 2, with the new texts.
- [ ] **Step 2: Score** with Task 1's columns. Pass: zero shell deviations, zero hand-held lease calls on GitLab, every refusal at its own off-script gate or the stand-down, no release on a stand-down, every counter through `run_budget`, S5b hands no prior id, T3b reaches the fallback box, T9 calls `ci_triage` with `config`.
- [ ] **Step 3: On a miss,** fix the skill text (re-run Task 2-5's Step 3 checks for that file), commit `<skill>: close GREEN gap: <what>`, and run a fresh round of 5 agents for that skill. At most 3 rounds per skill; a skill still failing after round 3 goes to the shepherd with the table.
- [ ] **Step 4:** Fill the GREEN column and notes; commit `ship-ci-skills: GREEN results`.

### Task 8: Phase 2, evidence_attach (only after #851 merges)

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/ship/SKILL.md`, `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md`, `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/pack/requires.json`, the spec (a Phase 2 node list and any fill-anchor rename).

- [ ] **Step 1:** `gh pr view 851 --repo m4ttstack/mattstack --json state`. Not `MERGED`: `chat_dm` the shepherd (`shepherd.y7rs`) that everything else is done and phase 2 waits on #851, and stop until told.
- [ ] **Step 2:** Rebase onto `origin/main` (`git_rebase {tree: <root>, onto: origin/main}`), resolving conflicts in the four skills only. Read `evidence_attach` and `evidence_record` in the regenerated `reference.md` and the merged `evidence-record` include.
- [ ] **Step 3:** In both ship skills replace "Files to attach?" through the `mr_upload` retry/refusal nodes and the `ship:upload-*` counters with the attach-gate and `evidence_attach` nodes the merged include defines, keeping one off-script gate on its refusals (`refused`, `timedOutTwice`) with take = `linkRefused: true`. Keep "Write the title and description" for the parts the domain owns; list any node a fill attaches to that changed in the spec's Fill anchors table.
- [ ] **Step 4:** Add scenarios E1 (two files upload, section written) and E2 (one file refused, take links it) to `scenarios.md`; run 5 fresh describe-only reps (Task 1 Step 2's command) per ship skill on S1 and E1-E2 (old text RED, new text GREEN); fill the table.
- [ ] **Step 5:** Re-run Task 6 Steps 1-3 (bump above main again if it moved). Commit `ship, stage-ship: attach evidence with evidence_attach`.
