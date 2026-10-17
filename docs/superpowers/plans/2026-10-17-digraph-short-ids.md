# Digraph Short Ids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prototype option A of the spec (every node gets a short id, its sentence in `label=`) on the checker, the process-digraphs rule, and two skills (watch-ci, stage-provision), and prove with RED/GREEN that agents follow the converted graphs no worse than the sentence-id ones.

**Architecture:** `check-dot.py` learns the short-id form while still passing every sentence-id graph. `convert.py` (the committed measurement script) gains a slug map so a conversion is scripted, hand-tuned and provably lossless (`--verify`). The two prototypes are converted with it, then tested with the approved tool-less recipe on the scenarios their own lanes already wrote.

**Tech Stack:** Python 3 (`check-dot.py`, `convert.py`), bash, Graphviz `dot`, `bun cli.ts skills compile`, `claude -p` (tool-less).

**Spec:** `docs/superpowers/specs/2026-10-17-digraph-short-ids-design.md` (read it first; option A is approved).

## Global Constraints

- Write only under: `plugins/mattstack/plugin/skills/process-digraphs/**`, `plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md`, `plugins/mattstack/attachments/pipeline/stage-provision/SKILL.md`, `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/**`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `.superpowers/`. No other skill converts.
- No employer names or slugs in anything committed. `bun run purity` passes before the branch is done.
- No plugin version bump, no push, no PR.
- Every `bun cli.ts` compile runs under an isolated HOME and `--mattstack-dir <scratch>` (use `build-system-files.sh`); never against `~/.mattstack`.
- Rep outputs and compiled system files live in the session scratchpad, never in the repo (the scripts refuse an out-dir inside the repo).
- The tool-less recipe, exactly: `claude --model sonnet --tools "" --strict-mcp-config --setting-sources local --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence`, one fresh empty directory per rep, 5 reps per scenario per side.
- RED = the base commit `1043f9eb8` (main at branch start); GREEN = this worktree.
- Short id form: `^[a-z]+(_[a-z]+)*$`. A graph labels every node or none. A `plaintext` id starts with its call's normalized first word; an octagon id starts with `stop_`.
- No em dashes or en dashes in committed prose.
- Commit after each task (`git add <files>; git commit`), message ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line.

## Review Focus

