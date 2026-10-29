# Review rule selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `review`, `self-review` and `receive-review` engines gain an optional `rule-selector` slot (contract `rule-selector@1`) that selects rules for the diff, asks the reviewer for a verdict per rule, checks the verdicts, and turns failed rules into findings.

**Architecture:** Each engine declares a `rule-selector` prop in a new block. Two new include bodies carry the shared prose: `review-rules-select-body` (the contract and the select step, all three engines) and `review-rules-verdicts-body` (check, repair, fails to findings, the verdict file; review and self-review). New graph nodes, each bound to its own short node block, place the steps in the review and self-review graphs and the select step in receive-review. Everything is engine prose compiled by `rt skills compile`; tests compile the real engines against a fixture pack.

**Tech Stack:** Markdown block trees under `plugins/mattstack/attachments/`, Mermaid engine graphs, `rt skills compile`, `bun test`, `check-dot.py`, `certify.sh`.

**Spec:** `docs/superpowers/specs/2026-10-28-review-rule-selector-design.md` (read it first; it is the authority).

## Global Constraints

- Tool-neutral: no engine, include, test fixture name or doc names a specific selector tool, product, team or employer. Fixture names use `acme`.
- Prop: name `rule-selector`, `merge: replace`, `default: ""`, `contract: "rule-selector@1"`; marker `{{props.rule-selector}}` alone on its line.
- Fill lines, verbatim: `selector: none`; or `selector: <command line with {format}>`, `verdicts: <command line with {selection} and {verdicts}>`, `fence: <info string>`. Placeholders use single braces (`{{` is a compiler token).
- Budget key `verdict-rounds:<depth>`, limit 2, charged on the problem event (one repair).
- Files in the review scratch dir: `selection.json`, `verdict-set.json`, `review-verdicts.json`. Next to the report json: `review-verdicts.json`.
- Tiers: a `blocking` rule's fail is Important, an `advisory` rule's fail is Minor; Critical is never assigned by a rule.
- Graph rules: short ids (`[a-z]+(_[a-z]+)*`), a plaintext node's id starts with its call word (`run_budget_...`), diamonds end in `?` with labelled out-edges, a node block has `node:` and a `# ` title and no `order:`.
- No em or en dashes, no personal names, no ticket ids (certify greps). Shell forms an MCP tool covers need `<!-- mcp-lint: allow -->` only where the engine truly runs them; the selector and verdicts commands come from the fill and run on Bash.
- No new MCP tool or app capability: leave `plugins/mattstack/pack/requires.json` unchanged.
- One `plugins/mattstack/.claude-plugin/plugin.json` version bump for the branch, in the last task, with the recompiled mattstack-pack output in the same commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Read `.claude/rules/build-and-plugin.md`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` and `plugins/mattstack/plugin/skills/process-digraphs/SKILL.md` before editing engine text; load superpowers:writing-skills for the prose.

## Review Focus

1. A fill that resolves to `selector: none`, or no binding at all: the run is byte-for-byte today's behaviour apart from skipped steps. Pinned in Task 1 (unbound compile has no fill text) and in each graph task's prose ("with no selector, skip").
2. A selector that exits non-zero or prints JSON without `rules`: quoted as a setup observation, dispatch goes ahead with no rule text and no verdict request. Pinned in Task 1's select prose and the GREEN walkthrough in Task 5.
3. A reviewer reply with no fenced block, or two: one problem, one repair, then unanswered rules in the notes; never a hold. Pinned in Task 1's verdicts prose and Task 5's walkthrough.
4. Head checkout provisioning failed: the select step still runs (it needs only the diff). Pinned in Task 2 (every edge into `dispatch_reviewer` passes `select_rules`).
5. A fail whose only evidence is `old`-side: anchored nowhere on the new side; it stays a finding with the location in the body. Pinned in Task 1's fails-to-findings prose.

---

### Task 1: The slot and the shared bodies

**Files:**
- Create: `plugins/mattstack/attachments/review-rules-select-body/index.block.md` and its section blocks
- Create: `plugins/mattstack/attachments/review-rules-verdicts-body/index.block.md` and its section blocks
- Create: `plugins/mattstack/attachments/review/review/rule-selector.block.md`, `.../self-review/rule-selector.block.md`, `.../receive-review/rule-selector.block.md`
- Create: `plugins/mattstack/attachments/review/review/rule-verdicts.block.md`, `.../self-review/rule-verdicts.block.md` (a block may end with only one headed include: `render.ts` raises `text-after-include` for anything after it)
- Create: `lib/skills/__tests__/fixtures/rule-selector/` (a pack: `pack/stubs.jsonc` rostering `review`, `self-review`, `receive-review`; `pack/skills.jsonc` binding `mattstack:<engine>/rule-selector` → `acme:acme-rule-selector` for all three; `attachments/acme-rule-selector/SKILL.md` with `metadata.provides: "rule-selector@1"`)
- Test: `lib/skills/__tests__/rule-selector.test.ts`

**Interfaces:**
- Produces: block key `mattstack:<engine>/rule-selector`, prop `rule-selector`, contract `rule-selector@1`; include names `review-rules-select-body` and `review-rules-verdicts-body` with these section titles (later tasks' node blocks point at them by title): select body: `# Rule selector`, `## The contract`, `## Select the rules`, `## When the selector fails`; verdicts body: `# Rule verdicts`, `## Check the verdict set`, `## Repair the verdict set`, `## Failed rules become findings`, `## The verdict file`.

