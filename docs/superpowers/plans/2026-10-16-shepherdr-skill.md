# shepherdr on the herd tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the shepherdr engine skill so every shell line and in-head counter the merged herd tools cover becomes a tool node, with budgets read from the daemon.

**Architecture:** One source file changes (`plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md`); its three dot graphs are replaced by the spec's appendix drafts and the prose around each is rewritten to match. The compiled copy under `plugins/mattstack/skills/shepherdr/` is regenerated, never edited. Behavior is proven with fresh-agent RED/GREEN runs dispatched by the controller.

**Tech Stack:** Markdown skills with graphviz `dot`; `render.sh` and `check-dot.py` (process-digraphs); `certify.sh`; `rt skills compile/check` via `bun cli.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-shepherdr-skill-design.md`

## Global Constraints

- Write only under `plugins/mattstack/attachments/orchestration/shepherdr/**`, `plugins/mattstack/skills/shepherdr/**` (compile output only), `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/pack/requires.json`, plugin tests and fixtures, `docs/superpowers/{specs,plans}/`, `.superpowers/`.
- Never edit, compile or sync anything under `~/.mattstack/orgs/<team org>/`.
- Never restart or touch the live rt daemon; run every `bun cli.ts` skills command under an isolated HOME (`env -i HOME=<temp> PATH="$PATH" ...`).
- `plugin.json` version `0.31.16`; `requires.json` `{ "minEngine": "0.31.16" }`.
- The engine body names no account provider, script or launcher (`cswap`, `pick-account.py`).
- No pane text read by the shepherd anywhere in the skill; `herd_diagnose` is the only pane read.
- Node `Domain provisions the tree?` keeps its exact text.
- Comments and prose follow the repo's plain-language style; no em or en dashes in new text.
- `references/job-template.md` is not edited.
- Run `bun run purity` before any push.
- Every verify step assumes `D=plugins/mattstack/plugin/skills/process-digraphs` and `F=plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md`, run from the worktree root.

## Review Focus