1. A sentence-id graph with a one-word lowercase node (`"done"`) and no labels must still pass (today's form is told apart by labels, not spelling). Test in Task 1.
2. A converted graph where an edge names the sentence instead of the id creates a phantom unlabelled node; it must fail as a mixed graph. Test in Task 1.
3. Plaintext labels whose first word is CamelCase (`EnterWorktree`), an env assignment (`CLAUDE_CONFIG_DIR=<dir> claude ...`), a shell command (`gh pr view`) or carries escaped quotes (`rt_verb {args: [\"skills\"]}`) must each accept the natural id. Tests in Task 1.
4. An id declared twice with two different labels silently merges two steps in dot; the source scan must catch it. Test in Task 1.
5. Converting a real skill must not change any node text, shape, style or edge; `convert.py --verify` must cover a hand-edited slug map, not only auto slugs. Check in Tasks 2, 4 and 5.

---

### Task 1: check-dot.py accepts and checks short ids

**Files:**
- Modify: `plugins/mattstack/plugin/skills/process-digraphs/check-dot.py`
- Test: `plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh`

**Interfaces:**
- Produces: `node_text(obj) -> str` (label when set and not `\N`, else the id); `call_prefix(text: str) -> str` (the normalized first word of a plaintext call); `double_declared(src: str) -> list[str]` (ids given a `label` in more than one statement). Problem strings named below; later tasks grep for them.

- [ ] **Step 1: Write the failing cases.** In `test-check-dot.sh`, replace the `opaque-id` case with `expect opaque-id "lowercase words joined by underscores"` on the same `n1 [label="Start here" ...]` graph, and add (each with a one-line graph, `"A"`/success outcome as the existing cases do):
  - `short-ok` → `""` : a full short-id graph: `start [label="Trigger: go" shape=ellipse]`, `git_push [label="git_push {tree}" shape=plaintext]`, `refused [label="Refused?" shape=diamond]` (edges `no` → `done`, `yes` → `reported`), `stop_shell [label="STOP: push only with git_push" shape=octagon]` on a `tempted to` edge from `refused` redirecting to `git_push`, `reported [label="Refused: reported" shape=doublecircle]`, `done [label="Done" shape=doublecircle style=filled]`.
  - `sentence-lowercase-ok` → `""` : today's form with a node `"done"` (no labels anywhere).
  - `mixed` → `"label every node or none"` : a short-id graph plus one unlabelled quoted node.
  - `phantom-edge` → `"label every node or none"` : a short-id graph where one edge names `"git_push {tree}"` instead of `git_push`.
  - `dup-text` → `"two nodes share the text"` : two short ids with the same label.
  - `double-decl` → `"declared with a label twice"` : `git_push [label="git_push {tree}" shape=plaintext]; git_push [label="git_push {tree: <root>}"];`.
  - `prefix-bad` → `"starts with its call"` : `push [label="git_push {tree}" shape=plaintext]`.
  - `prefix-camel-ok`, `prefix-env-ok`, `prefix-shell-ok`, `prefix-escaped-ok` → `""` : ids `enter_worktree` for `EnterWorktree {name}`, `claude_update` for `CLAUDE_CONFIG_DIR=<dir> claude plugin update x`, `gh_pr_view` for `gh pr view <PR>`, `rt_verb_skills_check` for `rt_verb {args: [\"skills\", \"check\"]}`.
  - `stop-prefix` → `"starts with stop_"` : octagon `halt [label="STOP: halt" shape=octagon]`.
  - `label-rules` → `"phrased as a question"` : short id `ask [label="Ready" shape=diamond]` (the text rule reads the label).
- [ ] **Step 2: Run** `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh` from the repo root. Expected: the new cases FAIL, every pre-existing case still passes.
- [ ] **Step 3: Implement** in `check-dot.py`:
  - `node_text(obj)` and use it everywhere `name` feeds a rule or a message (diamond `?`, `STOP` prefix, plaintext newline, `two_calls`, the off-script exit, every printed node). A message prints `"<text>"` plus ` [<id>]` when the id differs.
  - Replace the opaque-id ban: a labelled node whose id fails `^[a-z]+(_[a-z]+)*$` → `"<text>" [<id>]: a short id is lowercase words joined by underscores, no digits`.
  - Per graph: some nodes labelled and some not → `graph labels some nodes and not others (<unlabelled list>); label every node or none`.
  - Two nodes with equal `node_text` → `"<text>": two nodes share the text; give each step distinct text`.
  - `double_declared(src)` scans the block source with `(?m)^\s*([a-z][a-z_]*)\s*\[[^\]]*\blabel\s*=` and returns ids seen more than once → `"<id>": declared with a label twice; dot keeps one label and merges the steps`. Call it from `main` per block, beside `check(graph)`.
  - `call_prefix(text)`: drop leading `NAME=value ` tokens (`^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+`), take the leading `[A-Za-z0-9_-]+`, split CamelCase (`(?<=[a-z0-9])(?=[A-Z])` → `_`), `-` → `_`, lowercase. A plaintext short id that is neither equal to it nor starts with it plus `_` → `"<text>" [<id>]: a plaintext short id starts with its call (<prefix>)`.
  - An octagon short id not starting with `stop_` → `"<text>" [<id>]: a STOP's short id starts with stop_`.
  - The prefix and `stop_` rules apply only to labelled nodes; sentence-id graphs are checked exactly as today.
- [ ] **Step 4: Run** the test script again. Expected: every case passes. Then run `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py` over every plugin `.md` with a column-1 ```` ```dot ```` fence (`grep -rlE '^```dot' plugins/mattstack --include='*.md'`). Expected: same result as on the base commit (all ok).
- [ ] **Step 5: Commit** `check-dot.py` and `test-check-dot.sh`: `process-digraphs: check-dot accepts short ids with the sentence as label`.

### Task 2: convert.py applies a slug map

**Files:**
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/convert.py`

**Interfaces:**
- Consumes: Task 1's id rules (the auto slugs should pass them).
- Produces: `convert.py --emit-slugs <in.md>` prints a JSON object `{"<node text>": "<slug>"}` for every node scheme `all` would convert; `convert.py --scheme all --slugs <map.json> <in.md> <out.md>` uses the map's slug for each text it lists and the auto slug otherwise; `--verify <file.md> [--slugs <map.json>]` checks the map-applied conversion too.

- [ ] **Step 1:** Change `make_slug` so auto slugs meet Task 1: plaintext slugs start with the call prefix (same normalization as `call_prefix`), octagons with `stop_`, no digits (a clash appends a distinguishing word from the text, never `_2`; if none is left, append `alt`, `other`, ...).
- [ ] **Step 2:** Add `--emit-slugs` and `--slugs` as above; a map entry for a text not in the file is reported on stderr and exits 1.
- [ ] **Step 3: Verify:** `convert.py --verify` over the five compiled files from `build-system-files.sh 1043f9eb8 <scratch>/base` prints 30 `ok` lines; `--emit-slugs` on `watch-ci/SKILL.md` round-trips: `--scheme all --slugs <emitted>` output is byte-identical to `--scheme all` output; each converted base file passes Task 1's `check-dot.py` with no findings.
- [ ] **Step 4: Commit:** `digraph-ids: convert.py slug maps and rule-clean auto slugs`.

### Task 3: process-digraphs states the short-id rule (writing-skills RED/GREEN)

**Files:**
- Modify: `plugins/mattstack/plugin/skills/process-digraphs/SKILL.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/authoring/A1-draw.md`, `A2-extend.md`, `authoring-red-green.md`

**Interfaces:**
- Consumes: Task 1's checker.

- [ ] **Step 1: Write the scenarios.** A1: a prose process (a trigger, a `git_push` call that can be refused, a retry counter, a guard STOP for the shell, an `mr_create` call, an outcome) and "Write the dot block for this process, following the skill. Output only the fenced block." A2: a 12-node short-id graph (built with the new form, passing Task 1) plus "Add a `run_budget {key: push-retries, limit: 2}` call before the retry and a `Budget spent?` decision whose yes edge goes to a new outcome `Push refused: reported`. Output the whole updated block."
- [ ] **Step 2: RED.** 5 reps each of A1 and A2 with the recipe and `--append-system-prompt-file` = the base commit's `SKILL.md`. Run each rep's block through Task 1's `check-dot.py`. Record per rep: form (short ids / sentences / mixed), check-dot findings, words in the block.
- [ ] **Step 3: Edit SKILL.md** per the spec's "The rule": the Node vocabulary paragraph (text is the label, id is the handle, the id form, plaintext prefix, `stop_`, declare once in process order, label every node or none); the example graph in the new form (the spec's `hotfix_push`, keeping its off-script section); rule 1 keeps `### <exact node text>` and says the text is the label; recipe step 4's failure list names the new checks in place of "an opaque id"; publish checklist line 5 says identical text fails the check and identical ids merge steps. Write recipe-form guidance (what a node IS), not a prohibition list.
- [ ] **Step 4: GREEN.** Same 5+5 reps on the edited `SKILL.md`. Pass: at least 4 of 5 per scenario produce a short-id block that passes Task 1's `check-dot.py`, and no rep produces a mixed graph or a digit id. A miss revises the text and reruns that scenario, at most 2 rounds, then report.
- [ ] **Step 5:** `bash plugins/mattstack/plugin/skills/process-digraphs/render.sh plugins/mattstack/plugin/skills/process-digraphs/SKILL.md <scratch>/r` and `check-dot.py` on it pass; `sh plugins/mattstack/tests/certify.sh plugins/mattstack/plugin/skills/process-digraphs` passes. Write `authoring-red-green.md` (method, per-rep table, word counts of the blocks).
- [ ] **Step 6: Commit:** `process-digraphs: short ids with the sentence as label (RED/GREEN)`.

