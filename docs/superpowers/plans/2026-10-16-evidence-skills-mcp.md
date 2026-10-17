# Evidence skills on the evidence tools: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw `evidence-record` as three callable boxes on `evidence_record` and `evidence_attach`, and redraw `stage-evidence` on those boxes plus `dev_endpoints`, `run_budget` and `run_hold`.

**Architecture:** Skill text only. The include (`attachments/evidence-record/SKILL.md`) owns the record write, the annotate-or-waive loop and the attach with its upload off-script gate; stage-evidence draws them as boxes and keeps its own capture loop and gates. Proof is describe-only RED/GREEN reps on the compiled stage-evidence verb.

**Tech Stack:** Markdown SKILL.md files with graphviz digraphs; `bun cli.ts skills compile`; the `claude -p` describe-only recipe.

**Spec:** `docs/superpowers/specs/2026-10-16-evidence-skills-mcp-design.md`

## Global Constraints

- Every skill edit goes through superpowers:writing-skills (RED before GREEN), mattstack:process-digraphs and mattstack:editing-skills. Load all three before editing.
- Write only under `plugins/mattstack/attachments/evidence-record/**`, `plugins/mattstack/attachments/pipeline/stage-evidence/**`, `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/pack/requires.json`, `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/**`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.superpowers/`.
- Never compile, sync or edit anything under `~/.mattstack/orgs/`. Never edit ship, stage-ship or gate-protocol.
- Dot fences start at column 1. One exact call per `plaintext` node. STOP text never quotes a shell form. Every judgment `box` has a `### <exact node text>` section.
- Counters: `run_budget {key: evidence:<slug>, limit: N, stage}` each time the counted event happens, then a diamond `<slug> past its limit?` (true when `spent > limit`). Holds: `run_hold {runDb, stage, reason, decidedBy}`.
- Fixtures use `acme`, `queue`, `web`, `api`; no employer names, team slugs or ticket ids anywhere. `bun run purity` before every push.
- `rt` from source runs only under an isolated HOME: `env HOME=$SCRATCH/home bun cli.ts ... --mattstack-dir $SCRATCH/mattstack`, where `$SCRATCH` is a fresh folder under the session scratchpad.
- Test reps are describe-only: the recipe below, from an empty scratch dir, never with tools, MCP, hooks or plugins.
- Word targets: `evidence-record` under 1,100; `stage-evidence` under 2,400 (today 1,762 and 3,074).