- [ ] **Step 1: Write the failing tests** in `rule-selector.test.ts`, compiling the real `plugins/mattstack` against the fixture the way `browser-target.test.ts` does (`skillsCompile` with `--pack-dir`, `--mattstack-dir`, `--manifest`):
  - `bound: each review engine inlines the fill under the rule-selector prop`: for each of the three verbs, the compiled SKILL.md contains the fill's `fence: acme-verdicts` line and a seam marker containing `prop:rule-selector.rule-selector`.
  - `bound: review and self-review include both bodies, receive-review only the select body`: `## Select the rules` in all three; `## Failed rules become findings` in review and self-review only.
  - `unbound: no fill text, bodies still present`: compile the same fixture with the bindings removed; no `acme-verdicts`, and `## Select the rules` still present.
  - `a fill providing another contract is refused`: a second fixture fill with `provides: "review-criteria@1"` bound to `rule-selector` makes the compile fail; through `skillsCompile` the error is a `SkillsUsageError` whose text carries the message, so assert on `provides "review-criteria@1", but the prop's contract is "rule-selector@1"` (use `runExpectingCleanExit` from `lib/skills/__tests__/helpers.ts`, or assert the code `contract-mismatch` at the `compileBlockSkill` level as `compile-blocks.test.ts` does around line 724).