### Task 4: Convert watch-ci

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/slugs/watch-ci.json`

**Interfaces:**
- Consumes: Task 2's `--emit-slugs`, `--slugs`, `--verify`; Task 1's checker.

- [ ] **Step 1:** `convert.py --emit-slugs` on the SKILL.md into `slugs/watch-ci.json`; hand-edit every slug that does not name its step (generic, a stray word, or a near twin of another), keeping each 1 to 4 words.
- [ ] **Step 2:** `convert.py --scheme all --slugs slugs/watch-ci.json` in place; reorder nothing else in the file. Node declarations stay in the order the source had them.
- [ ] **Step 3: Verify:** `convert.py --verify <base SKILL.md> --slugs slugs/watch-ci.json` ok; a direct `dot -Tjson` comparison of base and converted (node texts, shapes, styles, edges) equal; `render.sh` and Task 1's `check-dot.py` pass on the file; `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/watch-ci` passes; `### ` section headings and every prose mention of node text are unchanged (`git diff` touches only lines inside the dot fences).
- [ ] **Step 4: Commit:** `watch-ci: short digraph ids (prototype)`.

### Task 5: Convert stage-provision

Same as Task 4 for `plugins/mattstack/attachments/pipeline/stage-provision/SKILL.md` with `slugs/stage-provision.json`; certify on its dir. Commit: `stage-provision: short digraph ids (prototype)`.