The rep recipe (herd room #m-6019):

```
claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
  --settings '{"disableAllHooks":true}' --disable-slash-commands \
  --no-session-persistence -p "<scenario>\n\n---\n\n<compiled stage-evidence>"
```

## Review Focus

- A verb that inlines the include but never had an MR lookup (a bare re-entry with no `mr`): box 3 must still require an explicit `mrUrl` and never guess one. Pinned in E1/E4 pass items (the `mrUrl` passed is the one the lookup returned).
- The second `evidence_record` call naming the source paths again instead of the returned `value` paths would copy a second time into a content folder: E1 and E2 pass items require the `value` paths.
- A `Taken` outcome at stage-evidence must not be read as a failure: E3 requires the stage to end done, not `run_stage fail`.
- A domain heading absent from the description: box 3 inserts above `before` or appends; the skill must not tell the agent to add the heading by hand first. E1's scenario description has no evidence heading.
- Holds reached from inside a box route to the verb's single `run_hold` node, never to a second hold path: checked by `check-dot.py` reachability and by reading the graph in Task 3 Step 4.

---

### Task 1: RED harness and baseline

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/build-system-file.sh`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/run-reps.sh`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/scenarios/{common,E1-happy-gitlab,E2-recapture,E3-refused-upload,E4-github-pr,E5-dev-servers}.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/red-green.md`

**Interfaces:**
- Produces: `build-system-file.sh <git-ref-or-tree-path> <out-dir>` writes `<out-dir>/stage-evidence.md`; `run-reps.sh <system-file> <scenario-file> <out-dir> <n>` writes `<out-dir>/rep-<i>.txt` for i in 1..n, each from its own fresh empty `mktemp -d` dir, run in parallel, prompt = `common.md` + the scenario + `\n\n---\n\n` + the system file.

- [ ] **Step 1: Write `build-system-file.sh`.** Model it on `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/rosie/plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/build-system-files.sh` (read it): refuse an out-dir inside the repo; export `plugins/mattstack` with `git archive <ref>` or copy it from a tree path; add `stage-evidence` (`{engine: "stage-evidence", description: "Test roster entry for stage-evidence"}`) to the copy's `pack/stubs.jsonc`; compile `--verb stage-evidence --preview` with `env HOME=<out>/.build/home` and `--mattstack-dir <out>/.build/mattstack`; fail on an empty output.
- [ ] **Step 2: Write `run-reps.sh`** to the interface above, using the recipe exactly.
- [ ] **Step 3: Write `scenarios/common.md`.** One invented run: project `gitlab.example.com/acme/queue`, run id `r-20261016-abc`, runDb `/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db`, worktree `/home/dev/.mattstack/rt/worktrees/queue/fix-retry`, branch `fix-retry`, stage `evidence`, no domain fill, `evidence-plan` = `screenshots: the retry badge and the dead-letter list, before`. The tools available, one line each with their key inputs (copy the inputs from `plugins/mattstack/attachments/mcp-tools/reference.md`): `run_field_get`, `run_field_set`, `run_stage`, `run_decision`, `run_hold`, `run_budget`, `gate_ask`, `mr_for_branch`, `mr_view`, `mr_update`, `mr_upload`, `evidence_record`, `evidence_attach`, `dev_endpoints`, `rt_verb`, `gitlab_get`, Fast Browser capture (`browser_take_screenshot`, saving under `/home/dev/.fast-browser/screenshots/`), an image drawing step, and Bash (`git`, `gh`). Close with: "Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), until the stage ends. Where the scenario gives a result or a gate answer, use it; otherwise state the result you assume."
- [ ] **Step 4: Write the five scenarios** with these facts and given results:
  - **E1 happy GitLab:** source local, no intake; two Fast Browser captures `/home/dev/.fast-browser/screenshots/retry-badge-before.png` and `.../dlq-list-before.png`; `git remote get-url origin` = `git@gitlab.example.com:acme/queue.git`; `mr_for_branch` returns `https://gitlab.example.com/acme/queue/-/merge_requests/12`; the `evidence-attach` gate's answer `{"annotations":["all proposed"],"attach":"now","next":"proceed"}`; `evidence_record`'s first result `{written:false, uncovered:[both before images, why "no-cover"], value: <paths under /home/dev/.mattstack/work/r-20261016-abc/evidence/<case>/>}`; draws succeed; the second result `{written:true}`; `evidence_attach` returns `{forge:"gitlab", descriptionWritten:true}`; the MR description has no evidence heading.
  - **E2 recapture:** attempt 2 of the stage; `evidence` holds a v2 record with case `retry-badge` (before annotated, captioned, under the run folder); the evidence gate's note: "recapture the retry-badge before: it showed the wrong record"; new capture at `/home/dev/.fast-browser/screenshots/retry-badge-before.png` (new bytes, same name); `evidence_record` returns uncovered with value path `/home/dev/.mattstack/work/r-20261016-abc/evidence/retry-badge/3f2a9c1b7d04/retry-badge-before.png`; no open MR (ship attaches).
  - **E3 refused upload:** as E1, plus a waived `/home/dev/.fast-browser/screenshots/dlq-replay.mp4`; `evidence_attach` returns `refused.size: [{path: <the run-folder mp4>, error: "file is 81 MB; the upload cap is 50 MB"}]`, `descriptionWritten:false, notWritten:"refused"`; the off-script gate's answer `{"next":"proceed","action":"take"}`.
  - **E4 GitHub PR:** as E1 but origin `git@github.com:acme/queue.git`; `gh pr view fix-retry --json number,url` returns `{"number":7,"url":"https://github.com/acme/queue/pull/7"}`; `gh pr view 7 --json body` returns a body with a `## Evidence` heading; `evidence_attach` returns `{forge:"github", description:"<spliced>", notWritten:"github", next:"gh pr view 7 --json body, then gh pr edit 7 --body-file"}`.
  - **E5 dev servers:** as E1 up to capture, plus a domain line inlined as a fill would: "Before capture, the web and api dev servers of this worktree must answer"; `dev_endpoints` returns both roles answered, ports 5173 and 8080.
- [ ] **Step 5: Run RED.** `build-system-file.sh main <scratch>/red`, then `run-reps.sh <scratch>/red/stage-evidence.md scenarios/<E> <scratch>/red/<E> 5` for each scenario.
- [ ] **Step 6: Score into `red-green.md`** per scenario and rep against the spec's Test plan pass items. Add an anti-goal column (a `run_field_set` evidence write, an evidence `mr_upload`, an `mr_update` of the section, a copy of a refused file, `rt` or `curl` on Bash for ports). Record the method, the RED column and one line per failure class.
- [ ] **Step 7: Commit** `evidence skills: RED baseline on the evidence tools`.

### Task 2: evidence-record on the tools

**Files:**
- Modify: `plugins/mattstack/attachments/evidence-record/SKILL.md` (whole page)

**Interfaces:**
- Produces, exact node texts other verbs draw:
  - `Record the evidence (evidence-record)`; outcomes Recorded / Held at evidence-waiver / failed
  - `Annotate or waive each image the record does not yet cover (evidence-record)` (unchanged)
  - `Attach the evidence (evidence-record)`; outcomes Attached / Taken / Held / failed
- Produces, terminals inside the include: `Recorded`, `Record held at evidence-waiver: the verb's hold path`, `Record failed: the verb fails, naming the images or quoting the error`, `Attached`, `Taken: nothing written, a later attach sends the refused files`, `Attach held: the verb's hold path`, `Attach failed: the verb fails, the reason quoted`.

- [ ] **Step 1: Rewrite the page** to the spec's "evidence-record, after": the opening, "The record" bullets, three `##` sections each holding one digraph (`record_evidence`, `annotate_or_waive`, `attach_evidence`), the `evidence-waiver` gate (table and selection unchanged), the bridge sections, and "Domain precedence". Node texts in `record_evidence` and `attach_evidence` are the spec's boxes, verbatim, with these exact calls:
  - `evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}`
  - `evidence_record {runDb, stage, tree: <worktree>, images: <the same images by their value paths, with covers>}`
  - `evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}`
  - `evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}`
  - `gh pr view <n> --json body`
  - `evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}`
  - `gh pr edit <n> --body-file <a file holding the returned description>`
  - the `run_budget` keys and limits the spec names (`cover-rounds` 3, `record-retries` 1, `draw-failures:<image>` 1, `waiver-openings:<image>` 2, `record-recalls` 1, `upload-off-script` 1)
  - the gate box `Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)` and the STOP `STOP: a refused file moves only by the human's hand`
  - the diamond `Does this verb attach again later?` on Take.
- [ ] **Step 2: Write the sections:** where box 3 gets `heading`, `before` and `appendix` (the domain, else the MR template's evidence heading, else `## Evidence`); the upload off-script gate (scope, `context` quoting each refusal and path, Take/Iterate/Hold/Hand back meanings, "copying a file under an allowed root is only ever the human's move"); `Does this verb attach again later?` (stage-evidence: yes; ship: no); the re-record after a `record`/`raw-capture` refusal (the last recorded images, by `value` path, with covers); draws go beside the run-folder copy.
- [ ] **Step 3: Verify.** `bash plugins/mattstack/plugin/skills/process-digraphs/render.sh plugins/mattstack/attachments/evidence-record/SKILL.md` and `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/attachments/evidence-record/SKILL.md` exit 0; `(cd plugins/mattstack && sh tests/certify.sh attachments/evidence-record/)` exits 0; `rg -n 'run_field_set \{key: evidence|mr_upload \{|mr_update \{|"v": 2' plugins/mattstack/attachments/evidence-record/SKILL.md` prints nothing; `wc -w` under 1,100.
- [ ] **Step 4: Commit** `evidence-record: record, cover and attach through the evidence tools`.

### Task 3: stage-evidence on the boxes

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md`

**Interfaces:**
- Consumes: Task 2's three box texts and their outcomes.

- [ ] **Step 1: Redraw the graph** per the spec's "stage-evidence, after" table. Keep verbatim: `Run the domain steps before the gate (none when unbound)`, `Gate evidence (table below)`, `Record the ticket's location as the BEFORE`, `Capture the BEFORE for the next case`, `Pick the next source or view`, `Gate evidence-attach (table below)`, the data-source STOP and off-script gate, `Domain attaches evidence to an MR here?`, `run_field_get {key: branch}`, `mr_for_branch {repoName: <worktree>, branches: [<branch>]}`, `Attach now answered?`, `run_stage {action: fail, stage: evidence, reason, detailPath}`. New nodes, exact: `evidence_record {runDb, stage: evidence, plan: "none"}`; `Domain needs dev servers or another rt read?`; `dev_endpoints {tree: <worktree>, roles: <the domain's roles>}`; `git -C <worktree> remote get-url origin`; `Forge host?`; `gh pr view <branch> --json number,url`; `Open PR on the branch?`; `Record the evidence (evidence-record)` with `Record outcome?`; `Attach the evidence (evidence-record)` with `Attach outcome?` (Attached and Taken both to done); `run_hold {runDb, stage: evidence, reason, decidedBy}`; `run_budget {key: evidence:capture-attempts:<case>, limit: 2, stage: evidence}` with `capture-attempts past its limit?` (replaces `Attempts for this case = 3?`); `run_budget {key: evidence:source-off-script, limit: 1, stage: evidence}` with `source-off-script past its limit?` (replaces `Off-script rounds = 2?`). Delete every upload, `mr_view`, `mr_update`, validator and encoding node, and the `run_decision` + `run_field_set hold` pair.
- [ ] **Step 2: Rewrite the sections:** delete "Off-script gate: mr_upload refused"; trim "What the graph cannot show" to the data-source gate; Capture section per the spec (captures stay where written; a text capture goes to a file in the session temp root and is the `transcript`); the domain-steps section names `dev_endpoints` for ports and puts a `waiting` or unclaimed role in the evidence gate's sentence; the domain-rules tail is one line ("Finish through Record the evidence; ship adds the AFTERs to the same record."); the attach gate's **Hand back the markdown** keeps its label and means record only.
- [ ] **Step 3: Verify** as Task 2 Step 3 for this file, plus `rg -n 'mr_upload|mr_view|mr_update|run_field_set \{key: evidence|run_decision' plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md` prints nothing; `wc -w` under 2,400.
- [ ] **Step 4: Read the graph's every hold and fail edge** and confirm each lands on the one `run_hold` or `run_stage fail` node.
- [ ] **Step 5: Commit** `stage-evidence: draw the evidence boxes, dev_endpoints, run_budget, run_hold`.

### Task 4: version and whole-plugin gates

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`version`), `plugins/mattstack/pack/requires.json` (`minEngine`)

- [ ] **Step 1:** `git fetch origin main` and read main's `plugin.json` version; set both files to the next patch above it (0.31.16 while main is 0.31.15).
- [ ] **Step 2:** Under an isolated HOME: `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$SCRATCH/mattstack" --strict` and `bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$SCRATCH/mattstack"` exit 0; `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh` exits 0; `bun run purity` exits 0.
- [ ] **Step 3: Commit** `mattstack 0.31.16: evidence skills on the evidence tools`.

### Task 5: GREEN and the deviation table

**Files:**
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-16-evidence-skills-mcp/red-green.md`, the spec (deviation table)

- [ ] **Step 1:** `build-system-file.sh <worktree root> <scratch>/green`, then 5 reps per scenario, as Task 1 Step 5.
- [ ] **Step 2: Score** as Task 1 Step 6. Pass bar: no anti-goal call in any rep and at least 4 of 5 reps meet every pass item.
- [ ] **Step 3: On a miss,** fix the skill text, re-run Task 2 or 3's Step 3 checks for that file, commit `<skill>: close GREEN gap: <what>`, and rerun that scenario's 5 reps. At most 3 rounds; then the table goes to the shepherd.
- [ ] **Step 4:** Fill the GREEN column and add the spec's deviation table (scenario, rep, deviation, RED or GREEN, fixed by). Commit `evidence skills: GREEN results and deviation table`.
- [ ] **Step 5:** `chat_dm` ship-ci-skills (`ship-ci-skills.8z8h`) the three box texts, their outcomes, and the `Does this verb attach again later?` rule (ship answers no).