- [ ] **Step 2: Run them, expect FAIL.** `bun test lib/skills/__tests__/rule-selector.test.ts` (from the repo root).
- [ ] **Step 3: Write the prop blocks and the bodies.** Each engine's `rule-selector.block.md` copies `criteria.block.md`'s shape: the prop frontmatter from Global Constraints, `order:` 9 in review, 8 in self-review, 9 in receive-review (each a free value just before the engine's `reviewer` or `reply-rules` block; renumber nothing), title `# Rule selector`, the marker, then `{{include:review-rules-select-body}}` as the block's last line. Review and self-review each get a second block, `rule-verdicts.block.md`, `order:` 9.5 in review and 8.5 in self-review (`order` is any number and sorts numerically), title `# Rule verdicts`, holding only `{{include:review-rules-verdicts-body}}`. The bodies carry the spec's sections as engine prose: the contract (the spec's rule-selector@1 text), select (resolve the fill on every run; with `selector: none` or no binding skip every rule step; run the selector with `json` then `text` on the diff on stdin; make the review scratch dir here if none exists yet and write `selection.json` there; the text goes in the dispatch payload with the request to end the reply with the verdict set in a block tagged with the `fence` value), failure (quote as a setup observation; go on with no rules), check (extract the block to `verdict-set.json`; zero or two or more blocks, or unparseable JSON, is one problem; run the verdicts command with `{selection}` and `{verdicts}` replaced by the two paths; exit 0 none, 1 problems, other exit one problem), repair (charged per the budget; a fresh reviewer gets the selection text, the first verdict set and findings, and the problems, and returns a corrected verdict set only; the first findings stay), fails to findings (title `<rule id>: <summary>`, tiers per Global Constraints, anchor the first `new` evidence, `old` locations in the body, merge with a reviewer finding at the same file and line, rules with no valid verdict listed as unanswered in the draft's notes with the problems left), the verdict file (`review-verdicts.json` in the scratch dir always, next to the report json when a report path was handed in).
- [ ] **Step 4: Run the tests, expect PASS;** also `bun test lib/skills/__tests__/browser-target.test.ts` stays green.
- [ ] **Step 5: Certify** each new attachment root: `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/review-rules-select-body` and the same for `review-rules-verdicts-body`; the engine roots are certified in Task 5.
- [ ] **Step 6: Commit.** `git add plugins/mattstack/attachments lib/skills/__tests__` then `git commit -m "skills: rule-selector slot and shared rule bodies for the review engines"`.

---

### Task 2: The review graph

**Files:**
- Modify: `plugins/mattstack/attachments/review/review/the-review-graph/index.block.md`
- Create in `.../the-review-graph/`: `select-rules.block.md`, `check-verdicts.block.md`, `repair-verdicts.block.md`, `fails-to-findings.block.md`
- Modify: `.../review/run.block.md` (budget table), `.../the-review-graph/write-post-extras.block.md`, `.../the-review-graph/write-report.block.md`, `plugins/mattstack/attachments/review-core-body-after/dispatch-the-review.block.md`, `plugins/mattstack/attachments/review-dispatch-body-after/reviewer-shape.block.md`
- Test: `lib/skills/__tests__/rule-selector.test.ts`

**Interfaces:**
- Consumes: Task 1's section titles.
- Produces: node ids `select_rules`, `check_verdicts`, `verdict_problems`, `run_budget_verdict_rounds`, `verdict_rounds_spent`, `repair_verdicts`, `fails_to_findings` (Task 3 reuses the same ids in the self-review graph).

- [ ] **Step 1: Failing test** `review graph places the rule steps`: in the bound compile's review SKILL.md, the dot fence has edges `select_rules -> dispatch_reviewer`, `dispatch_reviewer -> check_verdicts`, `assemble_draft -> fails_to_findings`, `fails_to_findings -> verify_blocking`, no edge `dispatch_reviewer -> assemble_draft`, the edge `redispatch_reviewer -> assemble_draft` still present (the verify re-dispatch bypasses the verdict loop), and the text contains `run_budget {runDb, key: verdict-rounds:<depth>, limit: 2, stage}`. Run it, expect FAIL.
- [ ] **Step 2: Edit the graph.** Declare the nodes:
  - `select_rules` (block title `Select the rules for the change`);
  - `check_verdicts` (`Check the reviewer's verdict set`);
  - `verdict_problems{Verdict problems left?}`;
  - `run_budget_verdict_rounds[/"run_budget {runDb, key: verdict-rounds:<depth>, limit: 2, stage}"/]`;
  - `verdict_rounds_spent{verdict-rounds:<depth> spent?}`;
  - `repair_verdicts` (`Repair the verdict set`);
  - `fails_to_findings` (`Turn failed rules into findings`).

  Edges: every edge that today ends at `dispatch_reviewer` (the two `checks not run` edges, `repro_browser -->|no...|`, `capture_repro -->|...|`) ends at `select_rules` instead, with the same labels, and `select_rules --> dispatch_reviewer`; replace `dispatch_reviewer --> assemble_draft` with `dispatch_reviewer --> check_verdicts`, `check_verdicts --> verdict_problems`, `verdict_problems -->|none, or no selector| assemble_draft`, `verdict_problems -->|yes| run_budget_verdict_rounds`, `run_budget_verdict_rounds --> verdict_rounds_spent`, `verdict_rounds_spent -->|no| repair_verdicts`, `repair_verdicts --> check_verdicts`, `verdict_rounds_spent -->|yes: list them in the notes| assemble_draft`; replace `assemble_draft --> verify_blocking` with `assemble_draft --> fails_to_findings` and `fails_to_findings --> verify_blocking`. `redispatch_reviewer --> assemble_draft` stays.
- [ ] **Step 3: Node blocks.** Each is a few lines that point to its Task 1 section by title and say what to skip with no selector (select: skip when unbound or `selector: none`; check: with no selector, `verdict_problems` takes `none`; fails: nothing to add with no selector, and on a pass after `redispatch_reviewer` the merge keeps one finding per rule).
- [ ] **Step 4: Edit the existing blocks.** `run.block.md`: a row `` `verdict-rounds:<depth>` | 2 | a verdict check at that depth leaves problems ``. `write-post-extras.block.md`: reuse the scratch dir `select_rules` made, if any, instead of making a new one. `write-report.block.md`: write `review-verdicts.json` next to the report json when a selector ran. `dispatch-the-review.block.md`: add the rule selection text, when a selector ran, to the payload list. `reviewer-shape.block.md`: when the payload carries a rule selection, the reply ends with the verdict set in the fenced block it names.
- [ ] **Step 5: Run the test, expect PASS.** Then compile to a scratch pack the way CI does (`editing-skills` "Edit or create the skill in its source path": copy `plugins/mattstack` and the two `tests/graph-*.jsonc` files to a scratch dir, `rt skills compile --pack-dir <scratch>/pack --mattstack-dir <scratch>/ms`) and run `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids <scratch>/pack/skills/review/SKILL.md` (a rostered door lands under `skills/`; check `attachments/review/` if it is not there). Expected: no output, exit 0. Do the same against the bound fixture compile.
- [ ] **Step 6: Commit.** `git commit -m "skills: review selects rules before dispatch and turns failed rules into findings"`.

---

### Task 3: The self-review graph

**Files:**
- Modify: `plugins/mattstack/attachments/review/self-review/the-self-review-graph/index.block.md`, `.../self-review/run.block.md`
- Create in `.../the-self-review-graph/`: `select-rules.block.md`, `check-verdicts.block.md`, `repair-verdicts.block.md`, `fails-to-findings.block.md`
- Test: `lib/skills/__tests__/rule-selector.test.ts`

**Interfaces:**
- Consumes: Task 1's section titles; Task 2's node ids and titles (same ids, same titles).

- [ ] **Step 1: Failing test** `self-review graph places the rule steps`: edges `run_depth_checks -> select_rules`, `select_rules -> repro_browser`, `dispatch_reviewer -> check_verdicts`, `fails_to_findings -> assemble_draft`, the `verdict-rounds` budget node, and `make_recorded_move -> assemble_draft` unchanged. Run, expect FAIL.
- [ ] **Step 2: Edit the graph.** Same node declarations as Task 2. `run_depth_checks --> select_rules --> repro_browser` replaces `run_depth_checks --> repro_browser`. Replace `dispatch_reviewer --> assemble_draft` with the check loop of Task 2, whose `none, or no selector` and `yes: list them in the notes` edges go to `fails_to_findings`, then `fails_to_findings --> assemble_draft`.
- [ ] **Step 3: Node blocks** as in Task 2; the select block names the diff: the working-tree diff from the merge base, uncommitted changes included (`git diff <merge base>`, the same diff `find_merge_base` and `dispatch_reviewer` describe; `<!-- mcp-lint: allow -->` if the lint flags it), so the rules match what the reviewer judges. `run.block.md`: the budget row.
- [ ] **Step 4: Run the test, expect PASS;** check-dot on the compiled self-review, bound and unbound, as in Task 2.
- [ ] **Step 5: Commit.** `git commit -m "skills: self-review selects rules and turns failed rules into findings before the draft"`.

---

### Task 4: receive-review selects rules for the adjudicator

**Files:**
- Modify: `plugins/mattstack/attachments/review/receive-review/steps/index.block.md`, `.../steps/dispatch-adjudicator.block.md`
- Create: `.../steps/select-rules.block.md`
- Test: `lib/skills/__tests__/rule-selector.test.ts`

- [ ] **Step 1: Failing test** `receive-review selects rules before the adjudicator`: edges `any_unresolved -> select_rules` (labelled `yes`), `select_rules -> dispatch_adjudicator`; no `check_verdicts` node in receive-review. Run, expect FAIL.
- [ ] **Step 2: Edit the graph.** `any_unresolved -->|yes| select_rules`, `select_rules --> dispatch_adjudicator`; the revise path that re-enters `dispatch_adjudicator` stays as is (selection reused, not re-run). Node block `select_rules` (title `Select the rules for the change`): the select section of the select body, run on the diff range the adjudicator is handed; no verdict request.
- [ ] **Step 3:** `dispatch-adjudicator.block.md`: the selection text, when a selector ran, goes to the adjudicator as reference for judging threads.
- [ ] **Step 4: Run the test, expect PASS;** check-dot on compiled receive-review, bound and unbound.
- [ ] **Step 5: Commit.** `git commit -m "skills: receive-review hands the adjudicator the selected rules"`.

---

### Task 5: Docs, version and verification

**Files:**
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/props.md` (prop table and the "what reviewers check" row), `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` (fill `provides` lines), `plugins/mattstack/README.md` (contracts list), `website/docs/skills/packs.mdx` (if it lists review props), `plugins/mattstack/CERTIFICATION.md` (ledger row), `plugins/mattstack/.claude-plugin/plugin.json` (patch bump), the recompiled mattstack-pack output under `plugins/mattstack/skills/` (only the version in its compiled ids changes: the shipped roster compiles none of the review engines)

- [ ] **Step 1: Docs.** A `rule-selector` row (merge replace, default empty, contract `rule-selector@1`, one line on what the fill resolves to); README and SKILL.md mention the contract beside `review-criteria@1`.
- [ ] **Step 2: Certify** every touched root: `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/review/review` (which holds both new blocks), `.../review/self-review`, `.../review/receive-review`, `.../review-core-body-after`, `.../review-dispatch-body-after`, the two new bodies, and `plugins/mattstack/plugin/skills/extending-a-pack`. Expected: no `FAIL` lines.
- [ ] **Step 3: Bump and recompile.** Patch-bump `plugin.json`; `rt skills compile --pack mattstack --pack-dir plugins/mattstack` (from this worktree; never the `--pack`-only form); `rt skills check --pack-dir plugins/mattstack --strict`. Expected: check passes.
- [ ] **Step 4: Full checks.** `bun test lib/skills commands/__tests__/skills.test.ts commands/__tests__/skills-bind.test.ts scripts/ci/__tests__/block-graphs-compiled.test.ts`, then the CI-style compile plus `check-dot.py --short-ids` on every compiled SKILL.md in the scratch pack. Expected: all pass.
- [ ] **Step 5: Commit.** `git add plugins/mattstack website docs` then `git commit -m "mattstack: document the rule-selector slot; bump"`.

The GREEN walkthrough (editing-skills) is the controller's: after Task 5, a fresh agent reads the bound compiled `review` SKILL.md and walks three scenarios (no binding; a selector that exits 1; a reply with no fenced block), reporting each step it would take. Review Focus 1 to 3 pass when it skips, quotes a setup observation and goes on, and makes exactly one repair then lists unanswered rules.