### Task 6: RED/GREEN on watch-ci

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/run-reps.sh`, `blind.sh`, `red-green.md`

**Interfaces:**
- Consumes: Task 4's converted SKILL.md.
- Produces: `run-reps.sh --prompt <prompt-file> --out <dir> [--system <file>] [--reps N]` (one fresh empty dir per rep, the recipe, parallel, refuses an out-dir in the repo); `blind.sh <dir>... <blind-dir>` copies every `rep-*.txt` to `<blind-dir>/<random>.txt` and writes the mapping to `<blind-dir>/../mapping.tsv`.

- [ ] **Step 1:** Build the two prompt files: base or converted `SKILL.md`, then the World, Conventions, Shared shapes and `## watch-ci` sections (through the line before `## stage-watch-ci`) of `2026-10-16-ship-ci-skills/scenarios.md`, then: "Follow this skill exactly. For each scenario, list every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything." Probe once: a rep that tries a tool gets none.
- [ ] **Step 2:** 5 reps RED, 5 reps GREEN (each rep covers all 13 scenarios). Blind them.
- [ ] **Step 3: Score** every blind transcript against `2026-10-16-ship-ci-skills/expected.md`, per scenario, on the lane's columns (shell calls a tool covers, hand-held lease calls, counters in context, re-derived values, skipped steps, runaway loops, refusal missed its gate or stand-down, release on a stand-down) plus "stop named by the node's text or id" (yes/no). Read the mapping only after every transcript is scored.
- [ ] **Step 4:** Write `red-green.md` (method, per-rep tables per side, totals per scenario and per column). Pass: GREEN's total deviations ≤ RED's for the skill and for each scenario. A miss: name the node(s) the deviating reps lost, revise the slug map or the rule, reconvert (Task 4 Steps 2-3), rerun GREEN, at most 2 rounds, then stop and report the table.
- [ ] **Step 5: Commit** the scripts and record: `digraph-ids: watch-ci RED/GREEN`.

### Task 7: RED/GREEN on stage-provision

**Files:**
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-17-digraph-ids/red-green.md`

- [ ] **Step 1:** System files: `build-system-files.sh 1043f9eb8 <scratch>/red` and `build-system-files.sh <worktree> <scratch>/green`; use each `stage-provision.md`. Prompts: `2026-10-16-pipeline-skills/scenarios/S5-occupied-ticket-branch.md` and `S5b-precheck-daemon-outdated.md`, unchanged.
- [ ] **Step 2:** `run-reps.sh --system <stage-provision.md> --prompt <scenario>`, 5 reps per scenario per side; blind; score on the pipeline lane's S5/S5b pass criteria (`2026-10-16-pipeline-skills/red-green.md`, "Pass criteria") plus the stop-named column.
- [ ] **Step 3:** Append to `red-green.md`. Same pass bar and fix budget as Task 6.
- [ ] **Step 4: Commit:** `digraph-ids: stage-provision RED/GREEN`.

### Task 8: Measure, check the plugin, fill the spec's Results

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-digraph-short-ids-design.md` (Results only)

- [ ] **Step 1:** `wc -w` and `count-tokens.sh` on the RED and GREEN compiled `watch-ci.md` and `stage-provision.md` (from Task 7's build dirs), and `wc -w` on both source `SKILL.md`s at base and HEAD.
- [ ] **Step 2: Whole-plugin checks**, from the repo root with an isolated HOME and scratch mattstack dir: the check-dot sweep over every plugin `.md` with a dot block; `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh`; certify on process-digraphs, watch-ci and stage-provision; `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir <scratch> --strict`; `bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir <scratch>`; `bun run purity`. Expected: every one exits 0; if `skills check --strict` fails only on the missing version bump, record that (no bump on this branch by design).
- [ ] **Step 3:** Fill the spec's Results: the deviation tables (RED vs GREEN per scenario), the stop-named counts, words and tokens before and after for both prototypes, the authoring RED/GREEN summary, the check outputs, and a recommendation on Decision 2.
- [ ] **Step 4: Commit:** `digraph-ids: spec results`.