- A domain fill that still asks for a Bash `rt herd spawn --dir` (the team pack's delta 2): the start graph's `STOP: spawn only with herd_spawn` guard must redirect it to the tree spawn. Pinned in Task 2 Step 3 and scenario S6 (Task 6).
- A shepherd resumed in a fresh session with no memory of earlier respawns or nudges: every budget diamond must read a fetched budget. Pinned by scenarios S2 and S3.
- A lane whose worktree was disposed by its merge (no `herd_lanes` row): must reach the off-script gate, never a hand-run `gh pr view` or `mr_view`. Pinned in Task 4 Step 3 and scenario S4.
- `herd_nudge` refused because the worker already read the answer: must end the turn, not escalate. Pinned in Task 3 Step 3.
- A hidden herd (`bg:` panes): the rewritten diagnosis prose must not lose `herd_attend` as the way to put a pane in front of the user. Pinned in Task 3 Step 3.

---

### Task 1: RED baseline (controller-run)

The controller runs this task itself: it dispatches the fresh test agents, which an implementer subagent cannot do.

**Files:**
- Create: `.superpowers/sdd/shepherdr-tests/baseline-SKILL.md` (copy of the current compiled skill)
- Create: `.superpowers/sdd/shepherdr-tests/scenarios/S1.md` … `S6.md`
- Create: `.superpowers/sdd/shepherdr-tests/red/S<n>-r<k>.md` (25+5 transcripts' call lists)
- Modify: `docs/superpowers/specs/2026-10-16-shepherdr-skill-design.md` (append `## Test results`)

**Interfaces:**
- Produces: the six scenario files (reused verbatim by Task 6) and the RED half of the deviation table.

- [ ] **Step 1:** `cp plugins/mattstack/skills/shepherdr/SKILL.md .superpowers/sdd/shepherdr-tests/baseline-SKILL.md`.
- [ ] **Step 2: Write the scenarios.** Each file holds: the situation, the scripted result of every tool the agent may call (keyed by tool name; any unscripted call returns `{"error":"not scripted"}`), and the ask: "List, in order, every tool call or shell command you make, with its input, and stop where the skill says to end the turn. Do not explain the skill." S1 to S5 are the spec's test plan rows. S6: team-pack-style domain text in the `## Domain rules` section says "spawn into the provisioned tree with `rt herd spawn --dir <path>`"; the provision result is `{tree: "acme-123-fix", path: "/x/acme-123-fix", ...}`. Scripted `herd_diagnose` results carry the spec's budget values (S2 `blockedNotices {used:3,cap:3,spent:true}`, S3 `nudges {"g1":{used:1,cap:2,spent:false}}`, S1 `respawns {used:0,cap:2,spent:false}`, `verdict: "rate-limited"`).
- [ ] **Step 3: Run RED.** Dispatch 5 fresh `general-purpose` agents per scenario (model `sonnet`, effort `medium`), each prompt = baseline skill path + the herd tool section of `plugins/mattstack/attachments/mcp-tools/reference.md` + the scenario file. Save each agent's call list to `red/S<n>-r<k>.md`.
- [ ] **Step 4: Score.** For each run count the spec's six deviation columns plus `fill obeyed over the graph` for S6. Append `## Test results` to the spec with the RED table (one row per scenario, columns = deviation counts summed over 5 runs).
- [ ] **Step 5: Commit** the spec change: `git add docs/superpowers/specs/2026-10-16-shepherdr-skill-design.md && git commit -m "spec: RED baseline for shepherdr on the herd tools"`.

### Task 2: Start graph, accounts and spawn prose

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md` (lines 59-165, 204-232, 381-397)

**Interfaces:**
- Consumes: spec Appendix A (start graph draft) and the spec's "Start graph" section.
- Produces: node texts `herd_spawn {herd, job, brief, model, effort, account?, tree: <the domain's tree>}` and `STOP: spawn only with herd_spawn`.

- [ ] **Step 1: Replace the `digraph shepherdr_start` block** with the spec's Appendix A block, byte for byte.
- [ ] **Step 2: Rewrite the prose** per the spec's "Start graph" bullets: `## Accounts` text after the slot (pass the pick as `account` on `herd_spawn` or `herd_respawn`; accounts in use are each job's `account` in `herd_status`; no Bash clause), `### Ask the strategy and model per job` (drop the Bash clause; add the respawn-inherits sentence), `**The domain-provisioned spawn.**` (no code block; tree name from `worktree_provision`'s `tree`; admission rule; refusal goes to the off-script gate), `**Spawn facts.**` linked-worktree bullet.
- [ ] **Step 3: Verify.**
  Run: `bash $D/render.sh $F && python3 $D/check-dot.py $F`
  Expected: `0 failed` and `ok, 0 warning(s)`.
  Run: `sed -n '/^## Accounts/,/^## Watch\|^## The watch loop/p' $F | grep -c -E 'rt herd spawn|--dir|--account|cswap|pick-account'`
  Expected: `0`.
  Run: `grep -c '"Domain provisions the tree?" -> "STOP: spawn only with herd_spawn" \[label="tempted to spawn from the shell"\]' $F`
  Expected: `1`.
- [ ] **Step 4: Commit:** `git commit -am "shepherdr: spawn domain trees with herd_spawn {tree}"`.

### Task 3: Watch loop

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md` (the `## The watch loop` section through `## What the watch loop cannot show`, lines 399-647 before Task 2)

**Interfaces:**
- Consumes: spec Appendix B and the spec's "How a budget is read" and "Watch loop" sections.
- Produces: the watch node texts in the spec's Renames table.

- [ ] **Step 1: Replace the `digraph shepherdr_watch` block** with the spec's Appendix B block, byte for byte.
- [ ] **Step 2: Rewrite the sections** so every box in the new graph has a `### <exact node text>` section and no section names a removed node: update `Present the open gates`, `Say which answer won, in one line`, `Fix the answers: each value verbatim`, `Pick the account per the accounts rules`, `Report the stall to the user` (now also an expired login); replace `Ask: attend or close and respawn` with `### Ask: attend or respawn`. In "What the watch loop cannot show": one `Diagnosis and nudges` bullet replaces `Blocked diagnosis`, `Typing versus keys` and `Unconsumed answers`, and it keeps that `herd_attend {job, herd}` is how a hidden (`bg:`) pane reaches the user; rewrite `The disposable reviewer`; replace `The shared respawn` and its code block with the `herd_respawn` paragraph from the spec; add the budget-reading rule from "How a budget is read" (table and freshness sentence) as a `**Budgets.**` paragraph.
- [ ] **Step 3: Verify.**
  Run: `bash $D/render.sh $F && python3 $D/check-dot.py $F` → `0 failed`, `ok, 0 warning(s)`.
  Run: `sed -n '/^## The watch loop/,/^## Lanes and wrap-up/p' $F | grep -c -E 'rt gate|rt herd spawn|pane, peek|rt pane send|--by shepherd|keeps neither'`
  Expected: `0`.
  Run: `grep -c '"Nudge delivered?" -> "End the turn until something arrives" \[label="refused: already consumed, the worker read it"\]' $F` → `1`.
  Run: `sed -n '/^## What the watch loop cannot show/,/^## Lanes and wrap-up/p' $F | grep -c 'herd_attend'` → at least `1`.
- [ ] **Step 4: Commit:** `git commit -am "shepherdr: watch loop on herd_diagnose, herd_nudge, herd_respawn and shepherd gate tools"`.

### Task 4: Lanes graph, off-script gate and rationalizations

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md` (`## Lanes and wrap-up` through the end; `### Shepherd off-script gate: ask the user`)

**Interfaces:**
- Consumes: spec Appendix C and the spec's "Lanes graph" and "Off-script gate and rationalizations" sections.

- [ ] **Step 1: Replace the `digraph shepherdr_lanes` block** with the spec's Appendix C block, byte for byte.
- [ ] **Step 2: Rewrite the prose:** `The two objective checks` and `A report is a claim, not a merge` bullets around `herd_lanes` (both forges; a lane with no row is in `skipped` and goes to the off-script gate); `### Show the status table` names `herd_lanes` for drift; the off-script gate's counter paragraph (`... spent?` reads the daemon budget fetched in this decision; `... = 2?` is a same-turn retry count); the two rationalization rows from the spec.
- [ ] **Step 3: Verify.**
  Run: `bash $D/render.sh $F && python3 $D/check-dot.py $F` → `0 failed`, `ok, 0 warning(s)`.
  Run: `grep -c -E 'gh pr view|git diff --stat|cd <an active' $F` → `0`.
  Run: `grep -c '"Merged on the repo?" -> "Shepherd off-script gate: ask the user" \[label="no row: quote the skipped reason"\]' $F` → `1`.
  Run: `grep -c 'mcp-lint: allow' $F` → only lines naming `rt herd stop --hidden` and the `/reload-plugins` self-queue remain (`grep 'mcp-lint: allow' $F` shows nothing else).
  Run: `wc -w $F` → at most `8447` (1,200 under the 9,647 baseline).
- [ ] **Step 4: Commit:** `git commit -am "shepherdr: lanes on herd_lanes; budgets read from the daemon"`.

### Task 5: Compile, bump, certify, check

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`"version": "0.31.16"`), `plugins/mattstack/pack/requires.json` (`{ "minEngine": "0.31.16" }`)
- Regenerate: `plugins/mattstack/skills/shepherdr/**`

- [ ] **Step 1:** Set both versions; confirm main's version first with `git fetch -q origin main && git show origin/main:plugins/mattstack/.claude-plugin/plugin.json | grep version` (if main is above 0.31.14, use main's next patch in both files).
- [ ] **Step 2: Compile under an isolated HOME.**
  Run: `T=$(mktemp -d); env -i HOME=$T PATH="$PATH" bun cli.ts skills compile --pack mattstack --pack-dir "$PWD/plugins/mattstack"`
  Expected: exit 0; `git status --short plugins/mattstack/skills/shepherdr` shows `SKILL.md` modified and nothing outside `skills/shepherdr`.
- [ ] **Step 3: Read** `plugins/mattstack/skills/shepherdr/SKILL.md` in full and confirm the three graphs match the source and no `{{` remains.
- [ ] **Step 4: Gates.**
  Run: `cd plugins/mattstack && for d in skills/shepherdr/ attachments/orchestration/shepherdr/; do sh tests/certify.sh "$d" || exit 1; done; cd -` → no `FAIL`.
  Run: `bash $D/render.sh plugins/mattstack/skills/shepherdr/SKILL.md && python3 $D/check-dot.py plugins/mattstack/skills/shepherdr/SKILL.md` → clean.
  Run: `T=$(mktemp -d); mkdir -p $T/m; env -i HOME=$T PATH="$PATH" bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir $T/m --strict; echo rc=$?` → `rc=0`.
  Run: `bun run purity` → pass.
- [ ] **Step 5: Commit:** `git add plugins/mattstack && git commit -m "mattstack 0.31.16: compile shepherdr on the herd tools"`.

### Task 6: GREEN and refactor (controller-run)

**Files:**
- Create: `.superpowers/sdd/shepherdr-tests/green/S<n>-r<k>.md`
- Modify: `docs/superpowers/specs/2026-10-16-shepherdr-skill-design.md` (`## Test results` GREEN rows)

- [ ] **Step 1: Run GREEN:** the same six scenarios, five fresh agents each, same model and effort as Task 1, with the compiled `plugins/mattstack/skills/shepherdr/SKILL.md` in place of the baseline.
- [ ] **Step 2: Score** with Task 1's columns; add the GREEN rows beside RED.
- [ ] **Step 3: If any GREEN deviation:** fix the source wording that the transcript points at, recompile (Task 5 Step 2), rerun that scenario's five, and count a craft round. At 3 craft rounds, stop and raise it through the herd's question channel.
- [ ] **Step 4: Commit** the spec (and any source/compiled fix): `git commit -am "spec: GREEN results for shepherdr on the herd tools"`.
